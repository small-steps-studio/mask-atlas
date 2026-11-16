'use strict';
// The seen-value matcher as it was before the head index (one regular expression per kind of value,
// built for the whole set): the reference that test/free.seen.test.js compares the production
// matcher with. Kept as it was, on purpose; not used by the extension.

const W = require('../../src/core/words');
const { normName } = require('../../src/core/run');
const free = require('../../src/core/free');

const MIN_NAME = 3;
const SEEN_ID_KINDS = new Set(['record', 'plan', 'licence', 'device', 'other', 'taxid', 'msgid', 'routing', 'id']);
const foldLow = free.foldLow;
const digitSpans = free.digitSpans;
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }
function flexSpace(s) { return s.split(/\s+/).map(esc).join('\\s+'); }
const LOOK_BEFORE_WORD = '(?<![\\p{L}\\p{Nd}_])';
const LOOK_AFTER_WORD = '(?![\\p{L}\\p{Nd}_])';
const LOOK_BEFORE_ID = '(?<![A-Za-z0-9])';
const LOOK_AFTER_ID = '(?![A-Za-z0-9])';
function createSeenReference() {
  const names = new Map();     // lower-case token -> { kind, original, exact }
  const phrases = new Map();   // normalised phrase -> { kind, original }  (streets, towns, organisations)
  const ids = new Map();       // lower-case id -> { kind, original }
  const digitsSeen = new Map(); // digits -> { kind, original } for phones and SSN-like numbers
  let compiled = null;

  function addName(kind, token) {
    const t = token.trim();
    if (t.length < MIN_NAME || !/\p{L}/u.test(t)) return;
    const low = t.toLowerCase();
    if (W.TITLE_WORDS.some(function (w) { return w.toLowerCase() === low; }) || W.SUFFIX_WORDS.indexOf(low) !== -1) return;
    if (!names.has(low)) names.set(low, { kind: kind, original: t, exact: W.COMMON_WORD_NAMES.indexOf(low) !== -1 });
    compiled = null;
  }

  function add(kind, original) {
    const text = String(original).trim();
    if (!text) return;
    switch (kind) {
      case 'family': case 'given': case 'fullname':
        for (const part of text.split(/[\s,]+/)) {
          addName(kind, part);
          if (/[-–]/.test(part)) for (const sub of part.split(/[-–]/)) addName(kind, sub);
        }
        break;
      case 'org': case 'place': case 'street': case 'city':
        if (text.length >= 4 && /\p{L}/u.test(text)) { phrases.set(normName(text), { kind: kind, original: text }); compiled = null; }
        break;
      case 'phone': case 'ssn': {
        const d = text.replace(/\D/g, '');
        if (d.length >= 7 && d.length <= 15) { digitsSeen.set(d, { kind: kind, original: text }); compiled = null; }
        break;
      }
      default:
        if (SEEN_ID_KINDS.has(kind) && text.length >= 5 && /\d/.test(text)) { ids.set(text.toLowerCase(), { kind: kind, original: text }); compiled = null; }
    }
  }

  // The regular expressions are built only for the pieces whose values can occur in a given text
  // (a cheap test on the lower-cased text or on its digits comes first): building them costs far
  // more than the search, and a message has a handful of short fields in which nothing is found.
  function compile() {
    const pieces = [];
    const sorted = function (arr) { return arr.sort(function (a, b) { return b.length - a.length; }); };
    const nameList = [], exactList = [];
    for (const [low, e] of names) { (e.exact ? exactList : nameList).push(low); }
    if (nameList.length) {
      const folded = nameList.map(foldLow);
      pieces.push({ group: 'name', test: function (info) { const low = info.low(); return folded.some(function (n) { return low.indexOf(n) !== -1; }); },
        build: function () { return new RegExp(LOOK_BEFORE_WORD + '(?:' + sorted(nameList.slice()).map(esc).join('|') + ')' + LOOK_AFTER_WORD, 'giu'); } });
    }
    if (exactList.length) {
      const forms = [];
      for (const low of exactList) { const o = names.get(low).original; forms.push(o, o.toUpperCase()); }
      pieces.push({ group: 'name', test: function (info) { return forms.some(function (f) { return info.text.indexOf(f) !== -1; }); }, build: function () {
        return new RegExp(LOOK_BEFORE_WORD + '(?:' + sorted(Array.from(new Set(forms))).map(esc).join('|') + ')' + LOOK_AFTER_WORD, 'gu');
      } });
    }
    const phraseList = Array.from(phrases.keys()).sort(function (a, b) { return b.length - a.length; });
    if (phraseList.length) {
      const folded = phraseList.map(foldLow);
      pieces.push({ group: 'phrase', test: function (info) { const low = info.spaced(); return folded.some(function (n) { return low.indexOf(n) !== -1; }); },
        build: function () { return new RegExp(LOOK_BEFORE_WORD + '(?:' + phraseList.map(flexSpace).join('|') + ')' + LOOK_AFTER_WORD, 'giu'); } });
    }
    const idList = Array.from(ids.keys()).sort(function (a, b) { return b.length - a.length; });
    if (idList.length) pieces.push({ group: 'id', test: function (info) { const low = info.low(); return idList.some(function (id) { return low.indexOf(id) !== -1; }); }, build: function () { return new RegExp(LOOK_BEFORE_ID + '(?:' + idList.map(esc).join('|') + ')' + LOOK_AFTER_ID, 'gi'); } });
    for (const [d, e] of digitsSeen) {
      const tail = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
      pieces.push({ group: 'digits', entry: e, test: function (info) { return info.digits().indexOf(tail) !== -1; }, scan: function (text) { return digitSpans(text, tail); } });
    }
    compiled = { pieces: pieces };
    return compiled;
  }

  /** Matches of the seen values in `text`. With `distinctiveOnly` only numbers, ids and e-mail are looked for. */
  function find(text, distinctiveOnly) {
    const out = [];
    if (!text || (!names.size && !phrases.size && !ids.size && !digitsSeen.size)) return out;
    const c = compiled || compile();
    let low = null, spaced = null, digits = null;
    const info = {
      text: text,
      low: function () { if (low === null) low = foldLow(text); return low; },
      spaced: function () { if (spaced === null) spaced = foldLow(text).replace(/\s+/g, ' '); return spaced; },
      digits: function () { if (digits === null) digits = text.replace(/\D/g, ''); return digits; }
    };
    for (const p of c.pieces) {
      if (distinctiveOnly && (p.group === 'name' || p.group === 'phrase')) continue;
      if (p.test && !p.test(info)) continue;
      if (p.scan) {
        for (const span of p.scan(text)) {
          const e = p.entry;
          out.push({ start: span[0], end: span[1], kind: e.kind, category: e.kind === 'ssn' ? 'ssn' : 'phone', original: e.original, seen: true });
        }
        continue;
      }
      if (!p.re) p.re = p.build();
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        if (m[0].length === 0) { p.re.lastIndex++; continue; }
        let entry;
        if (p.group === 'name') entry = names.get(m[0].toLowerCase());
        else if (p.group === 'phrase') entry = phrases.get(normName(m[0]));
        else if (p.group === 'id') entry = ids.get(m[0].toLowerCase());
        else entry = p.entry;
        if (!entry) continue;
        const category = entry.kind === 'family' || entry.kind === 'given' || entry.kind === 'fullname' ? 'names'
          : entry.kind === 'org' || entry.kind === 'place' ? 'other' : entry.kind === 'street' || entry.kind === 'city' ? 'addresses' : entry.kind === 'phone' ? 'phone' : entry.kind === 'ssn' ? 'ssn' : 'other';
        out.push({ start: m.index, end: m.index + m[0].length, kind: entry.kind, category: category, original: entry.original, seen: true });
      }
    }
    return out;
  }

  return { add: add, find: find, size: function () { return names.size + phrases.size + ids.size + digitsSeen.size; } };
}

module.exports = { createSeenReference };
