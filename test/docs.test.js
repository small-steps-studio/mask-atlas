'use strict';
// The numbers in the documents, checked against what the code does now: the coverage page, the
// README, the verification page and the licence page. A number that changes with the code fails
// here, so the pages cannot drift away from the product.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { measure, measureFolder } = require('./helpers/measure');
const { sampleFor } = require('../src/samples');
const K = require('../src/core/keyed');
const V = require('../src/core/verify');
const engine = require('../src/core/engine');
const { createRun, CATEGORIES } = require('../src/core/run');
const config = require('../src/licence/config');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const read = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); };
const num = function (n) { return Number(n).toLocaleString('en-US'); };

test('coverage page: the measured table of the sample files', () => {
  const m = measure();
  const page = read('docs/coverage.md');
  assert.ok(page.indexOf('(' + m.formatsFiles.hl7 + ' HL7 v2, ' + m.formatsFiles.x12 + ' X12, ' + m.formatsFiles.fhir + ' FHIR JSON documents and ' + m.formatsFiles.ndjson + ' NDJSON files) and ' + m.invalid + ' invalid files') !== -1, 'file counts');
  assert.ok(page.indexOf('(' + num(m.planted) + ' in all') !== -1 && page.indexOf('(' + m.keep + ':') !== -1, 'planted and harmless counts');
  assert.equal(m.gonePro, m.planted, 'with the fixed key every planted value is gone after a Pro run');
  const row = function (label, planted, gone) { return '| ' + label + ' | ' + num(planted) + ' | ' + num(gone) + ' | ' + num(planted - gone) + ' |'; };
  assert.ok(page.indexOf(row('HL7 v2 (' + m.formatsFiles.hl7 + ' files)', m.byFormat.hl7, m.goneProByFormat.hl7)) !== -1, 'HL7 row');
  assert.ok(page.indexOf(row('X12 (' + m.formatsFiles.x12 + ' files)', m.byFormat.x12, m.goneProByFormat.x12)) !== -1, 'X12 row');
  assert.ok(page.indexOf(row('FHIR JSON (' + m.formatsFiles.fhir + ' files)', m.byFormat.fhir, m.goneProByFormat.fhir)) !== -1, 'FHIR row');
  assert.ok(page.indexOf(row('NDJSON (' + m.formatsFiles.ndjson + ' files)', m.byFormat.ndjson, m.goneProByFormat.ndjson)) !== -1, 'NDJSON row');
  assert.ok(page.indexOf('| **All ' + m.files + ' files** | **' + num(m.planted) + '** | **' + num(m.gonePro) + '** | **0** |') !== -1, 'total row');
  assert.ok(page.indexOf('How they were found: ' + m.detect.rule + ' by place, ' + m.detect.seen + ' by earlier occurrence (they also sit in a note or comment), ' + m.detect.pattern + ' by shape') !== -1, 'how found');
  assert.ok(page.indexOf('All ' + m.keep + ' harmless strings were still in the output') !== -1 && m.keepLostPro === 0);
  // the free mask, per category
  for (const [key, label] of CATEGORIES) {
    const c = m.byCategory[key];
    assert.ok(page.indexOf('| ' + label + ' | ' + c.planted + ' | ' + c.free + ' | ' + c.pro + ' |') !== -1, 'category row ' + label + ' ' + JSON.stringify(c));
  }
  assert.ok(page.indexOf('| **Total** | **' + num(m.planted) + '** | **' + num(m.goneFree) + '** | **' + num(m.gonePro) + '** |') !== -1, 'free total');
  assert.ok(page.indexOf('The free mask removed ' + num(m.goneFree) + ' of the ' + num(m.planted) + ' (' + Math.round(100 * m.goneFree / m.planted) + ' %). The ' + (m.planted - m.goneFree) + ' that remain are, in the sample files, ' + m.freeLeft.repetition + ' repetitions') !== -1, 'free sentence');
  assert.ok(page.indexOf(m.freeLeft.shape + ' shapes inside free text') !== -1 && page.indexOf(m.freeLeft.other + ' values that also occur') !== -1, 'free remainder');
  assert.equal(m.keepLostFree, 1);
  assert.ok(page.indexOf('One of the ' + m.keep + ' harmless strings was changed by the mask') !== -1);
  assert.ok(page.indexOf('lists ' + m.uncovered.listed + ' planted values that were expected to survive') !== -1 && page.indexOf('6 of them survive and ' + (m.uncovered.listed - m.uncovered.survive) + ' are replaced') !== -1 && m.uncovered.survive === 6);
  // the README repeats the two headline numbers
  const readme = read('README.md');
  assert.ok(readme.indexOf('all ' + num(m.planted) + ' planted identifiers were gone after a Pro run and the free mask removed ' + m.goneFree) !== -1, 'README numbers');
  assert.ok(readme.indexOf('In the ' + m.files + ' invented sample messages') !== -1);
});

test('coverage page: the folder run over the sample folder', async () => {
  const f = await measureFolder();
  const page = read('docs/coverage.md');
  assert.ok(page.indexOf('(' + f.entries + ' files, the 12 invalid files and the manifest included) wrote ' + f.by.written + ' files, skipped ' + f.by.skipped + ' that are not messages, reported ' + f.by.error + ' invalid JSON file') !== -1, JSON.stringify(f));
  assert.ok(page.indexOf('replaced ' + num(f.replaced) + ' fields and passed the verification') !== -1);
  assert.equal(f.pass, true);
  assert.equal(f.findings, 0);
});

test('verification page: the plain check of the checker on the sample message', () => {
  const s = sampleFor('hl7');
  const run = createRun({ mode: 'pseudonym' });
  const r = engine.processText(s.text, run, {});
  const v = V.createVerifier(run);
  const bad = v.check(s.text, r.format);
  const page = read('docs/verification.md');
  assert.ok(page.indexOf('reports FAIL, with ' + bad.originalValues + ' replaced values still present, ' + bad.patterns + ' patterns that the run did not create and ' + bad.fields + ' unreplaced fields') !== -1, JSON.stringify([bad.originalValues, bad.patterns, bad.fields]));
  assert.equal(v.check(r.text, r.format).pass, true);
});

test('licence and pricing statements agree with the configuration', () => {
  assert.equal(config.priceText, 'USD 29');
  assert.equal(config.businessPriceText, 'USD 59 per user');
  assert.equal(config.trialDays, 14);
  assert.equal(config.activationLimit, 3);
  assert.equal(config.maxUsers, 100);
  assert.equal(config.graceDays, 14);
  assert.equal(config.cacheHours, 24);
  for (const f of ['README.md', 'TERMS.md', 'docs/licence.md']) {
    const text = read(f);
    assert.match(text, /USD 29/, f);
    assert.match(text, /USD 59 per user/, f);
    assert.match(text, /14[- ]day/, f);
  }
  assert.match(read('docs/licence.md'), /1-100/);
  assert.match(read('docs/licence.md'), /up to 3 computers/);
  assert.equal(pkg.contributes.configuration.properties['maskAtlas.maxFileSizeMB'].default, 20);
  assert.equal(pkg.contributes.configuration.properties['maskAtlas.maxFileSizeMB'].maximum, 64);
  assert.match(read('docs/getting-started.md'), /20 MB by default, at most 64/);
});

test('the pseudonym key is 256 bits and comes from the system random source', () => {
  assert.equal(K.randomKey().length, 32);
  assert.notDeepEqual(K.randomKey(), K.randomKey());
  assert.equal(K.keyFromSeed('a seed of at least twelve characters').length, 32);
  assert.match(read('src/core/keyed.js'), /crypto\.randomBytes\(32\)/);
});
