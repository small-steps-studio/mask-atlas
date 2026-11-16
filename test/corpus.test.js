'use strict';
// The corpus of 72 invented messages (HL7 v2, FHIR JSON and NDJSON, X12) seeded with known
// identifiers: after a Pro run every seeded value is gone, the clinical content named in the
// manifest survives, and the output has the same structure as the input. The free-tier mask keeps
// every length and the whole structure. Twelve invalid files must be refused or handled without
// a crash. All fixtures live in test/fixtures/corpus (part of the repository).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('./helpers/corpus');
const K = require('../src/core/keyed');
const { createRun } = require('../src/core/run');

const SEED = 'corpus test seed phrase 2026';
const files = C.manifest.files;

function structureHl7(text) {
  return text.split(/\r\n|\r|\n/).map(function (l) { return l.replace(/[^|^~&]/g, '').length + ':' + l.slice(0, 3); });
}
function structureX12(text) {
  const t = text.charAt(105);
  const e = text.charAt(3);
  return text.split(t).map(function (s) { return s.trim().split(e).length + ':' + s.trim().split(e)[0]; });
}
function shape(value) {
  if (Array.isArray(value)) return '[' + value.map(shape).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).map(function (k) { return k + ':' + shape(value[k]); }).join(',') + '}';
  return typeof value;
}
function structureOf(entry, text) {
  if (entry.format === 'hl7') return structureHl7(text);
  if (entry.format === 'x12') return structureX12(text);
  if (/\.ndjson$/.test(entry.file)) return text.split(/\r?\n/).filter(Boolean).map(function (l) { return shape(JSON.parse(l)); });
  return shape(JSON.parse(text));
}

test('the corpus has at least 60 messages in all three formats and hundreds of seeded identifiers', () => {
  assert.ok(files.length >= 60, 'files: ' + files.length);
  const by = { hl7: 0, fhir: 0, x12: 0 };
  let seeded = 0, keeps = 0;
  for (const e of files) { by[e.format]++; seeded += e.seeded.length; keeps += (e.keep || []).length; }
  assert.ok(by.hl7 >= 20 && by.fhir >= 20 && by.x12 >= 14, JSON.stringify(by));
  assert.ok(seeded >= 1000, 'seeded values: ' + seeded);
  assert.ok(keeps >= 400, 'values to keep: ' + keeps);
  assert.equal(C.manifest.invalid.length, 12);
  for (const e of files) assert.ok(fs.existsSync(path.join(C.ROOT, e.file)), e.file + ' exists in the repository tree');
});

for (const entry of files) {
  test('corpus ' + entry.file + ': every seeded value is gone, the clinical content stays, the structure is the same', () => {
    const text = C.readFixtureUtf8(entry.file);
    const before = structureOf(entry, text);
    const run = createRun({ mode: 'pseudonym', key: K.keyFromSeed(SEED) });
    const r = C.engine.processText(text, run, {});
    assert.equal(r.ok, true, r.message);
    assert.equal(r.format, entry.format);
    assert.ok(r.changed > 0, 'something was replaced');
    const left = C.leftovers(entry, r.text);
    assert.deepEqual(left.map(function (s) { return s.where + ' (' + s.category + ')'; }), [], 'seeded values still in the output (positions only)');
    assert.deepEqual(C.missingKeeps(entry, r.text).length, 0, 'a value that must survive was lost: ' + JSON.stringify(C.missingKeeps(entry, r.text)));
    assert.deepEqual(structureOf(entry, r.text), before, 'same segments, elements and keys as the input');
    // a second run with the same seed gives the same text; another seed gives another one
    const again = C.engine.processText(text, createRun({ mode: 'pseudonym', key: K.keyFromSeed(SEED) }), {});
    assert.equal(again.text, r.text, 'deterministic for a seed');
    const other = C.engine.processText(text, createRun({ mode: 'pseudonym', key: K.keyFromSeed(SEED + ' other') }), {});
    assert.notEqual(other.text, r.text, 'another seed gives other replacements');
    assert.equal(C.leftovers(entry, other.text).length, 0);
  });

  test('corpus ' + entry.file + ': the free-tier mask keeps every length and the structure', () => {
    const text = C.readFixtureUtf8(entry.file);
    const r = C.engine.processText(text, C.newRun('mask'), {});
    assert.equal(r.ok, true, r.message);
    assert.equal(r.text.length, text.length, 'same length');
    assert.deepEqual(structureOf(entry, r.text), structureOf(entry, text));
    const a = text.split(/\r\n|\r|\n/), b = r.text.split(/\r\n|\r|\n/);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) assert.equal(b[i].length, a[i].length, 'line ' + (i + 1) + ' keeps its length');
    assert.ok(r.changed > 0);
    // the first seeded value of a structured field is masked in the free tier
    const structured = entry.seeded.filter(function (s) { return !s.freeText && s.detect === 'rule'; });
    const masked = structured.filter(function (s) { return r.text.toLowerCase().indexOf(s.value.toLowerCase()) === -1; });
    assert.ok(masked.length >= Math.ceil(structured.length * 0.6), 'the profile masks most structured seeded values: ' + masked.length + ' of ' + structured.length);
  });
}

test('one run over the whole corpus: the same person gets the same fake name and no seeded value survives', () => {
  const run = createRun({ mode: 'pseudonym', key: K.keyFromSeed(SEED) });
  let total = 0;
  for (const entry of files) {
    const r = C.engine.processText(C.readFixtureUtf8(entry.file), run, {});
    assert.equal(r.ok, true);
    assert.equal(C.leftovers(entry, r.text).length, 0, entry.file);
    total += entry.seeded.length;
  }
  assert.ok(total >= 1000);
  assert.ok(run.stats.total > total / 2, 'the run counted its replacements: ' + run.stats.total);
});

for (const entry of C.manifest.invalid) {
  test('invalid corpus file ' + entry.file + ' (' + entry.expect + '): refused or handled, never a crash or a leak of a stack', () => {
    const text = fs.readFileSync(path.join(C.ROOT, entry.file)).toString('latin1');
    const r = C.engine.processText(text, createRun({ mode: 'pseudonym' }), {});
    if (entry.expect === 'not-recognised') {
      assert.equal(r.ok, false, 'not recognised');
      assert.match(r.message, /^[A-Za-z]/);
      assert.doesNotMatch(r.message, /\bat \w+.*\(.*:\d+:\d+\)|node:internal/);
    } else {
      assert.ok(r.ok === true || r.ok === false);
      if (r.ok === false) assert.doesNotMatch(r.message, /node:internal|TypeError|undefined/);
    }
  });
}
