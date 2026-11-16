'use strict';
// Checks the packaged .vsix: lists its files, refuses tests, scripts, secrets, screenshots, working
// notes and development files inside it, scans every text entry for keys and private paths, and
// confirms the manifest inside (version, pricing, engine). The wording checks are kept outside this
// folder (see scripts/release-gate.js).
//   node scripts/check-vsix.js [path/to/mask-atlas-x.y.z.vsix]
// A .vsix is a zip file; the central directory is read and entries are inflated with Node's zlib.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const file = process.argv[2] || path.join(ROOT, pkg.name + '-' + pkg.version + '.vsix');
const problems = [];
function fail(t) { problems.push(t); }

function readZip(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = b.readUInt16LE(eocd + 10);
  let pos = b.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(pos) !== 0x02014b50) throw new Error('bad central directory');
    const method = b.readUInt16LE(pos + 10);
    const compressedSize = b.readUInt32LE(pos + 20);
    const nameLength = b.readUInt16LE(pos + 28);
    const extraLength = b.readUInt16LE(pos + 30);
    const commentLength = b.readUInt16LE(pos + 32);
    const localOffset = b.readUInt32LE(pos + 42);
    const name = b.toString('utf8', pos + 46, pos + 46 + nameLength);
    const dataStart = localOffset + 30 + b.readUInt16LE(localOffset + 26) + b.readUInt16LE(localOffset + 28);
    const raw = b.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? raw : null;
    if (data === null) throw new Error('unsupported compression for ' + name);
    entries.push({ name: name, data: data });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const buf = fs.readFileSync(file);
const entries = readZip(buf);
const names = entries.map(function (e) { return e.name; });
process.stdout.write(names.map(function (n) { return '  ' + n; }).join('\n') + '\n');

const forbidden = /(^|\/)(test|tests|scripts|docs|demo|node_modules|\.github|\.vscode)\/|\.test\.js$|\.vsix$|\.map$|\.log$|SPEC|STATUS|TODO-BEFORE-PUBLISH|NOTES|(^|\/)QA-|RELEASE-NOTES|\.gitignore$|\.gitattributes$|screenshots\/|(^|\/)secrets?\/|\.env$|\.pem$|\.key$|\.py$/;
for (const n of names) if (forbidden.test(n)) fail('the package contains a development or secret file: ' + n);

const required = ['extension/package.json', 'extension/readme.md', 'extension/changelog.md', 'extension/LICENSE.txt', 'extension/TERMS.md', 'extension/PRIVACY.md',
  'extension/media/icon.png', 'extension/schemas/rules.schema.json', 'extension/src/extension.js', 'extension/src/core/engine.js', 'extension/src/licence/config.js', 'extension/media/walkthrough/open-sample.md', 'extension.vsixmanifest'];
for (const r of required) if (names.indexOf(r) === -1) fail('the package lacks ' + r);

let scanned = 0;
for (const e of entries) {
  if (/\.(png|ico)$/.test(e.name)) continue;
  scanned++;
  const text = e.data.toString('utf8');
  if (/MOCK-KEY|[A-Za-z]:\\Users\\|\/home\/[a-z]+\//.test(text)) fail(e.name + ' contains a test key or a private path');
  if (/(sk|pk|lk)_(live|test)_[A-Za-z0-9]{16,}/.test(text)) fail(e.name + ' looks like it contains a secret');
  if (/test\.(checkout\.)?dodopayments/.test(text)) fail(e.name + ' names the test environment of the payment provider, which an installed copy must not carry');
}

const inner = entries.find(function (e) { return e.name === 'extension/package.json'; });
if (inner) {
  const manifest = JSON.parse(inner.data.toString('utf8'));
  if (manifest.version !== pkg.version) fail('version inside the package is ' + manifest.version);
  if (manifest.pricing !== 'Trial') fail('pricing inside the package is ' + manifest.pricing);
  if (manifest.engines.vscode !== '^1.82.0') fail('engine inside the package is ' + manifest.engines.vscode);
  if (names.indexOf('extension/src/licence/test-environment.js') !== -1) fail('the package carries the licence test environment');
  // Identity of the package against the source manifest.
  for (const k of ['name', 'displayName', 'publisher', 'license', 'homepage', 'main']) if (manifest[k] !== pkg[k]) fail('manifest field ' + k + ' inside the package differs from the source: ' + manifest[k]);
  if (manifest.publisher !== 'SmallStepsStudio') fail('publisher must be SmallStepsStudio');
  if (!manifest.repository || manifest.repository.url !== 'https://github.com/small-steps-studio/' + pkg.name) fail('repository url is not the public repository');
  if (!manifest.bugs || manifest.bugs.url !== 'https://github.com/small-steps-studio/' + pkg.name + '/issues') fail('bugs url is not the issues page');
  if (manifest.homepage !== 'https://github.com/small-steps-studio/' + pkg.name + '#readme') fail('homepage is not the repository readme');
  if (JSON.stringify(manifest.contributes) !== JSON.stringify(pkg.contributes)) fail('contributes inside the package differs from the source manifest');
}

// Every packaged file must be byte-identical to the file of the source folder (README and CHANGELOG
// links are rewritten by the packager and are compared by size class only), and every file that
// belongs in the package must be in it.
const sourceMap = { 'extension/readme.md': 'README.md', 'extension/changelog.md': 'CHANGELOG.md' };
for (const e of entries) {
  if (!/^extension\//.test(e.name)) continue;
  const rel = sourceMap[e.name] || e.name.slice('extension/'.length);
  const sourceFile = path.join(ROOT, rel);
  if (!fs.existsSync(sourceFile)) { fail('the package holds a file that is not in the source folder: ' + e.name); continue; }
  if (sourceMap[e.name]) continue;
  if (e.name === 'extension/package.json') continue;
  const sourceData = fs.readFileSync(sourceFile);
  if (!sourceData.equals(e.data)) fail('the packaged file differs from the source file: ' + e.name);
}
{
  const must = ['src', 'media/icon.png', 'media/walkthrough', 'schemas'];
  function walk(dir, out) {
    for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + d.name;
      if (d.isDirectory()) walk(rel, out); else out.push(rel);
    }
    return out;
  }
  const expected = [];
  for (const m of must) { if (fs.statSync(path.join(ROOT, m)).isDirectory()) walk(m, expected); else expected.push(m); }
  for (const rel of expected) if (names.indexOf('extension/' + rel) === -1) fail('the source file is missing from the package: ' + rel);
}
const vsixmanifest = entries.find(function (e) { return e.name === 'extension.vsixmanifest'; });
if (vsixmanifest) {
  const xml = vsixmanifest.data.toString('utf8');
  if (!/Pricing" Value="Trial"/.test(xml)) fail('extension.vsixmanifest does not carry Pricing=Trial');
  if (!/Microsoft\.VisualStudio\.Code\.ExecutesCode" Value="true"/.test(xml)) fail('ExecutesCode flag missing');
}

process.stdout.write(names.length + ' entries (' + scanned + ' text entries scanned for keys and private paths), ' + Math.round(buf.length / 1024) + ' KB\n');
if (buf.length > 2 * 1024 * 1024) fail('the package is larger than 2 MB');
if (problems.length) {
  process.stdout.write('VSIX CHECK FAILED\n' + problems.map(function (p) { return '  - ' + p; }).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('VSIX CHECK PASSED: ' + path.basename(file) + '\n');
