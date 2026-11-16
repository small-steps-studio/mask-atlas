'use strict';
// Residual-identifier verification (Pro). It re-reads the OUTPUT and asks three questions:
//   1. original values: does any word or number that the run replaced still appear in the output?
//   2. patterns: is there an e-mail address, SSN-like number, telephone number or IP address in the
//      output that is not a replacement made by this run?
//   3. fields: does a field that the profile names (a name, address, number, ...) hold a value that
//      is not a replacement made by this run?
// A pass means that these three checks found nothing. It is not proof that the output is free of
// identifiers: the limits are listed in the report (see LIMITS). A finding is reported with its
// place (message or interchange, element path, kind), never with the value.

const engine = require('./engine');
const { createRun } = require('./run');
const { findPatterns } = require('./free');
const { createLocator } = require('./locate');

const LIMITS = [
  'The check only knows the values that this run replaced and the shapes and fields that Mask Atlas recognises.',
  'A word that the run itself wrote as a replacement is never counted as a left-over, anywhere in the output. When a replacement happens to equal an original value of another record, that original is not found by the first check where it stays; the third check still reads the fields of the profile.',
  'A name, address or number that was never in a recognised field, was not seen elsewhere in the same message and has no recognisable shape cannot be found by this check or by the de-identification.',
  'Text inside pictures, scanned documents and encoded attachments is not read.',
  'File names and folder names are not changed.',
  'Places that a rule file keeps (and, with the setting maskAtlas.scanFreeText off, notes and comments) are left as they are; the report says how many.',
  'Combinations of harmless-looking details (rare diagnoses, small places, exact ages) can still point to a person; review the output yourself.'
];

// the kinds whose replacement keeps the letters of the original (only digits change)
// the shortest letter run (between any two non-letters) that counts as a word kept from the original
const MIN_WORD = 2;
const DIGIT_ONLY_KINDS = new Set(['phone', 'ssn', 'ip']);
const TOKEN_RE = /[\p{L}\p{Nd}][\p{L}\p{Nd}'’._@\/-]*/gu;
const MAX_LOCATED = 200;     // places worked out per check of one text (the others are counted)
const MAX_LOCATION_ROWS = 400; // rows kept for a whole run
const CHECK_NAMES = { value: 'a replaced value is still there', pattern: 'a pattern the run did not create', field: 'a field holds a value the run did not create' };

function createVerifier(run) {
  const index = run.originalsIndex();
  const exported = run.exportRows();
  const knownStrings = new Set();
  const knownDigits = new Set();
  const knownTokens = new Set();
  for (const r of exported.rows) {
    if (r.category === 'date shift') continue;
    const low = r.replacement.toLowerCase();
    // A kind that changes only digits (phone, ssn, ip) keeps the letters of a value that has some. When a RULE of the rule file applies such a
    // kind to a street, "12 OAK ST" becomes "37 OAK ST". A letter run of two or more letters (between any two non-letters) that the
    // replacement shares with the original of its own map row is not a replaced word, so it is not known, and the street name that stays is
    // found like any other value the run did not create. Only rows made by a rule count: the built-in profile uses these kinds for
    // values such as "HC-ACC-228814" or "5035550123 MAIN", where the letters are not a name.
    const originalWords = DIGIT_ONLY_KINDS.has(r.kind) && r.byRule ? new Set(r.original.toLowerCase().split(/[^\p{L}]+/u).filter(function (w) { return w.length >= MIN_WORD; })) : null;
    const shared = function (w) { return originalWords !== null && originalWords.has(w); };
    const keeps = originalWords !== null && low.split(/[^\p{L}\p{Nd}'’]+/u).some(shared);
    if (!keeps) knownStrings.add(low);
    const digits = r.replacement.replace(/\D/g, '');
    if (digits.length >= 7) knownDigits.add(digits);
    for (const t of r.replacement.split(/[^\p{L}\p{Nd}'’]+/u)) if (t && !shared(t.toLowerCase())) knownTokens.add(t.toLowerCase());
    // the words of a replacement as the first check reads them (a reference such as Patient/p65 is one word there)
    for (const t of r.replacement.matchAll(TOKEN_RE)) { const w = t[0].toLowerCase().replace(/[._\/-]+$/, ''); if (!shared(w)) knownTokens.add(w); }
  }

  function isKnown(text) {
    const low = String(text).toLowerCase();
    if (knownStrings.has(low) || run.isKept(low)) return true;
    const digits = low.replace(/\D/g, '');
    if (digits.length >= 7 && knownDigits.has(digits)) return true;
    const toks = low.split(/[^\p{L}\p{Nd}'’]+/u).filter(Boolean);
    return toks.length > 0 && toks.every(function (t) { return knownTokens.has(t); });
  }

  /** Checks one output text. `format` is the format of the text. */
  function check(text, format, debug) {
    const res = { examples: [], originalValues: 0, patterns: 0, fields: 0, byPath: [], categories: new Map(), incomplete: !exported.complete, locations: [], keptByRule: 0, keptByDesign: 0, leftByRules: 0, leftPaths: [] };
    let locate = null;
    const places = new Map();
    let located = 0;
    // The place of a finding; false when the place is one that a run keeps on purpose (X12 control numbers): no finding there.
    function note(check, kind, offset) {
      if (!locate) locate = createLocator(text, format);
      let where;
      if (located < MAX_LOCATED) where = locate(offset);
      else {
        // past the cap only the count is kept, but a place that the run keeps on purpose is still no finding (X12 only: cheap to tell)
        where = { unit: 0, path: '(further places)', line: null };
        if (format === 'x12' && locate(offset).kept) where.kept = true;
      }
      if (where.kept) { res.keptByDesign++; return false; }
      located++;
      const key = check + '|' + where.unit + '|' + where.path + '|' + kind;
      const have = places.get(key);
      if (have) have.count++; else places.set(key, { check: check, kind: kind, unit: where.unit, path: where.path, line: where.line, count: 1 });
      return true;
    }
    // 1. original values
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      const raw = m[0];
      const low = raw.toLowerCase().replace(/[._\/-]+$/, '');
      if (low.length < 4) continue;
      if (index.ids.has(low)) { if (!knownTokens.has(low) && note('value', 'other', m.index)) { res.originalValues++; bump(res, 'other'); if (debug) res.examples.push('id:' + low); } continue; }
      if (/\d{7}/.test(low)) { const d = low.replace(/\D/g, ''); if (d.length >= 7 && index.ids.has(d) && !knownDigits.has(d) && note('value', 'other', m.index)) { res.originalValues++; bump(res, 'other'); continue; } }
      if (/\p{L}/u.test(low)) {
        for (const part of low.split(/[^\p{L}\p{Nd}'’]+/u)) {
          if (part.length >= 4 && index.names.has(part) && !knownTokens.has(part)) { if (note('value', 'names', m.index)) { res.originalValues++; bump(res, 'names'); if (debug) res.examples.push('name:' + part); } break; }
        }
      }
    }
    // 2. patterns
    for (const p of findPatterns(text, { dates: false, titles: false })) {
      if (p.kind === 'url') continue;
      const original = text.slice(p.start, p.end);
      if (isKnown(original)) continue;
      if (!note('pattern', p.category, p.start)) continue;
      res.patterns++; bump(res, p.category);
    }
    // 3. fields (and free text) of the profile
    const vrun = createRun({ mode: 'pseudonym', key: run.key, options: Object.assign({}, run.options, { recordMap: false }), userRules: run.userRules });
    const firstLine = new Map();
    const out = engine.processText(text, vrun, {
      format: format, scanOnly: true, verify: true, known: isKnown,
      onHit: function (h, category) { const k = h.path + '\u0000' + category; if (!firstLine.has(k) && typeof h.line === 'number') firstLine.set(k, h.line + 1); }
    });
    if (out.ok !== false) {
      for (const row of vrun.stats.byPath.values()) {
        res.fields += row.count;
        res.byPath.push({ path: row.path, category: row.category, count: row.count });
        places.set('field|0|' + row.path + '|' + row.category, { check: 'field', kind: row.category, unit: 0, path: row.path, line: firstLine.get(row.path + '\u0000' + row.category) || null, count: row.count });
      }
      for (const [cat, n] of vrun.stats.byCategory) res.categories.set(cat, (res.categories.get(cat) || 0) + n);
      res.keptByRule = vrun.stats.keptByRule;
    }
    // Places that the built-in profile alone would have replaced and that the rules of the rule file left as they are (rules of any
    // kind: keep, free-text, a single component of a field ...): the same check with the rules switched off. A pass does not stand
    // alone when there are any; the report names the places (paths and counts, never values).
    if (run.userRules) {
      const bare = createRun({ mode: 'pseudonym', key: run.key, options: Object.assign({}, run.options, { recordMap: false }), userRules: null });
      const out0 = engine.processText(text, bare, { format: format, scanOnly: true, verify: true, known: isKnown });
      if (out0.ok !== false) {
        // by field: the components of one HL7 field (PID-5.1, PID-5.2) are one place, counted by the most frequent of them
        const byField = new Map();
        for (const row of bare.stats.byPath.values()) {
          const field = row.path.replace(/^([A-Z][A-Z0-9]{2}-\d+)\.\d+$/, '$1');
          byField.set(field, Math.max(byField.get(field) || 0, row.count));
        }
        for (const [path, count] of byField) { res.leftByRules += count; res.leftPaths.push({ path: path, count: count }); }
        res.leftPaths.sort(function (a, b) { return b.count - a.count; });
      }
    }
    res.byPath.sort(function (a, b) { return b.count - a.count; });
    res.locations = Array.from(places.values()).sort(function (a, b) { return b.count - a.count; }).slice(0, MAX_LOCATION_ROWS);
    res.pass = res.originalValues === 0 && res.patterns === 0 && res.fields === 0 && !res.incomplete;
    return res;
  }

  function bump(res, category) { res.categories.set(category, (res.categories.get(category) || 0) + 1); }

  return { check: check, isKnown: isKnown };
}

/** Adds the result of one check to a running total; `file` names the file (or the document) that was checked. */
function combine(total, one, file) {
  total.originalValues += one.originalValues; total.patterns += one.patterns; total.fields += one.fields;
  total.incomplete = total.incomplete || one.incomplete;
  total.keptByDesign += one.keptByDesign || 0;
  total.keptByRule = Math.max(total.keptByRule, one.keptByRule || 0);
  total.leftByRules += one.leftByRules || 0;
  for (const r of one.leftPaths || []) {
    const have = total.leftPaths.get(r.path);
    if (have !== undefined) total.leftPaths.set(r.path, have + r.count); else if (total.leftPaths.size < 500) total.leftPaths.set(r.path, r.count);
  }
  for (const [cat, n] of one.categories) total.categories.set(cat, (total.categories.get(cat) || 0) + n);
  for (const r of one.byPath) {
    const k = r.path + '\u0000' + r.category;
    const have = total.paths.get(k);
    if (have) have.count += r.count; else total.paths.set(k, { path: r.path, category: r.category, count: r.count });
  }
  for (const loc of one.locations || []) {
    if (total.locations.length >= MAX_LOCATION_ROWS) { total.locationsCut = true; break; }
    total.locations.push(Object.assign({ file: file || '' }, loc));
  }
  total.files++;
  if (!one.pass) total.failedFiles++;
  return total;
}

function newTotal() { return { files: 0, failedFiles: 0, originalValues: 0, patterns: 0, fields: 0, incomplete: false, categories: new Map(), paths: new Map(), locations: [], locationsCut: false, keptByRule: 0, keptByDesign: 0, leftByRules: 0, leftPaths: new Map() }; }

module.exports = { createVerifier, combine, newTotal, LIMITS, CHECK_NAMES };
