'use strict';
// The three built-in samples (src/samples.js): recognised, processed without error by the scan, the
// fixed-pattern mask and the pseudonym run, made of invented data only, and still valid for their
// format after de-identification.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRun } = require('../src/core/run');
const engine = require('../src/core/engine');
const { sampleFor, SAMPLES } = require('../src/samples');

const KEY = Buffer.alloc(32, 5);
const KINDS = ['hl7', 'fhir', 'x12'];
const FORMAT_OF = { hl7: 'hl7', fhir: 'fhir', x12: 'x12' };
const text = (kind) => sampleFor(kind).text;
const pseudonym = (kind, options) => { const run = createRun({ mode: 'pseudonym', key: KEY, options: options }); return { run: run, result: engine.processText(text(kind), run, {}) }; };
const masked = (kind) => { const run = createRun({ mode: 'mask' }); return { run: run, result: engine.processText(text(kind), run, {}) }; };

// Identifiers written into each sample, listed by hand. Every one of them must be gone after a pseudonym run.
const IDENTIFIERS = {
  hl7: ['Larkspur', 'Evander', 'Marlowe', 'Odelia', 'Thistlewood', 'Corisande', 'HC-7305518', '926-41-7390', 'HC-ACC-228814', 'HC-V-905527', '6102257', 'HM-MEMBER-4417203',
    '41 Wren Hollow', 'Wren Hollow', 'Fernbury', '43055', '614-555-0187', '614-555-0143', 'evander.larkspur@mail.example', '19810322', 'MSG20261104-0042', 'HARBOURSIDE'],
  fhir: ['Larkspur', 'Evander', 'Marlowe', 'Odelia', 'HC-7305518', '926-41-7390', '614-555-0187', '614-555-0143', 'evander.larkspur@mail.example', '1981-03-22', '41 Wren Hollow', 'Fernbury', '43055',
    '7c1d5b0e-2a64-4f1b-9e0a-3d55b7a1c201', '3a9e8c44-61d7-4d0c-8b52-90e1f2a6b302', 'harbourside', 'sample-visit-bundle'],
  x12: ['LARKSPUR', 'EVANDER', 'NWP4417203', '19810322', '926-41-7390', '41 WREN HOLLOW', 'WREN HOLLOW', 'FERNBURY', '43055', 'HARBOURSIDE', 'NORTHWAY', 'HM10442', 'NW20917', '1982736451', '466012345',
    '6145550110', 'billing@harbourside.example', 'ACCT-HM-905527', 'GRP-HM-2210', '900 QUAYSIDE', 'QUAYSIDE', 'BATCH-HM-1104']
};
// The structured fields of the profile (the free tier does not read free text), so the fixed-pattern mask is checked on these lines only.
const STRUCTURED = {
  hl7: { lines: /^(PID|NK1|PV1)\|/, originals: ['Larkspur', 'Evander', 'Marlowe', 'Odelia', 'Thistlewood', 'Corisande', 'HC-7305518', '926-41-7390', 'HC-ACC-228814', '41 Wren Hollow', 'Fernbury', '43055', '614-555-0187', '614-555-0143', 'evander.larkspur@mail.example', '19810322'] },
  x12: { lines: /^(NM1\*IL|N3|N4|DMG|REF\*SY|PER)\*/, originals: ['LARKSPUR', 'EVANDER', 'NWP4417203', '19810322', '926-41-7390', '41 WREN HOLLOW', 'FERNBURY', '43055', '6145550110', 'billing@harbourside.example'] }
};
// Fragments are joined here so that this file holds none of these words in one piece.
const PERSONAL = [['im', 'ad'], ['murat', 'spahic'], ['car', 'rd'], ['small', 'steps']].map((p) => p.join(''));
const TRACE = ['ia', 'detareneg', 'rotareneg', 'ledom', 'tpmorp', 'mll', 'edualc', 'tpg', 'tolipoc', 'ciporhtna', 'ianepo', 'tnatsissa'].map((w) => w.split('').reverse().join(''));
const REAL_NAMES = ['mayo clinic', 'cleveland clinic', 'johns hopkins', 'kaiser', 'aetna', 'cigna', 'humana', 'medicare', 'medicaid', 'blue cross', 'blue shield', 'unitedhealth', 'cerner', 'allscripts',
  'mckesson', 'walgreens', 'quest diagnostics', 'labcorp', 'mass general', 'mount sinai', 'anthem', 'tricare', 'veterans', 'nhs'];

// control characters other than tab, line feed and carriage return
const CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) + '-' + String.fromCharCode(31) + ']');

function segmentsOf(kind, t) { return kind === 'x12' ? t.split('~').map((s) => s.replace(/^\s+/, '')).filter(Boolean) : t.split(/\r\n|\r|\n/).filter(Boolean); }

// ---- the samples themselves ------------------------------------------------------------------

test('the samples are the three that the commands open, with names and languages', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), ['fhir', 'hl7', 'x12']);
  assert.equal(sampleFor('hl7').language, 'plaintext');
  assert.equal(sampleFor('x12').language, 'plaintext');
  assert.equal(sampleFor('fhir').language, 'json');
  assert.match(sampleFor('hl7').name, /\.hl7$/);
  assert.match(sampleFor('fhir').name, /\.json$/);
  assert.match(sampleFor('x12').name, /\.x12$/);
  assert.equal(sampleFor('nothing'), undefined);
});

for (const kind of KINDS) {
  test(kind + ' sample: recognised as its format and short', () => {
    assert.equal(engine.detectFormat(text(kind)), FORMAT_OF[kind]);
    assert.ok(text(kind).length > 500 && text(kind).length < 8000, 'a short sample: ' + text(kind).length);
  });

  test(kind + ' sample: the scan, the fixed-pattern mask and the pseudonym run all finish without error', () => {
    const scanRun = createRun({ mode: 'pseudonym', key: KEY });
    const scan = engine.processText(text(kind), scanRun, { scanOnly: true });
    assert.equal(scan.ok, true);
    assert.equal(scan.text, text(kind), 'a scan changes nothing');
    assert.ok(scanRun.stats.total >= 15, 'the scan finds the identifiers: ' + scanRun.stats.total);
    assert.equal(scanRun.entryCount(), 0, 'a scan keeps no values');
    const m = masked(kind);
    assert.equal(m.result.ok, true);
    assert.ok(m.result.changed >= 10);
    const p = pseudonym(kind);
    assert.equal(p.result.ok, true);
    assert.ok(p.result.changed >= 15);
    assert.equal(p.result.units, 1);
  });

  test(kind + ' sample: only invented data (no personal name, no real institution, no tool wording, only reserved contact details)', () => {
    const t = text(kind);
    const low = t.toLowerCase();
    for (const w of PERSONAL) assert.ok(!low.includes(w), 'a personal word is in the sample');
    for (const w of REAL_NAMES) assert.ok(!low.includes(w), 'a real institution or payer: ' + w);
    for (const w of TRACE) assert.ok(!new RegExp('\\b' + w + '\\b', 'i').test(t), 'a forbidden word is in the sample');
    for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)/g)) assert.match(m[1], /\.example$/, 'e-mail domain ' + m[1]);
    for (const m of t.matchAll(/https?:\/\/([^/"\s]+)/g)) assert.ok(['terminology.hl7.org', 'loinc.org', 'hl7.org', 'unitsofmeasure.org', 'harbourside.example'].includes(m[1]), 'host ' + m[1]);
    for (const m of t.matchAll(/\b\d{3}-\d{3}-\d{4}\b/g)) assert.match(m[0], /^\d{3}-555-01\d\d$/, 'telephone number ' + m[0] + ' is in the reserved range 0100-0199');
    if (kind === 'x12') for (const s of segmentsOf('x12', t).map((x) => x.split('*'))) if (s[0] === 'PER') assert.match(s[s.indexOf('TE') + 1], /^\d{3}5550\d{3}$/, 'telephone number in PER');
  });

  test(kind + ' sample: the pseudonym run removes every identifier that is written into it', () => {
    const out = pseudonym(kind).result.text.toLowerCase();
    for (const id of IDENTIFIERS[kind]) assert.ok(!out.includes(id.toLowerCase()), '"' + id + '" is still in the output');
  });

  test(kind + ' sample: the pseudonym run is repeatable with the same key and differs with another key', () => {
    const a = pseudonym(kind).result.text;
    assert.equal(pseudonym(kind).result.text, a);
    const other = engine.processText(text(kind), createRun({ mode: 'pseudonym', key: Buffer.alloc(32, 6) }), {}).text;
    assert.notEqual(other, a);
  });
}

test('the samples: SSN-like numbers are of a kind that is never issued, so they cannot belong to a real person', () => {
  const problems = [];
  for (const kind of KINDS) {
    for (const m of text(kind).matchAll(/\b(\d{3})-(\d{2})-(\d{4})\b/g)) {
      const [area, group, serial] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!(area === 0 || area === 666 || area >= 900 || group === 0 || serial === 0)) problems.push(kind + ': ' + m[0] + ' (area ' + area + ')');
    }
  }
  assert.deepEqual(problems, []);
});

for (const kind of ['hl7', 'x12']) {
  test(kind + ' sample: the fixed-pattern mask hides the structured fields with X and 9 and keeps their length', () => {
    const out = masked(kind).result.text;
    const before = segmentsOf(kind, text(kind));
    const after = segmentsOf(kind, out);
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i].length, before[i].length, 'segment ' + i + ' keeps its length');
      if (STRUCTURED[kind].lines.test(before[i])) for (const id of STRUCTURED[kind].originals) assert.ok(!after[i].includes(id), '"' + id + '" is still in ' + before[i].slice(0, 3));
    }
    assert.match(out, /XXXX/);
    assert.match(out, /9999/);
  });
}

test('fhir sample: the fixed-pattern mask hides the structured fields', () => {
  const out = JSON.parse(masked('fhir').result.text);
  const patient = out.entry[0].resource;
  assert.equal(patient.name[0].family, 'XXXXXXXX');
  assert.deepEqual(patient.name[0].given, ['XXXXXXX', 'XXXXXXX']);
  assert.equal(patient.identifier[0].value, 'XX-9999999');
  assert.equal(patient.birthDate, '9999-99-99');
  assert.equal(patient.address[0].line[0], '99 XXXX XXXXXX XXXX');
  assert.equal(patient.telecom[0].value, '999-999-9999');
});

// ---- structure after de-identification -------------------------------------------------------

test('hl7 sample: carriage-return terminators, MSH first, and the same segments and field counts after every kind of run', () => {
  const t = text('hl7');
  assert.ok(t.includes('\r') && !t.includes('\n'), 'carriage returns only');
  assert.ok(t.endsWith('\r'));
  assert.ok(t.startsWith('MSH|^~\\&|'));
  const before = segmentsOf('hl7', t);
  for (const out of [pseudonym('hl7').result.text, masked('hl7').result.text, pseudonym('hl7', { keepEnvelope: true, shiftDates: false }).result.text]) {
    assert.ok(out.startsWith('MSH|^~\\&|'), 'delimiters kept');
    assert.ok(out.includes('\r') && !out.includes('\n'), 'terminators kept');
    assert.ok(out.endsWith('\r'));
    const after = segmentsOf('hl7', out);
    assert.deepEqual(after.map((s) => s.slice(0, 3)), before.map((s) => s.slice(0, 3)), 'segment order');
    assert.deepEqual(after.map((s) => s.split('|').length), before.map((s) => s.split('|').length), 'field count of each segment');
    assert.deepEqual(after.map((s) => s.split('^').length), before.map((s) => s.split('^').length), 'component count of each segment');
    for (const s of after) assert.ok(s.length > 3 && !CONTROL.test(s), 'plain segment text');
  }
});

test('hl7 sample: the date of birth moves by a whole number of days and the other dates move by the same number', () => {
  const out = segmentsOf('hl7', pseudonym('hl7').result.text);
  const dob = out.find((s) => s.startsWith('PID|')).split('|')[7];
  assert.match(dob, /^\d{8}$/);
  const days = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))) / 86400000;
  const shift = days(dob) - days('19810322');
  assert.ok(Math.abs(shift) >= 60 && Math.abs(shift) <= 730, 'offset ' + shift);
  const dg1 = out.find((s) => s.startsWith('DG1|')).split('|')[5];
  assert.equal(days(dg1) - days('20261104'), shift, 'the diagnosis date moves with it');
  const evn = out.find((s) => s.startsWith('EVN|')).split('|')[2];
  assert.equal(days(evn.slice(0, 8)) - days('20261104'), shift);
  assert.equal(evn.slice(8), '091500', 'the time of day is untouched');
});

function x12Problems(t) {
  const problems = [];
  const widths = [3, 2, 10, 2, 10, 2, 15, 2, 15, 6, 4, 1, 5, 9, 1, 1, 1];
  const first = t.indexOf('~') + 1;
  if (first !== 106) problems.push('ISA is ' + first + ' characters');
  const isa = t.slice(0, 105).split('*');
  if (isa.length !== 17) problems.push('ISA has ' + isa.length + ' elements');
  else isa.forEach((e, i) => { if (e.length !== widths[i]) problems.push('ISA element ' + i + ' is ' + e.length + ' long'); });
  const segs = segmentsOf('x12', t).map((s) => s.split('*'));
  const at = (id) => segs.findIndex((s) => s[0] === id);
  const st = at('ST'), se = at('SE');
  if (se - st + 1 !== Number(segs[se][1])) problems.push('SE01 is ' + segs[se][1] + ' but ' + (se - st + 1) + ' segments lie between ST and SE');
  if (segs[st][2] !== segs[se][2]) problems.push('ST02 and SE02 differ');
  const gs = segs.filter((s) => s[0] === 'GS').length, ge = segs.filter((s) => s[0] === 'GE');
  if (ge.length !== 1 || Number(ge[0][1]) !== segs.filter((s) => s[0] === 'ST').length) problems.push('GE01 does not count the ST segments');
  if (segs[at('GS')][6] !== ge[0][2]) problems.push('GS06 and GE02 differ');
  const iea = segs[at('IEA')];
  if (Number(iea[1]) !== gs) problems.push('IEA01 does not count the groups');
  if (iea[2] !== segs[0][13]) problems.push('ISA13 and IEA02 differ');
  if (segs[0][0] !== 'ISA' || segs[segs.length - 1][0] !== 'IEA') problems.push('envelope order');
  return problems;
}

test('x12 sample: the ISA is exactly 106 characters and its SE, GE and IEA counts and control numbers are right', () => {
  const t = text('x12');
  assert.equal(t.indexOf('~') + 1, 106);
  assert.deepEqual(x12Problems(t), []);
  const segs = segmentsOf('x12', t).map((s) => s.split('*'));
  assert.equal(segs[segs.length - 3][0], 'SE');
  assert.equal(segs[segs.length - 3][2], '0001');
  assert.deepEqual(segs[segs.length - 2], ['GE', '1', '231']);
  assert.deepEqual(segs[segs.length - 1], ['IEA', '1', '000000231']);
  assert.equal(t.split('\n').length, segs.length + 1, 'one segment per line, with a final line break');
});

test('x12 sample: after a pseudonym run and after the mask the interchange is as valid as the input (control numbers and counts untouched)', () => {
  const baseline = x12Problems(text('x12'));
  for (const out of [pseudonym('x12').result.text, masked('x12').result.text, pseudonym('x12', { keepEnvelope: true }).result.text]) {
    assert.deepEqual(x12Problems(out), baseline);
    assert.equal(out.split('\n').length, text('x12').split('\n').length, 'line breaks kept');
    assert.deepEqual(segmentsOf('x12', out).map((s) => s.split('*')[0]), segmentsOf('x12', text('x12')).map((s) => s.split('*')[0]), 'segment order');
    const segs = segmentsOf('x12', out).map((s) => s.split('*'));
    assert.deepEqual(segs[segs.length - 1], ['IEA', '1', '000000231']);
    assert.equal(segs[0][13], '000000231');
  }
});

test('x12 sample: a National Provider Identifier written in the sample fails the check-digit test, so it cannot be a real provider', () => {
  const luhn = (n) => { let sum = 0; ('80840' + n).split('').reverse().forEach((c, i) => { let d = Number(c); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }); return sum % 10 === 0; };
  const npis = segmentsOf('x12', text('x12')).map((s) => s.split('*')).filter((s) => s[0] === 'NM1' && s[8] === 'XX').map((s) => s[9]);
  assert.ok(npis.length >= 1);
  for (const n of npis) assert.equal(luhn(n), false, n + ' passes the check digit of provider numbers');
});

test('fhir sample: valid JSON, a bundle of a Patient and an Observation, and still consistent after de-identification', () => {
  const t = text('fhir');
  const original = JSON.parse(t);
  assert.equal(original.resourceType, 'Bundle');
  assert.equal(original.entry.length, 2);
  assert.ok(t.endsWith('}\n'));
  for (const out of [pseudonym('fhir').result.text, masked('fhir').result.text]) {
    const doc = JSON.parse(out);
    assert.equal(doc.resourceType, 'Bundle');
    assert.equal(doc.type, 'collection');
    assert.deepEqual(doc.entry.map((e) => e.resource.resourceType), ['Patient', 'Observation']);
    assert.equal(doc.entry[1].resource.valueQuantity.value, 148, 'the measurement is untouched');
    assert.equal(doc.entry[1].resource.code.coding[0].code, '8480-6');
    assert.equal(doc.entry[0].resource.gender, 'male');
    assert.ok(out.endsWith('}\n'));
    assert.match(out, /^\{\n  "resourceType"/, 'indentation kept');
  }
  const doc = JSON.parse(pseudonym('fhir').result.text);
  const [patient, observation] = doc.entry.map((e) => e.resource);
  assert.equal(doc.entry[0].fullUrl, 'urn:uuid:' + patient.id, 'the address and the id still agree');
  assert.equal(doc.entry[1].fullUrl, 'urn:uuid:' + observation.id);
  assert.equal(observation.subject.reference, doc.entry[0].fullUrl, 'the reference still points to the patient');
  assert.match(patient.id, /^[A-Za-z0-9.-]{1,64}$/, 'a valid resource id');
  assert.match(patient.birthDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(observation.effectiveDateTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(patient.telecom.some((c) => c.system === 'email' && /^[^@\s]+@[^@\s]+$/.test(c.value)));
  assert.equal(observation.subject.display.includes(patient.name[0].family), true, 'the display text follows the replaced name');
});
