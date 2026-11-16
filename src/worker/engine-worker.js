'use strict';
// The engine in a worker thread. The editor's extension host runs every extension on one thread, so
// a de-identification that works for seconds would freeze them all; here it runs beside the host
// and answers with plain data. The worker keeps the runs (key, registry of replaced values, date
// offsets) so that the verification and the map export of a run can ask for them later, and forgets
// a run when told to. Nothing here touches the editor.

const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const v8 = require('node:v8');
const engine = require('../core/engine');
const files = require('../core/files');
const V = require('../core/verify');
const K = require('../core/keyed');
const { createRun } = require('../core/run');
const rulesModule = require('../pro/rules');
const { mapCsv } = require('../report');

const runs = new Map();
const MAX_HITS = 20000;
const PROGRESS_MS = 150;

function send(message) { parentPort.postMessage(message); }
function runOf(id) {
  const r = runs.get(id);
  if (!r) throw new Error('the result of that run is no longer in memory. Run the de-identification again.');
  return r;
}
function progressFor(id) {
  let last = 0;
  return function (data, force) {
    const now = Date.now();
    if (!force && now - last < PROGRESS_MS) return;
    last = now;
    send({ id: id, progress: Object.assign({ heapMB: Math.round(v8.getHeapStatistics().used_heap_size / 1048576) }, data) });
  };
}

/**
 * Places that the rule file left as they are although the built-in profile would have replaced them (found by the
 * verification with the rules switched off) count as kept by the rules, so that the run says so whatever the kind of the rule.
 */
function applyRuleLeftovers(stats, total) {
  const paths = total.leftPaths instanceof Map ? Array.from(total.leftPaths) : [];
  total.leftPaths = paths;
  if (!stats || !(total.leftByRules > 0)) return;
  if (total.leftByRules > (stats.keptByRule || 0)) stats.keptByRule = total.leftByRules;
  for (const [p, n] of paths) {
    let covered = false;
    for (const k of stats.keptPaths.keys()) if (p === k || p.indexOf(k + '.') === 0) { covered = true; break; }
    if (!covered && stats.keptPaths.size < 500) stats.keptPaths.set(p, n);
  }
}

const handlers = {
  /** Creates a run. mode, seed (text) or keyHex, options, rulesText (a rule file's text, parsed here). */
  createRun: function (m) {
    let userRules = null;
    let rules = null;
    if (m.rulesText) {
      const parsed = rulesModule.parseRules(m.rulesText);
      if (!parsed.ok) return { rulesErrors: parsed.errors };
      userRules = parsed.rules;
      rules = { count: parsed.count, keepCount: parsed.keepCount, takeoverCount: parsed.takeoverCount };
    }
    const key = m.keyHex ? Buffer.from(m.keyHex, 'hex') : m.seed ? K.keyFromSeed(m.seed) : K.randomKey();
    const run = createRun({ mode: m.mode, key: key, options: m.options, userRules: userRules });
    runs.set(m.runId, { run: run, verifier: null });
    return { rules: rules };
  },

  /** Processes a text. scanOnly counts and collects the places of the hits; verify checks the result. */
  processText: function (m) {
    const { run } = runOf(m.runId);
    const hits = [];
    const seen = new Set();
    const options = { format: m.format };
    if (m.scanOnly) {
      options.scanOnly = true;
      options.onHit = function (h, category) {
        if (!m.collectHits || hits.length >= MAX_HITS) return;
        const key = h.line + '|' + h.path + '|' + category;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({ line: h.line, path: h.path, category: category });
      };
    }
    const result = engine.processText(m.text, run, options);
    const out = { ok: result.ok, reason: result.reason, message: result.message, format: result.format, changed: result.changed, units: result.units, hits: hits, stats: run.snapshotStats(), mapIncomplete: run.isEntriesFull() };
    if (!result.ok) return out;
    if (!m.scanOnly) out.text = result.text;
    if (m.verify && !m.scanOnly && result.changed) {
      const verifier = V.createVerifier(run);
      const total = V.newTotal();
      const one = verifier.check(result.text, result.format);
      V.combine(total, one, '');
      total.paths = Array.from(total.paths.values()).sort(function (a, b) { return b.count - a.count; });
      total.pass = one.pass;
      applyRuleLeftovers(out.stats, total);
      out.verification = total;
    }
    return out;
  },

  /** Verifies a text against a run. */
  verifyText: function (m) {
    const { run } = runOf(m.runId);
    const verifier = V.createVerifier(run);
    const total = V.newTotal();
    const one = verifier.check(m.text, m.format);
    V.combine(total, one, '');
    total.paths = Array.from(total.paths.values()).sort(function (a, b) { return b.count - a.count; });
    total.pass = one.pass;
    total.leftPaths = Array.from(total.leftPaths);
    return { verification: total };
  },

  /** A folder run or a run over selected files, then the verification of the copies read back from disk. */
  runFiles: async function (m) {
    const { run } = runOf(m.runId);
    const report = progressFor(m.id);
    const list = m.folder ? files.listFiles(m.folder, m.outDir) : m.list;
    const baseDir = m.folder || m.baseDir;
    const done = await files.runFiles(list, baseDir, m.outDir, run, {
      onFile: function (i, total, name) { report({ phase: 'files', done: i + 1, total: total, name: name }, true); },
      onProgress: function (bytes, size) { report({ phase: 'file', bytes: bytes, size: size }); }
    });
    report({ phase: 'verify', done: 0, total: done.files.length }, true);
    const verifier = V.createVerifier(run);
    const total = await files.verifyOutputs(m.outDir, done.files, verifier, { onFile: function (i, count) { report({ phase: 'verify', done: i, total: count }); } });
    const stats = run.snapshotStats();
    applyRuleLeftovers(stats, total);
    const index = run.originalsIndex();
    const nameWarnings = done.files.filter(function (f) {
      const lowName = f.file.split(/[\\/]/).pop().toLowerCase();
      return Array.from(index.names).some(function (t) { return lowName.indexOf(t) !== -1; }) || Array.from(index.ids).some(function (t) { return t.length >= 6 && lowName.indexOf(t) !== -1; });
    }).map(function (f) { return f.file; });
    return { files: done.files, truncated: !!m.folder && list.length >= files.MAX_FILES, nameWarnings: nameWarnings, verification: total, stats: stats, mapIncomplete: run.isEntriesFull() };
  },

  /** Verifies the output files of an earlier run again. */
  verifyOutputs: async function (m) {
    const { run } = runOf(m.runId);
    const report = progressFor(m.id);
    const verifier = V.createVerifier(run);
    const total = await files.verifyOutputs(m.outDir, m.entries, verifier, { onFile: function (i, count) { report({ phase: 'verify', done: i, total: count }); } });
    total.leftPaths = Array.from(total.leftPaths);
    return { verification: total };
  },

  /** Writes the pseudonym map as a CSV file (the originals are in it: only on explicit request). */
  exportMap: function (m) {
    const { run } = runOf(m.runId);
    const exported = run.exportRows();
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(m.target, Buffer.concat([bom, Buffer.from(mapCsv(exported.rows, m.neutralise), 'utf8')]));
    return { rows: exported.rows.length, complete: exported.complete };
  },

  forget: function (m) { runs.delete(m.runId); return {}; },
  ping: function () { return { pong: true }; }
};

function plainError(e) {
  const text = e && e.message ? String(e.message) : '';
  return { message: /^[A-Za-z0-9 ,.:;()'"%\/-]{1,300}$/.test(text) ? text : 'the run could not be completed.', cancelled: !!(e && e.cancelled) };
}

parentPort.on('message', function (m) {
  Promise.resolve().then(function () { return handlers[m.op](m); }).then(
    function (result) { send({ id: m.id, ok: true, result: result }); },
    function (e) { send({ id: m.id, ok: false, error: plainError(e) }); }
  );
});
