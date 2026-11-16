'use strict';
// Child process of the large-file tests: writes a file of invented messages, de-identifies it the
// way the folder command does (the engine in the worker thread, this process playing the extension
// host), verifies the output from disk and prints one JSON line with the measurements, among them
// the longest time the host thread was blocked (a timer that fires every 10 ms).
//   node test/helpers/large-run.js <hl7|x12|ndjson|bundle> <megabytes> <scratch-folder> [worker-heap-megabytes]

const fs = require('node:fs');
const path = require('node:path');
const gen = require('./large-gen');
const { createClient } = require('../../src/worker/client');

function writeBundle(file, megabytes) {
  const fd = fs.openSync(file, 'w');
  let written = 0, n = 0;
  fs.writeSync(fd, '{"resourceType":"Bundle","type":"collection","entry":[');
  while (written < megabytes * 1000 * 1000) {
    let block = '';
    for (let k = 0; k < 200; k++, n++) {
      const resources = gen.ndjson(n).split('\n').filter(Boolean);
      for (const r of resources) block += (n === 0 && !block ? '' : ',') + '{"resource":' + r + '}';
    }
    fs.writeSync(fd, block);
    written += Buffer.byteLength(block);
  }
  fs.writeSync(fd, ']}');
  fs.closeSync(fd);
  return { messages: n, bytes: fs.statSync(file).size };
}

async function main() {
  const format = process.argv[2];
  const megabytes = Number(process.argv[3]);
  const dir = process.argv[4];
  const heapMB = process.argv[5] ? Number(process.argv[5]) : undefined;
  const input = path.join(dir, 'in');
  fs.mkdirSync(input, { recursive: true });
  const name = 'large-in.' + (format === 'ndjson' ? 'ndjson' : format === 'x12' ? 'x12' : format === 'bundle' ? 'json' : 'hl7');
  const made = format === 'bundle' ? writeBundle(path.join(input, name), megabytes) : gen.writeLarge(format, path.join(input, name), megabytes * 1000 * 1000);
  const client = createClient({ heapMB: heapMB });
  const runId = client.newRunId();
  await client.request('createRun', { runId: runId, mode: 'pseudonym', options: { recordMap: true }, rulesText: '' });
  let peakRss = 0, peakHeap = 0, last = Date.now(), maxBlock = 0, verifyStart = 0;
  const timer = setInterval(function () {
    const now = Date.now();
    maxBlock = Math.max(maxBlock, now - last);
    last = now;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 10);
  const t0 = Date.now();
  const done = await client.request('runFiles', { runId: runId, folder: input, outDir: path.join(dir, 'out') }, {
    onProgress: function (p) {
      if (p.heapMB) peakHeap = Math.max(peakHeap, p.heapMB);
      if (p.phase === 'verify' && !verifyStart) verifyStart = Date.now();
    }
  });
  const end = Date.now();
  clearInterval(timer);
  maxBlock = Math.max(maxBlock, end - last);
  const entry = done.files[0] || {};
  const outFile = path.join(dir, 'out', name);
  const v = done.verification;
  const out = {
    format: format, inputBytes: made.bytes, messages: made.messages, ok: entry.status === 'written', changed: entry.changed || 0, outputBytes: fs.existsSync(outFile) ? fs.statSync(outFile).size : 0,
    seconds: Math.round(((verifyStart || end) - t0) / 100) / 10, verifySeconds: verifyStart ? Math.round((end - verifyStart) / 100) / 10 : 0, peakRssMB: Math.round(peakRss / 1048576), peakHeapMB: peakHeap,
    maxHostBlockMs: maxBlock, verification: { pass: v.pass, findings: v.originalValues + v.patterns + v.fields, incomplete: !!v.incomplete }, reason: entry.reason
  };
  await client.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(JSON.stringify(out) + '\n');
}

main().catch(function (e) { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
