'use strict';
// Large files: the file run reads a file in pieces, writes through a temporary file and verifies
// the copy from disk. The engine runs in the worker thread of the extension (the child process plays
// the extension host), and the longest time that the host thread was blocked is measured with a
// 10 ms timer. The default run uses 2 MB of each format (about a minute); MASK_ATLAS_LARGE=<megabytes>
// (for example 50) runs the real measurement and prints it, which is how the table in docs/pro.md
// was made:
//   MASK_ATLAS_LARGE=50 node --test test/large.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HELPER = path.join(__dirname, 'helpers', 'large-run.js');
const MEGABYTES = Number(process.env.MASK_ATLAS_LARGE) || 2;
// the longest block of the host thread that a run may cause (the audit measured 1.9 to 4.1 s for 10 MB before the worker)
const MAX_HOST_BLOCK_MS = 1000;
// memory limit of the worker in megabytes: 1024 proves that a run fits into 1 GB; MASK_ATLAS_LARGE_HEAP=0 uses the limit of the extension (3 GB), as the table in docs/pro.md does
const HEAP = process.env.MASK_ATLAS_LARGE_HEAP === '0' ? [] : [process.env.MASK_ATLAS_LARGE_HEAP || '1024'];

function runChild(args) {
  return new Promise(function (resolve, reject) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-large-test-'));
    const child = cp.spawn(process.execPath, [HELPER].concat(args.slice(0, 2), [dir], args.slice(2)), { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', function (c) { out += c; });
    child.stderr.on('data', function (c) { err += c; });
    child.on('close', function (code) {
      fs.rmSync(dir, { recursive: true, force: true });
      if (code !== 0) return reject(new Error('the child failed (' + code + '): ' + err.slice(0, 400)));
      resolve(JSON.parse(out.trim().split('\n').pop()));
    });
  });
}

for (const format of ['hl7', 'x12', 'ndjson']) {
  test(MEGABYTES + ' MB of ' + format + ' with a different patient in every message: processed in pieces in the worker under a 1 GB heap, written, verified from disk, host thread never blocked', { timeout: 3 * 3600 * 1000 }, async () => {
    const r = await runChild([format, String(MEGABYTES)].concat(HEAP));
    if (process.env.MASK_ATLAS_LARGE) process.stdout.write('MEASUREMENT ' + JSON.stringify(r) + '\n');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.inputBytes >= MEGABYTES * 1000 * 1000 * 0.99, 'the input has the size asked for: ' + r.inputBytes);
    assert.ok(r.changed > r.messages, 'every message had fields replaced: ' + r.changed + ' for ' + r.messages);
    assert.ok(r.outputBytes > r.inputBytes * 0.9, 'the output is about as large as the input');
    assert.ok(r.peakHeapMB < 1000, 'heap in use stayed under the limit: ' + r.peakHeapMB + ' MB');
    assert.equal(r.verification.incomplete, false);
    assert.ok(r.verification.findings <= Math.ceil(r.messages / 10000) + 2, 'verification findings: ' + r.verification.findings + ' (coincidences of a replacement with another original are possible, see docs/verification.md)');
    assert.ok(r.maxHostBlockMs < MAX_HOST_BLOCK_MS, 'the host thread was blocked for ' + r.maxHostBlockMs + ' ms');
  });
}

test('a FHIR bundle in a single JSON file is read whole in the worker: 3 MB under a 1 GB heap, host thread never blocked', { timeout: 3600 * 1000 }, async () => {
  const mb = process.env.MASK_ATLAS_LARGE_BUNDLE ? Number(process.env.MASK_ATLAS_LARGE_BUNDLE) : 3;
  const r = await runChild(['bundle', String(mb)].concat(HEAP));
  if (process.env.MASK_ATLAS_LARGE_BUNDLE) process.stdout.write('MEASUREMENT ' + JSON.stringify(r) + '\n');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.peakHeapMB < 1000, 'heap in use: ' + r.peakHeapMB + ' MB');
  assert.equal(r.verification.incomplete, false);
  assert.ok(r.maxHostBlockMs < MAX_HOST_BLOCK_MS, 'the host thread was blocked for ' + r.maxHostBlockMs + ' ms');
});

// ---- one interchange or bundle that holds a whole batch: the time must not grow with the square -------

const gen = require('./helpers/large-gen');
const engine = require('../src/core/engine');
const { createRun } = require('../src/core/run');

function claimLoop(i) {
  const fam = gen.letters(i, 9).toUpperCase(), giv = gen.letters(i * 3 + 1, 6).toUpperCase();
  return ['HL*' + (i + 2) + '*1*22*0', 'SBR*P*18**GRP-' + gen.digits(i, 4, 18) + '*****CI', 'NM1*IL*1*' + fam + '*' + giv + '*A***MI*MBR' + gen.digits(i, 8, 19),
    'N3*' + (1 + i % 998) + ' ' + gen.letters(i, 7).toUpperCase() + ' ROAD', 'N4*' + gen.letters(i + 5, 8).toUpperCase() + '*TX*' + gen.digits(i, 5, 20), 'DMG*D8*19800214*F',
    'REF*SY*' + gen.digits(i, 3, 1) + '-' + gen.digits(i, 2, 2) + '-' + gen.digits(i, 4, 3), 'CLM*ACCT-' + gen.digits(i, 6, 21) + '*182.50***11:B:1*Y*A*Y*Y', 'DTP*431*D8*20261029',
    'NTE*ADD*PATIENT ' + fam + ' ' + giv + ' ASKED FOR A STATEMENT'].join('~') + '~';
}
function interchange(claims) {
  let text = 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *261105*0830*^*00501*000000001*0*P*:~GS*HC*S*R*20261105*0830*1*X*005010X222A1~ST*837*0001*005010X222A1~';
  for (let i = 0; i < claims; i++) text += claimLoop(i);
  return text + 'SE*10*0001~GE*1*1~IEA*1*000000001~';
}
function bundle(patients) {
  const entries = [];
  for (let i = 0; i < patients; i++) entries.push('{"resource":' + gen.ndjson(i).split('\n')[0] + '}');
  return '{"resourceType":"Bundle","type":"collection","entry":[' + entries.join(',') + ']}';
}
function timed(text) {
  const started = Date.now();
  const r = engine.processText(text, createRun({ mode: 'pseudonym' }), {});
  assert.equal(r.ok, true);
  return { ms: Date.now() - started, text: r.text };
}

for (const [label, make] of [['X12 interchange with a claim loop per patient', interchange], ['FHIR bundle with a patient per entry', bundle]]) {
  test(label + ': 3,000 loops take about three times as long as 1,000, and none of the names survives', () => {
    const small = timed(make(1000));
    const big = timed(make(3000));
    assert.ok(big.ms < 30000, '3,000 loops took ' + big.ms + ' ms');
    assert.ok(big.ms < Math.max(1500, small.ms * 6), 'time grew faster than the work: ' + small.ms + ' ms for 1,000 and ' + big.ms + ' ms for 3,000');
    assert.equal(big.text.indexOf(gen.letters(2999, 9).toUpperCase()), -1);
    assert.equal(big.text.toLowerCase().indexOf(gen.letters(1500, 9).toLowerCase()), -1);
  });
}
