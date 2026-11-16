'use strict';
// The editor side of the engine worker (see engine-worker.js): one worker thread, started on first
// use, answers requests one after the other. cancel() stops the worker at once (whatever it was
// doing is abandoned and the runs it held are gone); the next request starts a new one.

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_FILE = path.join(__dirname, 'engine-worker.js');
const HEAP_MB = 3072;

/**
 * A folder run writes each file through a temporary file `<name>.part-<pid>` and moves it into place when it is complete. A worker that is
 * stopped does not get to remove the one it was writing, so the host does it (only files of this process, only below the output folder).
 */
function removePartFiles(dir) {
  const suffix = '.part-' + process.pid;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) removePartFiles(full);
    else if (e.name.endsWith(suffix)) { try { fs.rmSync(full, { force: true }); } catch (err) { /* left in place: the message of the run names the folder */ } }
  }
}

class Cancelled extends Error { constructor() { super('cancelled'); this.cancelled = true; } }

function createClient(options) {
  const o = options || {};
  let worker = null;
  let seq = 0;
  let runSeq = 0;
  const pending = new Map();

  function failAll(error) {
    const folders = [];
    for (const p of Array.from(pending.values())) { if (p.outDir) folders.push(p.outDir); p.reject(error); }
    pending.clear();
    return folders;
  }

  function start() {
    if (worker) return worker;
    const w = new Worker(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: o.heapMB || HEAP_MB } });
    w.unref(); // an idle worker never keeps the process alive
    w.on('message', function (m) {
      const p = pending.get(m.id);
      if (!p) return;
      if (m.progress) { if (p.onProgress) p.onProgress(m.progress); return; }
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else { const e = new Error(m.error && m.error.message ? m.error.message : 'the run could not be completed.'); if (m.error && m.error.cancelled) e.cancelled = true; p.reject(e); }
    });
    w.on('error', function (e) {
      const memory = e && (e.code === 'ERR_WORKER_OUT_OF_MEMORY' || /out of memory/i.test(String(e.message)));
      if (worker === w) worker = null;
      const left = failAll(new Error(memory ? 'the run needed more memory than the editor allows for it. Split the input, or de-identify fewer files at a time.' : 'the run stopped unexpectedly.'));
      left.forEach(removePartFiles);
      if (o.onReset) o.onReset();
    });
    w.on('exit', function () {
      if (worker === w) { worker = null; failAll(new Error('the run stopped unexpectedly.')).forEach(removePartFiles); if (o.onReset) o.onReset(); }
    });
    worker = w;
    return w;
  }

  /** Sends a request; resolves with the answer. opts.onProgress(data) receives progress, opts.token a cancellation token of the editor. */
  function request(op, payload, opts) {
    const options2 = opts || {};
    const token = options2.token;
    if (token && token.isCancellationRequested) return Promise.reject(new Cancelled());
    const id = ++seq;
    const w = start();
    return new Promise(function (resolve, reject) {
      let subscription = null;
      const finish = function (fn) { return function (v) { if (subscription && subscription.dispose) subscription.dispose(); fn(v); }; };
      pending.set(id, { resolve: finish(resolve), reject: finish(reject), onProgress: options2.onProgress, outDir: op === 'runFiles' && payload && payload.outDir ? payload.outDir : '' });
      if (token && typeof token.onCancellationRequested === 'function') subscription = token.onCancellationRequested(function () { cancel(); });
      w.postMessage(Object.assign({}, payload, { op: op, id: id }));
    });
  }

  /** Stops the worker now; every request that was waiting for it is rejected as cancelled. */
  function cancel() {
    const w = worker;
    worker = null;
    if (!w) return Promise.resolve();
    const error = new Cancelled();
    const folders = failAll(error);
    if (o.onReset) o.onReset();
    return w.terminate().then(function () { /* stopped */ }, function () { /* already gone */ }).then(function () { folders.forEach(removePartFiles); });
  }

  /** Tells a running worker to drop a run; nothing happens (and no worker starts) when none runs. */
  function forget(runId) {
    if (!worker) return Promise.resolve();
    return request('forget', { runId: runId }).then(function () { /* gone */ }, function () { /* the worker is gone already */ });
  }

  function dispose() { return cancel(); }
  function newRunId() { return 'run' + (++runSeq) + '-' + Date.now().toString(36); }

  return { request: request, forget: forget, cancel: cancel, dispose: dispose, newRunId: newRunId, isRunning: function () { return !!worker; } };
}

module.exports = { createClient, Cancelled, WORKER_FILE, removePartFiles };
