'use strict';
// The engine runs in a worker thread, so a long run does not freeze the extension host (QA defect 1):
// the answers equal those of the engine in this thread, the host thread stays responsive during a
// run of several megabytes, a run can be cancelled at once and the next one works, and the editor
// commands (De-identify Message, folder run) use the worker. The measurements of the host thread
// use a timer that fires every 10 ms; a block shows as a gap between two ticks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('../src/worker/client');
const samples = require('../src/samples');
const engine = require('../src/core/engine');
const { createRun } = require('../src/core/run');
const gen = require('./helpers/large-gen');
const pkg = require('../package.json');
const M = require('./helpers/vscode-mock');

const ROOT = path.join(__dirname, '..');
const KEY_HEX = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';
// Before the worker, a block of 1 to 4 seconds was measured for 10 MB; with it the longest gap stays far below.
const MAX_BLOCK_MS = 1000; // the blocks before the worker were 1.9 s and more; a busy machine must not fail the test

/** A timer on this thread that records the longest time between two ticks. */
function lagMonitor() {
  let last = Date.now();
  let max = 0;
  const timer = setInterval(function () { const t = Date.now(); max = Math.max(max, t - last); last = t; }, 10);
  return { stop: function () { clearInterval(timer); max = Math.max(max, Date.now() - last); return max; } };
}

function scratch(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-' + name + '-')); }

test('the worker gives the same replacements, counts and verdict as the engine in this thread, for each sample format', async () => {
  const client = createClient();
  try {
    for (const kind of ['hl7', 'fhir', 'x12']) {
      const text = samples.sampleFor(kind).text;
      const local = createRun({ mode: 'pseudonym', key: Buffer.from(KEY_HEX, 'hex'), options: { recordMap: true } });
      const direct = engine.processText(text, local, {});
      const runId = client.newRunId();
      await client.request('createRun', { runId: runId, mode: 'pseudonym', keyHex: KEY_HEX, options: { recordMap: true }, rulesText: '' });
      const viaWorker = await client.request('processText', { runId: runId, text: text, verify: true });
      assert.equal(viaWorker.ok, true, kind);
      assert.equal(viaWorker.text, direct.text, kind + ': the same output text');
      assert.equal(viaWorker.stats.total, local.stats.total, kind + ': the same count');
      assert.equal(viaWorker.verification.pass, true, kind + ': the worker verified its own output');
      assert.equal(viaWorker.verification.originalValues + viaWorker.verification.patterns + viaWorker.verification.fields, 0, kind);
      const again = await client.request('verifyText', { runId: runId, text: text, format: viaWorker.format });
      assert.equal(again.verification.pass, false, kind + ': the unchanged message fails against the run, as it does in this thread');
    }
  } finally { await client.dispose(); }
});

test('a run that the worker no longer holds is refused with a plain message', async () => {
  const client = createClient();
  try {
    await assert.rejects(client.request('processText', { runId: 'nothing', text: 'MSH|^~\\&|' }), (e) => /no longer in memory/.test(e.message) && !e.cancelled);
    await client.forget('nothing'); // nothing to forget and no error
  } finally { await client.dispose(); }
});

test('a folder run of 3 MB and its verification leave the host thread responsive (the longest block stays under a second)', { timeout: 300000 }, async () => {
  const dir = scratch('lag');
  const client = createClient();
  try {
    const input = path.join(dir, 'in');
    fs.mkdirSync(input);
    gen.writeLarge('hl7', path.join(input, 'big.hl7'), 3 * 1000 * 1000);
    gen.writeLarge('ndjson', path.join(input, 'big.ndjson'), 1 * 1000 * 1000);
    const runId = client.newRunId();
    await client.request('createRun', { runId: runId, mode: 'pseudonym', options: { recordMap: true }, rulesText: '' });
    const phases = new Set();
    const monitor = lagMonitor();
    const started = Date.now();
    const out = await client.request('runFiles', { runId: runId, folder: input, outDir: path.join(dir, 'out') }, { onProgress: function (p) { phases.add(p.phase); } });
    const elapsed = Date.now() - started;
    const block = monitor.stop();
    assert.equal(out.verification.pass, true, JSON.stringify(out.verification));
    assert.equal(out.files.filter((f) => f.status === 'written').length, 2);
    assert.ok(phases.has('files') && phases.has('verify'), 'progress was reported: ' + Array.from(phases).join(','));
    assert.ok(block < MAX_BLOCK_MS, 'the host thread was blocked for ' + block + ' ms in a run of ' + elapsed + ' ms');
    assert.ok(elapsed > 4 * block, 'the work was done: ' + elapsed + ' ms for a longest block of ' + block + ' ms');
  } finally { await client.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cancel stops a run at once, the host thread is not blocked by it, and the next request starts a new worker', { timeout: 300000 }, async () => {
  const dir = scratch('cancel');
  let resets = 0;
  const client = createClient({ onReset: function () { resets++; } });
  try {
    const input = path.join(dir, 'in');
    fs.mkdirSync(input);
    gen.writeLarge('hl7', path.join(input, 'big.hl7'), 6 * 1000 * 1000);
    const runId = client.newRunId();
    await client.request('createRun', { runId: runId, mode: 'pseudonym', options: {}, rulesText: '' });
    const long = client.request('runFiles', { runId: runId, folder: input, outDir: path.join(dir, 'out') });
    const outcome = long.then(() => 'finished', (e) => (e.cancelled ? 'cancelled' : 'failed: ' + e.message));
    await new Promise((r) => setTimeout(r, 400));
    const monitor = lagMonitor();
    const t0 = Date.now();
    await client.cancel();
    const stopped = Date.now() - t0;
    assert.equal(await outcome, 'cancelled');
    assert.ok(stopped < 3000, 'the worker stopped within ' + stopped + ' ms');
    assert.ok(monitor.stop() < MAX_BLOCK_MS, 'cancelling did not block this thread');
    assert.equal(resets, 1, 'the owner was told that the runs are gone');
    assert.equal(client.isRunning(), false);
    // the run is gone with the worker; a new run works
    await assert.rejects(client.request('processText', { runId: runId, text: 'x' }), /no longer in memory/);
    const id2 = client.newRunId();
    await client.request('createRun', { runId: id2, mode: 'mask', options: {} });
    const r = await client.request('processText', { runId: id2, text: samples.sampleFor('hl7').text });
    assert.equal(r.ok, true);
    assert.ok(r.changed > 0);
  } finally { await client.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a token that is already cancelled never starts a request', async () => {
  const client = createClient();
  try {
    await assert.rejects(client.request('ping', {}, { token: { isCancellationRequested: true, onCancellationRequested: () => ({ dispose() {} }) } }), (e) => e.cancelled === true);
    assert.equal(client.isRunning(), false, 'no worker was started for it');
  } finally { await client.dispose(); }
});

// ---- the commands use the worker -------------------------------------------------------------

function startExtension(options) {
  const mock = M.createMock(options);
  return M.startExtension(ROOT, pkg, mock, 1);
}

test('De-identify Message of a 3 MB document leaves the host thread responsive and the result verified', { timeout: 300000 }, async () => {
  let text = '';
  for (let i = 0; text.length < 3 * 1000 * 1000; i++) text += gen.hl7(i);
  const x = await startExtension({ files: { 'file:///work/big.hl7': text }, active: 'file:///work/big.hl7' });
  try {
    const monitor = lagMonitor();
    const started = Date.now();
    await x.run('maskAtlas.deidentifyDocument');
    const elapsed = Date.now() - started;
    const block = monitor.stop();
    const info = x.state.infoMessages.map((m) => m.text).join(' | ');
    assert.match(info, /Verification: PASS/);
    assert.equal(x.state.edits, 0);
    assert.ok(block < MAX_BLOCK_MS, 'blocked for ' + block + ' ms in ' + elapsed + ' ms');
    assert.ok(x.state.progress.length >= 1, 'a notification with a cancel button was shown for the large text');
    assert.equal(x.state.progress[0].cancellable, true);
  } finally { x.uninstall(); }
});

test('cancelling De-identify Message in the notification stops the run, keeps nothing, and the command works again', { timeout: 300000 }, async () => {
  let text = '';
  for (let i = 0; text.length < 3 * 1000 * 1000; i++) text += gen.hl7(i);
  const x = await startExtension({ files: { 'file:///work/big.hl7': text }, active: 'file:///work/big.hl7', cancelAfter: 300 });
  try {
    const started = Date.now();
    await x.run('maskAtlas.deidentifyDocument');
    assert.ok(Date.now() - started < 5000, 'the command returned soon after the cancellation');
    assert.ok(x.state.infoMessages.some((m) => /cancelled\. Nothing was kept of the unfinished run/.test(m.text)), JSON.stringify(x.state.infoMessages.map((m) => m.text)));
    assert.equal(x.state.openedDocs.length, 0, 'no result document was opened');
    assert.equal(x.state.edits, 0);
    // the busy flag is released: a second command runs (a small document now)
    x.state.setActive(null);
    const doc = x.state.addDocument('file:///work/small.hl7', samples.sampleFor('hl7').text);
    x.state.activeTextEditor = { document: doc, edit: async () => true };
    await x.run('maskAtlas.scan');
    assert.ok(x.state.infoMessages.some((m) => /fields can point to a person/.test(m.text)), 'the scan ran after the cancellation');
  } finally { x.uninstall(); }
});

test('a second command while one runs is refused with a message, not queued behind it', { timeout: 300000 }, async () => {
  let text = '';
  for (let i = 0; text.length < 2 * 1000 * 1000; i++) text += gen.hl7(i);
  const x = await startExtension({ files: { 'file:///work/big.hl7': text }, active: 'file:///work/big.hl7' });
  try {
    const first = x.run('maskAtlas.deidentifyDocument');
    await new Promise((r) => setTimeout(r, 150));
    await x.run('maskAtlas.scan');
    assert.ok(x.state.warningMessages.some((m) => /Another run is still working/.test(m.text)), JSON.stringify(x.state.warningMessages.map((m) => m.text)));
    await first;
    assert.match(x.state.infoMessages.map((m) => m.text).join(' | '), /Verification: PASS/);
  } finally { x.uninstall(); }
});

test('a folder run over the command uses the worker, shows progress with a cancel button and can be cancelled', { timeout: 300000 }, async () => {
  const dir = scratch('foldercmd');
  const folder = path.join(dir, 'feed');
  fs.mkdirSync(folder);
  gen.writeLarge('hl7', path.join(folder, 'big.hl7'), 5 * 1000 * 1000);
  try {
    const x = await startExtension({ files: { 'file:///work/a.hl7': samples.sampleFor('hl7').text }, active: 'file:///work/a.hl7', cancelAfter: 500, answer: (kind, text, buttons) => (buttons.indexOf('Write Copies') !== -1 ? 'Write Copies' : undefined) });
    try {
      const monitor = lagMonitor();
      await x.run('maskAtlas.deidentifyFolder', M.Uri.file(folder));
      const block = monitor.stop();
      assert.ok(block < MAX_BLOCK_MS, 'blocked for ' + block + ' ms');
      assert.equal(x.state.progress[0].cancellable, true);
      assert.ok(x.state.infoMessages.some((m) => /cancelled\. Files already written stay in "feed-masked"; they are not a complete or verified result/.test(m.text)), JSON.stringify(x.state.infoMessages.map((m) => m.text)));
      assert.equal(x.state.openedDocs.length, 0, 'no report was opened for a cancelled run');
    } finally { x.uninstall(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
