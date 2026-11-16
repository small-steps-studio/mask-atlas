'use strict';
// Regression tests for the defects of the independent audit (numbered as in the audit). Each case
// is the audit's reproduction; it failed before the fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/core/keyed');
const free = require('../src/core/free');
const engine = require('../src/core/engine');
const { createRun } = require('../src/core/run');

function run(text, options) {
  const r = engine.processText(text, createRun({ mode: 'pseudonym', key: K.keyFromSeed('audit fixes seed phrase'), options: options }), {});
  assert.equal(r.ok, true, r.message);
  return r.text;
}
function maskRun(text) {
  const r = engine.processText(text, createRun({ mode: 'mask' }), {});
  assert.equal(r.ok, true, r.message);
  return r.text;
}

// ---- 5: seen values that start with a mark must not make the time grow with their number ------------------

test('5: 2,000 names that start with an apostrophe and an 800 KB note take well under a second, like ordinary names', () => {
  const seen = free.createSeen();
  for (let i = 0; i < 2000; i++) seen.add('family', "'Zorbel" + String.fromCharCode(97 + (i % 26)) + i.toString(36));
  const words = [];
  for (let i = 0; i < 140000; i++) words.push(i % 50 === 0 ? "'Zorbel" + String.fromCharCode(97 + (i % 26)) + (i % 2000).toString(36) : 'word' + (i % 97));
  const note = words.join(' ');
  assert.ok(note.length > 700000);
  const started = Date.now();
  const found = seen.find(note, false);
  const ms = Date.now() - started;
  assert.ok(ms < 12000, 'the search took ' + ms + ' ms');
  assert.ok(found.length > 100, 'matches were found: ' + found.length);
});

// ---- 8: no two different originals share a replacement, whatever their kind ------------------------------

test('8: 80,000 different family names, given names, towns and organisations give 80,000 different replacements', () => {
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('injective across kinds seed') });
  const out = new Map();
  const letters = (i) => { let s = ''; let v = i; for (let k = 0; k < 6; k++) { s += String.fromCharCode(97 + (v % 26)); v = Math.floor(v / 26) + k; } return s; };
  let n = 0;
  for (let i = 0; i < 20000; i++) {
    for (const [kind, prefix] of [['family', 'fam'], ['given', 'giv'], ['city', 'cty'], ['org', 'org']]) {
      const original = prefix + letters(i);
      const replacement = r.value(kind, original);
      const low = replacement.toLowerCase();
      const have = out.get(low);
      assert.ok(have === undefined, 'the replacement ' + JSON.stringify(replacement) + ' of ' + kind + ' number ' + i + ' was already the replacement of ' + have);
      out.set(low, kind + ' ' + i);
      n++;
    }
  }
  assert.equal(out.size, n);
  assert.equal(n, 80000);
  // the same original of the same kind still gives the same replacement
  assert.equal(r.value('family', 'famabcdef'), r.value('family', 'famabcdef'));
});

// ---- 3: standard extensions that carry a person's, place's or organisation's name ----------------------------

const MAIDEN = 'http://hl7.org/fhir/StructureDefinition/patient-mothersMaidenName';
const patient = (extra) => JSON.stringify(Object.assign({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Brightmoor', given: ['Celestine'] }] }, extra));

test('3: the mother\'s maiden name (patient-mothersMaidenName) is replaced by a Pro run and masked by the free tier', () => {
  const input = patient({ extension: [{ url: MAIDEN, valueString: 'Pemberthwaite' }] });
  const pro = JSON.parse(run(input));
  assert.equal(pro.extension[0].url, MAIDEN, 'the url of a standard extension stays');
  assert.notEqual(pro.extension[0].valueString, 'Pemberthwaite');
  assert.ok(pro.extension[0].valueString.length > 3, 'an invented name');
  const free = JSON.parse(maskRun(input));
  assert.equal(free.extension[0].valueString, 'XXXXXXXXXXXXX');
  assert.equal(free.extension[0].url, MAIDEN);
});

test('3: the name parts of a HumanName extension, the address-part extensions and the congregation are replaced', () => {
  const input = patient({
    name: [{ family: 'Brightmoor', _family: { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/humanname-mothers-family', valueString: 'Quillfeather' }, { url: 'http://hl7.org/fhir/StructureDefinition/humanname-own-name', valueString: 'Oakhaven' }] } }],
    address: [{ line: ['41 Wren Hollow Road'], _line: [{ extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-houseNumber', valueString: '41' }, { url: 'http://hl7.org/fhir/StructureDefinition/iso21090-ADXP-streetName', valueString: 'Wren Hollow Road' }] }] }],
    extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/patient-congregation', valueString: 'Saint Margarets North Parish' }]
  });
  const out = run(input);
  for (const original of ['Quillfeather', 'Oakhaven', 'Wren Hollow', 'Saint Margarets']) assert.equal(out.indexOf(original), -1, original);
  const free = maskRun(input);
  for (const original of ['Quillfeather', 'Oakhaven', 'Wren Hollow', 'Saint Margarets']) assert.equal(free.indexOf(original), -1, 'free: ' + original);
  assert.equal(JSON.parse(out).name[0]._family.extension.length, 2);
});

test('3: the case is on the coverage list: a plain valueString of a local extension is only scanned for values seen elsewhere', () => {
  const out = JSON.parse(run(patient({ extension: [{ url: 'http://example.org/ext/note', valueString: 'Spoke with Tomasz Brightwater' }] })));
  assert.ok(out.extension[0].valueString.indexOf('Tomasz Brightwater') !== -1, 'a name seen nowhere else stays in an unknown extension');
});

// ---- 10: Communication.payload.contentString is free text -------------------------------------------------------

test('10: Communication.payload.contentString is read as free text: the seen name and the phone number go', () => {
  const comm = JSON.stringify({ resourceType: 'Communication', id: 'c1', status: 'completed', subject: { reference: 'Patient/p1' }, payload: [{ contentString: 'Dear Celestine Brightmoor, call 541-555-0192' }] });
  const bundle = JSON.stringify({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: JSON.parse(patient({ telecom: [{ system: 'phone', value: '541-555-0192' }] })) }, { resource: JSON.parse(comm) }] });
  const out = run(bundle);
  for (const original of ['Celestine', 'Brightmoor', '541-555-0192']) assert.equal(out.indexOf(original), -1, original);
});

// ---- 12: the host of a local extension url names the sender like an identifier system ---------------------------

test('12: a local extension url keeps its path and loses the organisation\'s host; the same host gets the same replacement as an identifier system', () => {
  const input = patient({
    identifier: [{ system: 'https://stmargarets-north.org/ids/mrn', value: 'MRN-0099' }],
    extension: [{ url: 'https://stmargarets-north.org/ext/emergency', valueString: 'urgent' }]
  });
  const out = JSON.parse(run(input));
  assert.ok(out.extension[0].url.endsWith('/ext/emergency'));
  assert.equal(out.extension[0].url.indexOf('stmargarets'), -1);
  assert.equal(out.identifier[0].system.split('/')[2], out.extension[0].url.split('/')[2]);
  assert.equal(JSON.parse(run(patient({ extension: [{ url: MAIDEN, valueString: 'Zz' }] }))).extension[0].url, MAIDEN);
});

// ---- 9: single letters outside ASCII in names ---------------------------------------------------------------

const hl7 = (name) => ['MSH|^~' + String.fromCharCode(92) + '&|REGAPP|HALDRINN|LABAPP|LAB|20261105083012||ADT^A01|MSG00001|P|2.5', 'PID|1||MR-4471920^^^HGH^MR||' + name + '||19731104|M', ''].join('\r');
const pidName = (text) => text.split('\r')[1].split('|')[5];

test('9: a one-character family name and an initial with a full stop outside ASCII are replaced', () => {
  const out = run(hl7('王^小明'));
  const name = pidName(out);
  for (const ch of ['王', '小', '明']) assert.equal(name.indexOf(ch), -1, 'the character ' + ch.charCodeAt(0).toString(16) + ' is gone from ' + name);
  assert.match(name, /^[A-Z][a-z]+\^[A-Z][a-z]+$/);
  const dotted = pidName(run(hl7('Kowalski^Jan^Ł.')));
  assert.equal(dotted.indexOf('Ł'), -1);
  assert.match(dotted.split('^')[2], /^[A-Z]\.$/);
  assert.equal(pidName(maskRun(hl7('王^小明'))), 'X^XX');
  // the same one-character name gets the same replacement within a run
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('one character names') });
  assert.equal(r.value('family', '王'), r.value('family', '王'));
});

// ---- 13: a URL in an X12 element whose interchange uses ':' as the component separator -------------------------

test('13: the replacement written for a URL that held the component separator is the one recorded, so the check finds nothing', () => {
  const V = require('../src/core/verify');
  const control = '000000001';
  const isa = 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *261105*0830*^*00501*' + control + '*0*P*:~';
  const text = isa + 'GS*HC*S*R*20261105*0830*1*X*005010X222A1~ST*837*0001*005010X222A1~NM1*IL*1*DRAVENKORT*SELMIRA****MI*MBR55820119~PER*IC*BILLING*UR*https://portal.dravenkort-care.example/p/1234~SE*4*0001~GE*1*1~IEA*1*' + control + '~';
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('x12 url seed phrase') });
  const out = engine.processText(text, r, {});
  assert.equal(out.ok, true);
  const per = out.text.split('~').find((s) => s.indexOf('PER*') === 0);
  assert.ok(per.indexOf('dravenkort') === -1, per);
  assert.equal(out.text.split('~')[0].length, 105, 'ISA keeps its width');
  const check = V.createVerifier(r).check(out.text, 'x12');
  assert.equal(check.fields, 0, 'no field of the output holds a value that the run did not write');
});

// ---- 11: UTF-16 files ---------------------------------------------------------------------------------------------

test('11: UTF-16 files with a byte order mark are de-identified and written in the same encoding; without a mark the message says so', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const files = require('../src/core/files');
  const V = require('../src/core/verify');
  const samples = require('../src/samples');
  const text = samples.sampleFor('hl7').text.replace(/\r/g, '\r\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-u16-'));
  try {
    const le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]);
    const be = Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(text, 'utf16le').swap16()]);
    fs.writeFileSync(path.join(dir, 'le.hl7'), le);
    fs.writeFileSync(path.join(dir, 'be.hl7'), be);
    fs.writeFileSync(path.join(dir, 'nomark.hl7'), Buffer.from(text, 'utf16le'));
    const run = createRun({ mode: 'pseudonym', key: K.keyFromSeed('utf sixteen seed phrase') });
    const result = await files.runFolder(dir, path.join(dir, 'out'), run, {});
    const by = Object.fromEntries(result.files.map((f) => [f.file, f]));
    assert.equal(by['le.hl7'].status, 'written');
    assert.equal(by['be.hl7'].status, 'written');
    assert.equal(by['nomark.hl7'].status, 'skipped');
    assert.match(by['nomark.hl7'].message, /UTF-16 text without a byte order mark.*Save it as UTF-8/);
    const outLe = fs.readFileSync(path.join(dir, 'out', 'le.hl7'));
    const outBe = fs.readFileSync(path.join(dir, 'out', 'be.hl7'));
    assert.deepEqual(Array.from(outLe.subarray(0, 2)), [0xFF, 0xFE]);
    assert.deepEqual(Array.from(outBe.subarray(0, 2)), [0xFE, 0xFF]);
    const readLe = new TextDecoder('utf-16le').decode(outLe), readBe = new TextDecoder('utf-16be').decode(outBe);
    for (const t of [readLe, readBe]) { for (const original of ['Larkspur', 'Evander', 'HC-7305518', '926-41-7390']) assert.equal(t.indexOf(original), -1, original); assert.ok(t.indexOf('MSH|') !== -1); }
    assert.equal(readLe, readBe, 'both byte orders give the same text for one run');
    const total = await files.verifyOutputs(path.join(dir, 'out'), result.files, V.createVerifier(run), {});
    assert.equal(total.files, 2);
    assert.equal(total.pass, true, 'the verification reads UTF-16 outputs: ' + JSON.stringify([total.originalValues, total.patterns, total.fields]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 6: a verification finding says where it is, never what it is ------------------------------------------------

test('6: a left-over name in a note is reported with the message, the element and the kind, and the report holds no value', () => {
  const V = require('../src/core/verify');
  const samples = require('../src/samples');
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('where seed phrase') });
  const first = engine.processText(samples.sampleFor('hl7').text, r, {});
  const second = engine.processText(samples.sampleFor('hl7').text, r, {});
  assert.equal(first.ok && second.ok, true);
  const bad = first.text + 'MSH|^~' + String.fromCharCode(92) + '&|A\rNTE|1||Visitor Larkspur signed in, call 614-555-0187\r';
  const check = V.createVerifier(r).check(bad, 'hl7');
  assert.equal(check.pass, false);
  const found = check.locations.filter((l) => l.check === 'value');
  assert.ok(found.some((l) => l.path === 'NTE-3' && l.unit === 2 && l.kind === 'names'), JSON.stringify(found));
  assert.ok(check.locations.some((l) => l.check === 'pattern' && l.path === 'NTE-3' && l.kind === 'phone'));
  const text = JSON.stringify(check);
  for (const value of ['Larkspur', 'larkspur', '614-555-0187']) assert.equal(text.indexOf(value), -1, 'the result must not carry ' + value);
});

test('6: FHIR findings carry the resource, the key and the line; a folder run attaches the file', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const V = require('../src/core/verify');
  const files = require('../src/core/files');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-where-'));
  try {
    fs.mkdirSync(path.join(dir, 'in'));
    fs.writeFileSync(path.join(dir, 'in', 'p.json'), JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Brightmoor', given: ['Celestine'] }] }, null, 2));
    const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('where seed phrase two') });
    const res = await files.runFolder(path.join(dir, 'in'), path.join(dir, 'out'), r, {});
    assert.equal(res.files[0].status, 'written');
    // put the real name back into the copy
    const copy = path.join(dir, 'out', 'p.json');
    fs.writeFileSync(copy, fs.readFileSync(copy, 'utf8').replace(/"family": "[^"]+"/, '"family": "Brightmoor"'));
    const total = await files.verifyOutputs(path.join(dir, 'out'), res.files, V.createVerifier(r), {});
    assert.equal(total.pass, false);
    const rows = total.locations.filter((l) => l.file === 'p.json');
    assert.ok(rows.some((l) => /Patient\.name\.family|Patient\.family/.test(l.path) || l.path === 'Patient.name.family'), JSON.stringify(rows));
    assert.ok(rows.every((l) => typeof l.count === 'number'));
    assert.equal(JSON.stringify(total.locations).indexOf('Brightmoor'), -1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('6: the control numbers of an X12 interchange (kept on purpose) are no finding, even when they equal the digits of a replaced SSN', () => {
  const V = require('../src/core/verify');
  const isa = (control) => 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *261105*0830*^*00501*' + control + '*0*P*:~';
  const claim = (control, ssn) => isa(control) + 'GS*HC*S*R*20261105*0830*1*X*005010X222A1~ST*837*0001*005010X222A1~NM1*IL*1*DRAVENKORT*SELMIRA****MI*MBR' + control.slice(1) + '~REF*SY*' + ssn + '~SE*4*0001~GE*1*1~IEA*1*' + control + '~';
  const text = claim('003321461', '111-22-3333') + claim('000000002', '003-32-1461');
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('control number seed') });
  const out = engine.processText(text, r, {});
  assert.equal(out.ok, true);
  assert.ok(out.text.indexOf('*003321461*') !== -1 || out.text.indexOf('003321461~') !== -1, 'the control number is kept');
  const check = V.createVerifier(r).check(out.text, 'x12');
  assert.equal(check.pass, true, JSON.stringify([check.originalValues, check.patterns, check.fields, check.locations]));
  assert.ok(check.keptByDesign >= 2, 'the two places are counted as kept on purpose: ' + check.keptByDesign);
});

// ---- 16 (found while re-measuring the 50 MB X12 file): a postal code that equals the X12 version number -----------------

test('16: a replaced postal code "00501" (also the version number in ISA12) is no finding in the envelopes, however many interchanges there are', () => {
  const V = require('../src/core/verify');
  const gen = require('./helpers/large-gen');
  let text = '';
  for (let i = 0; i < 400; i++) text += gen.x12(i).replace(/\*TX\*\d{5}~/, '*TX*00501~');
  assert.equal((text.match(/\*TX\*00501~/g) || []).length, 400);
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('postal code equals version') });
  const out = engine.processText(text, r, {});
  assert.equal(out.ok, true);
  assert.equal((out.text.match(/\*00501\*/g) || []).length, 400, 'the version number of the standard stays in every ISA');
  assert.equal(out.text.indexOf('*TX*00501~'), -1, 'the postal code itself is replaced');
  const check = V.createVerifier(r).check(out.text, 'x12');
  assert.equal(check.originalValues, 0, JSON.stringify(check.locations.slice(0, 3)));
  assert.equal(check.pass, true);
  assert.ok(check.keptByDesign >= 400, 'the 400 places are counted as kept on purpose: ' + check.keptByDesign);
});

test('16: the places that are kept on purpose stay no finding after the 200 places that are worked out one by one', () => {
  const V = require('../src/core/verify');
  const gen = require('./helpers/large-gen');
  let text = '';
  for (let i = 0; i < 300; i++) text += gen.x12(i).replace(/\*TX\*\d{5}~/, '*TX*00501~');
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('postal code equals version two') });
  const out = engine.processText(text, r, {});
  assert.equal(out.ok, true);
  // 250 real left-overs (original family names put back into notes) come first, then the interchanges whose ISA12 equals a replaced original
  const names = [];
  for (let i = 0; i < 250; i++) names.push('NTE*ADD*VISITOR ' + gen.letters(i, 9).toUpperCase() + ' CAME~');
  const first = out.text.indexOf('ISA*');
  const second = out.text.indexOf('ISA*', first + 4);
  const mixed = out.text.slice(0, second) + names.join('') + out.text.slice(second);
  const check = V.createVerifier(r).check(mixed, 'x12');
  assert.equal(check.originalValues, 250, 'exactly the 250 left-over names are findings, not the envelopes: ' + check.originalValues);
});

// ---- 7: the blind spot is stated truthfully ---------------------------------------------------------------------

test('7: a word that equals a replacement is never counted as a left-over; the limits say so, and a non-coinciding name is found', () => {
  const V = require('../src/core/verify');
  const header = 'MSH|^~' + String.fromCharCode(92) + '&|REGAPP|HALDRINN|LABAPP|LAB|20261105083012||ADT^A01|MSG00001|P|2.5\r';
  const msg = (family) => header + 'PID|1||MR-' + family.length + '^^^HGH^MR||' + family + '^Quill||19731104|M\r';
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('blind spot seed phrase') });
  const one = engine.processText(msg('Alderbrooke'), r, {});
  const replacement = one.text.split('\r')[1].split('|')[5].split('^')[0];
  // the real family name of another patient is exactly that replacement, and it stays in an unknown segment of a third message
  const two = engine.processText(msg(replacement), r, {});
  assert.equal(two.ok, true);
  const three = engine.processText(header + 'ZNT|1|Visitor ' + replacement + ' signed in\r', r, {});
  const control = engine.processText(header + 'ZNT|1|Visitor Alderbrooke signed in\r', r, {});
  assert.equal(three.ok && control.ok, true);
  const v = V.createVerifier(r);
  assert.ok(three.text.indexOf('Visitor ' + replacement + ' signed in') !== -1, 'the real name of the second patient stays in the unknown segment');
  assert.equal(v.check(two.text + three.text, 'hl7').pass, true, 'documented blind spot: the word is a replacement of this run');
  assert.equal(v.check(two.text + control.text, 'hl7').pass, false, 'an original that is no replacement is found');
  assert.ok(V.LIMITS.some((l) => /never counted as a left-over/.test(l)));
});
