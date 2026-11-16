'use strict';
// File and folder processing. Files are read in chunks that end at message boundaries (HL7 messages,
// X12 interchanges, NDJSON lines), so memory stays proportional to one message and not to the file;
// a single FHIR JSON document is read whole (up to MAX_JSON_BYTES). Output goes to a temporary file
// that replaces the target only when the whole file was processed. No editor API is used.

const fs = require('node:fs');
const path = require('node:path');
const engine = require('./engine');

const CHUNK_BYTES = 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 50000;
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn']);

class Cancelled extends Error { constructor() { super('cancelled'); this.cancelled = true; } }
class EncodingChange extends Error {}

function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }

/** UTF-16 text is recognised by its byte order mark only: 'utf16le', 'utf16be' or '' (not UTF-16). */
function utf16Of(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf16le';
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'utf16be';
  return '';
}

/** The bytes of `text` in the encoding of the file it came from. */
function encodeText(text, encoding) {
  if (encoding === 'latin1') return Buffer.from(text, 'latin1');
  if (encoding === 'utf16le') return Buffer.from(text, 'utf16le');
  if (encoding === 'utf16be') return Buffer.from(text, 'utf16le').swap16();
  return Buffer.from(text, 'utf8');
}

/** Text of a whole file and the encoding that was used: UTF-16 with a byte order mark, UTF-8, else Latin-1. */
function decodeFile(buf) {
  const u16 = utf16Of(buf);
  if (u16) return { encoding: u16, text: new TextDecoder(u16 === 'utf16le' ? 'utf-16le' : 'utf-16be', { ignoreBOM: true }).decode(buf) };
  try { return { encoding: 'utf8', text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf) }; } catch (e) { return { encoding: 'latin1', text: buf.toString('latin1') }; }
}

function makeDecoder(encoding) {
  if (encoding === 'utf16le' || encoding === 'utf16be') {
    const td16 = new TextDecoder(encoding === 'utf16le' ? 'utf-16le' : 'utf-16be', { ignoreBOM: true });
    return { decode: function (buf) { return td16.decode(buf, { stream: true }); }, end: function () { return td16.decode(); } };
  }
  if (encoding === 'latin1') return { decode: function (buf) { return buf.toString('latin1'); }, end: function () { return ''; } };
  const td = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  return {
    decode: function (buf) { try { return td.decode(buf, { stream: true }); } catch (e) { throw new EncodingChange(); } },
    end: function () { try { return td.decode(); } catch (e) { throw new EncodingChange(); } }
  };
}

function readSniff(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const n = fs.readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

function sniff(file) {
  const buf = readSniff(file);
  let encoding = 'utf8';
  let text;
  const u16 = utf16Of(buf);
  if (u16) { encoding = u16; text = new TextDecoder(u16 === 'utf16le' ? 'utf-16le' : 'utf-16be', { ignoreBOM: true }).decode(buf, { stream: true }); }
  else { try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf, { stream: true }); } catch (e) { encoding = 'latin1'; text = buf.toString('latin1'); } }
  // text of which every second byte is zero is UTF-16 without a byte order mark
  let zeros = 0;
  for (let i = 0; i < Math.min(buf.length, 4096); i++) if (buf[i] === 0) zeros++;
  return { encoding: encoding, text: text, format: engine.detectFormat(text), utf16WithoutMark: !u16 && buf.length >= 8 && zeros > Math.min(buf.length, 4096) / 4 };
}

// ---- unit boundaries for the chunked formats ------------------------------------------------

function lastHl7Start(text) {
  const re = /(?:^|[\r\n\x0b])(MSH|FHS|BHS|BTS|FTS)(?=[^A-Za-z0-9\s])/g;
  let last = -1, m;
  while ((m = re.exec(text)) !== null) {
    last = m.index + m[0].length - 3;
    if (last > 0 && text.charCodeAt(last - 1) === 0x0b) last--; // the MLLP start byte opens the message
  }
  return last;
}

function x12Cut(text) {
  const units = engine.x12.splitUnits(text).filter(function (u) { return u.kind === 'interchange'; });
  if (units.length < 2) return -1;
  return text.length - units[units.length - 1].text.length;
}

function lastLineBreak(text) {
  // only a line feed ends a line: a carriage return at the end of a piece belongs to the line break that follows
  const i = text.lastIndexOf('\n');
  return i < 0 ? -1 : i + 1;
}

/** Builds the index of Patient lines of an NDJSON file (names and numbers seen for each patient). */
async function ndjsonIndex(file, encoding, opts) {
  const fhir = engine.fhir;
  const fd = fs.openSync(file, 'r');
  const dec = makeDecoder(encoding);
  const buf = Buffer.alloc(CHUNK_BYTES);
  let carry = '';
  const lines = [];
  const merged = new Map();
  function flush() {
    if (!lines.length) return;
    for (const [k, v] of fhir.patientSeenIndex(lines)) merged.set(k, v);
    lines.length = 0;
  }
  try {
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK_BYTES, pos);
      if (n === 0) break;
      pos += n;
      carry += dec.decode(buf.subarray(0, n));
      if (pos === n && carry.charCodeAt(0) === 0xFEFF) carry = carry.slice(1); // the byte order mark is not part of the first line
      const cut = lastLineBreak(carry);
      if (cut > 0) { for (const l of carry.slice(0, cut).split(/\r?\n/)) if (l.indexOf('"Patient"') !== -1) lines.push(l); carry = carry.slice(cut); }
      flush();
      if (opts && opts.isCancelled && opts.isCancelled()) throw new Cancelled();
      await tick();
    }
    carry += dec.end();
    for (const l of carry.split(/\r?\n/)) if (l.indexOf('"Patient"') !== -1) lines.push(l);
    flush();
  } finally { fs.closeSync(fd); }
  return merged;
}

/**
 * Processes one file. Writes `outPath` (through a temporary file) unless `opts.skipUnchanged` is set
 * and nothing was replaced. Returns { ok, format, units, changed, written, bytesIn, reason?, message? }.
 * opts: scanOnly (no output), skipUnchanged, onProgress(bytesDone, bytesTotal), isCancelled(), engine options.
 */
async function processFile(inPath, outPath, run, opts) {
  const o = opts || {};
  const stat = fs.statSync(inPath);
  if (!stat.isFile()) return { ok: false, reason: 'not-a-file', message: 'Not a regular file.' };
  if (stat.size === 0) return { ok: false, reason: 'not-recognised', message: 'The file is empty.' };
  let info = sniff(inPath);
  if (!info.format) {
    return { ok: false, reason: 'not-recognised', message: info.utf16WithoutMark
      ? 'The file looks like UTF-16 text without a byte order mark, which is not supported. Save it as UTF-8, or as UTF-16 with a byte order mark.'
      : 'The file is not recognised as HL7 v2, FHIR JSON or X12.' };
  }
  // A byte that is not UTF-8 after the first look makes the file be read again as Latin-1; what the first
  // pass counted is taken back, so that the statistics of the run count every field once.
  const snapshot = stat.size > SNIFF_BYTES && info.encoding === 'utf8' && run && run.snapshotStats ? run.snapshotStats() : null;
  try {
    return await runFile(inPath, outPath, run, o, info, stat);
  } catch (e) {
    if (e instanceof EncodingChange && info.encoding === 'utf8') {
      if (snapshot) run.restoreStats(snapshot);
      info = Object.assign({}, info, { encoding: 'latin1' });
      return runFile(inPath, outPath, run, o, info, stat);
    }
    throw e;
  }
}

async function runFile(inPath, outPath, run, o, info, stat) {
  const format = info.format;
  const encoding = info.encoding;
  const eo = Object.assign({}, o, { format: format });
  const tmp = o.scanOnly ? null : outPath + '.part-' + process.pid;
  let outFd = null;
  let changed = 0, units = 0, bytesOut = 0;
  const dec = makeDecoder(encoding);
  const buf = Buffer.alloc(CHUNK_BYTES);
  let failure = null;

  function emit(text) {
    if (!outFd) return;
    const b = encodeText(text, encoding);
    fs.writeSync(outFd, b, 0, b.length);
    bytesOut += b.length;
  }
  function process_(text) {
    if (!text) return;
    const r = engine.processText(text, run, eo);
    if (r.ok === false) { failure = r; return; }
    changed += r.changed; units += r.units || 0;
    emit(r.text);
  }

  const fd = fs.openSync(inPath, 'r');
  try {
    if (format === 'fhir' && stat.size > MAX_JSON_BYTES) return { ok: false, format: format, reason: 'too-large', message: 'A single FHIR JSON document larger than ' + Math.round(MAX_JSON_BYTES / 1048576) + ' MB is not read into memory. Split it, or export it as NDJSON (one resource per line).' };
    if (tmp) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); outFd = fs.openSync(tmp, 'w'); }
    if (format === 'fhir') {
      const all = fs.readFileSync(inPath);
      const text = dec.decode(all) + dec.end();
      process_(text);
    } else {
      if (format === 'ndjson' && run.mode === 'pseudonym') eo.patientSeen = await ndjsonIndex(inPath, encoding, o);
      let carry = '';
      let pos = 0;
      for (;;) {
        const n = fs.readSync(fd, buf, 0, CHUNK_BYTES, pos);
        if (n === 0) break;
        pos += n;
        carry += dec.decode(buf.subarray(0, n));
        const cut = format === 'hl7' ? lastHl7Start(carry) : format === 'x12' ? x12Cut(carry) : lastLineBreak(carry);
        if (cut > 0) { process_(carry.slice(0, cut)); carry = carry.slice(cut); }
        if (failure) break;
        if (o.onProgress) o.onProgress(pos, stat.size);
        if (o.isCancelled && o.isCancelled()) throw new Cancelled();
        await tick();
      }
      if (!failure) { carry += dec.end(); process_(carry); }
    }
    if (failure) {
      if (outFd) { fs.closeSync(outFd); outFd = null; fs.rmSync(tmp, { force: true }); }
      return Object.assign({ ok: false, format: format }, failure);
    }
    if (outFd) { fs.closeSync(outFd); outFd = null; }
    let written = false;
    if (tmp) {
      if (o.skipUnchanged && changed === 0) fs.rmSync(tmp, { force: true });
      else { fs.rmSync(outPath, { force: true }); fs.renameSync(tmp, outPath); written = true; }
    }
    return { ok: true, format: format, units: units, changed: changed, written: written, bytesIn: stat.size, bytesOut: bytesOut };
  } catch (e) {
    if (outFd) { try { fs.closeSync(outFd); } catch (e2) { /* closed */ } outFd = null; }
    if (tmp) fs.rmSync(tmp, { force: true });
    throw e;
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* closed */ }
    if (outFd) { try { fs.closeSync(outFd); } catch (e) { /* closed */ } }
  }
}

/** Lists the regular files below `root` (not following links), sorted, skipping `skip` and VCS folders. */
function listFiles(root, skip) {
  const out = [];
  const skipAbs = skip ? path.resolve(skip) : null;
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    for (const ent of entries) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) { if (SKIP_DIRS.has(ent.name) || (skipAbs && path.resolve(full) === skipAbs)) continue; walk(full); }
      else if (ent.isFile()) out.push(full);
    }
  })(root);
  return out;
}

/**
 * De-identifies the given files into outDir, keeping their path relative to baseDir. A file in which
 * nothing was replaced is not written and is reported as unchanged. Returns { files }.
 * opts: onFile(index, total, name), isCancelled(), plus processFile options.
 */
async function runFiles(list, baseDir, outDir, run, opts) {
  const o = opts || {};
  const results = [];
  const used = new Set();
  for (let i = 0; i < list.length; i++) {
    if (o.isCancelled && o.isCancelled()) throw new Cancelled();
    let rel = path.relative(baseDir, list[i]);
    // a file outside the base folder, or a name used twice, is written under its own name with a counter
    if (rel.startsWith('..') || path.isAbsolute(rel)) rel = path.basename(list[i]);
    if (used.has(rel.toLowerCase())) {
      let n = 2;
      const ext = path.extname(rel);
      const stem = rel.slice(0, rel.length - ext.length);
      while (used.has((stem + '-' + n + ext).toLowerCase())) n++;
      rel = stem + '-' + n + ext;
    }
    used.add(rel.toLowerCase());
    if (o.onFile) o.onFile(i, list.length, rel);
    const entry = { file: rel };
    try {
      const r = await processFile(list[i], path.join(outDir, rel), run, Object.assign({}, o, { skipUnchanged: true }));
      if (r.ok) {
        entry.format = r.format; entry.units = r.units; entry.changed = r.changed;
        entry.status = r.written ? 'written' : 'unchanged';
      } else if (r.reason === 'not-recognised' || r.reason === 'not-a-file') { entry.status = 'skipped'; entry.message = r.message; }
      else { entry.status = 'error'; entry.format = r.format; entry.message = r.message; }
    } catch (e) {
      if (e && e.cancelled) throw e;
      entry.status = 'error';
      entry.message = 'The file could not be processed (' + (e && e.code ? e.code : 'unexpected problem') + ').';
    }
    results.push(entry);
    await tick();
  }
  return { files: results };
}

/** De-identifies every recognised file below inDir into outDir (same relative paths). */
async function runFolder(inDir, outDir, run, opts) {
  const list = listFiles(inDir, outDir);
  const result = await runFiles(list, inDir, outDir, run, opts);
  result.truncated = list.length >= MAX_FILES;
  return result;
}

const MAX_VERIFY_BYTES = 64 * 1024 * 1024;

/**
 * Reads the files that a run wrote (from disk, not from memory) and checks them with the verifier.
 * Returns the combined total of verify.newTotal(); a file too large to read whole makes it incomplete.
 */
async function verifyOutputs(outDir, entries, verifier, opts) {
  const V = require('./verify');
  const total = V.newTotal();
  let n = 0;
  for (const e of entries) {
    n++;
    if (opts && opts.onFile) opts.onFile(n, entries.length);
    if (e.status !== 'written') continue;
    if (opts && opts.isCancelled && opts.isCancelled()) throw new Cancelled();
    const file = path.join(outDir, e.file);
    const stat = fs.statSync(file);
    if (stat.size > MAX_VERIFY_BYTES) { total.incomplete = true; total.files++; total.failedFiles++; continue; }
    const buf = fs.readFileSync(file);
    let text;
    text = decodeFile(buf).text;
    const format = engine.detectFormat(text) || e.format;
    V.combine(total, verifier.check(text, format), e.file);
    await tick();
  }
  total.paths = Array.from(total.paths.values()).sort(function (x, y) { return y.count - x.count; });
  total.pass = total.originalValues === 0 && total.patterns === 0 && total.fields === 0 && !total.incomplete;
  return total;
}

module.exports = { processFile, runFolder, runFiles, verifyOutputs, listFiles, sniff, Cancelled, CHUNK_BYTES, MAX_JSON_BYTES, MAX_FILES };
