'use strict';
// QA defect 2: a workspace can carry settings and a rule file that weaken a run. Such a run must not
// start silently: the settings that weaken it are declared restricted for Restricted Mode, a
// workspace that weakens a run is named in a confirmation before the run, and every run says in its
// notification and its report which settings and rules differ from the defaults, where each comes
// from, how many fields the rules kept, and that a pass counts only what the run replaced.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const samples = require('../src/samples');
const settings = require('../src/settings');
const engine = require('../src/core/engine');
const { createRun } = require('../src/core/run');
const pkg = require('../package.json');
const M = require('./helpers/vscode-mock');

const ROOT = path.join(__dirname, '..');
const URI = 'file:///work/adt.hl7';
const PLAIN = ['MSH|^~\\&|APP|FAC|APP2|FAC2|20261104091530||ADT^A01|MSG0001|P|2.5', 'EVN|A01|20261104091500',
  'PID|1||MR-445566^^^HSC^MR||Quillfeather^Roderick^Q||19700101|M|||5 Orchard Lane^^Marlby^OH^43055', ''].join('\r');
const WEAK_KEYS = ['keepEnvelopeIdentifiers', 'maskOrganisations', 'shiftDates', 'scanFreeText', 'rulesFile', 'export.neutraliseFormulas'];

function ruleFile(rules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-weak-'));
  const file = path.join(dir, 'rules.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, rules: rules }));
  return { dir: dir, file: file };
}
function sourcesOf(config, source) { const out = {}; for (const k of Object.keys(config)) out[k] = source; return out; }
/** Answers the confirmations with their buttons and the notification of a run with "Show Report". */
function answerAll(log) {
  return (kind, text, buttons) => {
    if (log) log.push({ kind: kind, text: text, buttons: buttons });
    for (const b of ['Run With These Settings', 'Write Copies', 'Save Map', 'Show Report', 'Continue']) if (buttons.indexOf(b) !== -1) return b;
    return undefined;
  };
}
function start(options) {
  const mock = M.createMock(Object.assign({ files: { [URI]: samples.sampleFor('hl7').text }, active: URI, folders: [{ uri: M.Uri.file(path.join(ROOT, 'test')), name: 'work' }] }, options || {}));
  return M.startExtension(ROOT, pkg, mock, 1);
}
const reportOf = (x) => x.state.openedDocs.map((d) => d.getText()).find((t) => /^# Mask Atlas: de-identification report/.test(t));
const infoText = (x) => x.state.infoMessages.concat(x.state.warningMessages).map((m) => m.text).join(' | ');

// ---- the manifest ----------------------------------------------------------------------------

test('every setting that can weaken a run is declared restricted for Restricted Mode, with an explanation', () => {
  const c = pkg.capabilities.untrustedWorkspaces;
  assert.equal(c.supported, 'limited');
  assert.ok(typeof c.description === 'string' && c.description.length > 60, 'the description tells the user what is ignored');
  assert.deepEqual(c.restrictedConfigurations.slice().sort(), WEAK_KEYS.map((k) => 'maskAtlas.' + k).sort());
  const props = pkg.contributes.configuration.properties;
  for (const key of c.restrictedConfigurations) assert.ok(props[key], key + ' is a setting of this extension');
  // the rows that the report lists as weakening are exactly the restricted settings (the rule file is a path, not a boolean)
  const weakeningKeys = settings.ROWS.filter((r) => r.weakens(r.key === 'keepEnvelopeIdentifiers' ? true : r.key === 'dateOrder' ? 'dmy' : false)).map((r) => r.key);
  assert.deepEqual(weakeningKeys.sort(), WEAK_KEYS.filter((k) => k !== 'rulesFile').sort());
});

// ---- the settings module ---------------------------------------------------------------------

test('sourceOf names the place of a value; describeSettings lists only what differs from the defaults and marks what weakens', () => {
  assert.equal(settings.sourceOf(undefined), 'default');
  assert.equal(settings.sourceOf({ globalValue: true }), 'user');
  assert.equal(settings.sourceOf({ globalValue: true, workspaceValue: false }), 'workspace');
  assert.equal(settings.sourceOf({ globalValue: true, workspaceValue: false, workspaceFolderValue: true }), 'workspace folder');
  const none = settings.describeSettings({ keepEnvelopeIdentifiers: false, maskOrganisations: true, shiftDates: true, dateOrder: 'mdy', scanFreeText: true, 'export.neutraliseFormulas': true }, {}, null, false);
  assert.deepEqual(none.rows, []);
  const d = settings.describeSettings({ keepEnvelopeIdentifiers: true, shiftDates: false, dateOrder: 'dmy' }, { keepEnvelopeIdentifiers: 'user', shiftDates: 'workspace', dateOrder: 'workspace folder' }, { count: 3, keepCount: 2 }, true);
  assert.deepEqual(d.rows.map((r) => r.setting), ['maskAtlas.keepEnvelopeIdentifiers', 'maskAtlas.shiftDates', 'maskAtlas.dateOrder', 'maskAtlas.rulesFile', 'pseudonym seed']);
  assert.deepEqual(d.weakening.map((r) => r.setting), ['maskAtlas.keepEnvelopeIdentifiers', 'maskAtlas.shiftDates', 'maskAtlas.rulesFile']);
  assert.deepEqual(d.workspaceWeakening.map((r) => r.setting), ['maskAtlas.shiftDates']);
  assert.match(settings.weakeningText(d.weakening, 4), /4 fields kept by your rules/);
  assert.match(settings.weakeningText(d.weakening, 1), /1 field kept by your rules/);
  assert.match(settings.workspaceWarning(d.workspaceWeakening), /dates are kept as they are \(workspace setting maskAtlas\.shiftDates\)/);
  // a rule file without keep rules adds paths but weakens nothing
  assert.deepEqual(settings.describeSettings({}, { rulesFile: 'workspace' }, { count: 2, keepCount: 0 }, false).weakening, []);
});

// ---- the reproduction of the audit -----------------------------------------------------------

test('QA reproduction: keep rule on PID-5, dates, free text, envelope and organisations from the workspace: confirmed first, named everywhere, never a bare PASS', async () => {
  const rules = ruleFile([{ format: 'hl7', path: 'PID-5', kind: 'keep' }]);
  const config = { keepEnvelopeIdentifiers: true, maskOrganisations: false, shiftDates: false, scanFreeText: false, rulesFile: rules.file };
  const log = [];
  const x = start({ config: config, configSources: sourcesOf(config, 'workspace'), answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    const modal = log.find((m) => m.buttons.indexOf('Run With These Settings') !== -1);
    assert.ok(modal, 'a confirmation came before the run');
    for (const part of ['This workspace changes how the run works', 'sender, receiver, facility and control identifiers are kept (workspace setting maskAtlas.keepEnvelopeIdentifiers)', 'organisation names are kept (workspace setting maskAtlas.maskOrganisations)',
      'dates are kept as they are (workspace setting maskAtlas.shiftDates)', 'notes, comments and narrative are not read (workspace setting maskAtlas.scanFreeText)', 'places named by a keep rule are left as they are (workspace setting maskAtlas.rulesFile)']) {
      assert.ok(modal.text.indexOf(part) !== -1, 'the confirmation says: ' + part);
    }
    const note = log.find((m) => /fields replaced in a new, unsaved editor/.test(m.text));
    assert.ok(note, 'the notification of the run');
    assert.doesNotMatch(note.text, /Verification: PASS\b(?!, with weakened)/, 'no bare PASS');
    const report = reportOf(x);
    assert.ok(report, 'the report was opened');
    assert.match(report, /## Settings and rules that differ from the defaults/);
    for (const row of ['maskAtlas.keepEnvelopeIdentifiers` | true | workspace', 'maskAtlas.maskOrganisations` | false | workspace', 'maskAtlas.shiftDates` | false | workspace', 'maskAtlas.scanFreeText` | false | workspace', 'maskAtlas.rulesFile` | 1 rule, 1 keeps a place | workspace']) {
      assert.ok(report.indexOf(row) !== -1, 'the report lists: ' + row);
    }
    assert.match(report, /\| Fields kept by your rules \| 1 \|/);
    assert.match(report, /Places kept by your rules[^]*`PID-5`: 1/);
    assert.match(report, /This run was weakened by settings or rules/);
    // the audit: the report said "Free-text fields scanned | 7 (2 values found)" although the setting was off
    assert.match(report, /\| Free-text fields \| \d+ found and NOT read \(the setting maskAtlas\.scanFreeText is off\) \|/);
    assert.doesNotMatch(report, /Free-text fields read/);
    // the weakening works as described: the kept name is in the copy
    const copy = x.state.openedDocs.find((d) => /^MSH\|/.test(d.getText())).getText();
    assert.ok(copy.indexOf('Larkspur^Evander^Marlowe') !== -1, 'the places kept by the rule are in the copy');
    // the unread notes still hold values that the run replaced elsewhere: the verification says so
    assert.match(report, /\*\*Result: FAIL\*\*/);
  } finally { x.uninstall(); fs.rmSync(rules.dir, { recursive: true, force: true }); }
});

test('declining the confirmation of a workspace that weakens the run: nothing is run, nothing is opened, nothing is kept', async () => {
  const rules = ruleFile([{ format: 'hl7', path: 'PID-5', kind: 'keep' }]);
  const config = { shiftDates: false, rulesFile: rules.file };
  const x = start({ config: config, configSources: sourcesOf(config, 'workspace'), answer: (kind, text, buttons) => undefined });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    assert.equal(x.state.openedDocs.length, 0);
    assert.equal(x.state.edits, 0);
    await x.run('maskAtlas.exportMap');
    assert.ok(x.state.infoMessages.some((m) => /there is no run to export/.test(m.text)), 'the declined run left nothing in memory');
  } finally { x.uninstall(); fs.rmSync(rules.dir, { recursive: true, force: true }); }
});

test('the same settings from the user need no confirmation, but the notification and the report still name them and their source', async () => {
  const rules = ruleFile([{ format: 'hl7', path: 'PID-5', kind: 'keep' }]);
  const config = { shiftDates: false, keepEnvelopeIdentifiers: true, rulesFile: rules.file };
  const log = [];
  const x = start({ config: config, configSources: sourcesOf(config, 'user'), files: { [URI]: PLAIN }, answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    assert.equal(log.filter((m) => m.buttons.indexOf('Run With These Settings') !== -1).length, 0, 'no confirmation for the user\'s own settings');
    const note = log.find((m) => /fields replaced in a new, unsaved editor/.test(m.text));
    assert.match(note.text, /Verification: PASS, with weakened settings \(/);
    assert.match(note.text, /dates are kept as they are/);
    assert.match(note.text, /places kept by your rule file/);
    assert.match(note.text, /1 field kept by your rules/);
    const report = reportOf(x);
    assert.match(report, /maskAtlas\.shiftDates` \| false \| user \|/);
    assert.match(report, /\*\*Result: PASS, with weakened settings\*\*/);
    assert.match(report, /The pass counts only what the run replaced\. Settings or rules left places as they are: /);
    const copy = x.state.openedDocs.find((d) => /^MSH\|/.test(d.getText())).getText();
    assert.ok(copy.indexOf('Quillfeather^Roderick^Q') !== -1, 'the place kept by the rule is in the copy');
    assert.ok(copy.indexOf('5 Orchard Lane') === -1, 'the address was replaced');
  } finally { x.uninstall(); fs.rmSync(rules.dir, { recursive: true, force: true }); }
});

test('a rule file without keep rules, or keep rules that match nothing, does not turn a pass into a weakened pass', async () => {
  const rules = ruleFile([{ format: 'hl7', path: 'PID-9', kind: 'keep' }, { format: 'hl7', path: 'ZPD-5', kind: 'record' }]);
  const config = { rulesFile: rules.file };
  const x = start({ config: config, configSources: sourcesOf(config, 'user'), files: { [URI]: PLAIN }, answer: answerAll([]) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    const text = infoText(x);
    assert.match(text, /Verification: PASS\./);
    assert.doesNotMatch(text, /weakened/);
    const report = reportOf(x);
    assert.match(report, /\*\*Result: PASS\*\*/);
    assert.doesNotMatch(report, /This run was weakened/);
    assert.match(report, /maskAtlas\.rulesFile` \| 2 rules, 1 keeps a place \| user/, 'the rule file is still listed');
  } finally { x.uninstall(); fs.rmSync(rules.dir, { recursive: true, force: true }); }
});

test('with every setting at its default the verdict is a plain PASS and the report says that nothing differs', async () => {
  const x = start({ files: { [URI]: PLAIN }, answer: answerAll([]) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    assert.match(infoText(x), /Verification: PASS\./);
    assert.doesNotMatch(infoText(x), /weakened/);
    const report = reportOf(x);
    assert.match(report, /None: every setting is at its default and no rule file is in use\./);
    assert.match(report, /\*\*Result: PASS\*\*/);
  } finally { x.uninstall(); }
});

test('a setting from a workspace folder is reported as such, and one modal covers the settings of a folder run too', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-weakfolder-'));
  const folder = path.join(dir, 'feed');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'a.hl7'), PLAIN);
  const config = { maskOrganisations: false };
  const log = [];
  const x = start({ config: config, configSources: { maskOrganisations: 'workspace folder' }, answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyFolder', M.Uri.file(folder));
    const modal = log.find((m) => m.buttons.indexOf('Write Copies') !== -1);
    assert.ok(modal);
    assert.match(modal.text, /This workspace changes how the run works: organisation names are kept \(workspace folder setting maskAtlas\.maskOrganisations\)/);
    assert.match(infoText(x), /Verification: PASS, with weakened settings/);
    const report = reportOf(x);
    assert.ok(report, 'Show Report was answered, so the report was opened');
    assert.match(report, /maskAtlas\.maskOrganisations` \| false \| workspace folder \|/);
  } finally { x.uninstall(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the free-text count is true -------------------------------------------------------------

test('with scanFreeText off no free text is read, and the counts say so; with it on the fields are counted as read', () => {
  const text = samples.sampleFor('hl7').text;
  const on = createRun({ mode: 'pseudonym', options: { freeText: true } });
  const off = createRun({ mode: 'pseudonym', options: { freeText: false } });
  const a = engine.processText(text, on, {});
  const b = engine.processText(text, off, {});
  assert.ok(on.stats.freeTextFields > 0);
  assert.equal(off.stats.freeTextFields, on.stats.freeTextFields, 'the same fields are found');
  assert.equal(on.stats.freeTextRead, on.stats.freeTextFields, 'all of them were read');
  assert.equal(off.stats.freeTextRead, 0, 'none was read');
  assert.equal(off.stats.freeTextHits, 0);
  assert.ok(on.stats.freeTextHits > 0);
  assert.ok(a.text.indexOf('Wife Odelia') === -1 && a.text.indexOf('evander.larkspur@mail.example') === -1, 'on: the names and the address in the notes are replaced');
  assert.ok(b.text.indexOf('evander.larkspur@mail.example') !== -1 && b.text.indexOf('Wife Odelia') !== -1, 'off: the notes are left as they are');
});

test('the risk report names the settings that apply to it and says when free text was not read because of the setting', async () => {
  const config = { keepEnvelopeIdentifiers: true, scanFreeText: false };
  const x = start({ config: config, configSources: sourcesOf(config, 'workspace'), answer: answerAll([]) });
  try {
    await x.run('maskAtlas.scan');
    const free = x.state.openedDocs.map((d) => d.getText()).find((r) => /^# Mask Atlas: identifier risk report/.test(r));
    assert.doesNotMatch(free, /scanFreeText/, 'without a trial or licence the free tier reads no free text, so that setting does not apply to the scan');
    await x.run('maskAtlas.deidentifyDocument'); // starts the trial: free text is now read by the scan, so the setting matters
    x.state.openedDocs.length = 0;
    x.state.setActive(URI);
    await x.run('maskAtlas.scan');
    const report = x.state.openedDocs.map((d) => d.getText()).find((t) => /^# Mask Atlas: identifier risk report/.test(t));
    assert.match(report, /## Settings and rules that differ from the defaults/);
    assert.match(report, /maskAtlas\.keepEnvelopeIdentifiers` \| true \| workspace \|/);
    assert.match(report, /maskAtlas\.scanFreeText` \| false \| workspace \|/);
    assert.match(report, /found and NOT read, because the setting maskAtlas\.scanFreeText is off/);
    assert.doesNotMatch(report, /Free text was scanned/);
    assert.match(infoText(x), /Settings that keep identifiers apply: sender, receiver, facility and control identifiers are kept \(workspace setting maskAtlas\.keepEnvelopeIdentifiers\)/);
  } finally { x.uninstall(); }
});

test('Mask Message In Place and the preview say which settings keep identifiers', async () => {
  const config = { keepEnvelopeIdentifiers: true, maskOrganisations: false };
  const x = start({ config: config, configSources: sourcesOf(config, 'workspace') });
  try {
    await x.run('maskAtlas.maskDocument');
    const text = infoText(x);
    assert.match(text, /fields masked with X for letters and 9 for digits/);
    assert.match(text, /Settings that keep identifiers apply: sender, receiver, facility and control identifiers are kept \(workspace setting maskAtlas\.keepEnvelopeIdentifiers\); organisation names are kept \(workspace setting maskAtlas\.maskOrganisations\)\./);
  } finally { x.uninstall(); }
  const y = start({});
  try {
    await y.run('maskAtlas.maskDocument');
    assert.doesNotMatch(infoText(y), /Settings that keep identifiers apply/);
  } finally { y.uninstall(); }
});

test('the export of the map names a workspace that turns the neutralisation of formulas off, and writes what the setting says', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-weakmap-'));
  const target = path.join(dir, 'map.csv');
  const config = { 'export.neutraliseFormulas': false };
  const log = [];
  const x = start({ config: config, configSources: sourcesOf(config, 'workspace'), files: { [URI]: PLAIN }, saveDialog: M.Uri.file(target), answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    await x.run('maskAtlas.exportMap');
    const modal = log.find((m) => /lists every original value next to its replacement/.test(m.text));
    assert.ok(modal, 'the warning of the export');
    assert.ok(modal.text.indexOf('formula characters in the map CSV are not neutralised (workspace setting maskAtlas.export.neutraliseFormulas)') !== -1);
    assert.ok(fs.existsSync(target));
  } finally { x.uninstall(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a relative path of the rule file points into the workspace folder: the file counts as the workspace\'s, whoever set the path, and it is not read at all in an untrusted workspace', async () => {
  const rules = ruleFile([{ format: 'hl7', path: 'PID-5', kind: 'keep' }]);
  const config = { rulesFile: 'rules.json' };
  const folders = [{ uri: M.Uri.file(rules.dir), name: 'work' }];
  const log = [];
  const x = start({ config: config, configSources: { rulesFile: 'user' }, folders: folders, files: { [URI]: PLAIN }, answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    const modal = log.find((m) => m.buttons.indexOf('Run With These Settings') !== -1);
    assert.ok(modal, 'the keep rule comes from a file in the workspace folder, so the run asks first');
    assert.match(modal.text, /places named by a keep rule are left as they are \(rule file inside the workspace folder, path set in your user settings: maskAtlas\.rulesFile\)/);
    assert.doesNotMatch(modal.text, /workspace folder setting maskAtlas\.rulesFile/, 'a path from the user settings is not called a workspace folder setting');
    assert.match(reportOf(x), /maskAtlas\.rulesFile` \| 1 rule, 1 keeps a place \| rule file inside the workspace folder, path set in your user settings \|/);
  } finally { x.uninstall(); }
  const y = start({ config: config, configSources: { rulesFile: 'user' }, folders: folders, trusted: false, files: { [URI]: PLAIN }, answer: answerAll([]) });
  try {
    await y.run('maskAtlas.deidentifyDocument');
    assert.equal(y.state.openedDocs.length, 0, 'nothing was run');
    assert.ok(y.state.warningMessages.some((m) => /is a path inside a workspace that is not trusted, so it is not read/.test(m.text) && /Nothing was changed/.test(m.text)), JSON.stringify(y.state.warningMessages.map((m) => m.text)));
  } finally { y.uninstall(); fs.rmSync(rules.dir, { recursive: true, force: true }); }
  // an absolute path from the user's own settings is the user's choice
  const rules2 = ruleFile([{ format: 'hl7', path: 'PID-5', kind: 'keep' }]);
  const log2 = [];
  const z = start({ config: { rulesFile: rules2.file }, configSources: { rulesFile: 'user' }, trusted: false, files: { [URI]: PLAIN }, answer: answerAll(log2) });
  try {
    await z.run('maskAtlas.deidentifyDocument');
    assert.equal(log2.filter((m) => m.buttons.indexOf('Run With These Settings') !== -1).length, 0);
    assert.match(reportOf(z), /\*\*Result: PASS, with weakened settings\*\*/);
  } finally { z.uninstall(); fs.rmSync(rules2.dir, { recursive: true, force: true }); }
});
