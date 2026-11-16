'use strict';
// HL7 v2.x reader/writer for the de-identifier. A message is split into segments, fields,
// repetitions, components and subcomponents with the delimiters of its own MSH (or FHS / BHS),
// the identifying fields named in the tables below become hits, and the message is written back
// with exactly the same delimiters, segment terminators and untouched text. Structure (segment
// order, counts, delimiters) is never changed.
//
// The tables list field positions and data types only; they carry no text of the standard.

const { finishUnit } = require('../core/unit');
const T = require('../core/text');

const DEFAULT_DELIMS = { field: '|', comp: '^', rep: '~', esc: '\\', sub: '&' };
const HEADER_SEGMENTS = new Set(['MSH', 'FHS', 'BHS']);

// Data type -> component number -> kind (an array applies to the subcomponents in order).
const DT = {
  XPN: { 1: 'family', 2: 'given', 3: 'given' },
  XCN: { 1: ['licence', 'family', 'given', 'given'], 2: 'family', 3: 'given', 4: 'given' },
  NDL: { 1: ['licence', 'family', 'given', 'given'], 2: 'family', 3: 'given', 4: 'given' },
  XAD: { 1: 'street', 2: 'street', 3: 'city', 5: 'zip', 8: 'city', 10: 'other' },
  XTN: { 1: 'phoneOrEmail', 4: 'email', 6: 'phone', 7: 'phone', 12: 'phone' },
  CX: { 1: 'cx', 4: ['routing', 'routing', null], 6: ['routing', 'routing', null] },
  EI: { 1: 'other' },
  EIP: { 1: 'other', 2: 'other' },
  XON: { 1: 'org', 3: 'other', 10: 'other', 11: 'other' },
  HD: { 1: 'routing', 2: 'routing' },
  CEX: { 1: 'text', 2: 'text' },
  PL: { 1: 'text', 2: 'text', 3: 'text', 4: ['routing', 'routing', null], 7: 'text', 9: 'text' },
  HDORG: { 1: 'org', 2: 'routing' },
  TS: { 1: 'date' },
  TQ: { 4: 'date', 5: 'date' },
  DLN: { 1: 'licence', 3: 'date' },
  AUI: { 1: 'plan' },
  PLN: { 1: 'licence' },
  MFEKEY: { 1: 'record', 2: 'record' },
  ED: { 5: 'binary' },
  RP: { 1: 'url' }
};

const WHOLE = { DT: 'date', SSN: 'ssn' };

// Sender, receiver and control-id fields: kept when the setting says so.
const ENVELOPE = { MSH: [3, 4, 5, 6, 10, 22, 23], FHS: [3, 4, 5, 6, 9, 10, 11, 12], BHS: [3, 4, 5, 6, 9, 10, 11, 12], MSA: [2] };

// Segment -> field number -> data type, 'FREE' (running text) or 'k:<kind>' (a single value).
const SEG = {
  MSH: { 3: 'HD', 4: 'HDORG', 5: 'HD', 6: 'HDORG', 7: 'TS', 10: 'k:msgid', 22: 'XON', 23: 'XON' },
  FHS: { 3: 'HD', 4: 'HDORG', 5: 'HD', 6: 'HDORG', 7: 'TS', 9: 'k:msgid', 10: 'k:msgidOrFree', 11: 'k:msgid', 12: 'k:msgid' },
  BHS: { 3: 'HD', 4: 'HDORG', 5: 'HD', 6: 'HDORG', 7: 'TS', 9: 'k:msgid', 10: 'k:msgidOrFree', 11: 'k:msgid', 12: 'k:msgid' },
  MSA: { 2: 'k:msgid' },
  EVN: { 2: 'TS', 3: 'TS', 5: 'XCN', 6: 'TS', 7: 'HDORG' },
  PID: { 2: 'CX', 3: 'CX', 4: 'CX', 5: 'XPN', 6: 'XPN', 7: 'TS', 9: 'XPN', 11: 'XAD', 13: 'XTN', 14: 'XTN', 18: 'CX', 19: 'SSN', 20: 'DLN', 21: 'CX', 23: 'k:city',
    29: 'TS', 33: 'TS', 34: 'HDORG', 40: 'XTN' },
  PD1: { 3: 'XON', 4: 'XCN' },
  NK1: { 2: 'XPN', 4: 'XAD', 5: 'XTN', 6: 'XTN', 8: 'TS', 9: 'TS', 12: 'k:other', 13: 'XON', 16: 'TS', 26: 'XPN', 30: 'XPN', 31: 'XTN', 32: 'XAD', 33: 'CX', 37: 'SSN' },
  PV1: { 3: 'PL', 6: 'PL', 11: 'PL', 42: 'PL', 43: 'PL', 7: 'XCN', 8: 'XCN', 9: 'XCN', 17: 'XCN', 19: 'CX', 23: 'XON', 44: 'TS', 45: 'TS', 52: 'XCN' },
  PV2: { 3: 'FREE', 8: 'TS', 9: 'TS', 23: 'XON', 31: 'TS' },
  MRG: { 1: 'CX', 2: 'CX', 3: 'CX', 4: 'CX', 5: 'CX', 6: 'CX', 7: 'XPN' },
  IN1: { 3: 'CX', 4: 'XON', 5: 'XAD', 6: 'XPN', 7: 'XTN', 8: 'k:plan', 9: 'XON', 10: 'CX', 11: 'XON', 12: 'TS', 13: 'TS', 14: 'AUI', 16: 'XPN', 18: 'TS', 19: 'XAD',
    30: 'TS', 31: 'XCN', 35: 'k:plan', 36: 'k:plan', 44: 'XAD', 49: 'CX' },
  IN2: { 1: 'CX', 2: 'SSN', 3: 'XON', 6: 'k:plan', 7: 'XPN', 8: 'k:plan', 9: 'XPN', 10: 'k:other', 17: 'DT', 22: 'XPN', 25: 'CX', 26: 'CX' },
  GT1: { 2: 'CX', 3: 'XPN', 4: 'XPN', 5: 'XAD', 6: 'XTN', 7: 'XTN', 8: 'TS', 12: 'k:ssn', 13: 'TS', 14: 'TS', 16: 'XON', 17: 'XAD', 18: 'XTN', 19: 'CX', 21: 'XON' },
  NTE: { 3: 'FREE' },
  AL1: { 5: 'FREE', 6: 'DT' },
  DG1: { 4: 'FREE', 5: 'TS', 16: 'XCN', 19: 'TS' },
  PR1: { 5: 'TS', 8: 'XCN', 11: 'XCN', 12: 'XCN' },
  PRA: { 6: 'PLN' },
  STF: { 2: 'CX', 3: 'XPN', 6: 'TS', 10: 'XTN', 11: 'XAD', 15: 'XTN' },
  ROL: { 4: 'XCN', 5: 'TS', 6: 'TS' },
  PRD: { 2: 'XPN', 3: 'XAD', 4: 'XTN', 5: 'PLN' },
  MFE: { 4: 'MFEKEY' },
  ORC: { 13: 'PL', 17: 'CEX', 2: 'EI', 3: 'EI', 4: 'EI', 9: 'TS', 10: 'XCN', 11: 'XCN', 12: 'XCN', 14: 'XTN', 15: 'TS', 19: 'XCN', 21: 'XON', 22: 'XAD', 23: 'XTN', 24: 'XAD' },
  OBR: { 2: 'EI', 3: 'EI', 7: 'TS', 8: 'TS', 10: 'XCN', 13: 'FREE', 14: 'TS', 16: 'XCN', 17: 'XTN', 18: 'k:other', 19: 'k:other', 20: 'k:other', 22: 'TS', 28: 'XCN',
    29: 'EIP', 31: 'FREE', 32: 'NDL', 33: 'NDL', 34: 'NDL', 35: 'NDL', 36: 'TS' },
  OBX: { 15: 'CEX', 14: 'TS', 16: 'XCN', 18: 'EI', 19: 'TS', 23: 'XON', 24: 'XAD', 25: 'XCN' },
  SPM: { 2: 'EIP' },
  SCH: { 15: 'PL', 19: 'PL', 22: 'PL', 1: 'EI', 2: 'EI', 11: 'TQ', 12: 'XCN', 13: 'XTN', 14: 'XAD', 16: 'XCN', 17: 'XTN', 18: 'XAD', 20: 'XCN', 21: 'XTN' },
  AIG: { 3: 'EI', 8: 'TS' },
  AIP: { 3: 'XCN', 6: 'TS' },
  AIL: { 6: 'TS' },
  AIS: { 4: 'TS' },
  TXA: { 4: 'TS', 5: 'XCN', 6: 'TS', 7: 'TS', 8: 'TS', 9: 'XCN', 10: 'XCN', 11: 'XCN', 12: 'EI', 13: 'EI', 14: 'EI', 15: 'EI' },
  FT1: { 2: 'k:record', 4: 'TS', 5: 'TS', 20: 'XCN', 21: 'XCN' },
  RXA: { 3: 'TS', 4: 'TS', 10: 'XCN' },
  RXE: { 13: 'XCN', 14: 'XCN' },
  TQ1: { 7: 'TS', 8: 'TS' },
  QRD: { 8: 'XCN' },
  ACC: { 1: 'TS' }
};

// OBX-5 by the value type in OBX-2.
const OBX_VALUE = {
  ST: 'FREE', TX: 'FREE', FT: 'FREE', DT: 'DT', DTM: 'TS', TS: 'TS', XPN: 'XPN', XAD: 'XAD', XTN: 'XTN', XCN: 'XCN', CX: 'CX', EI: 'EI', XON: 'XON', ED: 'ED', RP: 'RP', SN: null, NM: null,
  CE: null, CWE: null, CNE: null, CF: null, ID: null, IS: null, NA: null, TM: null
};

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseDelimiters(headerSegment) {
  const field = headerSegment[3];
  if (!field) return null;
  const end = headerSegment.indexOf(field, 4);
  const enc = headerSegment.slice(4, end === -1 ? headerSegment.length : end).slice(0, 4);
  return { field: field, comp: enc[0] || '^', rep: enc[1] || '~', esc: enc[2] || '\\', sub: enc[3] || '&' };
}

const NO_SEGMENT = '(line without a segment name)';

function segmentIdOf(text, field) {
  if (text.length < 3) return null;
  const id = text.slice(0, 3);
  if (!/^[A-Z][A-Z0-9]{2}$/.test(id)) return null;
  if (text.length > 3 && text[3] !== field) return null;
  return id;
}

/** Splits text into segments (keeping each terminator). */
function splitSegments(text) {
  const parts = text.split(/(\r\n|\r|\n)/);
  const segs = [];
  for (let i = 0; i < parts.length; i += 2) segs.push({ text: parts[i], term: parts[i + 1] || '' });
  return segs;
}

/**
 * A subcomponent as the readers see it: the escapes of the four delimiters become the characters they
 * stand for; every other escape sequence, the escape of the escape character and a stray escape
 * character become placeholders. restore() puts them back and writes delimiter characters of the
 * replacement as escapes, so that a masked or replaced value keeps its length and its escapes.
 */
function protectValue(sub, d) {
  if (sub.indexOf(d.esc) === -1) return { text: sub, restore: function (x) { return escapeDelims(x, d); } };
  const map = { F: d.field, S: d.comp, T: d.sub, R: d.rep };
  const ph = T.placeholders();
  const pair = new RegExp(esc(d.esc) + '([^' + esc(d.esc) + ']{0,60})' + esc(d.esc), 'g');
  const text = sub.replace(pair, function (m, inner) { return inner.length === 1 && map[inner] !== undefined ? map[inner] : ph.add(m); }).split(d.esc).map(function (part, i) { return i === 0 ? part : ph.add(d.esc) + part; }).join('');
  return { text: text, restore: function (x) { return ph.restore(escapeDelims(x, d)); } };
}

function escapeDelims(s, d) {
  let out = '';
  for (const ch of s) {
    if (ch === d.esc) out += d.esc + 'E' + d.esc;
    else if (ch === d.field) out += d.esc + 'F' + d.esc;
    else if (ch === d.comp) out += d.esc + 'S' + d.esc;
    else if (ch === d.sub) out += d.esc + 'T' + d.esc;
    else if (ch === d.rep) out += d.esc + 'R' + d.esc;
    else out += ch;
  }
  return out;
}

/**
 * Prepares a free-text field for the scanners. The five delimiter escapes (\F\ \S\ \T\ \R\ \E\)
 * become the characters they stand for (unless the field also holds unescaped delimiters, in which
 * case they are protected like every other escape), all other escape sequences become private-use
 * characters. restore() puts everything back, escaping delimiter characters again.
 */
function protect(text, d) {
  if (text.indexOf(d.esc) === -1) return { text: text, restore: function (x) { return x; } };
  const re = new RegExp(esc(d.esc) + '([^' + esc(d.esc) + ']{0,60})' + esc(d.esc), 'g');
  const stripped = text.replace(re, '');
  const raw = stripped.indexOf(d.comp) !== -1 || stripped.indexOf(d.sub) !== -1 || stripped.indexOf(d.rep) !== -1;
  const map = { F: d.field, S: d.comp, T: d.sub, R: d.rep, E: d.esc };
  const ph = T.placeholders();
  const masked = text.replace(re, function (m, inner) {
    if (!raw && inner.length === 1 && map[inner] !== undefined) return map[inner];
    return ph.add(m);
  });
  return { text: masked, restore: function (x) { return ph.restore(raw ? x : escapeDelims(x, d)); } };
}

const CX_TYPE = { SS: 'ssn', MR: 'record', PI: 'record', PT: 'record', AN: 'record', VN: 'record', PN: 'licence', DL: 'licence', DN: 'licence', NPI: 'licence', LN: 'licence',
  MD: 'licence', UPIN: 'licence', MA: 'plan', MC: 'plan', MB: 'plan', SN: 'plan', TAX: 'taxid', EI: 'taxid', FI: 'taxid', RRI: 'other' };

function cxKind(value, typeCode) {
  const t = CX_TYPE[(typeCode || '').toUpperCase()];
  if (t) return t;
  return /^\d{3}-?\d{2}-?\d{4}$/.test(value) ? 'ssn' : 'record';
}

function phoneOrEmailKind(value) { return value.indexOf('@') !== -1 ? 'email' : 'phone'; }

/**
 * Reads one message and returns { hits, freeSlots, idents, write() }. `d` are its delimiters.
 */
function readMessage(text, d, opts) {
  const o = opts || {};
  const segs = splitSegments(text);
  const hits = [];
  const freeSlots = [];
  const idents = { ssn: [], id: [], name: [] };
  const segInfo = [];
  let pidSeen = false;
  const lineBase = o.lineBase || 0;

  for (let segIndex = 0; segIndex < segs.length; segIndex++) {
    const seg = segs[segIndex];
    const id = segmentIdOf(seg.text, d.field);
    const info = { seg: seg, id: id, fields: null, dirty: false, nodes: new Map(), line: lineBase + segIndex };
    segInfo.push(info);
    if (!id) {
      // a line without a segment name (a note that continues after a line break) is running text, read like a note: names seen elsewhere in the message, telephone numbers, e-mail addresses and other patterns are replaced in it
      if (/[A-Za-z0-9]/.test(seg.text)) {
        info.fields = [seg.text];
        freeSlots.push(slotFor(info, 0, NO_SEGMENT, d, false));
      }
      continue;
    }
    info.fields = seg.text.split(d.field);
    const header = HEADER_SEGMENTS.has(id);
    const table = SEG[id];
    const isZ = id[0] === 'Z';
    const userFields = userFieldsFor(o.userRules, id);
    if (!table && !isZ && !userFields.size) { sweepSegment(info, header, d, freeSlots, null, hits); continue; }
    const handled = new Set();
    if (table) {
      for (const key of Object.keys(table)) {
        const n = Number(key);
        const k = header ? n - 1 : n;
        if (k < 1 || k >= info.fields.length) continue;
        handled.add(k);
        if (userFields.has(n)) continue;
        if (o.keepEnvelope && ENVELOPE[id] && ENVELOPE[id].indexOf(n) !== -1) continue;
        applyField(info, k, n, table[key], d, hits, freeSlots, idents, id === 'PID' && !pidSeen);
      }
      if (id === 'OBX') obxValue(info, d, hits, freeSlots, handled);
      if (id === 'PID') pidSeen = true;
    }
    for (const [n, list] of userFields) {
      const k = header ? n - 1 : n;
      if (k < 1 || k >= info.fields.length || !info.fields[k]) continue;
      handled.add(k);
      applyUserField(info, k, n, list, d, hits, freeSlots);
    }
    sweepSegment(info, header, d, freeSlots, handled, hits, isZ);
  }

  function write() {
    let out = '';
    for (const info of segInfo) {
      if (info.fields && info.dirty) {
        for (const [k, node] of info.nodes) info.fields[k] = node.dirty ? node.reps.map(function (r) { return r.map(function (c) { return c.join(d.sub); }).join(d.comp); }).join(d.rep) : info.fields[k];
        info.seg.text = info.fields.join(d.field);
      }
      out += info.seg.text + info.seg.term;
    }
    return out;
  }
  return { hits: hits, freeSlots: freeSlots, idents: idents, write: write };
}

const TS_ONLY = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?(?:[+-]\d{4})?$/;

/** User rules for a segment, by field number: Map(field -> [{ comp, kind, fmt }]). The first rule for a field and component wins. */
function userFieldsFor(userRules, id) {
  const out = new Map();
  if (!userRules) return out;
  for (const key of [id, 'Z*']) {
    if (key === 'Z*' && id[0] !== 'Z') continue;
    for (const r of userRules.get(key) || []) {
      const list = out.get(r.field) || [];
      if (!list.some(function (x) { return x.comp === r.comp; })) list.push(r);
      out.set(r.field, list);
    }
  }
  return out;
}

function applyUserField(info, k, n, list, d, hits, freeSlots) {
  const id = info.id;
  const whole = list.find(function (r) { return r.comp === 0; });
  if (whole || list.some(function (r) { return r.kind === 'FREE'; })) {
    const w = whole || list.find(function (r) { return r.kind === 'FREE'; });
    if (w.kind === null) { hits.push({ kind: 'keep', path: id + '-' + n, value: info.fields[k] }); return; }
    if (w.kind === 'FREE') {
      // a field that the built-in profile replaces (a date, a name ...) and that the rule hands over to the free-text reader stays as it is unless a value in it was seen elsewhere
      if (SEG[id] && SEG[id][n] !== undefined) hits.push({ kind: 'keep', path: id + '-' + n, value: 'kept' });
      freeSlots.push(slotFor(info, k, id + '-' + n, d, false));
      return;
    }
    leafHits(info, k, n, null, w.kind, d, hits, { ssn: [], id: [], name: [] }, false, undefined, true);
    return;
  }
  const rules = {};
  for (const r of list) if (r.kind !== null) rules[r.comp] = r.kind;
  // components that a rule keeps: counted when they hold a value (the places, never the values)
  for (const r of list) if (r.kind === null && r.comp > 0 && info.fields[k].split(d.comp)[r.comp - 1]) hits.push({ kind: 'keep', path: id + '-' + n + '.' + r.comp, value: 'kept' });
  if (Object.keys(rules).length) leafHits(info, k, n, rules, 'USER', d, hits, { ssn: [], id: [], name: [] }, false, undefined, true);
}

function sweepSegment(info, header, d, freeSlots, handled, hits, full) {
  if (!info.fields) return;
  for (let k = 1; k < info.fields.length; k++) {
    if (handled && handled.has(k)) continue;
    if (!info.fields[k]) continue;
    const n = header ? k + 1 : k;
    if (header && n <= 2) continue;
    // a whole 12 or 14 digit timestamp in a field the tables do not know is a date
    if (hits && /\d{12}/.test(info.fields[k])) {
      const node = nodeOf(info, k, d);
      node.reps.forEach(function (rep) {
        rep.forEach(function (comp, ci) {
          comp.forEach(function (sub, si) {
            if (!TS_ONLY.test(sub)) return;
            hits.push({ kind: 'date', fmt: 'hl7', value: sub, line: info.line, path: info.id + '-' + n + '.' + (ci + 1), set: function (next) { comp[si] = next; node.dirty = true; info.dirty = true; } });
          });
        });
      });
    }
    freeSlots.push(slotFor(info, k, info.id + '-' + n, d, !full));
  }
}

function slotFor(info, k, path, d, sweep) {
  let prot = null;
  return {
    path: path, sweep: sweep,
    get: function () { prot = protect(info.fields[k], d); return prot.text; },
    set: function (text) { info.fields[k] = prot.restore(text); info.dirty = true; info.nodes.delete(k); }
  };
}

function nodeOf(info, k, d) {
  let node = info.nodes.get(k);
  if (!node) {
    node = { reps: info.fields[k].split(d.rep).map(function (r) { return r.split(d.comp).map(function (c) { return c.split(d.sub); }); }), dirty: false };
    info.nodes.set(k, node);
  }
  return node;
}

function applyField(info, k, n, spec, d, hits, freeSlots, idents, isFirstPid) {
  const id = info.id;
  if (!info.fields[k]) return;
  if (spec === 'FREE') { freeSlots.push(slotFor(info, k, id + '-' + n, d, false)); return; }
  if (spec.startsWith('k:')) {
    let kind = spec.slice(2);
    if (kind === 'msgidOrFree') {
      if (/\s/.test(info.fields[k]) || !/\d/.test(info.fields[k])) { freeSlots.push(slotFor(info, k, id + '-' + n, d, false)); return; }
      kind = 'msgid';
    }
    leafHits(info, k, n, null, kind, d, hits, idents, isFirstPid);
    return;
  }
  if (WHOLE[spec]) { leafHits(info, k, n, null, WHOLE[spec], d, hits, idents, isFirstPid, spec === 'DT' ? 'hl7' : undefined); return; }
  const rules = DT[spec];
  if (!rules) return;
  leafHits(info, k, n, rules, spec, d, hits, idents, isFirstPid);
}

function leafHits(info, k, n, rules, spec, d, hits, idents, isFirstPid, wholeFmt, byRule) {
  const node = nodeOf(info, k, d);
  const id = info.id;
  node.reps.forEach(function (rep) {
    const typeCode = spec === 'CX' || spec === 'EI' ? (rep[4] ? rep[4][0] : '') : '';
    rep.forEach(function (comp, ci) {
      let rule;
      if (rules === null) rule = spec;
      else rule = rules[ci + 1];
      if (!rule) return;
      comp.forEach(function (sub, si) {
        if (!sub) return;
        let kind = Array.isArray(rule) ? rule[Math.min(si, rule.length - 1)] : rule;
        if (comp.length === 1 && Array.isArray(rule)) kind = rule[0];
        if (!kind) return;
        const prot = protectValue(sub, d);
        const value = prot.text;
        if (kind === 'cx') kind = cxKind(value, typeCode);
        else if (kind === 'phoneOrEmail') kind = phoneOrEmailKind(value);
        const path = id + '-' + n + (rules === null ? '' : '.' + (ci + 1));
        const hit = {
          kind: kind, value: value, path: path, line: info.line, fmt: kind === 'date' ? 'hl7' : undefined, envelope: ((spec === 'CX' && (ci === 3 || ci === 5)) || (spec === 'PL' && ci === 3)) || undefined,
          set: function (next) { comp[si] = prot.restore(next); node.dirty = true; info.dirty = true; }
        };
        if (kind === 'date' && wholeFmt) hit.fmt = wholeFmt;
        if (byRule) hit.byRule = true; // the kind comes from the user's rule file, not from the built-in profile
        hits.push(hit);
        if (isFirstPid) {
          if (kind === 'ssn') idents.ssn.push('ssn:' + value.replace(/\D/g, ''));
          else if (kind === 'record' && (id === 'PID')) idents.id.push('id:' + value.toLowerCase());
          else if (kind === 'family') idents.name.push('name:' + value.toLowerCase());
        }
      });
    });
  });
}

function obxValue(info, d, hits, freeSlots, handled) {
  const f = info.fields;
  if (f.length <= 5 || !f[5]) return;
  const type = (f[2] || '').split(d.comp)[0].toUpperCase();
  handled.add(5);
  if (!Object.prototype.hasOwnProperty.call(OBX_VALUE, type)) { freeSlots.push(slotFor(info, 5, 'OBX-5', d, false)); return; }
  const spec = OBX_VALUE[type];
  if (spec === null) return;
  applyField(info, 5, 5, spec, d, hits, freeSlots, { ssn: [], id: [], name: [] }, false);
}

/** True when the text starts like an HL7 v2 message, batch or file header (after a BOM or MLLP byte). */
function detect(text) {
  const t = text.replace(T.LEADING_BLANKS, '');
  return /^(MSH|FHS|BHS)[^A-Za-z0-9\s]/.test(t);
}

/** Looks like loose HL7 segments without a header (three capitals, the default field separator). */
function looksLikeSegments(text) {
  const t = text.replace(T.LEADING_BLANKS, '');
  return /^[A-Z][A-Z0-9]{2}\|/.test(t) && /\r|\n/.test(t);
}

/**
 * Processes one message or header unit. `run` is the run, `options.scanOnly` counts without changing.
 * Returns { text, changed }.
 */
function processUnit(text, run, options) {
  const o = options || {};
  let prefix = '', body = text, suffix = '';
  const m = new RegExp('^([' + T.BOM + String.fromCharCode(0x0b) + ']*)([\\s\\S]*?)(' + String.fromCharCode(0x1c) + '\\r?)?$').exec(text);
  if (m) { prefix = m[1]; body = m[2]; suffix = m[3] || ''; }
  const first = body.split(/\r\n|\r|\n/).find(function (l) { return /^(MSH|FHS|BHS)/.test(l); });
  const d = (first && parseDelimiters(first)) || DEFAULT_DELIMS;
  const msg = readMessage(body, d, { keepEnvelope: run.options.keepEnvelope, userRules: run.userRules ? run.userRules.hl7 : null, lineBase: o.lineBase || 0 });
  const idents = msg.idents.ssn.concat(msg.idents.id, msg.idents.name);
  const changed = finishUnit(run, 'hl7', msg.hits, msg.freeSlots, idents, { scanOnly: o.scanOnly, known: o.known, onHit: o.onHit, verify: o.verify });
  return { text: changed && !o.scanOnly ? prefix + msg.write() + suffix : text, changed: changed };
}

/** Splits a file text into units: { text, kind } with kind 'message' | 'header' | 'trailer' | 'other'. */
function splitUnits(text) {
  const units = [];
  const re = /(?:^﻿?|[\r\n\x0b])(MSH|FHS|BHS|BTS|FTS)(?=[^A-Za-z0-9\s])/g;
  let m;
  const starts = [];
  while ((m = re.exec(text)) !== null) {
    let s = m.index + m[0].length - 3;
    // the MLLP start byte belongs to the message that it opens
    if (s > 0 && text.charCodeAt(s - 1) === 0x0b) s--;
    starts.push(s);
  }
  if (!starts.length) return [{ text: text, kind: 'message' }];
  if (starts[0] > 0) units.push({ text: text.slice(0, starts[0]), kind: 'other' });
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i], e = i + 1 < starts.length ? starts[i + 1] : text.length;
    const chunk = text.slice(s, e);
    const kind = /^\x0b?MSH/.test(chunk) ? 'message' : /^\x0b?(FHS|BHS)/.test(chunk) ? 'header' : 'trailer';
    units.push({ text: chunk, kind: kind });
  }
  return units;
}

module.exports = { detect, looksLikeSegments, processUnit, splitUnits, parseDelimiters, readMessage, DEFAULT_DELIMS, SEG, DT };
