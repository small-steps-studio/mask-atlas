'use strict';
// The pipeline every format shares. A format reader turns one unit (an HL7 message, an X12
// interchange, a FHIR resource or bundle) into
//   hits       fields that a rule identifies: { kind, value, path, set(newText), fmt, lat }
//   freeSlots  free-text fields: { get(), set(text), path, sweep }
//   idents     identifiers of the patient, most reliable first (for the date offset)
// and calls finishUnit. Modes: 'mask' (fixed pattern), 'pseudonym', or scanOnly (count, change nothing).

const { CATEGORY_OF } = require('./run');
const { createSeen, scanText } = require('./free');

const GENERIC = new Set(require('./words').GENERIC_ORG_WORDS);
const SEEN_KINDS = new Set(['family', 'given', 'fullname', 'org', 'place', 'street', 'city', 'phone', 'ssn', 'record', 'plan', 'licence', 'device', 'other', 'taxid', 'msgid', 'routing']);

function categoryOf(kind) { return CATEGORY_OF[kind] || 'other'; }

function finishUnit(run, unit, hits, freeSlots, idents, options) {
  const opts = options || {};
  const scanOnly = opts.scanOnly === true;
  const pseudo = run.mode === 'pseudonym';
  run.stats.units++;
  const person = pseudo ? run.person(idents) : null;
  const useFree = pseudo && run.options.freeText && opts.freeText !== false;
  const seen = useFree ? createSeen() : null;

  const active = [];
  for (const h of hits) {
    if (h.kind === 'keep') { run.keepNote(h.path); continue; } // a place that a rule of the user's keeps as it is
    if ((h.kind === 'org' || h.kind === 'place') && !run.options.maskOrganisations) continue;
    if (h.envelope && run.options.keepEnvelope) continue;
    if (h.kind === 'date' && !run.options.shiftDates && pseudo) continue;
    if (typeof h.value !== 'string' || h.value === '' || !/[\p{L}\p{Nd}]/u.test(h.value)) continue;
    active.push(h);
    if (seen && SEEN_KINDS.has(h.kind)) {
      seen.add(h.kind, h.value);
      if (h.kind === 'org' || h.kind === 'place') {
        const first = h.value.split(/[^\p{L}\p{Nd}'-]+/u).filter(Boolean)[0] || '';
        if (first.length >= 6 && !GENERIC.has(first.toLowerCase())) seen.add('family', first);
      }
      // an address written inside a name ("Records Office, 61 Records Lane") is a street seen here
      if ((h.kind === 'org' || h.kind === 'place' || h.kind === 'fullname' || h.kind === 'addrtext') && h.value.indexOf(',') !== -1) {
        for (const part of h.value.split(',').slice(1)) if (/^\s*\d+[\p{L}\p{Nd}\s.'-]*$/u.test(part) && /\p{L}/u.test(part)) seen.add('street', part.trim());
      }
    }
  }
  if (seen && opts.extraSeen) for (const e of opts.extraSeen) seen.add(e[0], e[1]);

  // names first, so that display strings and free text reuse the same name parts
  const first = active.filter(function (h) { return h.kind === 'family' || h.kind === 'given'; });
  const rest = active.filter(function (h) { return h.kind !== 'family' && h.kind !== 'given'; });
  const ordered = first.concat(rest);
  const personCache = new Map();
  function personFor(h) {
    if (!pseudo || !h.idents) return person;
    let p = personCache.get(h.idents);
    if (!p) { p = run.person(h.idents); personCache.set(h.idents, p); }
    return p;
  }
  let changed = 0;
  for (const h of ordered) {
    const category = h.category || categoryOf(h.kind);
    if (h.kind === 'text') continue;
    if (scanOnly) {
      if (opts.verify && (h.kind === 'date' || h.kind === 'binary' || h.kind === 'geo')) continue;
      if (opts.known && h.kind !== 'date' && opts.known(h.value)) continue;
      if (opts.onHit) opts.onHit(h, category);
      run.count(category, h.path, h.value, false);
      continue;
    }
    let next;
    if (h.kind === 'date') {
      next = run.shift(h.fmt || 'hl7', h.value, personFor(h));
      if (next === null) { run.stats.unparsedDates++; next = run.value('other', h.value); }
    } else next = run.value(h.kind, h.value, h);
    if (next !== h.value) { h.set(next); changed++; }
    run.count(category, h.path, h.value, next !== h.value);
  }

  // hits of kind 'text' hold running text inside a structured field: they are scanned like free text
  if (pseudo || scanOnly) {
    for (const h of active) {
      if (h.kind !== 'text') continue;
      run.stats.freeTextFields++;
      if (pseudo && !run.options.freeText) continue; // the setting scanFreeText is off: running text is left as it is
      run.stats.freeTextRead++;
      const res = scanText(h.value, { run: run, seen: seen, person: personFor(h), path: h.path, scanOnly: scanOnly, known: opts.known, dates: !opts.verify });
      if (res.count) { run.stats.freeTextHits += res.count; if (!scanOnly && res.text !== h.value) { h.set(res.text); changed++; } }
    }
  }

  for (const slot of freeSlots) {
    const text = slot.get();
    if (typeof text !== 'string' || !text) continue;
    if (!slot.sweep) run.stats.freeTextFields++;
    if (!pseudo) continue;
    // with the setting scanFreeText off, notes, comments and narrative are not read; the sweep of fields that the profile does not know goes on
    if (!slot.sweep && !run.options.freeText) continue;
    if (!slot.sweep) run.stats.freeTextRead++;
    const res = scanText(text, { run: run, seen: seen, person: personFor(slot), path: slot.path, distinctiveOnly: slot.sweep === true, scanOnly: scanOnly, known: opts.known, dates: slot.sweep !== true && !opts.verify });
    if (res.count) {
      run.stats.freeTextHits += res.count;
      if (!scanOnly && res.text !== text) { slot.set(res.text); changed++; }
    }
  }
  return changed;
}

module.exports = { finishUnit, categoryOf, SEEN_KINDS };
