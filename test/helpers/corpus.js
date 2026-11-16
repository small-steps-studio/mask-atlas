'use strict';
// Helpers for the corpus tests: reads the manifest, runs the engine over a file and compares the
// result with what the manifest says was seeded (must be gone) and what must survive.

const fs = require('node:fs');
const path = require('node:path');
const { createRun } = require('../../src/core/run');
const engine = require('../../src/core/engine');

const ROOT = path.join(__dirname, '..', 'fixtures', 'corpus');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function readFixture(rel) { return fs.readFileSync(path.join(ROOT, rel)).toString('latin1'); }
function readFixtureUtf8(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function newRun(mode, extra) {
  return createRun(Object.assign({ mode: mode || 'pseudonym' }, extra || {}));
}

/** Seeded values still present in the output (case-insensitive), as [{value, category, where}]. */
function leftovers(entry, output) {
  const low = output.toLowerCase();
  return entry.seeded.filter(function (s) { return low.indexOf(s.value.toLowerCase()) !== -1; });
}

function missingKeeps(entry, output) {
  const low = output.toLowerCase();
  return (entry.keep || []).filter(function (k) { return low.indexOf(k.toLowerCase()) === -1; });
}

module.exports = { ROOT, manifest, readFixture, readFixtureUtf8, newRun, leftovers, missingKeeps, engine };
