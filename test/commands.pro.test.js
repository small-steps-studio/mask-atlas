'use strict';
// The Pro commands end to end with the editor mocked: De-identify Message, the verification of the
// result, the explicit export of the pseudonym map (warning first, formula neutralisation, original
// values only in that file), Forget Last Run, and a folder run with its confirmation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const samples = require('../src/samples');
const pkg = require('../package.json');
const M = require('./helpers/vscode-mock');

const ROOT = path.join(__dirname, '..');
const URI = 'file:///work/adt.hl7';

function start(options) {
  const mock = M.createMock(Object.assign({ files: { [URI]: samples.sampleFor('hl7').text }, active: URI, folders: [{ uri: M.Uri.file(path.join(ROOT, 'test')), name: 'work' }] }, options || {}));
  return M.startExtension(ROOT, pkg, mock, 1);
}
const yes = (label) => (kind, text, buttons) => (buttons.indexOf(label) !== -1 ? label : undefined);
const no = () => undefined;
const ORIGINALS = ['Larkspur', 'Evander', 'Marlowe', 'Odelia', 'Thistlewood', 'HC-7305518', '926-41-7390', 'Fernbury'];

test('De-identify Message opens a copy without the originals, verifies it and leaves the original alone', async () => {
  const x = await start();
  try {
    await x.run('maskAtlas.deidentifyDocument');
    const info = x.state.infoMessages.map((m) => m.text).join(' | ');
    assert.match(info, /fields replaced in a new, unsaved editor/);
    assert.match(info, /Verification: PASS/);
    assert.match(info, /Your original was not changed/);
    assert.equal(x.state.edits, 0, 'the original editor was not edited');
    assert.ok(x.state.openedDocs.some((d) => d.getText().length > 0 && d.getText().indexOf('Larkspur') === -1 && d.getText().indexOf('MSH|') === 0), 'a new document holds the copy, without the family name');
  } finally { x.uninstall(); }
});

test('Export Pseudonym Map asks first, writes originals only to the chosen file, neutralises formulas, and the trial is needed', async () => {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-map-')), 'map.csv');
  try {
    const x = await start({ answer: yes('Save Map'), saveDialog: M.Uri.file(target) });
    try {
      await x.run('maskAtlas.exportMap');
      assert.equal(fs.existsSync(target), false, 'no run yet: nothing is written');
      assert.ok(x.state.infoMessages.some((m) => /there is no run to export/.test(m.text)));
      await x.run('maskAtlas.deidentifyDocument');
      await x.run('maskAtlas.exportMap');
      const warning = x.state.warningMessages.find((m) => /lists every original value next to its replacement/.test(m.text));
      assert.ok(warning, 'the warning was shown before the file dialog');
      assert.ok(fs.existsSync(target), 'the map was written after the confirmation');
      const bytes = fs.readFileSync(target);
      assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xEF, 0xBB, 0xBF], 'UTF-8 with a byte order mark');
      const csv = bytes.toString('utf8');
      assert.match(csv, /^﻿category,original,replacement\r\n/);
      for (const original of ['Larkspur', 'HC-7305518']) assert.ok(csv.indexOf(original) !== -1, 'the map holds ' + original + ' because it was asked for');
      for (const line of csv.split('\r\n').slice(1)) { const cells = line.split(','); if (cells[1]) assert.doesNotMatch(cells[1], /^[=+\-@]/, 'a cell that starts with a formula character is neutralised'); }
      assert.doesNotMatch(JSON.stringify(x.state.infoMessages), /Larkspur|HC-7305518/, 'no message names a value');
    } finally { x.uninstall(); }
  } finally { fs.rmSync(path.dirname(target), { recursive: true, force: true }); }
});

test('Export Pseudonym Map writes nothing when the warning is declined, and Forget Last Run removes the run', async () => {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-map2-')), 'map.csv');
  try {
    const x = await start({ answer: no, saveDialog: M.Uri.file(target) });
    try {
      await x.run('maskAtlas.deidentifyDocument');
      await x.run('maskAtlas.exportMap');
      assert.equal(fs.existsSync(target), false, 'the warning was not confirmed');
      await x.run('maskAtlas.forgetRun');
      assert.ok(x.state.infoMessages.some((m) => /removed from memory/.test(m.text)));
      await x.run('maskAtlas.exportMap');
      assert.ok(x.state.infoMessages.some((m) => /there is no run to export/.test(m.text)));
      assert.equal(fs.existsSync(target), false);
    } finally { x.uninstall(); }
  } finally { fs.rmSync(path.dirname(target), { recursive: true, force: true }); }
});

test('the save dialog of the map starts in the home folder, not next to the data', async () => {
  const x = await start({ answer: yes('Save Map'), saveDialog: undefined });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    await x.run('maskAtlas.exportMap');
    const opts = x.state.saveDialogs[0];
    assert.ok(opts, 'the dialog was opened');
    const first = Array.isArray(opts) ? opts[0] : opts;
    assert.equal(path.dirname(first.defaultUri.fsPath), os.homedir());
  } finally { x.uninstall(); }
});

test('a folder run asks for a confirmation, writes copies without the originals and reports the files that were not written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-folder-'));
  const folder = path.join(dir, 'feed');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'a.hl7'), samples.sampleFor('hl7').text.replace(/\r/g, '\n'));
  fs.writeFileSync(path.join(folder, 'b.json'), samples.sampleFor('fhir').text);
  fs.writeFileSync(path.join(folder, 'c.txt'), 'plain notes\n');
  try {
    const x = await start({ answer: yes('Write Copies') });
    try {
      await x.run('maskAtlas.deidentifyFolder', M.Uri.file(folder));
      const confirm = x.state.warningMessages.find((m) => /write de-identified copies/.test(m.text));
      assert.ok(confirm, 'the confirmation names the target before anything is written');
      assert.match(confirm.text, /"feed-masked"/);
      const out = path.join(dir, 'feed-masked');
      assert.deepEqual(fs.readdirSync(out).sort(), ['a.hl7', 'b.json']);
      for (const f of fs.readdirSync(out)) { const t = fs.readFileSync(path.join(out, f), 'utf8'); for (const original of ORIGINALS) assert.ok(t.indexOf(original) === -1, f + ' still holds ' + original); }
      assert.ok(fs.readFileSync(path.join(folder, 'a.hl7'), 'utf8').indexOf('Larkspur') !== -1, 'the original is untouched');
      const shown = x.state.infoMessages.concat(x.state.warningMessages).map((m) => m.text).join(' | ');
      assert.match(shown, /2 files written to "feed-masked"/);
      assert.match(shown, /Verification: PASS/);
    } finally { x.uninstall(); }
    // declined: nothing is written
    const y = await start({ answer: no });
    try {
      await y.run('maskAtlas.deidentifyFolder', M.Uri.file(folder));
      assert.equal(fs.existsSync(path.join(dir, 'feed-masked-2')), false);
    } finally { y.uninstall(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
