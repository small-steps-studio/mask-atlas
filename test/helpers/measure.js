'use strict';
// Measures the corpus the way docs/coverage.md reports it: planted values per format and per
// category, how many are gone after a Pro run and after the free mask, how they were found, and
// which harmless strings survive. The documentation test compares the page with this result, so a
// number on the page cannot drift from what the code does.
//   node test/helpers/measure.js     prints the result as JSON

const C = require('./corpus');
const K = require('../../src/core/keyed');
const { createRun, CATEGORIES } = require('../../src/core/run');

const SEED = 'key one for coverage 1';

function groupOf(entry) { return entry.format === 'ndjson' ? 'ndjson' : entry.format; }

function measure() {
  const labels = {};
  for (const [key, label] of CATEGORIES) labels[key] = label;
  const out = {
    files: C.manifest.files.length, invalid: C.manifest.invalid.length, planted: 0, byFormat: {}, byCategory: {}, goneProByFormat: {}, goneFree: 0, gonePro: 0,
    detect: { rule: 0, seen: 0, pattern: 0 }, uncovered: { listed: 0, survive: 0 }, keep: 0, keepLostPro: 0, keepLostFree: 0, freeLeft: { repetition: 0, shape: 0, other: 0 }, formatsFiles: {}
  };
  for (const e of C.manifest.files) {
    const g = groupOf(e);
    out.formatsFiles[g] = (out.formatsFiles[g] || 0) + 1;
    const text = C.readFixtureUtf8(e.file);
    const pro = C.engine.processText(text, createRun({ mode: 'pseudonym', key: K.keyFromSeed(SEED) }), {});
    const free = C.engine.processText(text, createRun({ mode: 'mask' }), {});
    const proLeft = new Set(C.leftovers(e, pro.text).map(function (s) { return s.value + '|' + s.where; }));
    const freeLeft = new Set(C.leftovers(e, free.text).map(function (s) { return s.value + '|' + s.where; }));
    for (const u of e.uncovered || []) { out.uncovered.listed++; if (pro.text.toLowerCase().indexOf(u.value.toLowerCase()) !== -1) out.uncovered.survive++; }
    out.keep += (e.keep || []).length;
    out.keepLostPro += C.missingKeeps(e, pro.text).length;
    out.keepLostFree += C.missingKeeps(e, free.text).length;
    for (const s of e.seeded) {
      const id = s.value + '|' + s.where;
      out.planted++;
      out.byFormat[g] = (out.byFormat[g] || 0) + 1;
      const c = out.byCategory[s.category] || (out.byCategory[s.category] = { label: labels[s.category] || s.category, planted: 0, free: 0, pro: 0 });
      c.planted++;
      if (!proLeft.has(id)) { c.pro++; out.gonePro++; out.goneProByFormat[g] = (out.goneProByFormat[g] || 0) + 1; }
      if (!freeLeft.has(id)) { c.free++; out.goneFree++; } else if (s.freeText) out.freeLeft.repetition++; else if (s.detect === 'pattern') out.freeLeft.shape++; else out.freeLeft.other++;
      out.detect[s.detect] = (out.detect[s.detect] || 0) + 1;
    }
  }
  return out;
}

/** A folder run over the whole corpus folder: counts of written, skipped, unchanged and error entries, replaced fields, verification. */
async function measureFolder() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const files = require('../../src/core/files');
  const V = require('../../src/core/verify');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-measure-'));
  try {
    const run = createRun({ mode: 'pseudonym', key: K.keyFromSeed(SEED) });
    const r = await files.runFolder(C.ROOT, path.join(dir, 'out'), run, {});
    const by = {};
    for (const f of r.files) by[f.status] = (by[f.status] || 0) + 1;
    const total = await files.verifyOutputs(path.join(dir, 'out'), r.files, V.createVerifier(run), {});
    return { entries: r.files.length, by: by, replaced: run.stats.total, pass: total.pass, findings: total.originalValues + total.patterns + total.fields };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { measure, measureFolder };
if (require.main === module) {
  measureFolder().then(function (folder) { process.stdout.write(JSON.stringify({ corpus: measure(), folder: folder }) + '\n'); });
}
