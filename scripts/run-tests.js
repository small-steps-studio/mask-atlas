'use strict';
// Runs the unit suite: every test/*.test.js through `node --test`. The helper files of the test folder
// are not test files, so they are named explicitly instead of letting Node pick everything up.
//   node scripts/run-tests.js [more node --test options]
// MASK_ATLAS_TZ=Pacific/Auckland runs the suite in another time zone (set before the first Date is made).

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'test');
const files = fs.readdirSync(dir).filter(function (f) { return /\.test\.js$/.test(f); }).sort().map(function (f) { return path.join('test', f); });
const env = Object.assign({}, process.env);
if (env.MASK_ATLAS_TZ) {
  const preload = path.join(__dirname, 'set-tz.js');
  // NODE_OPTIONS reads a backslash inside quotes as an escape, so the path is written with forward slashes (valid on Windows too).
  env.NODE_OPTIONS = ((env.NODE_OPTIONS || '') + ' --require "' + preload.split(path.sep).join('/') + '"').trim();
}
const r = cp.spawnSync(process.execPath, ['--test'].concat(process.argv.slice(2), files), { cwd: ROOT, env: env, stdio: 'inherit', windowsHide: true });
process.exit(r.status === null ? 1 : r.status);
