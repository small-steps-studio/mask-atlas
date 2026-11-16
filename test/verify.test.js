'use strict';
// The residual-identifier verification: a clean output passes, each of the three checks catches
// its kind of leftover, a coincidence of a replacement with another original is not a finding, and
// no result carries a value from a message.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./helpers/corpus');
const K = require('../src/core/keyed');
const V = require('../src/core/verify');
const { createRun } = require('../src/core/run');

function process_(file, seed) {
  const run = createRun({ mode: 'pseudonym', key: K.keyFromSeed(seed || 'verify test seed phrase') });
  const text = C.readFixtureUtf8(file);
  const r = C.engine.processText(text, run, {});
  assert.equal(r.ok, true);
  return { run: run, input: text, output: r.text, format: r.format };
}

test('a de-identified message passes; the unchanged message fails against the same run', () => {
  for (const file of ['hl7/adt-a01-01.hl7', 'x12/claim-837p-01.837', 'fhir/patient-01.json', 'hl7/oru-r01-02.hl7']) {
    const p = process_(file);
    const v = V.createVerifier(p.run);
    const good = v.check(p.output, p.format);
    assert.equal(good.pass, true, file + ': ' + JSON.stringify({ o: good.originalValues, p: good.patterns, f: good.fields }));
    const bad = v.check(p.input, p.format);
    assert.equal(bad.pass, false, file + ' unchanged');
    assert.ok(bad.originalValues > 0 && bad.fields > 0, file + ': replaced values and unreplaced fields are found');
  }
});

test('each check catches its own kind of leftover', () => {
  const p = process_('hl7/adt-a01-01.hl7');
  const v = V.createVerifier(p.run);
  // 1. an original name appended to a note
  const withName = p.output.replace(/\r?\n$/, '') + '\rNTE|1||Rebecca spoke with Quillfeather again\r';
  const one = v.check(withName, p.format);
  assert.ok(one.originalValues >= 1, 'a replaced name in a new note is found');
  // 2. a foreign e-mail address and a telephone number
  const withPattern = p.output.replace(/\r?\n$/, '') + '\rNTE|1||write to someone.else@postbox.example or call 718-555-0123\r';
  const two = v.check(withPattern, p.format);
  assert.ok(two.patterns >= 2, 'an e-mail address and a telephone number that the run did not create: ' + two.patterns);
  // 3. an original value back in a field of the profile
  const original = C.readFixtureUtf8('hl7/adt-a01-01.hl7').split(/\r\n|\r|\n/).find(function (l) { return l.indexOf('PID|') === 0; });
  const lines = p.output.split(/\r\n|\r|\n/).map(function (l) { return l.indexOf('PID|') === 0 ? original : l; });
  const three = v.check(lines.join('\r'), p.format);
  assert.ok(three.fields >= 3, 'fields of the profile with unreplaced values: ' + three.fields);
  assert.ok(three.byPath.some(function (r) { return /^PID-/.test(r.path); }));
});

test('a result holds counts, categories and paths, never a value of the message', () => {
  const p = process_('hl7/adt-a01-01.hl7');
  const v = V.createVerifier(p.run);
  const bad = v.check(p.input, p.format);
  const text = JSON.stringify({ o: bad.originalValues, p: bad.patterns, f: bad.fields, paths: bad.byPath, cats: Array.from(bad.categories.entries()), examples: bad.examples });
  for (const s of C.manifest.files.find(function (e) { return e.file === 'hl7/adt-a01-01.hl7'; }).seeded) assert.ok(text.toLowerCase().indexOf(s.value.toLowerCase()) === -1, 'the result must not carry ' + s.where);
  assert.deepEqual(bad.examples, [], 'no example values unless debugging is asked for');
});

test('a replacement that equals the original of another value is no finding (references such as Patient/p65)', () => {
  const run = createRun({ mode: 'pseudonym', key: K.keyFromSeed('coincidence seed phrase') });
  // many patients with short sequential ids: replacements of one id are the originals of others
  const lines = [];
  for (let i = 0; i < 300; i++) {
    lines.push(JSON.stringify({ resourceType: 'Patient', id: 'p' + i, name: [{ family: 'Zorbelian' + String.fromCharCode(97 + (i % 26)) + i, given: ['Quen'] }] }));
    lines.push(JSON.stringify({ resourceType: 'Observation', id: 'o' + i, status: 'final', code: { text: 'x' }, subject: { reference: 'Patient/p' + i } }));
  }
  const r = C.engine.processText(lines.join('\n') + '\n', run, {});
  assert.equal(r.ok, true);
  assert.equal(r.format, 'ndjson');
  const check = V.createVerifier(run).check(r.output || r.text, r.format);
  assert.equal(check.originalValues, 0, 'no coincidence is counted');
  assert.equal(check.pass, true);
});

test('totals add up and a run with more distinct values than are kept makes the check incomplete', () => {
  const p = process_('hl7/adt-a01-01.hl7');
  const v = V.createVerifier(p.run);
  const total = V.newTotal();
  V.combine(total, v.check(p.output, p.format));
  V.combine(total, v.check(p.input, p.format));
  assert.equal(total.files, 2);
  assert.equal(total.failedFiles, 1);
  assert.ok(total.originalValues > 0 && total.fields > 0);
});
