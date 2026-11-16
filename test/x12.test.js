'use strict';
// X12 interchanges: envelope widths and counts, delimiters, segment terminators, element handling.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRun } = require('../src/core/run');
const engine = require('../src/core/engine');
const x12 = require('../src/formats/x12');
const K = require('../src/core/keyed');
const D = require('../src/core/dates');

const KEY = K.keyFromSeed('x12 tests');

function proc(text, mode, options, extra) {
  const run = createRun({ mode: mode || 'pseudonym', key: KEY, options: options });
  const r = engine.processText(text, run, extra);
  assert.equal(r.ok, true, r.message);
  r.run = run;
  return r;
}

// Builds an interchange with correct SE, GE and IEA counts. `segments` are arrays of elements.
function build(o) {
  const sep = o.sep || '*', sub = o.sub || ':', term = o.term || '~', nl = o.nl || '';
  const rep = o.rep === undefined ? '^' : o.rep;
  const ctl = o.control || '000000417';
  const sender = o.sender || 'MERIDALECLINIC', receiver = o.receiver || 'NORTHBRIDGECLR';
  const isa = ['ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', sender.padEnd(15), 'ZZ', receiver.padEnd(15), '261105', '0830', rep, o.version || '00501', ctl, '0', 'P', sub].join(sep) + term;
  const body = [['ST', o.type || '837', '0001']].concat(o.segments);
  body.push(['SE', String(body.length + 1), '0001']);
  const all = [['GS', o.group || 'HC', sender, receiver, '20261105', '0830', '417', 'X', '005010X222A1']].concat(body, [['GE', '1', '417'], ['IEA', '1', ctl]]);
  return isa + nl + all.map((a) => a.join(sep) + term + nl).join('');
}

function parse(text, sep, term) {
  return text.split(term).map((p) => {
    const lead = /^\s*/.exec(p)[0];
    const body = p.slice(lead.length);
    return { lead: lead, el: body ? body.split(sep) : null };
  }).filter((s) => s.el);
}
function elementsOf(text, id, n, occ, sep, term) {
  const hit = parse(text, sep || '*', term || '~').filter((s) => s.el[0] === id)[occ || 0];
  assert.ok(hit, id + ' missing');
  return hit.el[n];
}
function leadsOf(text, term) { return text.split(term).map((p) => /^\s*/.exec(p)[0]); }
function dayOf(s) { return D.toDays(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8))); }
function shape(s) { return s.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/\d/g, '9'); }

// The checks every output must pass: same segments in the same order, same element counts, same control numbers,
// SE01 equal to the real segment count, ISA still 106 characters with the fixed widths.
function assertEnvelope(input, output, sep, term) {
  const a = parse(input, sep, term), b = parse(output, sep, term);
  assert.deepEqual(b.map((s) => s.el[0]), a.map((s) => s.el[0]), 'segment ids');
  assert.deepEqual(b.map((s) => s.el.length), a.map((s) => s.el.length), 'element counts');
  assert.deepEqual(b.map((s) => s.lead), a.map((s) => s.lead), 'whitespace between segments');
  for (let i = 0; i < a.length; i++) if (['ST', 'SE', 'GE', 'IEA'].includes(a[i].el[0])) assert.deepEqual(b[i].el, a[i].el, a[i].el[0]);
  const isaIn = a.find((s) => s.el[0] === 'ISA').el, isaOut = b.find((s) => s.el[0] === 'ISA').el;
  for (const n of [1, 2, 3, 4, 5, 7, 10, 11, 12, 13, 14, 15, 16]) assert.equal(isaOut[n], isaIn[n], 'ISA' + String(n).padStart(2, '0'));
  for (const n of [6, 8]) assert.equal(isaOut[n].length, 15, 'ISA' + String(n).padStart(2, '0') + ' width');
  const gsIn = a.find((s) => s.el[0] === 'GS').el, gsOut = b.find((s) => s.el[0] === 'GS').el;
  for (const n of [1, 5, 6, 7, 8]) assert.equal(gsOut[n], gsIn[n], 'GS' + n);
  const st = b.findIndex((s) => s.el[0] === 'ST'), se = b.findIndex((s) => s.el[0] === 'SE');
  assert.equal(Number(b[se].el[1]), se - st + 1, 'SE01 counts the segments from ST to SE');
  const at = output.indexOf('ISA');
  assert.ok(x12.isaDelimiters(output.slice(at, at + 106)), 'the ISA segment is still 106 characters with the fixed widths');
}
function assertGone(output, secrets) {
  const low = output.toLowerCase();
  for (const s of secrets) assert.equal(low.indexOf(s.toLowerCase()), -1, s + ' is still in the output');
}

const SUBSCRIBER = [['NM1', 'IL', '1', 'DRAVENKORT', 'SELMIRA', 'A', '', '', 'MI', 'DKV55820119'], ['N3', '61 KESTRELHILL ROAD', 'APT 3'], ['N4', 'WRENBURY', 'TX', '77410'],
  ['DMG', 'D8', '19790326', 'F'], ['REF', 'SY', '938-52-7710'], ['REF', '87', '005010X222A1']];
const PAYER = ['NM1', 'PR', '2', 'VANTREL MUTUAL HEALTH', '', '', '', '', 'PI', 'VM0044'];
const BILLING = [['NM1', '85', '2', 'SORRELBY FAMILY CARE', '', '', '', '', 'XX', '1417000042'], ['N3', '2210 HAVERSTOCK ROW'], ['N4', 'WRENBURY', 'TX', '77410'], ['REF', 'EI', '741855202']];
const COMMON = ['DRAVENKORT', 'SELMIRA', 'KESTRELHILL', 'HAVERSTOCK', 'SORRELBY', 'VANTREL', 'WRENBURY', 'DKV55820119', '938-52-7710', '741855202', '1417000042', 'VM0044'];

const CASES = [
  { name: '837P professional claim', type: '837', group: 'HC', secrets: COMMON.concat(['ACCT-DK-770412', 'GRP-DK-4410', 'PCCN-30018842', '2145550142', 'billing@sorrelby-care.example', 'TIBERWOOD', 'HELENE', '1932000087', 'TX77410']),
    segments: [['BHT', '0019', '00', 'BATCH20261105A', '20261105', '0830', 'CH'], ['NM1', '41', '2', 'SORRELBY FAMILY CARE', '', '', '', '', '46', 'TX77410'],
      ['PER', 'IC', 'BILLING OFFICE', 'TE', '2145550142', 'EM', 'billing@sorrelby-care.example'], ['NM1', '40', '2', 'NORTHBRIDGE CLEARING', '', '', '', '', '46', 'NBC0021'], ['HL', '1', '', '20', '1']]
      .concat(BILLING, [['HL', '2', '1', '22', '0'], ['SBR', 'P', '18', '', 'GRP-DK-4410', '', '', '', '', 'CI']], SUBSCRIBER, [PAYER, ['CLM', 'ACCT-DK-770412', '182.50', '', '', '11:B:1', 'Y', 'A', 'Y', 'Y'],
        ['DTP', '431', 'D8', '20261029'], ['DTP', '472', 'RD8', '20261029-20261031'], ['REF', 'F8', 'PCCN-30018842'], ['NTE', 'ADD', 'PATIENT DRAVENKORT SELMIRA ASKED FOR A STATEMENT AT 61 KESTRELHILL ROAD'],
        ['HI', 'ABK:R079'], ['NM1', '82', '1', 'TIBERWOOD', 'HELENE', '', '', '', 'XX', '1932000087'], ['PRV', 'PE', 'PXC', '207Q00000X'], ['LX', '1'], ['SV1', 'HC:99213', '95', 'UN', '1', '', '', '1'], ['DTP', '472', 'D8', '20261029']]) },
  { name: '837I institutional claim', type: '837', group: 'HC', secrets: COMMON.concat(['MRN0099881', 'ACCT-DK-880013', 'ELLERBROOK', 'ORSOLYA']),
    segments: [['BHT', '0019', '00', 'BATCH-I-0042', '20261105', '0830', 'CH']].concat(BILLING, [['HL', '2', '1', '22', '0'], ['SBR', 'P', '18', '', '', '', '', '', '', 'CI']], SUBSCRIBER, [PAYER,
      ['CLM', 'ACCT-DK-880013', '4200.00', '', '', '11:A:1', 'Y', 'A', 'Y', 'Y'], ['DTP', '434', 'RD8', '20261029-20261031'], ['CL1', '1', '1', '01'], ['REF', 'EA', 'MRN0099881'],
      ['HI', 'BK:R079'], ['NM1', '71', '1', 'ELLERBROOK', 'ORSOLYA', '', '', '', 'XX', '1932000087'], ['LX', '1'], ['SV2', '0120', 'HC:99213', '4200.00', 'UN', '3']]) },
  { name: '835 remittance', type: '835', group: 'HP', secrets: ['DRAVENKORT', 'SELMIRA', 'VANTREL', 'SORRELBY', 'LAKEMERE', 'DKV55820119', 'PCN-9921', 'ICN2026110500123', 'TRACE0000771', '1417000042', '999999999', '123456789', '888888888', '987654321', '1512345678', 'PAYER WAY'],
    segments: [['BPR', 'I', '1250.00', 'C', 'ACH', 'CCP', '01', '999999999', 'DA', '123456789', '1512345678', '', '01', '888888888', 'DA', '987654321', '20261105'], ['TRN', '1', 'TRACE0000771', '1512345678'], ['DTM', '405', '20261105'],
      ['N1', 'PR', 'VANTREL MUTUAL HEALTH', 'XV', 'VM0044'], ['N3', '100 PAYER WAY'], ['N4', 'LAKEMERE', 'OH', '44001'], ['N1', 'PE', 'SORRELBY FAMILY CARE', 'XX', '1417000042'], ['LX', '1'],
      ['CLP', 'PCN-9921', '1', '200.00', '150.00', '50.00', 'MC', 'ICN2026110500123', '11'], ['NM1', 'QC', '1', 'DRAVENKORT', 'SELMIRA', '', '', '', 'MI', 'DKV55820119'], ['DTM', '232', '20261029'], ['SVC', 'HC:99213', '200.00', '150.00']] },
  { name: '270 eligibility inquiry', type: '270', group: 'HS', secrets: COMMON.concat(['TRACE-270-0042', '93175-0012-7', '9877281234']),
    segments: [['BHT', '0022', '13', 'TRACE-270-0042', '20261105', '0830'], ['HL', '1', '', '20', '1'], PAYER, ['HL', '2', '1', '21', '1'], ['NM1', '1P', '2', 'SORRELBY FAMILY CARE', '', '', '', '', 'XX', '1417000042'],
      ['HL', '3', '2', '22', '0'], ['TRN', '1', '93175-0012-7', '9877281234'], SUBSCRIBER[0], SUBSCRIBER[3], ['DTP', '291', 'D8', '20261105'], ['EQ', '30']] },
  { name: '271 eligibility response', type: '271', group: 'HB', secrets: COMMON.concat(['TRACE-270-0042', '93175-0012-7']),
    segments: [['BHT', '0022', '11', 'TRACE-270-0042', '20261105', '0830'], ['HL', '1', '', '20', '1'], PAYER, ['HL', '2', '1', '21', '1'], ['NM1', '1P', '2', 'SORRELBY FAMILY CARE', '', '', '', '', 'XX', '1417000042'],
      ['HL', '3', '2', '22', '0'], ['TRN', '2', '93175-0012-7', '9877281234'], SUBSCRIBER[0], SUBSCRIBER[1], SUBSCRIBER[2], SUBSCRIBER[3], SUBSCRIBER[4], ['DTP', '346', 'D8', '20260101'], ['EB', '1', 'IND', '30']] },
  { name: '276 claim status request', type: '276', group: 'HR', secrets: COMMON.concat(['TRACE-9981', 'PCCN-30018842']),
    segments: [['BHT', '0010', '13', 'STATUS-0042', '20261105', '0830'], ['HL', '1', '', '20', '1'], PAYER, ['HL', '2', '1', '19', '1'], ['NM1', '41', '2', 'SORRELBY FAMILY CARE', '', '', '', '', '46', 'TX77410'],
      ['HL', '3', '2', '22', '0'], SUBSCRIBER[3], SUBSCRIBER[0], ['TRN', '1', 'TRACE-9981'], ['REF', '1K', 'PCCN-30018842'], ['DTP', '472', 'RD8', '20261029-20261031']] },
  { name: '277 claim status response', type: '277', group: 'HN', secrets: COMMON.concat(['TRACE-9981']),
    segments: [['BHT', '0010', '08', 'STATUS-0042', '20261105', '0830'], ['HL', '1', '', '20', '1'], PAYER, ['HL', '2', '1', '21', '1'], ['NM1', '41', '2', 'SORRELBY FAMILY CARE', '', '', '', '', '46', 'TX77410'],
      ['HL', '3', '2', '19', '1'], ['NM1', '85', '2', 'SORRELBY FAMILY CARE', '', '', '', '', 'XX', '1417000042'], ['HL', '4', '3', '22', '0'], SUBSCRIBER[0], ['TRN', '2', 'TRACE-9981'],
      ['STC', 'A1:20', '20261105', 'WQ', '182.50'], ['MSG', 'Please call DRAVENKORT about the claim'], ['DTP', '472', 'RD8', '20261029-20261031']] },
  { name: '278 service review', type: '278', group: 'HI', secrets: COMMON.concat(['AUTHREF0099', 'TIBERWOOD', 'HELENE']),
    segments: [['BHT', '0007', '13', 'AUTH-0042', '20261105', '0830'], ['HL', '1', '', '20', '1'], ['NM1', 'X3', '2', 'VANTREL MUTUAL HEALTH', '', '', '', '', 'PI', 'VM0044'], ['HL', '2', '1', '21', '1'],
      ['NM1', '1P', '1', 'TIBERWOOD', 'HELENE', '', '', '', 'XX', '1932000087'], ['HL', '3', '2', '22', '1'], SUBSCRIBER[0], SUBSCRIBER[3], SUBSCRIBER[4], ['HCR', 'A1', 'AUTHREF0099'], ['UM', 'HS', 'I', '11'],
      ['DTP', '472', 'RD8', '20261110-20261112']] },
  { name: '834 enrolment', type: '834', group: 'BE', secrets: COMMON.concat(['ENR-REF-0042', 'SUBSCRIBER-0001', 'GRP-DK-4410', '630044881', '2145550142', '938527710']),
    segments: [['BGN', '00', 'ENR-REF-0042', '20261105', '0830'], ['N1', 'P5', 'SORRELBY FAMILY CARE', 'FI', '741855202'], ['N1', 'IN', 'VANTREL MUTUAL HEALTH', 'FI', '630044881'],
      ['INS', 'Y', '18', '030', 'XN', 'A'], ['REF', '0F', 'SUBSCRIBER-0001'], ['REF', '1L', 'GRP-DK-4410'], ['DTP', '356', 'D8', '20261201'],
      ['NM1', 'IL', '1', 'DRAVENKORT', 'SELMIRA', 'A', '', '', '34', '938527710'], ['PER', 'IP', '', 'TE', '2145550142'], ['N3', '61 KESTRELHILL ROAD'], ['N4', 'WRENBURY', 'TX', '77410'], ['DMG', 'D8', '19790326', 'F']] }
];

for (const c of CASES) {
  test(c.name + ': envelope, counts and delimiters stay; the identifying elements go', () => {
    const text = build(c);
    assert.equal(engine.detectFormat(text), 'x12');
    const out = proc(text);
    assert.equal(out.units, 1);
    assert.ok(out.changed > 8);
    assertEnvelope(text, out.text, '*', '~');
    assertGone(out.text, c.secrets);
  });
}

for (const c of CASES.slice(0, 3)) {
  test(c.name + ' in mask mode: same length, letters X, digits 9, envelope intact', () => {
    const text = build(c);
    const out = proc(text, 'mask');
    assert.equal(out.text.length, text.length);
    assertEnvelope(text, out.text, '*', '~');
    assert.equal(proc(out.text, 'mask').text, out.text);
    assert.match(elementsOf(out.text, 'NM1', 3, 0), /^[X ]+$/);
  });
}

// ---- terminators, delimiters ---------------------------------------------------------------

for (const [label, nl] of [['no line break', ''], ['LF', '\n'], ['CRLF', '\r\n']]) {
  test('line break after each segment: ' + label + ' is kept exactly', () => {
    const text = build(Object.assign({}, CASES[0], { nl: nl }));
    const out = proc(text);
    assert.deepEqual(leadsOf(out.text, '~'), leadsOf(text, '~'));
    assertEnvelope(text, out.text, '*', '~');
    assertGone(out.text, CASES[0].secrets);
  });
}

const VARIANTS = [
  { name: 'pipe separator', o: { sep: '|' } },
  { name: 'plus separator, greater-than sub-element, apostrophe terminator', o: { sep: '+', sub: '>', term: "'" } },
  { name: 'line feed as the segment terminator', o: { term: '\n' } },
  { name: 'carriage return as the segment terminator', o: { term: '\r' } },
  { name: 'older version 00401 with U in ISA11', o: { version: '00401', rep: 'U' } },
  { name: 'caret separator and bar sub-element separator', o: { sep: '^', sub: '|', rep: '~', term: '!' } },
  { name: 'repetition separator and a different sub-element separator', o: { sub: '<', rep: '>' } }
];
for (const v of VARIANTS) {
  test('delimiters: ' + v.name, () => {
    const o = Object.assign({}, CASES[0], v.o);
    const text = build(o);
    const sep = o.sep || '*', term = o.term || '~';
    assert.equal(engine.detectFormat(text), 'x12');
    const d = x12.isaDelimiters(text.slice(0, 106));
    assert.equal(d.sep, sep);
    assert.equal(d.term, term);
    const out = proc(text);
    assertEnvelope(text, out.text, sep, term);
    assertGone(out.text, CASES[0].secrets);
  });
}

test('ISA06 and ISA08 are replaced and stay exactly 15 characters; GS02 and GS03 get the same replacements', () => {
  for (const [sender, receiver] of [['MERIDALECLINIC', 'NORTHBRIDGECLR'], ['MERIDALE', 'NBC'], ['A', 'B'], ['MERIDALE-1234567', 'X']]) {
    const text = build(Object.assign({}, CASES[0], { sender: sender.slice(0, 15), receiver: receiver }));
    const out = proc(text);
    const isa6 = elementsOf(out.text, 'ISA', 6, 0), isa8 = elementsOf(out.text, 'ISA', 8, 0);
    assert.equal(isa6.length, 15);
    assert.equal(isa8.length, 15);
    assert.notEqual(isa6.trim(), sender.slice(0, 15).trim());
    assert.equal(elementsOf(out.text, 'GS', 2, 0), isa6.trimEnd());
    assert.equal(elementsOf(out.text, 'GS', 3, 0), isa8.trimEnd());
    assert.equal(isa6.length - isa6.trimEnd().length, 15 - sender.slice(0, 15).length, 'padding spaces stay where they were');
  }
});

test('keepEnvelope keeps ISA06, ISA08, GS02 and GS03 and still replaces the people', () => {
  const text = build(CASES[0]);
  const out = proc(text, 'pseudonym', { keepEnvelope: true });
  assert.equal(elementsOf(out.text, 'ISA', 6, 0), 'MERIDALECLINIC '.slice(0, 15));
  assert.equal(elementsOf(out.text, 'ISA', 8, 0), 'NORTHBRIDGECLR '.slice(0, 15));
  assert.equal(elementsOf(out.text, 'GS', 2, 0), 'MERIDALECLINIC');
  assert.equal(elementsOf(out.text, 'GS', 3, 0), 'NORTHBRIDGECLR');
  assertGone(out.text, ['DRAVENKORT', 'SELMIRA', '938-52-7710']);
});

test('control numbers in ISA13, IEA02, GS06, GE02, ST02 and SE02 stay as they are', () => {
  const text = build(Object.assign({}, CASES[0], { control: '000012345' }));
  const out = proc(text);
  assert.equal(elementsOf(out.text, 'ISA', 13, 0), '000012345');
  assert.equal(elementsOf(out.text, 'IEA', 2, 0), '000012345');
  assert.equal(elementsOf(out.text, 'GS', 6, 0), '417');
  assert.equal(elementsOf(out.text, 'GE', 2, 0), '417');
  assert.equal(elementsOf(out.text, 'ST', 2, 0), '0001');
  assert.equal(elementsOf(out.text, 'SE', 2, 0), '0001');
});

// ---- several interchanges, damaged envelopes -----------------------------------------------

test('two interchanges in one text are both processed with their own envelopes; equal values get equal replacements', () => {
  const a = build(Object.assign({}, CASES[0], { control: '000000417' }));
  const b = build(Object.assign({}, CASES[2], { control: '000000418' }));
  for (const joiner of ['', '\n', '\r\n\r\n']) {
    const out = proc(a + joiner + b);
    assert.equal(out.units, 2);
    const at = out.text.lastIndexOf('ISA*');
    const first = out.text.slice(0, at - joiner.length);
    const second = out.text.slice(at);
    assertEnvelope(a, first, '*', '~');
    assertEnvelope(b, second, '*', '~');
    assert.equal(out.text.slice(first.length, out.text.length - second.length), joiner);
    assertGone(out.text, ['DRAVENKORT', 'SELMIRA', 'SORRELBY', 'VANTREL', 'LAKEMERE']);
    assert.equal(elementsOf(first, 'ISA', 6, 0), elementsOf(second, 'ISA', 6, 0), 'same sender, same replacement');
    assert.equal(elementsOf(second, 'ISA', 13, 0), '000000418');
  }
});

test('two interchanges with different element separators and terminators in one text are both processed', () => {
  const a = build(Object.assign({}, CASES[0], { control: '000000417' }));
  const b = build(Object.assign({}, CASES[2], { control: '000000418', sep: '|', term: '\n' }));
  for (const joiner of ['', '\n']) {
    const out = proc(a + joiner + b);
    assert.equal(out.units, 2, 'the second interchange is found although its ISA uses other delimiters');
    assertGone(out.text, ['DRAVENKORT', 'SELMIRA', 'SORRELBY', 'VANTREL', 'LAKEMERE', 'PCN-9921', 'TRACE0000771']);
    assertEnvelope(b, out.text.slice(out.text.lastIndexOf('ISA|')), '|', '\n');
  }
});

test('an interchange without IEA is still processed and nothing is added', () => {
  const text = build(CASES[0]).replace(/IEA\*1\*000000417~$/, '');
  assert.ok(text.endsWith('GE*1*417~'));
  const out = proc(text);
  assert.ok(out.text.endsWith('GE*1*417~'));
  assertGone(out.text, CASES[0].secrets);
  assert.deepEqual(parse(out.text, '*', '~').map((s) => s.el[0]), parse(text, '*', '~').map((s) => s.el[0]));
});

test('an ISA that is not exactly 106 characters is refused by format detection and left alone when forced', () => {
  const good = build(CASES[0]);
  const shortIsa = good.replace('MERIDALECLINIC ', 'MERIDALECLINIC').replace('NORTHBRIDGECLR ', 'NORTHBRIDGECLR');
  assert.equal(engine.detectFormat(shortIsa), null);
  const refused = engine.processText(shortIsa, createRun({ mode: 'pseudonym', key: KEY }));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'not-recognised');
  const forced = engine.processText(shortIsa, createRun({ mode: 'pseudonym', key: KEY }), { format: 'x12' });
  assert.equal(forced.ok, true);
  assert.equal(forced.changed, 0);
  assert.equal(forced.text, shortIsa);
  const longIsa = good.replace('ISA*00*', 'ISA*00*  ');
  assert.equal(engine.detectFormat(longIsa), null);
  const sameDelims = good.replace(':~GS', '*~GS');
  assert.equal(engine.detectFormat(sameDelims), null);
});

// ---- elements ------------------------------------------------------------------------------

test('NM1 person names and organisation names are replaced by the right kind of name', () => {
  const out = proc(build(CASES[0]));
  const person = parse(out.text, '*', '~').filter((s) => s.el[0] === 'NM1' && s.el[1] === 'IL')[0].el;
  assert.match(person[3], /^[A-Z]+$/);
  assert.match(person[4], /^[A-Z]+$/);
  assert.match(person[5], /^[A-Z]$/);
  assert.notEqual(person[3], 'DRAVENKORT');
  assert.equal(shape(person[9]), shape('DKV55820119'));
  const org = parse(out.text, '*', '~').filter((s) => s.el[0] === 'NM1' && s.el[1] === 'PR')[0].el;
  assert.match(org[3], /^[A-Z]+ [A-Z ]*(MUTUAL|HEALTH|SERVICES|PLAN|GROUP|INSURANCE|CARE|CENTER|CLINIC)[A-Z ]*$/);
  assert.equal(org[8], 'PI');
  assert.equal(org[2], '2');
  assert.equal(shape(org[9]), shape('VM0044'));
  const npi = parse(out.text, '*', '~').filter((s) => s.el[0] === 'NM1' && s.el[1] === '85')[0].el;
  assert.match(npi[9], /^\d{10}$/);
  assert.notEqual(npi[9], '1417000042');
});

test('REF qualifiers decide the kind: SY is an SSN, 87 is kept, EI is a tax number, F8 a record number', () => {
  const segs = [['REF', 'SY', '938-52-7710'], ['REF', '87', '005010X222A1'], ['REF', 'EI', '741855202'], ['REF', 'F8', 'PCCN-30018842'], ['REF', 'ZZ', 'LOCAL-77'], ['REF', 'EI', '741855202', 'DESC TEXT FOR THE NUMBER']];
  const out = proc(build({ segments: segs, type: '837' }));
  const refs = parse(out.text, '*', '~').filter((s) => s.el[0] === 'REF').map((s) => s.el);
  assert.match(refs[0][2], /^\d{3}-\d{2}-\d{4}$/);
  assert.notEqual(refs[0][2], '938-52-7710');
  assert.equal(refs[1][2], '005010X222A1');
  assert.match(refs[2][2], /^\d{9}$/);
  assert.notEqual(refs[2][2], '741855202');
  assert.equal(shape(refs[3][2]), shape('PCCN-30018842'));
  assert.notEqual(refs[3][2], 'PCCN-30018842');
  assert.equal(shape(refs[4][2]), shape('LOCAL-77'));
  assert.notEqual(refs[4][2], 'LOCAL-77');
  assert.equal(refs[5][2], refs[2][2], 'same number, same replacement');
  assert.equal(refs[5][3], 'DESC TEXT FOR THE NUMBER');
});

test('PER contacts: person name, department name, telephone, fax, e-mail and web address', () => {
  const segs = [['PER', 'IC', 'DRAVENKORT SELMIRA', 'TE', '2145550142', 'EM', 'selmira.d@mailbox.example', 'FX', '2145550199'], ['PER', 'IC', 'BILLING DEPARTMENT', 'TE', '2145550143'], ['PER', 'IC', 'CLAIMS HELPDESK', 'UR', 'www.claims-portal.example/help']];
  const out = proc(build({ segments: segs, type: '837' }));
  const per = parse(out.text, '*', '~').filter((s) => s.el[0] === 'PER').map((s) => s.el);
  assert.equal(per[0][2].indexOf('DRAVENKORT'), -1);
  assert.match(per[0][2], /^[A-Z]+ [A-Z]+$/);
  assert.match(per[0][4], /^\d{10}$/);
  assert.notEqual(per[0][4], '2145550142');
  assert.match(per[0][6], /^[a-z.]+\d*@[a-z]+\.example$/);
  assert.match(per[0][8], /^\d{10}$/);
  assert.notEqual(per[0][8], '2145550199');
  assert.notEqual(per[1][2], 'BILLING DEPARTMENT');
  assert.match(per[1][2], /^[A-Z ]+$/);
  assert.equal(per[2][3], 'UR');
  assert.equal(per[2][4].indexOf('claims-portal'), -1);
  assert.equal(per[0].length, 9);
});

test('N3, N4 and N1: street lines, towns and zip codes change, the state stays', () => {
  const out = proc(build({ segments: BILLING, type: '837' }));
  const get = (id) => parse(out.text, '*', '~').filter((s) => s.el[0] === id)[0].el;
  assert.match(get('N3')[1], /^\d{4} [A-Z ]+ ROW$/);
  assert.notEqual(get('N4')[1], 'WRENBURY');
  assert.equal(get('N4')[2], 'TX');
  assert.match(get('N4')[3], /^\d{5}$/);
  assert.notEqual(get('N4')[3], '77410');
});

test('dates: one offset for the whole interchange, D8 and RD8 (both ends) and the two-digit ISA09 all move together', () => {
  const text = build(CASES[0]);
  const out = proc(text);
  const diff = (id, n, occ, sub) => {
    const a = elementsOf(text, id, n, occ), b = elementsOf(out.text, id, n, occ);
    return sub ? [dayOf(b.split('-')[sub - 1]) - dayOf(a.split('-')[sub - 1])] : [dayOf(b) - dayOf(a)];
  };
  const offsets = [].concat(diff('DMG', 2, 0), diff('DTP', 3, 0), diff('DTP', 3, 1, 1), diff('DTP', 3, 1, 2), diff('DTP', 3, 2), diff('BHT', 4, 0), diff('GS', 4, 0));
  assert.equal(new Set(offsets).size, 1, offsets.join(','));
  assert.ok(Math.abs(offsets[0]) >= 60 && Math.abs(offsets[0]) <= 730);
  const isaIn = elementsOf(text, 'ISA', 9, 0), isaOut = elementsOf(out.text, 'ISA', 9, 0);
  const day6 = (s) => D.toDays(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)), Number(s.slice(4, 6)));
  assert.equal(day6(isaOut) - day6(isaIn), offsets[0]);
  const [r1, r2] = elementsOf(out.text, 'DTP', 3, 1).split('-');
  const [o1, o2] = elementsOf(text, 'DTP', 3, 1).split('-');
  assert.equal(dayOf(r2) - dayOf(r1), dayOf(o2) - dayOf(o1), 'range length');
  assert.equal(elementsOf(out.text, 'ISA', 10, 0), '0830');
  assert.equal(elementsOf(out.text, 'DMG', 3, 0), 'F');
  assert.equal(elementsOf(out.text, 'DMG', 1, 0), 'D8');
});

test('a date qualifier the profile does not know is left alone', () => {
  const out = proc(build({ segments: [['NM1', 'IL', '1', 'DRAVENKORT', 'SELMIRA'], ['DTP', '999', 'TM', '1530'], ['DTP', '999', 'D8', '20261029']], type: '837' }));
  assert.equal(elementsOf(out.text, 'DTP', 3, 0), '1530');
  assert.notEqual(elementsOf(out.text, 'DTP', 3, 1), '20261029');
});

test('free text in NTE and MSG is scanned for names seen in the interchange', () => {
  const out = proc(build(CASES[0]));
  const nte = elementsOf(out.text, 'NTE', 2, 0);
  assert.ok(nte.startsWith('PATIENT '));
  assert.equal(nte.indexOf('DRAVENKORT'), -1);
  assert.equal(nte.indexOf('KESTRELHILL'), -1);
  const patient = parse(out.text, '*', '~').filter((s) => s.el[0] === 'NM1' && s.el[1] === 'IL')[0].el;
  assert.ok(nte.indexOf(patient[3]) !== -1 && nte.indexOf(patient[4]) !== -1, 'the names in the note are the names of the NM1 segment');
  const msg = proc(build(CASES[6]));
  assert.equal(elementsOf(msg.text, 'MSG', 1, 0).indexOf('DRAVENKORT'), -1);
});

test('segments the profile does not name are only swept for e-mail, SSN-like numbers and seen numbers', () => {
  const text = build({ type: '837', segments: [['NM1', 'IL', '1', 'DRAVENKORT', 'SELMIRA', '', '', '', 'MI', 'DKV55820119'], ['REF', 'SY', '938-52-7710'], ['XYZ', 'DKV55820119', 'DRAVENKORT', '938-52-7710', 'mail a.b@zzz.example']] });
  const out = proc(text);
  const xyz = parse(out.text, '*', '~').filter((s) => s.el[0] === 'XYZ')[0].el;
  const nm1 = parse(out.text, '*', '~').filter((s) => s.el[0] === 'NM1')[0].el;
  assert.equal(xyz[1], nm1[9], 'a member number seen in NM1 is replaced the same way');
  assert.equal(xyz[2], 'DRAVENKORT', 'a name in an unknown segment is not touched');
  assert.equal(xyz[3], elementsOf(out.text, 'REF', 2, 0));
  assert.equal(xyz[4].indexOf('zzz.example'), -1);
});

test('maskOrganisations false keeps organisation names but not people', () => {
  const out = proc(build(CASES[0]), 'pseudonym', { maskOrganisations: false });
  assert.equal(elementsOf(out.text, 'NM1', 3, 0), 'SORRELBY FAMILY CARE');
  assert.equal(parse(out.text, '*', '~').filter((s) => s.el[0] === 'NM1' && s.el[1] === 'PR')[0].el[3], 'VANTREL MUTUAL HEALTH');
  assertGone(out.text, ['DRAVENKORT', 'SELMIRA']);
});

test('each member of an enrolment gets an own date offset; the same member keeps hers', () => {
  const member = (first, ssn, dob) => [['INS', 'Y', '18', '030', 'XN', 'A'], ['NM1', 'IL', '1', 'DRAVENKORT', first, '', '', '', '34', ssn], ['DMG', 'D8', dob, 'F'], ['DTP', '356', 'D8', '20261201']];
  const text = build({ type: '834', group: 'BE', segments: [['BGN', '00', 'ENR-1', '20261105', '0830']].concat(member('SELMIRA', '938527710', '19790326'), member('OSWINA', '938527711', '19790326')) });
  const out = proc(text);
  const dmg = parse(out.text, '*', '~').filter((s) => s.el[0] === 'DMG').map((s) => dayOf(s.el[2]) - dayOf('19790326'));
  assert.notEqual(dmg[0], dmg[1], 'two members, two offsets');
  const dtp = parse(out.text, '*', '~').filter((s) => s.el[0] === 'DTP').map((s) => dayOf(s.el[3]) - dayOf('20261201'));
  assert.equal(dtp[0], dmg[0], 'the dates of the first member move with her birth date');
  assert.equal(dtp[1], dmg[1], 'the dates of the second member move with her birth date');
});

test('scanOnly counts the identifiers and leaves the text alone', () => {
  const text = build(CASES[0]);
  const run = createRun({ mode: 'pseudonym', key: KEY });
  const cats = new Set();
  const out = engine.processText(text, run, { scanOnly: true, onHit: (h, c) => { cats.add(c); h.set = function () { throw new Error('set called in a scan'); }; } });
  assert.equal(out.ok, true);
  assert.equal(out.text, text);
  for (const c of ['names', 'addresses', 'dates', 'phone', 'email', 'ssn']) assert.ok(cats.has(c), c);
});

test('output is deterministic for a key and differs for another one', () => {
  const text = build(CASES[0]);
  assert.equal(proc(text).text, proc(text).text);
  const other = engine.processText(text, createRun({ mode: 'pseudonym', key: K.keyFromSeed('another x12 key') }));
  assert.notEqual(other.text, proc(text).text);
});
