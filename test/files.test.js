'use strict';
// core/files.js: files and folders on disk. Every corpus file gives the same bytes as the engine
// run on the whole text; chunk edges, encodings, line endings, folders, cancellation, temporary
// files, links, duplicate names, the NDJSON patient index and the verification of the output.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRun } = require('../src/core/run');
const engine = require('../src/core/engine');
const files = require('../src/core/files');
const V = require('../src/core/verify');
const samples = require('../src/samples');
const corpus = require('./helpers/corpus');

const CHUNK = files.CHUNK_BYTES;
const KEY = Buffer.alloc(32, 7);
const TMP_BASE = path.join(__dirname, '.tmp');
fs.mkdirSync(TMP_BASE, { recursive: true });
const WORK = fs.mkdtempSync(path.join(TMP_BASE, 'files-'));
test.after(() => {
  fs.rmSync(WORK, { recursive: true, force: true });
  try { fs.rmdirSync(TMP_BASE); } catch (e) { /* other test files still use it */ }
});

const UE = String.fromCharCode(252);   // u with diaeresis
const SNOWMAN = String.fromCharCode(0x2603);
const E_ACUTE = String.fromCharCode(233);
let counter = 0;

function newRun(mode, options) { return createRun({ mode: mode || 'pseudonym', key: KEY, options: options }); }
function freshDir(name) { const d = path.join(WORK, name + '-' + (++counter)); fs.mkdirSync(d, { recursive: true }); return d; }
function put(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function decodeLikeFiles(buf) {
  try { return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf), encoding: 'utf8' }; } catch (e) { return { text: buf.toString('latin1'), encoding: 'latin1' }; }
}
/** The bytes that one engine run on the whole text gives, in the encoding of the input. */
function singleShot(buf, mode, options) {
  const d = decodeLikeFiles(buf);
  const run = newRun(mode, options);
  const r = engine.processText(d.text, run, {});
  assert.equal(r.ok, true, 'the engine accepted the input');
  return { bytes: Buffer.from(r.text, d.encoding === 'latin1' ? 'latin1' : 'utf8'), result: r, run: run };
}
function assertSameBytes(actual, expected, label) {
  if (actual.equals(expected)) return;
  const n = Math.min(actual.length, expected.length);
  let i = 0;
  while (i < n && actual[i] === expected[i]) i++;
  const cut = (b) => JSON.stringify(b.toString('latin1', Math.max(0, i - 40), i + 40));
  assert.fail(label + ': first difference at byte ' + i + ' (actual ' + actual.length + ' bytes, expected ' + expected.length + ' bytes); actual ' + cut(actual) + ' expected ' + cut(expected));
}
function partFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full); else if (/\.part-\d+$/.test(e.name)) out.push(full);
    }
  })(dir);
  return out;
}
function eolCounts(text) {
  return { crlf: (text.match(/\r\n/g) || []).length, lf: (text.match(/(^|[^\r])\n/g) || []).length, cr: (text.match(/\r(?!\n)/g) || []).length };
}
/** Runs processFile and the single-shot engine run and compares everything that must match. */
async function compareFile(inPath, label, mode, options) {
  const out = inPath + '.out';
  const run = newRun(mode, options);
  const r = await files.processFile(inPath, out, run, {});
  assert.equal(r.ok, true, label + ': ' + (r.message || r.reason));
  const buf = fs.readFileSync(inPath);
  const exp = singleShot(buf, mode, options);
  assertSameBytes(fs.readFileSync(out), exp.bytes, label);
  assert.equal(r.changed, exp.result.changed, label + ': changed count');
  assert.equal(r.units, exp.result.units, label + ': units');
  assert.equal(run.stats.total, exp.run.stats.total, label + ': statistics of the run');
  assert.equal(run.entryCount(), exp.run.entryCount(), label + ': entries of the pseudonym map');
  assert.deepEqual(partFiles(path.dirname(out)), [], label + ': no temporary file is left');
  return { run: run, result: r, exp: exp };
}

// ---- builders for inputs larger than the chunk ----------------------------------------------

function letters(n, len) { let s = ''; for (let i = 0; i < len; i++) { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
function pad(n, w) { return String(n).padStart(w, '0'); }
const FAMILY = ['Quillfeather', 'Dravenholt', 'Marisolveth', 'Thornwhistle', 'Lindqvarn', 'Haverbrook', 'Pinkerton', 'Abernethy', 'Gravelmere', 'Kestrelhill'];
const GIVEN = ['Alderiq', 'Odelia', 'Bronwick', 'Selmira', 'Evander', 'Tisbeth', 'Corisande', 'Isidor', 'Maxim', 'Helene'];
function person(i) {
  return {
    family: FAMILY[i % 10] + letters(i, 3), given: GIVEN[(i * 3) % 10] + letters(i * 31 + 5, 2), mrn: 'LG-' + (3000000 + i), acct: 'AC' + (800000 + i),
    ssn: '9' + pad(Math.floor(i / 10000) % 100, 2) + '-' + pad(Math.floor(i / 100) % 100, 2) + '-' + pad(i % 100 + 1000, 4), phone: (300 + Math.floor(i / 10000)) + '-555-' + pad(i % 10000, 4),
    street: (10 + i) + ' Wrenhollow Road', dob: '19' + pad(40 + (i % 50), 2) + pad(1 + (i % 12), 2) + pad(1 + (i % 27), 2)
  };
}
function hl7Message(i, eol, padding) {
  const p = person(i);
  const seg = [
    'MSH|^~\\&|REGSYS|HARBOUR CLINIC|RES|HARBOUR LAB|20261104091530||ADT^A01|MSG' + i + '|P|2.5',
    'EVN|A01|20261104091500',
    'PID|1||' + p.mrn + '^^^HSC^MR~' + p.ssn + '^^^SSA^SS||' + p.family + '^' + p.given + '||' + p.dob + '|M|||' + p.street + '^^Fernbury^OH^43055||' + p.phone + '^PRN^PH|||||' + p.acct + '|' + p.ssn,
    'PV1|1|I|2N^204^A^HSC||||6102257^Thistlewood^Corisande^^^MD',
    'NTE|1||Patient ' + p.family + ' phoned ' + p.phone + '.' + (padding ? ' ' + 'x'.repeat(padding - 1) : ''),
    'OBX|1|TX|N^Note||Kontrolle f' + UE + 'r Herz und Lunge ohne Befund||||||F'
  ];
  for (let k = 0; k < 50 + (i % 11); k++) seg.push('OBX|' + (k + 2) + '|NM|718-7^Hemoglobin^LN||' + (10 + k) + '.8|g/dL|12.0-16.0|N|||F');
  return seg.join(eol) + eol;
}
/** The number of messages whose batch is at least `minBytes` long. */
function hl7CountFor(minBytes, eol) {
  let size = 0, n = 0;
  while (size < minBytes) { size += Buffer.byteLength(hl7Message(n, eol)); n++; }
  return n;
}
function hl7Batch(count, eol, padding) {
  const parts = [];
  for (let i = 0; i < count; i++) parts.push(hl7Message(i, eol, i === 0 ? padding : 0));
  return parts.join('');
}
function x12Interchange(i, eol, padding) {
  const p = person(i);
  const n = pad(i + 1, 9);
  const segs = [
    'ISA*00*          *00*          *ZZ*HARBOURSIDEMED *ZZ*NORTHWAYPAYER  *261104*0930*^*00501*' + n + '*0*P*:',
    'GS*HC*HARBOURSIDEMED*NORTHWAYPAYER*20261104*0930*' + (i + 1) + '*X*005010X222A1',
    'ST*837*0001*005010X222A1',
    'BHT*0019*00*BATCH-' + i + '*20261104*0930*CH',
    'NM1*41*2*HARBOURSIDE MEDICAL GROUP*****46*HM10442',
    'HL*1**20*1',
    'HL*2*1*22*0',
    'SBR*P*18**GRP-HM-2210*****CI',
    'NM1*IL*1*' + p.family.toUpperCase() + '*' + p.given.toUpperCase() + '*M***MI*NWP' + (4000000 + i),
    'N3*' + p.street.toUpperCase(),
    'N4*FERNBURY*OH*43055',
    'DMG*D8*' + p.dob + '*M',
    'REF*SY*' + p.ssn,
    'CLM*ACCT-' + p.acct + '*182.50***11:B:1*Y*A*Y*Y',
    'DTP*431*D8*20261029',
    'NTE*ADD*PATIENT ' + p.family.toUpperCase() + ' ASKED FOR A STATEMENT' + (padding ? ' ' + 'X'.repeat(padding - 1) : '')
  ];
  for (let k = 0; k < 140 + (i % 9); k++) segs.push('AMT*F5*9.5');
  segs.push('SE*' + (segs.length - 1) + '*0001', 'GE*1*' + (i + 1), 'IEA*1*' + n);
  return segs.join('~' + eol) + '~' + eol;
}
function x12CountFor(minBytes, eol) {
  let size = 0, n = 0;
  while (size < minBytes) { size += Buffer.byteLength(x12Interchange(n, eol)); n++; }
  return n;
}
function ndjsonLines(count, eol, padding) {
  const lines = [];
  const longCoding = { coding: [] };
  for (let k = 0; k < 6; k++) longCoding.coding.push({ system: 'http://loinc.org', code: '718-' + k, display: 'Hemoglobin [Mass/volume] in Blood, measured on the routine analyser in the main laboratory ' + k });
  for (let i = 0; i < count; i++) {
    const p = person(i);
    lines.push(JSON.stringify({ resourceType: 'Patient', id: 'p' + i, identifier: [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }] }, system: 'http://harbour.example/ids/mrn', value: p.mrn }],
      name: [{ family: p.family, given: [p.given] }], telecom: [{ system: 'phone', value: p.phone }], birthDate: '19' + p.dob.slice(2, 4) + '-' + p.dob.slice(4, 6) + '-' + p.dob.slice(6, 8), address: [{ line: [p.street], city: 'Fernbury', postalCode: '43055' }] }));
    lines.push(JSON.stringify({ resourceType: 'Observation', id: 'o' + i, status: 'final', category: [longCoding], code: longCoding, subject: { reference: 'Patient/p' + i },
      valueQuantity: { value: 13.8, unit: 'g/dL' }, note: [{ text: 'Reviewed with ' + p.given + ' ' + p.family + ' by phone ' + p.phone + (i === 0 && padding ? ' ' + 'x'.repeat(padding - 1) : '') + '.' }] }));
    lines.push(JSON.stringify({ resourceType: 'Encounter', id: 'e' + i, status: 'finished', class: { code: 'AMB' }, type: [longCoding], subject: { reference: 'Patient/p' + i }, period: { start: '2026-11-04T09:00:00Z', end: '2026-11-04T09:30:00Z' } }));
  }
  return lines.join(eol) + eol;
}
function ndjsonCountFor(minBytes, eol) {
  let n = 100;
  while (Buffer.byteLength(ndjsonLines(n, eol)) < minBytes) n += 100;
  return n;
}
function bundleText(count) {
  const entry = [];
  for (let i = 0; i < count; i++) {
    const p = person(i);
    entry.push({ fullUrl: 'urn:uuid:00000000-0000-4000-8000-' + pad(i, 12), resource: { resourceType: 'Patient', id: 'b' + i, name: [{ family: p.family, given: [p.given] }], telecom: [{ system: 'phone', value: p.phone }], birthDate: '1980-02-03', address: [{ line: [p.street], city: 'Fernbury' }] } });
    const coding = [];
    for (let k = 0; k < 40; k++) coding.push({ system: 'http://loinc.org', code: '718-' + k, display: 'Hemoglobin [Mass/volume] in Blood, measured on the routine analyser in the main laboratory ' + k });
    entry.push({ fullUrl: 'urn:uuid:00000000-0000-4000-9000-' + pad(i, 12), resource: { resourceType: 'Observation', id: 'bo' + i, status: 'final', code: { coding: coding }, subject: { reference: 'urn:uuid:00000000-0000-4000-8000-' + pad(i, 12) }, note: [{ text: 'Call ' + p.given + ' ' + p.family + ' on ' + p.phone }] } });
  }
  return JSON.stringify({ resourceType: 'Bundle', type: 'collection', entry: entry }, null, 2) + '\n';
}

/** Shifts a build so that a structure found in the unpadded build sits exactly at `wantIndex`. */
function aligned(build, find, wantIndex) {
  const idx = find(Buffer.from(build(0), 'utf8'));
  assert.ok(idx >= 0 && idx <= wantIndex, 'a structure exists before the wanted position');
  const text = build(wantIndex - idx);
  return { text: text, buf: Buffer.from(text, 'utf8') };
}

// ---- 1. every corpus file --------------------------------------------------------------------

for (const entry of corpus.manifest.files) {
  test('corpus ' + entry.file + ': processFile writes the bytes of the engine run (pseudonym and mask)', async () => {
    const dir = freshDir('corpus');
    for (const mode of ['pseudonym', 'mask']) {
      const inPath = put(dir, mode + '-' + path.basename(entry.file), fs.readFileSync(path.join(corpus.ROOT, entry.file)));
      const got = await compareFile(inPath, entry.file + ' (' + mode + ')', mode);
      assert.equal(got.result.written, true);
      if (entry.format === 'hl7' || entry.format === 'x12') assert.ok(got.result.units >= entry.messages && got.result.units <= entry.messages + 2, 'messages plus at most a file and a batch header: ' + got.result.units);
    }
  });
}

for (const entry of corpus.manifest.invalid) {
  test('invalid corpus file ' + entry.file + ': no crash, no output for a refusal, no temporary file', async () => {
    const dir = freshDir('invalid');
    const inPath = put(dir, path.basename(entry.file), fs.readFileSync(path.join(corpus.ROOT, entry.file)));
    const out = path.join(dir, 'out', path.basename(entry.file));
    const r = await files.processFile(inPath, out, newRun(), {});
    if (entry.expect === 'not-recognised') {
      assert.equal(r.ok, false);
      assert.equal(fs.existsSync(out), false, 'a refused file writes nothing');
    }
    assert.deepEqual(partFiles(dir), []);
    if (r.ok === false) assert.ok(typeof r.message === 'string' && r.message.length > 5);
  });
}

test('the whole corpus folder: written, skipped and error entries add up and the verification passes', async () => {
  const out = freshDir('corpus-folder');
  const run = newRun();
  const r = await files.runFolder(corpus.ROOT, path.join(out, 'masked'), run, {});
  const by = {};
  for (const e of r.files) by[e.status] = (by[e.status] || 0) + 1;
  assert.equal(by.written, corpus.manifest.files.length + 4, 'the corpus files and the four invalid files that are still recognisable');
  assert.equal(by.error, 1, 'only the file with the broken JSON is an error');
  assert.equal(by.skipped, 8, 'seven unrecognised invalid files and the manifest');
  assert.equal(r.files.length, by.written + by.skipped + by.error);
  assert.equal(r.truncated, false);
  const total = await files.verifyOutputs(path.join(out, 'masked'), r.files, V.createVerifier(run), {});
  assert.equal(total.pass, true, 'verification: ' + total.originalValues + ' values, ' + total.patterns + ' patterns, ' + total.fields + ' fields');
  assert.equal(total.files, by.written);
  assert.deepEqual(partFiles(out), []);
});

test('scanOnly counts like the engine and writes nothing', async () => {
  const dir = freshDir('scan');
  const inPath = put(dir, 'a.hl7', samples.sampleFor('hl7').text);
  const out = path.join(dir, 'out', 'a.hl7');
  const run = newRun();
  const r = await files.processFile(inPath, out, run, { scanOnly: true });
  assert.equal(r.ok, true);
  assert.equal(r.written, false);
  assert.equal(fs.existsSync(path.dirname(out)), false, 'not even the output folder is made');
  const expRun = newRun();
  engine.processText(samples.sampleFor('hl7').text, expRun, { scanOnly: true });
  assert.equal(run.stats.total, expRun.stats.total);
  assert.ok(run.stats.total > 10);
  assert.equal(run.entryCount(), 0, 'a scan keeps no values');
});

test('processFile refuses a folder, an empty file and an unrecognised file with a reason', async () => {
  const dir = freshDir('refuse');
  const a = await files.processFile(dir, path.join(dir, 'x'), newRun(), {});
  assert.deepEqual([a.ok, a.reason], [false, 'not-a-file']);
  const b = await files.processFile(put(dir, 'empty.hl7', ''), path.join(dir, 'o1'), newRun(), {});
  assert.deepEqual([b.ok, b.reason], [false, 'not-recognised']);
  const c = await files.processFile(put(dir, 'note.txt', 'just a few words about nothing'), path.join(dir, 'o2'), newRun(), {});
  assert.deepEqual([c.ok, c.reason], [false, 'not-recognised']);
  assert.equal(fs.existsSync(path.join(dir, 'o1')) || fs.existsSync(path.join(dir, 'o2')), false);
});

// ---- 2. chunk edges --------------------------------------------------------------------------

for (const [label, eol] of [['LF', '\n'], ['CR', '\r'], ['CRLF', '\r\n']]) {
  test('HL7 batch above two chunks with ' + label + ' terminators: messages straddle both chunk edges and the bytes match the single run', async () => {
    const dir = freshDir('hl7big');
    const count = hl7CountFor(2 * CHUNK + 30000, eol);
    const buf = Buffer.from(hl7Batch(count, eol), 'utf8');
    assert.ok(buf.length > 2 * CHUNK + 1000, 'the file is larger than two chunks (' + buf.length + ' bytes)');
    const starts = [];
    for (let at = buf.indexOf('MSH|'); at !== -1; at = buf.indexOf('MSH|', at + 4)) starts.push(at);
    for (const k of [1, 2]) assert.ok(!starts.includes(k * CHUNK) && starts.some((s) => s < k * CHUNK) && starts.some((s) => s > k * CHUNK), 'edge ' + k + ' is inside a message');
    const got = await compareFile(put(dir, 'batch.hl7', buf), 'HL7 ' + label);
    assert.equal(got.result.units, count);
  });
}

test('HL7: the chunk edge falls exactly on the first byte of a message', async () => {
  const dir = freshDir('hl7edge');
  const count = hl7CountFor(CHUNK + 120000, '\n');
  const a = aligned((p) => hl7Batch(count, '\n', p), (b) => b.lastIndexOf('MSH|', CHUNK), CHUNK);
  assert.equal(a.buf.indexOf('MSH|', CHUNK), CHUNK, 'a message starts at the first byte of the second chunk');
  const got = await compareFile(put(dir, 'edge.hl7', a.buf), 'HL7 edge at message start');
  assert.equal(got.result.units, count);
});

test('HL7 with CRLF: the chunk edge falls between the CR and the LF of a segment terminator', async () => {
  const dir = freshDir('hl7crlf');
  const count = hl7CountFor(CHUNK + 120000, '\r\n');
  const a = aligned((p) => hl7Batch(count, '\r\n', p), (b) => b.lastIndexOf('\r\n', CHUNK - 1) + 1, CHUNK);
  assert.equal(a.buf[CHUNK - 1], 13);
  assert.equal(a.buf[CHUNK], 10);
  const got = await compareFile(put(dir, 'crlf.hl7', a.buf), 'HL7 edge between CR and LF');
  assert.equal(got.result.units, count);
});

test('HL7 in UTF-8: a two-byte letter is cut by the chunk edge and still read as one letter', async () => {
  const dir = freshDir('hl7utf');
  const count = hl7CountFor(CHUNK + 120000, '\r');
  const a = aligned((p) => hl7Batch(count, '\r', p), (b) => b.lastIndexOf(Buffer.from([0xC3, 0xBC]), CHUNK - 1), CHUNK - 1);
  assert.equal(a.buf[CHUNK - 1], 0xC3);
  assert.equal(a.buf[CHUNK], 0xBC);
  const inPath = put(dir, 'cut.hl7', a.buf);
  const got = await compareFile(inPath, 'HL7 edge inside a letter');
  assert.ok(fs.readFileSync(inPath + '.out').includes(Buffer.from('Kontrolle f' + UE + 'r Herz', 'utf8')), 'untouched text keeps its UTF-8 letters');
  assert.equal(got.result.units, count);
});

test('HL7 with batch headers and trailers (FHS, BHS, BTS, FTS) matches the single run', async () => {
  const dir = freshDir('hl7batch');
  const count = hl7CountFor(CHUNK + 120000, '\r');
  const text = ['FHS|^~\\&|REGSYS|HARBOUR CLINIC|RES|HARBOUR LAB|20261104||FILE1|FC1', 'BHS|^~\\&|REGSYS|HARBOUR CLINIC|RES|HARBOUR LAB|20261104||BATCH1|BC1'].join('\r') + '\r' +
    hl7Batch(count, '\r') + ['BTS|' + count, 'FTS|1'].join('\r') + '\r';
  const buf = Buffer.from(text, 'utf8');
  assert.ok(buf.length > CHUNK);
  const got = await compareFile(put(dir, 'wrapped.hl7', buf), 'HL7 with wrappers');
  assert.equal(got.result.units, count + 2, 'the messages and the two headers');
});

test('HL7 with a byte order mark above one chunk: the mark stays and every message is processed', async () => {
  const dir = freshDir('hl7bom');
  const count = hl7CountFor(CHUNK + 120000, '\r');
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(hl7Batch(count, '\r'), 'utf8')]);
  const inPath = put(dir, 'bom.hl7', buf);
  const got = await compareFile(inPath, 'HL7 with BOM');
  const out = fs.readFileSync(inPath + '.out');
  assert.deepEqual([...out.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'the byte order mark is kept');
  assert.equal(got.result.units, count);
  assert.equal(out.toString('utf8').indexOf(person(0).family), -1, 'the first message, which follows the mark, is de-identified too');
});

for (const [label, eol, big] of [['LF', '\n', true], ['CRLF', '\r\n', false], ['no line break', '', false]]) {
  test('X12 file with many interchanges (' + label + ' after each segment) matches the single run', async () => {
    const dir = freshDir('x12big');
    const count = x12CountFor((big ? 2 * CHUNK + 30000 : CHUNK + 120000), eol);
    const buf = Buffer.from(Array.from({ length: count }, (_, i) => x12Interchange(i, eol)).join(eol), 'utf8');
    assert.ok(buf.length > (big ? 2 * CHUNK : CHUNK), 'larger than the chunks: ' + buf.length);
    const got = await compareFile(put(dir, 'many.x12', buf), 'X12 ' + label);
    assert.equal(got.result.units, count);
  });
}

for (const inside of [10, 106]) {
  test('X12: the chunk edge falls ' + inside + ' bytes into the ISA segment of an interchange', async () => {
    const dir = freshDir('x12isa');
    const count = x12CountFor(CHUNK + 120000, '\n');
    const build = (p) => Array.from({ length: count }, (_, i) => x12Interchange(i, '\n', i === 0 ? p : 0)).join('');
    const a = aligned(build, (b) => b.lastIndexOf('ISA*00*', CHUNK - inside), CHUNK - inside);
    assert.equal(a.buf.toString('latin1', CHUNK - inside, CHUNK - inside + 3), 'ISA');
    const got = await compareFile(put(dir, 'isa.x12', a.buf), 'X12 edge ' + inside + ' bytes into ISA');
    assert.equal(got.result.units, count);
  });
}

test('X12: one interchange larger than a chunk is read to its end', async () => {
  const dir = freshDir('x12one');
  const head = x12Interchange(0, '\n').split('\n').slice(0, 7).join('\n') + '\n';
  const loops = [];
  for (let i = 1; i < 300; i++) {
    const p = person(i);
    loops.push('HL*' + (i + 2) + '*1*22*0~', 'NM1*IL*1*' + p.family.toUpperCase() + '*' + p.given.toUpperCase() + '*M***MI*NWP' + (5000000 + i) + '~', 'N3*' + p.street.toUpperCase() + '~', 'DMG*D8*' + p.dob + '*M~', 'REF*SY*' + p.ssn + '~');
    for (let k = 0; k < 340; k++) loops.push('AMT*F5*9.5~');
  }
  const tail = 'SE*30000*0001~\nGE*1*1~\nIEA*1*000000001~\n';
  const buf = Buffer.from(head + loops.join('\n') + '\n' + tail, 'utf8');
  assert.ok(buf.length > CHUNK + 100000, 'larger than a chunk: ' + buf.length);
  const got = await compareFile(put(dir, 'one.x12', buf), 'X12 single interchange');
  assert.equal(got.result.units, 1);
});

for (const [label, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test('NDJSON above a chunk (' + label + '): Patient, Observation and Encounter lines match the single run', async () => {
    const dir = freshDir('nd');
    const count = ndjsonCountFor(CHUNK + 100000, eol);
    const buf = Buffer.from(ndjsonLines(count, eol), 'utf8');
    const got = await compareFile(put(dir, 'all.ndjson', buf), 'NDJSON ' + label);
    assert.equal(got.result.units, 3 * count);
    assert.equal(fs.readFileSync(path.join(dir, 'all.ndjson.out'), 'utf8').split(eol).length, 3 * count + 1, 'same number of lines');
  });
}

test('NDJSON with CRLF: the chunk edge falls between the CR and the LF of a line break', async () => {
  const dir = freshDir('ndcrlf');
  const count = ndjsonCountFor(CHUNK + 100000, '\r\n');
  const a = aligned((p) => ndjsonLines(count, '\r\n', p), (b) => b.lastIndexOf('\r\n', CHUNK - 1) + 1, CHUNK);
  assert.equal(a.buf[CHUNK - 1], 13);
  assert.equal(a.buf[CHUNK], 10);
  const inPath = put(dir, 'edge.ndjson', a.buf);
  await compareFile(inPath, 'NDJSON edge between CR and LF');
  assert.equal(/[^\r]\n/.test(fs.readFileSync(inPath + '.out', 'latin1')), false, 'every line break is still CR LF');
});

test('one FHIR Bundle above a chunk is read whole and matches the single run; the references stay intact', async () => {
  const dir = freshDir('bundle');
  let n = 100;
  while (Buffer.byteLength(bundleText(n)) < CHUNK + 100000) n += 50;
  const inPath = put(dir, 'bundle.json', bundleText(n));
  const got = await compareFile(inPath, 'FHIR Bundle');
  const doc = JSON.parse(fs.readFileSync(inPath + '.out', 'utf8'));
  assert.equal(doc.entry.length, 2 * n);
  const urls = new Set(doc.entry.map((e) => e.fullUrl));
  assert.equal(urls.size, 2 * n, 'the new addresses are still distinct');
  for (const e of doc.entry) if (e.resource.resourceType === 'Observation') assert.ok(urls.has(e.resource.subject.reference), 'the subject still points to an entry');
  assert.ok(got.result.changed > 2 * n);
});

test('progress goes up in steps and ends at the size of the file', async () => {
  const dir = freshDir('progress');
  const inPath = put(dir, 'p.hl7', hl7Batch(hl7CountFor(CHUNK + 50000, '\r'), '\r'));
  const size = fs.statSync(inPath).size;
  const seen = [];
  await files.processFile(inPath, inPath + '.out', newRun('mask'), { onProgress: (done, total) => seen.push([done, total]) });
  assert.ok(seen.length >= 2);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] > seen[i - 1][0]);
  assert.deepEqual(seen[seen.length - 1], [size, size]);
});

// ---- 3. encodings and line endings -----------------------------------------------------------

test('a Latin-1 file (bytes 0x80-0xFF) keeps every untouched byte and is written back as Latin-1', async () => {
  const dir = freshDir('latin');
  const note = Buffer.from('caf\xE9 cr\xE8me \xA9 2026 \xB0C \xFF', 'latin1');
  const buf = Buffer.concat([
    Buffer.from('MSH|^~\\&|REGSYS|HARBOUR CLINIC|RES|HARBOUR LAB|20261104091530||ADT^A01|MSG1|P|2.5\rPID|1||MR-771204^^^HSC^MR||M\xFCller^Hans||19700101|M|||5 Wren Road^^Fernbury^OH^43055||614-555-0187\rOBX|1|TX|N^Note||', 'latin1'),
    note, Buffer.from('||||||F\r', 'latin1')]);
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(buf), 'the input is not valid UTF-8');
  const inPath = put(dir, 'latin.hl7', buf);
  const r = await files.processFile(inPath, inPath + '.out', newRun(), {});
  assert.equal(r.ok, true);
  const out = fs.readFileSync(inPath + '.out');
  assert.ok(out.includes(note), 'the untouched bytes are identical');
  assert.equal(out.includes(Buffer.from('M\xFCller', 'latin1')), false, 'the name is replaced');
  assert.equal(out.includes(Buffer.from([0xC3])), false, 'nothing was written as UTF-8');
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(out), 'the output is still Latin-1');
  assertSameBytes(out, singleShot(buf).bytes, 'Latin-1 file');
});

test('a Latin-1 byte in the second chunk: the file is read again as Latin-1, bytes match, the run statistics are counted once', async () => {
  const dir = freshDir('latelatin');
  const early = hl7Batch(hl7CountFor(CHUNK + 30000, '\r'), '\r');
  const late = 'MSH|^~\\&|REGSYS|HARBOUR CLINIC|RES|HARBOUR LAB|20261104091530||ADT^A01|MSGL|P|2.5\rPID|1||MR-1^^^HSC^MR||Late^Person||19700101|M\rOBX|1|TX|N^Note||caf\xE9 au lait||||||F\r';
  const buf = Buffer.concat([Buffer.from(early, 'utf8'), Buffer.from(late, 'latin1')]);
  assert.ok(buf.lastIndexOf(0xE9) > CHUNK + 1000, 'the invalid byte is after the first chunk (and after the 64 KiB look at the start)');
  const inPath = put(dir, 'late.hl7', buf);
  const run = newRun();
  const r = await files.processFile(inPath, inPath + '.out', run, {});
  assert.equal(r.ok, true);
  const exp = singleShot(buf);
  assertSameBytes(fs.readFileSync(inPath + '.out'), exp.bytes, 'late Latin-1 file');
  assert.equal(run.stats.total, exp.run.stats.total, 'every field is counted once in the statistics of the run');
  assert.equal(run.stats.units, exp.run.stats.units, 'every message is counted once');
  assert.equal(run.entryCount(), exp.run.entryCount());
  assert.deepEqual(partFiles(dir), []);
});

test('a UTF-8 letter cut by the 64 KiB look at the start of the file is not mistaken for Latin-1', async () => {
  const dir = freshDir('sniffedge');
  const first = hl7Message(0, '\r');
  const opening = 'MSH|^~\\&|REGSYS|HARBOUR CLINIC|RES|HARBOUR LAB|20261104091530||ADT^A01|MSG77|P|2.5\rPID|1||MR-77^^^HSC^MR||Straddle^Person||19700101|M\rOBX|1|TX|N^Note||';
  const filler = 65535 - (Buffer.byteLength(first, 'utf8') + Buffer.byteLength(opening, 'utf8'));
  assert.ok(filler > 0);
  const buf = Buffer.from(first + opening + 'a'.repeat(filler) + UE + 'ber||||||F\r' + hl7Batch(30, '\r'), 'utf8');
  assert.equal(buf[65535], 0xC3);
  assert.equal(buf[65536], 0xBC);
  const inPath = put(dir, 'edge.hl7', buf);
  const r = await files.processFile(inPath, inPath + '.out', newRun(), {});
  assert.equal(r.ok, true);
  const out = fs.readFileSync(inPath + '.out');
  assert.ok(out.includes(Buffer.from(UE + 'ber||||||F', 'utf8')), 'still UTF-8');
  assertSameBytes(out, singleShot(buf).bytes, 'sniff edge');
});

test('a UTF-8 byte order mark is kept for every format and the first message is processed', async () => {
  const dir = freshDir('bom');
  const inputs = {
    hl7: [samples.sampleFor('hl7').text, 'Larkspur'], x12: [samples.sampleFor('x12').text, 'LARKSPUR'], fhir: [samples.sampleFor('fhir').text, 'Larkspur'], ndjson: [ndjsonLines(3, '\n'), person(0).family]
  };
  for (const [name, [text, original]] of Object.entries(inputs)) {
    const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
    const inPath = put(dir, 'bom-' + name + '.txt', buf);
    const r = await files.processFile(inPath, inPath + '.out', newRun(), {});
    assert.equal(r.ok, true, name + ': ' + (r.message || ''));
    const out = fs.readFileSync(inPath + '.out');
    assert.deepEqual([...out.subarray(0, 3)], [0xEF, 0xBB, 0xBF], name + ': the mark is kept');
    assert.notDeepEqual([...out.subarray(3, 6)], [0xEF, 0xBB, 0xBF], name + ': the mark is not doubled');
    assert.ok(r.changed > 5, name + ': the first message is processed');
    assert.equal(out.toString('utf8').includes(original), false, name + ': the first message holds no original name');
  }
});

for (const eol of ['\n', '\r\n']) {
  test('line endings ' + JSON.stringify(eol) + ' are kept in X12, FHIR and NDJSON', async () => {
    const dir = freshDir('eol');
    const sets = { x12: samples.sampleFor('x12').text.replace(/\n/g, eol), fhir: samples.sampleFor('fhir').text.replace(/\n/g, eol), ndjson: ndjsonLines(4, eol) };
    for (const [name, text] of Object.entries(sets)) {
      const inPath = put(dir, name + '.txt', text);
      const r = await files.processFile(inPath, inPath + '.out', newRun(), {});
      assert.equal(r.ok, true, name);
      assert.deepEqual(eolCounts(fs.readFileSync(inPath + '.out', 'latin1')), eolCounts(text), name + ': line endings');
    }
  });
}

for (const eol of ['\r', '\n', '\r\n']) {
  test('HL7 with ' + JSON.stringify(eol) + ' terminators keeps them', async () => {
    const dir = freshDir('hl7eol');
    const text = hl7Batch(3, eol);
    const inPath = put(dir, 'e.hl7', text);
    const r = await files.processFile(inPath, inPath + '.out', newRun(), {});
    assert.equal(r.ok, true);
    assert.deepEqual(eolCounts(fs.readFileSync(inPath + '.out', 'latin1')), eolCounts(text));
  });
}

// ---- 4. folders: unchanged, skipped, error ---------------------------------------------------

function mixedFolder() {
  const dir = freshDir('mixed');
  put(dir, 'a.hl7', samples.sampleFor('hl7').text);
  put(dir, 'sub/b.x12', samples.sampleFor('x12').text);
  put(dir, 'sub/deeper/c.json', samples.sampleFor('fhir').text);
  put(dir, 'nothing.json', '{"resourceType":"Observation","status":"final","valueString":"normal"}\n');
  put(dir, 'notes.txt', 'Reminder: order more gloves and call the supplier.\n');
  put(dir, 'empty.hl7', '');
  put(dir, 'blob.bin', Buffer.from([0, 255, 254, 3, 0, 9, 200, 100]));
  put(dir, 'broken.json', '{"resourceType":"Patient","name":[{"family":"ZEBEDEE-SECRET","given":["TOPSECRETGIVEN"] "oops":"SECRETTAIL"}]}');
  return dir;
}

test('runFolder: a file with nothing recognised is not written and is listed unchanged; other files are skipped or errors', async () => {
  const dir = mixedFolder();
  const out = path.join(freshDir('mixed-out'), 'masked');
  const r = await files.runFolder(dir, out, newRun(), {});
  const byFile = {};
  for (const e of r.files) byFile[e.file.replace(/\\/g, '/')] = e;
  assert.equal(byFile['a.hl7'].status, 'written');
  assert.equal(byFile['sub/b.x12'].status, 'written');
  assert.equal(byFile['sub/deeper/c.json'].status, 'written');
  assert.equal(byFile['nothing.json'].status, 'unchanged');
  assert.equal(byFile['nothing.json'].changed, 0);
  assert.equal(byFile['notes.txt'].status, 'skipped');
  assert.equal(byFile['empty.hl7'].status, 'skipped');
  assert.equal(byFile['blob.bin'].status, 'skipped');
  assert.equal(byFile['broken.json'].status, 'error');
  assert.equal(fs.existsSync(path.join(out, 'nothing.json')), false, 'the unchanged file was not copied');
  for (const gone of ['notes.txt', 'empty.hl7', 'blob.bin', 'broken.json']) assert.equal(fs.existsSync(path.join(out, gone)), false, gone + ' was not written');
  for (const kept of ['a.hl7', path.join('sub', 'b.x12'), path.join('sub', 'deeper', 'c.json')]) assert.ok(fs.existsSync(path.join(out, kept)), kept + ' was written');
  assert.deepEqual(partFiles(out), []);
});

test('an invalid JSON file is an error whose message holds no text of the file', async () => {
  const dir = mixedFolder();
  const out = path.join(freshDir('err-out'), 'masked');
  const r = await files.runFolder(dir, out, newRun(), {});
  const e = r.files.find((x) => x.file === 'broken.json');
  assert.equal(e.status, 'error');
  assert.match(e.message, /not valid/i);
  assert.match(e.message, /line \d+/);
  for (const secret of ['ZEBEDEE', 'SECRET', 'TOPSECRETGIVEN', 'oops', 'resourceType']) assert.ok(!e.message.includes(secret), 'message does not hold "' + secret + '"');
  const direct = await files.processFile(path.join(dir, 'broken.json'), path.join(out, 'x.json'), newRun(), {});
  assert.equal(direct.ok, false);
  assert.equal(direct.reason, 'invalid-json');
  assert.ok(!/SECRET|ZEBEDEE/.test(direct.message));
  assert.deepEqual(partFiles(out), []);
});

test('an output file that cannot be replaced is an error without a path in the message and leaves no temporary file', async () => {
  const dir = freshDir('blocked');
  put(dir, 'in/a.hl7', samples.sampleFor('hl7').text);
  const out = path.join(dir, 'out');
  put(out, 'a.hl7/keep.txt', 'x');   // a folder sits where the file must go
  const r = await files.runFolder(path.join(dir, 'in'), out, newRun(), {});
  assert.equal(r.files[0].status, 'error');
  assert.match(r.files[0].message, /^The file could not be processed \([A-Za-z_0-9]+\)\.$/);
  assert.deepEqual(partFiles(dir), []);
  await assert.rejects(() => files.processFile(path.join(dir, 'in', 'a.hl7'), path.join(out, 'a.hl7'), newRun(), {}));
  assert.deepEqual(partFiles(dir), [], 'a failed write removes its temporary file');
});

test('the output folder inside the input folder is not read again', async () => {
  const dir = freshDir('inside');
  put(dir, 'a.hl7', samples.sampleFor('hl7').text);
  put(dir, 'sub/b.x12', samples.sampleFor('x12').text);
  const out = path.join(dir, 'masked');
  const first = await files.runFolder(dir, out, newRun(), {});
  assert.deepEqual(first.files.map((f) => f.file.replace(/\\/g, '/')).sort(), ['a.hl7', 'sub/b.x12']);
  const second = await files.runFolder(dir, out, newRun(), {});
  assert.deepEqual(second.files.map((f) => f.file.replace(/\\/g, '/')).sort(), ['a.hl7', 'sub/b.x12'], 'the copies in the output folder are not inputs');
  assert.equal(fs.existsSync(path.join(out, 'masked')), false);
  assert.deepEqual(files.listFiles(dir, out).map((f) => path.relative(dir, f).replace(/\\/g, '/')), ['a.hl7', 'sub/b.x12']);
  // a sibling folder whose name only starts like the output folder is still read
  put(dir, 'masked-old/c.hl7', samples.sampleFor('hl7').text);
  assert.ok(files.listFiles(dir, out).some((f) => f.includes('masked-old')));
});

test('listFiles is sorted, skips version-control and package folders and returns files only', () => {
  const dir = freshDir('list');
  for (const rel of ['b.txt', 'a.txt', 'z/y.txt', 'node_modules/m.js', '.git/config', '.hg/h', '.svn/s', 'ok/.git/x', 'ok/k.txt']) put(dir, rel, 'x');
  const found = files.listFiles(dir).map((f) => path.relative(dir, f).replace(/\\/g, '/'));
  assert.deepEqual(found, ['a.txt', 'b.txt', 'ok/k.txt', 'z/y.txt']);
  assert.deepEqual(files.listFiles(path.join(dir, 'does-not-exist')), []);
});

test('links are not followed: a linked folder and a linked file are neither listed nor read', async (t) => {
  const dir = freshDir('links');
  put(dir, 'real/a.hl7', samples.sampleFor('hl7').text);
  const outside = freshDir('links-outside');
  put(outside, 'secret.hl7', samples.sampleFor('hl7').text);
  let made = 0;
  try { fs.symlinkSync(outside, path.join(dir, 'linked-folder'), 'junction'); made++; } catch (e) { /* not permitted here */ }
  try { fs.symlinkSync(path.join(outside, 'secret.hl7'), path.join(dir, 'linked-file.hl7'), 'file'); made++; } catch (e) { /* not permitted here */ }
  if (made === 0) { t.skip('this account may not create links; nothing to check'); return; }
  const listed = files.listFiles(dir).map((f) => path.relative(dir, f).replace(/\\/g, '/'));
  assert.deepEqual(listed, ['real/a.hl7'], 'only the real file');
  const r = await files.runFolder(dir, path.join(freshDir('links-out'), 'm'), newRun(), {});
  assert.deepEqual(r.files.map((f) => f.file.replace(/\\/g, '/')), ['real/a.hl7']);
});

// ---- 5. runFiles: names, counters, cancellation ----------------------------------------------

test('same file name from different folders: counters, nothing is written outside the output folder', async () => {
  const root = freshDir('dups');
  const msgs = [hl7Message(1, '\r'), hl7Message(2, '\r'), hl7Message(3, '\r'), hl7Message(4, '\r')];
  const a = put(root, 'A/x.hl7', msgs[0]);
  const b = put(root, 'B/x.hl7', msgs[1]);
  const c = put(root, 'C/X.HL7', msgs[2]);
  const d = put(root, 'D/x-2.hl7', msgs[3]);
  const viaDots = root + path.sep + 'A' + path.sep + '..' + path.sep + 'B' + path.sep + 'x.hl7';   // a path that climbs out and back in
  const outDir = path.join(root, 'out');
  const before = fs.readdirSync(root).sort();
  const r = await files.runFiles([a, b, c, d, viaDots], path.join(root, 'A'), outDir, newRun(), {});
  assert.deepEqual(r.files.map((f) => f.file), ['x.hl7', 'x-2.hl7', 'X-3.HL7', 'x-2-2.hl7', 'x-4.hl7']);
  for (const f of r.files) {
    assert.equal(f.status, 'written');
    assert.ok(!f.file.includes('..') && !path.isAbsolute(f.file) && !/[\\/]/.test(f.file), 'the name stays inside the output folder: ' + f.file);
  }
  assert.deepEqual(fs.readdirSync(root).sort(), before.concat(['out']).sort(), 'nothing was written next to the input folders');
  assert.equal(fs.readdirSync(outDir).length, 5);
  const exp = newRun();
  [msgs[0], msgs[1], msgs[2], msgs[3], msgs[1]].forEach((text, i) => {
    assert.equal(fs.readFileSync(path.join(outDir, r.files[i].file), 'utf8'), engine.processText(text, exp, {}).text, 'output ' + i + ' belongs to its input');
  });
});

test('a name that starts with two dots inside the base folder stays inside the output folder', async () => {
  const root = freshDir('dots');
  const f = put(root, 'in/..odd.hl7', hl7Message(1, '\r'));
  const r = await files.runFiles([f], path.join(root, 'in'), path.join(root, 'out'), newRun(), {});
  assert.equal(r.files[0].status, 'written');
  assert.ok(fs.existsSync(path.join(root, 'out', r.files[0].file)));
  assert.equal(path.dirname(path.resolve(root, 'out', r.files[0].file)), path.resolve(root, 'out'));
});

test('cancellation between two files throws Cancelled and leaves no temporary file; finished files stay', async () => {
  const root = freshDir('cancel');
  const list = [put(root, 'in/a.hl7', hl7Message(1, '\r')), put(root, 'in/b.hl7', hl7Message(2, '\r')), put(root, 'in/c.hl7', hl7Message(3, '\r'))];
  const out = path.join(root, 'out');
  await assert.rejects(() => files.runFiles(list, path.join(root, 'in'), out, newRun(), { isCancelled: () => fs.existsSync(path.join(out, 'a.hl7')) }),
    (e) => e instanceof files.Cancelled && e.cancelled === true && e.message === 'cancelled');
  assert.deepEqual(fs.readdirSync(out), ['a.hl7']);
  assert.deepEqual(partFiles(root), []);
});

test('cancellation inside a large file throws Cancelled and removes the temporary file', async () => {
  const root = freshDir('cancel-big');
  const inPath = put(root, 'big.hl7', hl7Batch(hl7CountFor(CHUNK + 50000, '\r'), '\r'));
  const out = path.join(root, 'out', 'big.hl7');
  let calls = 0;
  await assert.rejects(() => files.processFile(inPath, out, newRun('mask'), { isCancelled: () => ++calls >= 2 }), (e) => e instanceof files.Cancelled);
  assert.ok(calls >= 2);
  assert.equal(fs.existsSync(out), false, 'no output file');
  assert.deepEqual(partFiles(root), []);
  let n = 0;
  await assert.rejects(() => files.runFiles([inPath], root, path.join(root, 'out2'), newRun('mask'), { isCancelled: () => ++n >= 2 }), (e) => e.cancelled === true);
  assert.deepEqual(partFiles(root), []);
});

test('cancellation while the NDJSON patient index is read throws Cancelled and writes nothing', async () => {
  const root = freshDir('cancel-nd');
  const inPath = put(root, 'x.ndjson', ndjsonLines(ndjsonCountFor(CHUNK + 50000, '\n'), '\n'));
  let n = 0;
  await assert.rejects(() => files.processFile(inPath, path.join(root, 'out.ndjson'), newRun(), { isCancelled: () => ++n >= 1 }), (e) => e instanceof files.Cancelled);
  assert.equal(fs.existsSync(path.join(root, 'out.ndjson')), false);
  assert.deepEqual(partFiles(root), []);
});

test('a single FHIR document above the size limit is refused with a hint and leaves no temporary file', async () => {
  const root = freshDir('oversize');
  const inPath = path.join(root, 'huge.json');
  const fd = fs.openSync(inPath, 'w');
  fs.writeSync(fd, Buffer.from('{"resourceType":"Bundle","type":"collection","entry":[]}'));
  fs.ftruncateSync(fd, files.MAX_JSON_BYTES + 1024);
  fs.closeSync(fd);
  const out = path.join(root, 'out', 'huge.json');
  const r = await files.processFile(inPath, out, newRun(), {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too-large');
  assert.match(r.message, /40 MB/);
  assert.match(r.message, /NDJSON/);
  assert.equal(fs.existsSync(out), false);
  assert.deepEqual(partFiles(root), [], 'the refusal removes its temporary file');
  const folder = await files.runFiles([inPath], root, path.join(root, 'out3'), newRun(), {});
  assert.equal(folder.files[0].status, 'error');
  assert.deepEqual(partFiles(root), []);
});

// ---- 6. NDJSON patient index -----------------------------------------------------------------

function ndPatient(id, family, given) {
  return JSON.stringify({ resourceType: 'Patient', id: id, name: [{ family: family, given: [given] }], identifier: [{ type: { coding: [{ code: 'MR' }] }, system: 'http://harbour.example/mrn', value: 'ZX-' + id }] });
}
function ndObservation(id, patientId, text) {
  return JSON.stringify({ resourceType: 'Observation', id: id, status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] }, subject: { reference: 'Patient/' + patientId }, note: [{ text: text }] });
}

test('NDJSON: a Patient line after the Observation line still gets its name replaced in the Observation text', async () => {
  const dir = freshDir('ndindex');
  const text = [ndObservation('o1', 'p1', 'Zebulon Quenby phoned about the result and asked for a copy.'), ndPatient('p1', 'Quenby', 'Zebulon')].join('\n') + '\n';
  const inPath = put(dir, 'late.ndjson', text);
  const r = await files.processFile(inPath, inPath + '.out', newRun(), {});
  assert.equal(r.ok, true);
  const out = fs.readFileSync(inPath + '.out', 'utf8');
  assert.ok(!/zebulon|quenby/i.test(out), 'neither name is left');
  const [obs, pat] = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(pat.name[0].family && pat.name[0].given[0]);
  assert.ok(obs.note[0].text.includes(pat.name[0].family) && obs.note[0].text.includes(pat.name[0].given[0]), 'the same replacements appear in the note');
  assertSameBytes(Buffer.from(out), singleShot(Buffer.from(text)).bytes, 'index');
});

test('NDJSON: the Patient line is in a later chunk than the Observation line', async () => {
  const dir = freshDir('ndindex-big');
  const lines = [ndObservation('o1', 'p9', 'Reviewed with Zebulon Quenby by phone.')];
  const coding = [];
  for (let k = 0; k < 20; k++) coding.push({ system: 'http://loinc.org', code: '718-' + k, display: 'Hemoglobin [Mass/volume] in Blood, measured on the routine analyser in the main laboratory ' + k });
  for (let i = 0; i < 900; i++) lines.push(JSON.stringify({ resourceType: 'Observation', id: 'f' + i, status: 'final', code: { coding: coding }, subject: { reference: 'Patient/p' + (i % 7) } }));
  lines.push(ndPatient('p9', 'Quenby', 'Zebulon'));
  const buf = Buffer.from(lines.join('\n') + '\n', 'utf8');
  assert.ok(buf.length > 1.2 * CHUNK && buf.indexOf('"resourceType":"Patient"') > CHUNK, 'the Patient line starts after the first chunk');
  const inPath = put(dir, 'far.ndjson', buf);
  const r = await files.processFile(inPath, inPath + '.out', newRun(), {});
  assert.equal(r.ok, true);
  const out = fs.readFileSync(inPath + '.out', 'utf8');
  assert.ok(!/zebulon|quenby/i.test(out));
  assertSameBytes(Buffer.from(out), singleShot(buf).bytes, 'far index');
});

test('NDJSON in mask mode needs no index and still hides the Patient fields', async () => {
  const dir = freshDir('ndmask');
  const text = [ndObservation('o1', 'p1', 'Zebulon Quenby phoned.'), ndPatient('p1', 'Quenby', 'Zebulon')].join('\n') + '\n';
  const inPath = put(dir, 'm.ndjson', text);
  const r = await files.processFile(inPath, inPath + '.out', newRun('mask'), {});
  assert.equal(r.ok, true);
  const pat = JSON.parse(fs.readFileSync(inPath + '.out', 'utf8').trim().split('\n')[1]);
  assert.equal(pat.name[0].family, 'XXXXXX');
  assert.equal(pat.name[0].given[0], 'XXXXXXX');
});

// ---- 7. verification of the written files ----------------------------------------------------

async function cleanFolderRun() {
  const dir = freshDir('verify');
  put(dir, 'in/a.hl7', samples.sampleFor('hl7').text);
  put(dir, 'in/b.x12', samples.sampleFor('x12').text);
  put(dir, 'in/c.json', samples.sampleFor('fhir').text);
  const out = path.join(dir, 'out');
  const run = newRun();
  const r = await files.runFolder(path.join(dir, 'in'), out, run, {});
  return { dir: dir, out: out, run: run, entries: r.files };
}

test('verifyOutputs: PASS after a clean run, FAIL after one output gets an original phone number back', async () => {
  const x = await cleanFolderRun();
  const first = await files.verifyOutputs(x.out, x.entries, V.createVerifier(x.run), {});
  assert.equal(first.pass, true);
  assert.equal(first.files, 3);
  assert.equal(first.failedFiles, 0);
  const row = x.run.exportRows().rows.find((r) => r.category === 'phone' && r.original === '614-555-0187');
  assert.ok(row, 'the phone number of the sample is in the map');
  const target = path.join(x.out, 'a.hl7');
  const text = fs.readFileSync(target, 'utf8');
  assert.ok(text.includes(row.replacement));
  fs.writeFileSync(target, text.replace(row.replacement, row.original));
  const second = await files.verifyOutputs(x.out, x.entries, V.createVerifier(x.run), {});
  assert.equal(second.pass, false);
  assert.equal(second.failedFiles, 1);
  assert.ok(second.originalValues + second.patterns + second.fields >= 1);
});

test('verifyOutputs: a family name that comes back is noticed', async () => {
  const x = await cleanFolderRun();
  const row = x.run.exportRows().rows.find((r) => r.category === 'name' && r.original === 'Larkspur');
  assert.ok(row, 'the family name is in the map');
  const target = path.join(x.out, 'c.json');
  assert.ok(fs.readFileSync(target, 'utf8').includes(row.replacement));
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(row.replacement, 'Larkspur'));
  const total = await files.verifyOutputs(x.out, x.entries, V.createVerifier(x.run), {});
  assert.equal(total.pass, false);
  assert.ok(total.originalValues + total.fields >= 1);
});

test('verifyOutputs only reads entries that were written, honours cancellation and marks a file above 64 MiB incomplete', async () => {
  const x = await cleanFolderRun();
  const none = await files.verifyOutputs(x.out, x.entries.map((e) => Object.assign({}, e, { status: 'unchanged' })), V.createVerifier(x.run), {});
  assert.equal(none.files, 0);
  assert.equal(none.pass, true);
  await assert.rejects(() => files.verifyOutputs(x.out, x.entries, V.createVerifier(x.run), { isCancelled: () => true }), (e) => e instanceof files.Cancelled);
  const fd = fs.openSync(path.join(x.out, 'big.hl7'), 'w');
  fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  const total = await files.verifyOutputs(x.out, [{ file: 'big.hl7', status: 'written', format: 'hl7' }], V.createVerifier(x.run), {});
  assert.equal(total.incomplete, true);
  assert.equal(total.pass, false);
  assert.equal(total.failedFiles, 1);
});

// ---- 8. paths with spaces and non-ASCII characters -------------------------------------------

test('a folder name with spaces and non-ASCII letters works for input, output and verification', async () => {
  const root = freshDir('odd');
  const odd = 'in put ' + UE + E_ACUTE + ' ' + SNOWMAN;
  const inDir = path.join(root, odd);
  put(inDir, 'sub dir/p' + UE + 'fung ' + SNOWMAN + '.hl7', samples.sampleFor('hl7').text);
  put(inDir, 'caf' + E_ACUTE + '.x12', samples.sampleFor('x12').text);
  put(inDir, 'ordner ' + E_ACUTE + '/bundle.json', samples.sampleFor('fhir').text);
  const out = path.join(root, odd + ' (masked)');
  const run = newRun();
  const r = await files.runFolder(inDir, out, run, {});
  assert.equal(r.files.length, 3);
  assert.deepEqual(r.files.map((f) => f.status), ['written', 'written', 'written']);
  for (const f of r.files) assert.ok(fs.existsSync(path.join(out, f.file)), f.file);
  const total = await files.verifyOutputs(out, r.files, V.createVerifier(run), {});
  assert.equal(total.pass, true);
  const single = path.join(root, 'single ' + SNOWMAN + UE + '.hl7');
  fs.writeFileSync(single, samples.sampleFor('hl7').text);
  const r2 = await files.processFile(single, single + '.out', newRun(), {});
  assert.equal(r2.ok, true);
});

// ---- 9. consistency across files of one run --------------------------------------------------

test('one run over several files and formats gives the same replacement for the same person', async () => {
  const dir = freshDir('consistent');
  const hl = put(dir, 'a.hl7', samples.sampleFor('hl7').text);
  const fh = put(dir, 'b.json', samples.sampleFor('fhir').text);
  const run = newRun();
  await files.processFile(hl, hl + '.out', run, {});
  await files.processFile(fh, fh + '.out', run, {});
  const pid = fs.readFileSync(hl + '.out', 'utf8').split('\r').find((s) => s.startsWith('PID|'));
  const family = pid.split('|')[5].split('^')[0];
  const doc = JSON.parse(fs.readFileSync(fh + '.out', 'utf8'));
  assert.equal(doc.entry[0].resource.name[0].family, family, 'HL7 and FHIR agree on the replacement of the family name');
  assert.notEqual(family, 'Larkspur');
});

test('the same key gives the same files in two runs; another key gives other files', async () => {
  const dir = freshDir('keys');
  const inPath = put(dir, 'a.hl7', samples.sampleFor('hl7').text);
  await files.processFile(inPath, inPath + '.1', createRun({ mode: 'pseudonym', key: KEY }), {});
  await files.processFile(inPath, inPath + '.2', createRun({ mode: 'pseudonym', key: Buffer.from(KEY) }), {});
  await files.processFile(inPath, inPath + '.3', createRun({ mode: 'pseudonym', key: Buffer.alloc(32, 8) }), {});
  assert.ok(fs.readFileSync(inPath + '.1').equals(fs.readFileSync(inPath + '.2')));
  assert.ok(!fs.readFileSync(inPath + '.1').equals(fs.readFileSync(inPath + '.3')));
});
