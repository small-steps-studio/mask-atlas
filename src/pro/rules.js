'use strict';
// Rule files (Pro): a JSON document that adds paths to the built-in profile, changes the kind of a
// path or switches a built-in path off ("keep"). The first rule that matches a field wins.
//
//   { "version": 1, "rules": [
//       { "format": "hl7",  "path": "ZPD-5",              "kind": "record" },
//       { "format": "hl7",  "path": "PID-5.2",            "kind": "keep" },
//       { "format": "x12",  "path": "NM1[NM101=IL]-09",   "kind": "plan" },
//       { "format": "fhir", "path": "Patient.extension.valueString", "kind": "free-text" } ] }
//
// Paths: HL7 SEG-field[.component] (SEG may be Z* for every Z segment); X12 SEG-NN with an optional
// element test [NM101=IL]; FHIR dotted element names without indexes, either starting with a
// resource name or * (anchored) or just the last names (matched at the end of a path).

const MAX_BYTES = 1024 * 1024;
const MAX_RULES = 2000;

// rule kind -> internal kind ('FREE' marks running text, null means keep)
const KINDS = {
  keep: null, name: 'fullname', family: 'family', given: 'given', org: 'org', street: 'street', city: 'city', zip: 'zip', address: 'addrtext', date: 'date',
  phone: 'phone', email: 'email', ssn: 'ssn', url: 'url', ip: 'ip', record: 'record', plan: 'plan', licence: 'licence', device: 'device', id: 'other',
  'free-text': 'FREE', binary: 'binary'
};
const DATE_FORMATS = ['hl7', 'iso', 'd8', 'rd8', 'yymmdd'];

const HL7_PATH = /^((?:[A-Z][A-Z0-9]{2})|Z\*)-(\d{1,3})(?:\.(\d{1,2}))?$/;
const X12_PATH = /^([A-Z][A-Z0-9]{1,2})(?:\[([A-Z][A-Z0-9]{1,2})(\d{2})=([A-Za-z0-9]{1,20})\])?-(\d{2})$/;
const FHIR_SEG = /^(?:\*|[A-Za-z][A-Za-z0-9_]{0,60})$/;

/**
 * Reads and checks a rule file. Returns { ok: true, rules, count } or { ok: false, errors: [text] };
 * the messages name the rule number and the problem, never file contents beyond the rule's own path.
 */
function parseRules(text) {
  const errors = [];
  if (typeof text !== 'string' || text.length > MAX_BYTES) return { ok: false, errors: ['The rule file is larger than 1 MB.'] };
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, errors: ['The rule file is not valid JSON.'] }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, errors: ['The rule file must be a JSON object with "version" and "rules".'] };
  if (doc.version !== 1) errors.push('"version" must be 1.');
  if (!Array.isArray(doc.rules)) errors.push('"rules" must be a list.');
  else if (doc.rules.length > MAX_RULES) errors.push('"rules" may hold at most ' + MAX_RULES + ' rules.');
  if (errors.length) return { ok: false, errors: errors };
  const hl7 = new Map(), x12 = new Map(), fhir = [];
  let keepCount = 0, takeoverCount = 0;
  doc.rules.forEach(function (r, i) {
    const label = 'Rule ' + (i + 1) + ': ';
    if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(label + 'must be an object.'); return; }
    if (['hl7', 'x12', 'fhir'].indexOf(r.format) === -1) { errors.push(label + '"format" must be hl7, x12 or fhir.'); return; }
    if (typeof r.path !== 'string' || r.path.length > 200) { errors.push(label + '"path" must be a text of at most 200 characters.'); return; }
    if (!Object.prototype.hasOwnProperty.call(KINDS, r.kind)) { errors.push(label + '"kind" must be one of ' + Object.keys(KINDS).join(', ') + '.'); return; }
    const kind = KINDS[r.kind];
    if (kind === null) keepCount++;
    // a rule that names a field (or one component of an HL7 field) takes the place over from the built-in profile; these kinds can leave what it would have replaced
    else if (kind === 'FREE' || kind === 'binary' || (r.format === 'hl7' && /\.\d{1,2}$/.test(r.path))) takeoverCount++;
    let fmt;
    if (kind === 'date') {
      fmt = r.dateFormat || (r.format === 'fhir' ? 'iso' : r.format === 'x12' ? 'd8' : 'hl7');
      if (DATE_FORMATS.indexOf(fmt) === -1) { errors.push(label + '"dateFormat" must be one of ' + DATE_FORMATS.join(', ') + '.'); return; }
    }
    if (r.format === 'hl7') {
      const m = HL7_PATH.exec(r.path);
      if (!m) { errors.push(label + 'the HL7 path must look like PID-5, PID-5.2 or Z*-3.'); return; }
      const list = hl7.get(m[1]) || [];
      list.push({ field: Number(m[2]), comp: m[3] ? Number(m[3]) : 0, kind: kind, fmt: fmt });
      hl7.set(m[1], list);
    } else if (r.format === 'x12') {
      const m = X12_PATH.exec(r.path);
      if (!m) { errors.push(label + 'the X12 path must look like NM1-09 or NM1[NM101=IL]-09.'); return; }
      if (m[2] && m[2] !== m[1]) { errors.push(label + 'the element test must name the same segment (for example NM1[NM101=IL]-09).'); return; }
      const list = x12.get(m[1]) || [];
      list.push({ n: Number(m[5]), kind: kind, fmt: fmt, when: m[2] ? { n: Number(m[3]), value: m[4] } : null });
      x12.set(m[1], list);
    } else {
      const segs = r.path.split('.');
      if (segs.length > 12 || !segs.every(function (s) { return FHIR_SEG.test(s); })) { errors.push(label + 'the FHIR path must be dotted element names such as Patient.contact.name.text or *.note.text.'); return; }
      fhir.push({ segs: segs, anchored: /^[A-Z*]/.test(segs[0]), kind: kind, fmt: fmt });
    }
  });
  if (errors.length) return { ok: false, errors: errors };
  return { ok: true, rules: { hl7: hl7, x12: x12, fhir: fhir }, count: doc.rules.length, keepCount: keepCount, takeoverCount: takeoverCount };
}

/** The first FHIR rule matching a dotted path (array indexes already removed), or null. */
function matchFhir(rules, path) {
  if (!rules || !rules.fhir.length) return null;
  const segs = path.split('.');
  for (const r of rules.fhir) {
    if (r.anchored) {
      if (r.segs.length !== segs.length) continue;
      if (r.segs.every(function (s, i) { return s === '*' || s === segs[i]; })) return r;
    } else {
      if (r.segs.length > segs.length) continue;
      const off = segs.length - r.segs.length;
      if (r.segs.every(function (s, i) { return s === '*' || s === segs[off + i]; })) return r;
    }
  }
  return null;
}

/** Template written by "Create Rules File". */
function templateText() {
  return JSON.stringify({
    version: 1,
    rules: [
      { format: 'hl7', path: 'ZPD-5', kind: 'record' },
      { format: 'hl7', path: 'PV1-3', kind: 'keep' },
      { format: 'x12', path: 'REF[REF01=ZZ]-02', kind: 'id' },
      { format: 'fhir', path: 'Patient.extension.valueString', kind: 'free-text' }
    ]
  }, null, 2) + '\n';
}

module.exports = { parseRules, matchFhir, templateText, KINDS, MAX_RULES };
