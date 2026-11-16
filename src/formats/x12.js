'use strict';
// X12 reader/writer for the de-identifier: healthcare interchanges (270/271, 276/277, 278, 834, 835,
// 837) handled structurally. The ISA segment gives the delimiters; segments that carry names,
// addresses, identifiers, contacts and dates are named in the table below by segment and element
// position (never by text of an implementation guide); everything else is written back unchanged.
// Control numbers, counts and segment order are never touched, so envelope totals stay valid.

const { finishUnit } = require('../core/unit');
const T = require('../core/text');

const ISA_WIDTHS = [3, 2, 10, 2, 10, 2, 15, 2, 15, 6, 4, 1, 5, 9, 1, 1, 1];
const PATIENT_CODES = new Set(['IL', 'QC', '03', '74', 'PAT', 'QD', 'EY']);

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** The delimiters of an interchange if its ISA segment is well formed, else null. */
function isaDelimiters(text) {
  if (text.length < 106 || text.slice(0, 3) !== 'ISA') return null;
  const sep = text[3];
  if (/[A-Za-z0-9\s]/.test(sep)) return null;
  const parts = text.slice(0, 105).split(sep);
  if (parts.length !== 17) return null;
  for (let i = 0; i < 17; i++) if (parts[i].length !== ISA_WIDTHS[i]) return null;
  const sub = text[104], term = text[105];
  if (sub === sep || term === sep || term === sub) return null;
  const version = parts[12];
  const rep = /^00[5-9]/.test(version) && parts[11] !== 'U' && parts[11].length === 1 ? parts[11] : '';
  return { sep: sep, sub: sub, term: term, rep: rep };
}

function detect(head) {
  const t = head.replace(T.LEADING_BLANKS, '');
  return /^ISA[^A-Za-z0-9\s]/.test(t) && isaDelimiters(t) !== null;
}

function nm109Kind(q) {
  switch (q) {
    case 'SY': case '34': return 'ssn';
    case 'XX': case 'XV': case 'SL': case 'UP': return 'licence';
    case 'FI': case 'EI': return 'taxid';
    case 'MI': case 'MR': case 'II': case 'ZZ': case 'PI': case 'PP': case 'NI': case 'HN': case 'JD': case 'C': return 'plan';
    default: return 'other';
  }
}

function refKind(q) {
  switch (q) {
    case 'SY': return 'ssn';
    case '1L': case '1W': case 'IG': case '6P': case '18': case 'CE': case '2U': case '0K': case 'HJ': case 'A6': case '49': case '1M': case 'G1': case 'AH': return 'plan';
    case 'EI': case 'TJ': case 'FY': case 'E3': return 'taxid';
    case '87': return 'keep';
    case 'EA': case 'F8': case 'D9': case '1K': case 'BB': case 'BLT': case 'CT': case 'LU': case 'X4': case 'XZ': case '9A': case '9C': return 'record';
    case '0B': case '1A': case '1B': case '1C': case '1D': case '1G': case '1H': case 'HPI': case 'G2': case 'N5': case 'U3': case 'SY1': return 'licence';
    default: return 'other';
  }
}

function contactKind(qualifier, value) {
  if (qualifier === 'EM' || value.indexOf('@') !== -1) return 'email';
  if (qualifier === 'UR') return 'url';
  return 'phone';
}

function dtpFmt(q) {
  switch (q) {
    case 'D8': case 'DT': return 'd8';
    case 'RD8': return 'rd8';
    case 'D6': return 'yymmdd';
    default: return null;
  }
}

const DEPARTMENT = /\b(unit|department|dept|office|desk|services?|billing|claims?|support|center|centre|team|group|line|helpdesk|help|customer|provider|eligibility|enrollment|enrolment|intake|accounts?|finance|payments?|records|inquiries|inquiry|authorizations?|utilization|care)\b/i;

// Segment -> function(elements) -> [[elementNumber, kind, extra], ...]; kind 'FREE' marks running text.
const RULES = {
  BGN: function () { return [[2, 'record'], [3, 'date', { fmt: 'd8' }]]; },
  GS: function (e) { return [[2, 'routing', { envelope: true }], [3, 'routing', { envelope: true }], [4, 'date', { fmt: 'd8' }]]; },
  BHT: function (e) { return [[3, 'record'], [4, 'date', { fmt: 'd8' }]]; },
  NM1: function (e) {
    const person = e[2] === '1';
    const out = [[3, person ? 'family' : 'org']];
    if (person) out.push([4, 'given'], [5, 'given']);
    out.push([9, nm109Kind(e[8])]);
    return out;
  },
  N1: function (e) { return [[2, 'org'], [4, e[3] === 'XX' ? 'licence' : e[3] === 'FI' ? 'taxid' : 'other']]; },
  N2: function () { return [[1, 'org'], [2, 'org']]; },
  N3: function () { return [[1, 'street'], [2, 'street']]; },
  N4: function () { return [[1, 'city'], [3, 'zip'], [6, 'other']]; },
  DMG: function (e) { return [[2, 'date', { fmt: e[1] === 'RD8' ? 'rd8' : 'd8' }]]; },
  PER: function (e) { return [[2, DEPARTMENT.test(e[2] || '') ? 'org' : 'fullname'], [4, contactKind(e[3], e[4] || '')], [6, contactKind(e[5], e[6] || '')], [8, contactKind(e[7], e[8] || '')]]; },
  REF: function (e) { return [[2, refKind(e[1])], [3, 'FREE']]; },
  N9: function (e) { return [[2, refKind(e[1])], [3, 'FREE']]; },
  DTP: function (e) { const f = dtpFmt(e[2]); return f ? [[3, 'date', { fmt: f }]] : []; },
  DTM: function (e) { return [[2, 'date', { fmt: 'd8' }]]; },
  CLM: function () { return [[1, 'record']]; },
  CLP: function () { return [[1, 'record'], [7, 'record']]; },
  SBR: function () { return [[3, 'plan'], [4, 'plan']]; },
  BPR: function () { return [[7, 'other'], [9, 'other'], [10, 'other'], [13, 'other'], [15, 'other'], [16, 'date', { fmt: 'd8' }]]; },
  TRN: function () { return [[2, 'record'], [3, 'other'], [4, 'other']]; },
  HCR: function () { return [[2, 'plan']]; },
  IDC: function () { return [[3, 'plan']]; },
  PWK: function () { return [[6, 'other']]; },
  PAT: function () { return [[6, 'date', { fmt: 'd8' }]]; },
  MSG: function () { return [[1, 'FREE']]; },
  NTE: function () { return [[2, 'FREE']]; },
  K3: function () { return [[1, 'FREE']]; }
};
// ISA is handled apart (fixed width).

function splitUnits(text) {
  const units = [];
  let pos = 0;
  const lead = new RegExp('^[' + T.BOM + '\\s]*').exec(text)[0];
  if (lead.length) { units.push({ text: lead, kind: 'other' }); pos = lead.length; }
  while (pos < text.length) {
    const d = isaDelimiters(text.slice(pos, pos + 106));
    if (!d) { units.push({ text: text.slice(pos), kind: 'other' }); break; }
    // The next interchange starts with "ISA" after the segment terminator of this one or after a line break
    // (with white space in between); it may use other delimiters, so isaDelimiters decides. Walking back
    // from every "ISA" keeps the work linear, however many blank lines the text holds.
    let next = -1;
    let from = pos + 106;
    for (;;) {
      const at = text.indexOf('ISA', from);
      if (at === -1) break;
      from = at + 1;
      let b = at;
      let lineBreak = false;
      while (b > pos + 106 && /\s/.test(text[b - 1])) { b--; if (text[b] === '\r' || text[b] === '\n') lineBreak = true; }
      if (!(lineBreak || (b > pos + 106 && text[b - 1] === d.term))) continue;
      if (isaDelimiters(text.slice(at, at + 106))) { next = at; break; }
    }
    const end = next === -1 ? text.length : next;
    // whitespace between interchanges stays with the interchange before it
    units.push({ text: text.slice(pos, end), kind: 'interchange' });
    pos = end;
  }
  return units;
}

function readInterchange(text, run, lineBase) {
  const d = isaDelimiters(text.slice(0, 106));
  const parts = text.split(d.term);
  let lineNo = lineBase || 0;
  const segs = parts.map(function (p, i) {
    const lead = /^\s*/.exec(p)[0];
    const body = p.slice(lead.length);
    lineNo += (lead.match(/\r\n|\r|\n/g) || []).length;
    const seg = { lead: lead, el: body === '' ? null : body.split(d.sep), dirty: false, last: i === parts.length - 1, line: lineNo };
    lineNo += (body.match(/\r\n|\r|\n/g) || []).length;
    return seg;
  });
  const hits = [], freeSlots = [];
  const idents = { ssn: [], id: [], name: [] };
  let patients = 0;
  let patientOpen = false;
  // Member loops (INS of an enrolment, subscriber HL of a claim): the first member is the person of the
  // whole interchange; every later member is a person of her own, so that her dates move by her own offset.
  let memberStarts = 0;
  let member = null;
  let memberHasPatient = false;
  const members = [];
  const keepEnvelope = run.options.keepEnvelope;

  function sanitize(v) {
    let out = '';
    for (const ch of v) out += (ch === d.sep || ch === d.sub || ch === d.term || ch === d.rep || ch === '\r' || ch === '\n') ? 'X' : ch;
    return out;
  }

  segs.forEach(function (seg) {
    const e = seg.el;
    if (!e) return;
    const id = e[0];
    const used = new Set();
    let list = null;
    if (id === 'ISA') {
      list = [[6, 'routing', { envelope: true }], [8, 'routing', { envelope: true }], [9, 'date', { fmt: 'yymmdd' }]];
    } else if (RULES[id]) list = RULES[id](e);
    const userList = run.userRules ? run.userRules.x12.get(id) : null;
    if (userList) {
      list = list ? list.slice() : [];
      const done = new Set();
      for (const u of userList) {
        if (done.has(u.n)) continue;
        if (u.when && e[u.when.n] !== u.when.value) continue;
        done.add(u.n);
        const had = list.some(function (x) { return x[0] === u.n && x[1] !== 'keep'; });
        list = list.filter(function (x) { return x[0] !== u.n; });
        if ((u.kind === 'FREE' || u.kind === 'binary') && had && e[u.n]) hits.push({ kind: 'keep', path: id + '-' + (u.n < 10 ? '0' + u.n : u.n), value: 'kept' });
        if (u.kind !== null) list.push([u.n, u.kind, { fmt: u.fmt, byRule: true }]);
        else if (e[u.n]) hits.push({ kind: 'keep', path: id + '-' + (u.n < 10 ? '0' + u.n : u.n), value: 'kept' });
      }
    }
    if (id === 'INS' || (id === 'HL' && e[3] === '22')) {
      memberStarts++;
      patientOpen = false;
      if (memberStarts > 1) { member = { list: [], ssn: [], id: [], name: [] }; members.push(member); memberHasPatient = false; }
    }
    if (id === 'NM1') {
      const isPatient = PATIENT_CODES.has(e[1]);
      if (member) { patientOpen = isPatient && !memberHasPatient; if (isPatient) memberHasPatient = true; }
      else patientOpen = isPatient && patients === 0;
      if (isPatient) patients++;
    }
    const who = member ? member.list : undefined;
    const sink = member || idents;
    if (list) {
      for (const [n, kind, extra] of list) {
        if (n >= e.length || !e[n] || kind === 'keep') continue;
        used.add(n);
        const x = extra || {};
        if (x.envelope && keepEnvelope) continue;
        const path = id + '-' + (n < 10 ? '0' + n : n);
        if (kind === 'FREE') {
          freeSlots.push({ path: path, sweep: false, idents: who, get: function () { return e[n]; }, set: function (t) { e[n] = sanitize(t); seg.dirty = true; } });
          continue;
        }
        const value = e[n];
        hits.push({ kind: kind, value: value, path: path, line: seg.line, fmt: x.fmt, byRule: x.byRule, idents: who, clean: sanitize, set: function (t) { e[n] = sanitize(t); seg.dirty = true; } });
        if (patientOpen) {
          if (kind === 'ssn') sink.ssn.push('ssn:' + value.replace(/\D/g, ''));
          else if (id === 'NM1' && n === 9) sink.id.push('id:' + value.toLowerCase());
          else if (kind === 'family') sink.name.push('name:' + value.toLowerCase());
        }
      }
    }
    // everything else in the segment: only numbers, ids and e-mail seen elsewhere in the interchange
    if (id !== 'ISA' && id !== 'GS' && id !== 'GE' && id !== 'IEA' && id !== 'ST' && id !== 'SE') {
      for (let n = 1; n < e.length; n++) {
        if (used.has(n) || !e[n] || e[n].length < 5) continue;
        const path = id + '-' + (n < 10 ? '0' + n : n);
        freeSlots.push({ path: path, sweep: true, idents: who, get: function () { return e[n]; }, set: function (t) { e[n] = sanitize(t); seg.dirty = true; } });
      }
    }
  });

  function write() {
    return segs.map(function (seg, i) {
      if (!seg.el) return (seg.lead || '') + (i < segs.length - 1 ? d.term : '');
      const body = seg.dirty ? seg.el.join(d.sep) : null;
      return seg.lead + (body !== null ? body : seg.el.join(d.sep)) + (i < segs.length - 1 ? d.term : '');
    }).join('');
  }
  for (const m of members) m.list.push.apply(m.list, m.ssn.concat(m.id, m.name));
  return { hits: hits, freeSlots: freeSlots, idents: idents, write: write };
}

function processUnit(text, run, options) {
  const o = options || {};
  const msg = readInterchange(text, run, o.lineBase || 0);
  const idents = msg.idents.ssn.concat(msg.idents.id, msg.idents.name);
  const changed = finishUnit(run, 'x12', msg.hits, msg.freeSlots, idents, { scanOnly: o.scanOnly, known: o.known, onHit: o.onHit, verify: o.verify });
  return { text: changed && !o.scanOnly ? msg.write() : text, changed: changed };
}

module.exports = { detect, isaDelimiters, splitUnits, processUnit, readInterchange, RULES };
