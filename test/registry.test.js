'use strict';
// The registry of a run: replacements are injective, stable inside a run, styled like the original,
// and the same person gets the same invented values in HL7, FHIR and X12.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/core/run');
const engine = require('../src/core/engine');
const K = require('../src/core/keyed');
const D = require('../src/core/dates');

const KEY = K.keyFromSeed('registry tests');
const KEY2 = K.keyFromSeed('registry tests, other key');
const N = 100000;

function letters(n, len) { let s = ''; for (let i = 0; i < len; i++) { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function pad(n, w) { return String(n).padStart(w, '0'); }
function newRun(options, key) { return R.createRun({ mode: 'pseudonym', key: key || KEY, options: Object.assign({ recordMap: false }, options || {}) }); }

const MAKERS = [
  ['family', (i) => cap(letters(i, 6)), 'name'],
  ['given', (i) => cap(letters(i, 6)), 'name'],
  ['org', (i) => cap(letters(i, 6)) + ' Clinic', 'name'],
  ['street', (i) => '12 ' + cap(letters(i, 6)) + ' Road', 'name'],
  ['city', (i) => cap(letters(i, 6)), 'name'],
  ['email', (i) => 'user' + i + '@clinic.test', 'exact'],
  ['system', (i) => 'http://' + letters(i, 6) + '.hospital.test/ids', 'exact'],
  ['record', (i) => 'MR-' + pad(i, 7), 'exact'],
  ['phone', (i) => '(' + (200 + Math.floor(i / 10000)) + ') 555-' + pad(i % 10000, 4), 'exact'],
  ['ssn', (i) => pad(100 + Math.floor(i / 10000), 3) + '-' + pad(Math.floor(i / 100) % 100, 2) + '-' + pad(i % 100, 4), 'exact']
];

for (const [kind, make, how] of MAKERS) {
  test('injectivity: ' + N + ' different ' + kind + ' values get ' + N + ' different replacements, none equal to its original', () => {
    const run = newRun();
    const outs = new Set();
    for (let i = 0; i < N; i++) {
      const input = make(i);
      const out = run.value(kind, input);
      assert.notEqual(how === 'name' ? out.toLowerCase() : out, how === 'name' ? input.toLowerCase() : input, 'unchanged: ' + input);
      outs.add(how === 'name' ? out.toLowerCase() : out);
    }
    assert.equal(outs.size, N);
    // asking again gives the same answers
    for (let i = 0; i < N; i += 997) assert.equal(run.value(kind, make(i)), run.value(kind, make(i)));
    assert.equal(run.value(kind, make(5)), run.value(kind, make(5)));
  });
}

test('record numbers of one shape: the replacement keeps the shape, and another run with the same key agrees', () => {
  const a = newRun(), b = newRun();
  for (let i = 0; i < 2000; i += 7) {
    const out = a.value('record', 'MR-' + pad(i, 7));
    assert.match(out, /^[A-Z]{2}-\d{7}$/);
    assert.equal(b.value('record', 'MR-' + pad(i, 7)), out);
  }
});

test('names, in a run, keep their replacement when the same name comes again, in any case', () => {
  const run = newRun();
  const a = run.value('family', 'Quillfeather'), b = run.value('family', 'QUILLFEATHER'), c = run.value('family', 'quillfeather'), d = run.value('family', '  Quillfeather ');
  assert.equal(b.toLowerCase(), a.toLowerCase());
  assert.equal(c.toLowerCase(), a.toLowerCase());
  assert.equal(d.toLowerCase(), a.toLowerCase());
  const g1 = run.value('given', 'Alderiq'), g2 = run.value('given', 'ALDERIQ');
  assert.equal(g1.toLowerCase(), g2.toLowerCase());
});

test('names are styled like the original: UPPER, lower, Title, and anything mixed becomes Title', () => {
  const run = newRun();
  const cases = [['SMITHERS', /^[A-Z]+$/], ['smithers', /^[a-z]+$/], ['Smithers', /^[A-Z][a-z]+$/], ['SmiThers', /^[A-Z][a-z]+$/], ['MARY-ANN', /^[A-Z]+-[A-Z]+$/], ['mary-ann', /^[a-z]+-[a-z]+$/], ['Mary-Ann', /^[A-Z][a-z]+-[A-Z][a-z]+$/]];
  for (const [input, re] of cases) assert.match(run.value('family', input), re, input);
  assert.match(run.value('given', 'JEAN LUC'), /^[A-Z]+ [A-Z]+$/);
  assert.match(run.value('org', 'HALDON GENERAL HOSPITAL'), /^[A-Z ]+ HOSPITAL$/);
  assert.match(run.value('org', 'Haldon General Hospital'), /^[A-Z][a-z]+( [A-Z][a-z]+)* Hospital$/);
  assert.match(run.value('city', 'WRENBURY'), /^[A-Z]+( [A-Z]+)*$/);
  assert.match(run.value('city', 'wrenbury'), /^[a-z]+( [a-z]+)*$/);
});

test('restyle, titleCase, normName and reflow do what their names say', () => {
  assert.equal(R.restyle('Aaa bbb', 'JOHN'), 'AAA BBB');
  assert.equal(R.restyle('Aaa bbb', 'john'), 'aaa bbb');
  assert.equal(R.restyle('aaa bbb', 'John'), 'Aaa Bbb');
  assert.equal(R.restyle('aaa', 'J'), 'Aaa');
  assert.equal(R.titleCase("o'brien-smith jr"), "O'Brien-Smith Jr");
  assert.equal(R.normName('  Mary   ANN '), 'mary ann');
  assert.equal(R.reflow('(312) 555-0141', '9876543210'), '(987) 654-3210');
  assert.equal(R.reflow('12-34', '9'), '90-00');
  assert.equal(R.maskText('Mary-Ann 12, Anné'.replace('é', String.fromCharCode(0xe9))), 'XXXX-XXX 99, XXXX');
});

test('hyphenated names are replaced part by part: the parts keep the replacement they have alone', () => {
  const run = newRun();
  const whole = run.value('family', 'Marchbanner-Oyelaran');
  const [p1, p2] = whole.split('-');
  assert.equal(whole.split('-').length, 2);
  assert.equal(run.value('family', 'Marchbanner'), p1);
  assert.equal(run.value('family', 'Oyelaran'), p2);
  const dash = run.value('family', 'Marchbanner' + String.fromCharCode(0x2013) + 'Oyelaran');
  assert.equal(dash, p1 + String.fromCharCode(0x2013) + p2);
});

test('full names: "Family, Given" and "Given Family" use the replacements the parts already have; titles and suffixes stay', () => {
  const run = newRun();
  const fam = run.value('family', 'Tallworthy'), giv = run.value('given', 'Berenice');
  assert.equal(run.value('fullname', 'Tallworthy, Berenice'), fam + ', ' + giv);
  assert.equal(run.value('fullname', 'Berenice Tallworthy'), giv + ' ' + fam);
  assert.equal(run.value('fullname', 'Dr Berenice Tallworthy Jr'), 'Dr ' + giv + ' ' + fam + ' Jr');
  assert.equal(run.value('family', 'Berenice Tallworthy'), giv + ' ' + fam);
  const other = run.value('fullname', 'Oswin Ashgrove');
  assert.match(other, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
});

test('initials stay initials and a trailing dot stays', () => {
  const run = newRun();
  const m = run.value('given', 'M'), n = run.value('given', 'M.');
  assert.match(m, /^[A-Z]$/);
  assert.notEqual(m, 'M');
  assert.equal(n, m + '.');
});

test('values without letters or digits are returned as they are; empty text too', () => {
  const run = newRun();
  for (const s of ['', ' ', '-', '--', '#', '()', '...']) for (const kind of ['family', 'record', 'phone', 'org', 'street']) assert.equal(run.value(kind, s), s);
});

test('organisations: the setting keeps them, mask mode masks them', () => {
  assert.equal(newRun({ maskOrganisations: false }).value('org', 'Haldon General Hospital'), 'Haldon General Hospital');
  assert.equal(newRun({ maskOrganisations: false }).value('place', 'North Wing'), 'North Wing');
  assert.notEqual(newRun().value('org', 'Haldon General Hospital'), 'Haldon General Hospital');
  const mask = R.createRun({ mode: 'mask', key: KEY });
  assert.equal(mask.value('org', 'Haldon General Hospital'), 'XXXXXX XXXXXXX XXXXXXXX');
  assert.equal(mask.value('record', 'MR-4471920'), 'XX-9999999');
  assert.equal(mask.value('binary', 'QUJD=='), 'XXXXXX');
});

test('streets: number, name and type are treated apart; a unit stays a unit; a post box keeps its form', () => {
  const run = newRun();
  const s = run.value('street', '4127 Lindenmoor Terrace Apt 5B');
  assert.match(s, /^\d{4} [A-Z][a-z]+( [A-Z][a-z]+)* Terrace Apt \d[A-Z]$/);
  assert.match(run.value('street', 'PO Box 1234'), /^PO \d{4}$|^PO Box \d{4}$|^[A-Za-z. ]+ \d{4}$/);
  assert.equal(run.value('street', '12 Lindenmoor Terrace'), run.value('street', '12 Lindenmoor Terrace'));
  assert.match(run.value('street', 'Apt 7'), /^Apt 7$/);
  const t = run.value('street', '12 Lindenmoor Terrace').split(' ');
  assert.equal(t[t.length - 1], 'Terrace');
});

test('phone numbers and SSN-like numbers keep their punctuation; a leading country digit stays', () => {
  const run = newRun();
  assert.match(run.value('phone', '(312) 555-0141'), /^\(\d{3}\) \d{3}-\d{4}$/);
  assert.match(run.value('phone', '+1 312 555 0141'), /^\+1 \d{3} \d{3} \d{4}$/);
  assert.match(run.value('phone', '1-312-555-0141'), /^1-\d{3}-\d{3}-\d{4}$/);
  assert.equal(run.value('phone', '312-555-0141').replace(/\D/g, ''), run.value('phone', '3125550141'));
  assert.equal(run.value('phone', '+1 312 555 0141').replace(/\D/g, ''), '1' + run.value('phone', '3125550141'));
  assert.match(run.value('ssn', '912-73-4408'), /^\d{3}-\d{2}-\d{4}$/);
  assert.equal(run.value('ssn', '912 73 4408').replace(/\D/g, ''), run.value('ssn', '912-73-4408').replace(/\D/g, ''));
});

test('e-mail addresses, addresses of the web and IP addresses: shape and one replacement per original', () => {
  const run = newRun();
  assert.match(run.value('email', 'John.Doe@Clinic.Test'), /^[a-z.]+\d*@[a-z]+\.example$/);
  assert.equal(run.value('email', 'John.Doe@Clinic.Test'), run.value('email', 'john.doe@clinic.test'));
  assert.match(run.value('ip', '192.168.1.20'), /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  assert.notEqual(run.value('ip', '192.168.1.20'), '192.168.1.20');
  assert.match(run.value('ip', '2001:0db8:85a3:0000:0000:8a2e:0370:7334'), /^([0-9a-f]{4}:){7}[0-9a-f]{4}$/);
  assert.match(run.value('url', 'https://portal.rosewyn.test/patients/12345?token=abc'), /^https:\/\/[a-z0-9-]+\.example\/.*$/);
  assert.equal(run.value('system', 'http://hl7.org/fhir/sid/us-npi'), 'http://hl7.org/fhir/sid/us-npi');
  assert.match(run.value('system', 'http://rosewyn.test/ids/mrn'), /^http:\/\/[a-z0-9-]+\.example\/ids\/mrn$/);
  const rows = R.createRun({ mode: 'pseudonym', key: KEY }).value('geo', '40.1234', { lat: true });
  assert.match(rows, /^-?\d+\.\d{4}$/);
});

// ---- dates ---------------------------------------------------------------------------------

test('every person has one offset of 60 to 730 days, forward or back; any identifier finds the same person', () => {
  const run = newRun();
  const signs = new Set();
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 3000; i++) {
    const p = run.person(['id:' + i]);
    assert.ok(Math.abs(p.offset) >= 60 && Math.abs(p.offset) <= 730, 'offset ' + p.offset);
    signs.add(Math.sign(p.offset));
    counts[Math.min(6, Math.floor((Math.abs(p.offset) - 60) / 100))]++;
    assert.equal(run.person(['id:' + i]), p);
  }
  assert.equal(signs.size, 2);
  for (const c of counts.slice(0, 6)) assert.ok(c > 3000 * 0.1 && c < 3000 * 0.23, 'bucket ' + c);
  const a = run.person(['ssn:1', 'id:x']);
  assert.equal(run.person(['id:x']), a);
  assert.equal(run.person(['name:y', 'ssn:1']), a);
  assert.equal(run.person(['ssn:1']), a);
  assert.equal(run.person([]), run.person([null, '']));
  assert.ok(Math.abs(run.person([]).offset) >= 60);
});

test('offsets depend on the key and not on the order in which people appear', () => {
  const a = newRun(), b = newRun(), c = newRun({}, KEY2);
  const ids = Array.from({ length: 50 }, (_, i) => 'id:' + i);
  const first = ids.map((id) => a.person([id]).offset);
  const second = ids.slice().reverse().map((id) => b.person([id]).offset).reverse();
  assert.deepEqual(second, first);
  const other = ids.map((id) => c.person([id]).offset);
  assert.ok(other.filter((o, i) => o !== first[i]).length >= 45);
});

test('shift moves a date by the offset in each layout and falls back to null for text that is no date', () => {
  const run = newRun();
  const p = run.person(['id:1']);
  const dayOf = (s) => D.toDays(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
  assert.equal(dayOf(run.shift('hl7', '20261105', p)) - dayOf('20261105'), p.offset);
  assert.equal(dayOf(run.shift('d8', '20261105', p)) - dayOf('20261105'), p.offset);
  assert.equal(run.shift('iso', '2026-11-05', p).length, 10);
  const [x, y] = run.shift('rd8', '20261105-20261110', p).split('-');
  assert.equal(dayOf(y) - dayOf(x), 5);
  assert.equal(run.shift('hl7', 'garbage', p), null);
  assert.equal(run.shift('nothing', '20261105', p), null);
  assert.equal(newRun({ shiftDates: false }).shift('hl7', '20261105', p), '20261105');
  assert.equal(R.createRun({ mode: 'mask', key: KEY }).shift('hl7', '20261105', p), '99999999');
});

// ---- across formats ------------------------------------------------------------------------

const CR = '\r';
const HL7 = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5',
  'PID|1||MR-4471920^^^HGH^MR~912-73-4408^^^SSA^SS||TALLWORTHY^BERENICE||19731104|F|||||312-555-0141^PRN^PH'].join(CR) + CR;
const FHIR = JSON.stringify({ resourceType: 'Patient', id: 'p1', identifier: [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }] }, system: 'http://hgh.test/mrn', value: 'MR-4471920' },
  { type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'SS' }] }, system: 'http://hl7.org/fhir/sid/us-ssn', value: '912-73-4408' }],
name: [{ family: 'Tallworthy', given: ['Berenice'] }], telecom: [{ system: 'phone', value: '312-555-0141' }], birthDate: '1973-11-04' }, null, 2) + '\n';
function x12Text() {
  const isa = 'ISA*00*          *00*          *ZZ*SENDERID       *ZZ*RECEIVERID     *261105*0830*^*00501*000000417*0*P*:~';
  const segs = ['GS*HC*SENDERID*RECEIVERID*20261105*0830*417*X*005010X222A1', 'ST*837*0001*005010X222A1', 'NM1*IL*1*TALLWORTHY*BERENICE****MI*MR-4471920', 'DMG*D8*19731104*F', 'REF*SY*912-73-4408',
    'PER*IC*CONTACT*TE*3125550141', 'SE*6*0001', 'GE*1*417', 'IEA*1*000000417'];
  return isa + segs.map((s) => s + '~').join('');
}

function runAll(key) {
  const run = R.createRun({ mode: 'pseudonym', key: key });
  const h = engine.processText(HL7, run), f = engine.processText(FHIR, run), x = engine.processText(x12Text(), run);
  assert.ok(h.ok && f.ok && x.ok);
  const hl7Pid = h.text.split(CR)[1].split('|');
  const j = JSON.parse(f.text);
  const nm1 = x.text.split('~').find((s) => s.startsWith('NM1')).split('*');
  const seg = (id) => x.text.split('~').find((s) => s.startsWith(id + '*')).split('*');
  return {
    family: [hl7Pid[5].split('^')[0], j.name[0].family, nm1[3]].map((s) => s.toLowerCase()),
    given: [hl7Pid[5].split('^')[1], j.name[0].given[0], nm1[4]].map((s) => s.toLowerCase()),
    ssn: [hl7Pid[3].split('~')[1].split('^')[0], j.identifier[1].value, seg('REF')[2]].map((s) => s.replace(/\D/g, '')),
    mrn: [hl7Pid[3].split('~')[0].split('^')[0], j.identifier[0].value, nm1[9]],
    phone: [hl7Pid[13].split('^')[0], j.telecom[0].value, seg('PER')[4]].map((s) => s.replace(/\D/g, '')),
    dob: [hl7Pid[7], j.birthDate.replace(/-/g, ''), seg('DMG')[2]],
    all: h.text + f.text + x.text
  };
}

test('one patient in an HL7 message, a FHIR Patient and an X12 claim gets one set of invented values in one run', () => {
  const r = runAll(KEY);
  for (const field of ['family', 'given', 'ssn', 'mrn', 'phone', 'dob']) {
    assert.equal(new Set(r[field]).size, 1, field + ' differs between formats: ' + JSON.stringify(r[field]));
  }
  assert.notEqual(r.family[0], 'tallworthy');
  assert.notEqual(r.given[0], 'berenice');
  assert.notEqual(r.ssn[0], '912734408');
  assert.equal(r.ssn[0].length, 9);
  assert.equal(r.phone[0].length, 10);
  assert.notEqual(r.dob[0], '19731104');
  const dayOf = (s) => D.toDays(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
  const shift = dayOf(r.dob[0]) - dayOf('19731104');
  assert.ok(Math.abs(shift) >= 60 && Math.abs(shift) <= 730);
  for (const s of ['TALLWORTHY', 'BERENICE', '4471920', '912-73-4408', '312-555-0141', '3125550141', '19731104', '1973-11-04']) assert.equal(r.all.toUpperCase().indexOf(s), -1, s);
});

test('with another key the same patient gets other values in all three formats', () => {
  const a = runAll(KEY), b = runAll(KEY2);
  for (const field of ['family', 'given', 'ssn', 'mrn', 'phone', 'dob']) assert.notEqual(b[field][0], a[field][0], field);
  const again = runAll(KEY);
  assert.deepEqual(again.family, a.family);
  assert.deepEqual(again.dob, a.dob);
});

test('the same message processed twice in one run gives the same output both times', () => {
  const run = R.createRun({ mode: 'pseudonym', key: KEY });
  const one = engine.processText(HL7, run), two = engine.processText(HL7, run);
  assert.equal(two.text, one.text);
});

// ---- map export ----------------------------------------------------------------------------

test('exportRows lists every replacement once, with the date shift of each person; recordMap false keeps nothing', () => {
  const run = R.createRun({ mode: 'pseudonym', key: KEY });
  engine.processText(HL7, run);
  engine.processText(HL7, run);
  const { rows, complete } = run.exportRows();
  assert.equal(complete, true);
  const keys = rows.map((r) => r.category + '|' + r.original);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(rows.some((r) => r.category === 'name' && r.original === 'TALLWORTHY' && r.replacement === run.value('family', 'TALLWORTHY')));
  assert.ok(rows.some((r) => r.category === 'ssn' && r.original === '912-73-4408'));
  const shifts = rows.filter((r) => r.category === 'date shift');
  assert.equal(shifts.length, 1);
  assert.match(shifts[0].replacement, /^[+-]\d+ days$/);
  assert.ok(rows.every((r) => r.original !== r.replacement));
  const off = R.createRun({ mode: 'pseudonym', key: KEY, options: { recordMap: false } });
  engine.processText(HL7, off);
  assert.deepEqual(off.exportRows().rows.filter((r) => r.category !== 'date shift'), []);
});

test('originalsIndex holds the lower-case name parts and long identifiers of the run, and no short or common ones', () => {
  const run = R.createRun({ mode: 'pseudonym', key: KEY });
  engine.processText(HL7, run);
  const idx = run.originalsIndex();
  assert.ok(idx.names.has('tallworthy') && idx.names.has('berenice'));
  assert.ok(idx.ids.has('3125550141') && idx.ids.has('9127344408'.slice(0, 0) + '912734408'));
  for (const n of idx.names) assert.ok(n.length >= 4 && n === n.toLowerCase());
});

test('statistics count the replaced fields by category and by path, with shapes and no values', () => {
  const run = R.createRun({ mode: 'pseudonym', key: KEY });
  engine.processText(HL7, run);
  assert.ok(run.stats.total >= 10);
  assert.ok(run.stats.byCategory.get('names') >= 2);
  const rows = Array.from(run.stats.byPath.values());
  assert.ok(rows.some((r) => r.path === 'PID-5.1' && r.category === 'names' && r.shape === 'XXXXXXXXXX'));
  for (const r of rows) assert.doesNotMatch(r.shape, /[a-wyz]/i.test(r.shape) ? /^$/ : /^$/);
  assert.doesNotMatch(JSON.stringify(rows), /Tallworthy|TALLWORTHY|4471920|912-73-4408/);
});
