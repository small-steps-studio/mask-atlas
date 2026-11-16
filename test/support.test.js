'use strict';
// Report A Problem: the diagnostics block never holds file content, a file name, a path, a value of
// a message, the licence key or its hint, or a user or computer name; the wording of the help text;
// and the command that copies the block to the clipboard.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { diagnosticsBlock, licenceLine, reportProblemText, SETTING_KEYS } = require('../src/support');
const config = require('../src/licence/config');
const samples = require('../src/samples');
const pkg = require('../package.json');
const M = require('./helpers/vscode-mock');

const ROOT = path.join(__dirname, '..');
const HL7_URI = 'file:///work/secret-ward-notes.hl7';
const TRACE = [['a', 'i'], ['gener', 'ated'], ['mod', 'el'], ['prom', 'pt'], ['cla', 'ude'], ['g', 'pt'], ['co', 'pilot'], ['assis', 'tant']].map((p) => p.join(''));

const SETTINGS = { maxFileSizeMB: 20, keepEnvelopeIdentifiers: false, maskOrganisations: true, shiftDates: true, dateOrder: 'mdy', scanFreeText: true, rulesFile: '', markInProblems: true, 'export.neutraliseFormulas': true };
const INFO = {
  extensionVersion: '0.1.0', editorName: 'Visual Studio Code', editorVersion: '1.99.0', platform: 'win32', osRelease: '10.0.26100', arch: 'x64', nodeVersion: '22.1.0',
  settings: SETTINGS, licence: { pro: false, hasKey: false, trial: { state: 'unused' }, mode: 'live' }, active: { format: 'HL7 v2', size: 1234 }, seedSet: false, lastRun: false
};

async function start(options, prepare) {
  const o = options || {};
  const mock = M.createMock(Object.assign({ files: { [HL7_URI]: samples.sampleFor('hl7').text }, active: HL7_URI, folders: [{ uri: M.Uri.file(path.join(ROOT, 'test')), name: 'work' }] }, o));
  return M.startExtension(ROOT, pkg, mock, 1, prepare);
}

// ---- diagnosticsBlock ------------------------------------------------------------------------

test('the block for a typical state, line by line', () => {
  assert.equal(diagnosticsBlock(INFO), [
    'Mask Atlas 0.1.0',
    'Editor: Visual Studio Code 1.99.0',
    'Platform: win32 10.0.26100 x64, Node 22.1.0',
    'Active file: HL7 v2, 1234 characters',
    'Settings:',
    '  maxFileSizeMB = 20',
    '  keepEnvelopeIdentifiers = false',
    '  maskOrganisations = true',
    '  shiftDates = true',
    '  dateOrder = "mdy"',
    '  scanFreeText = true',
    '  rulesFile = not set',
    '  markInProblems = true',
    '  export.neutraliseFormulas = true',
    'Pseudonym seed: none',
    'Result of the last run held in memory: no',
    'Licence: Free (trial not started), licence server: live',
    'Issues page: ' + config.issuesUrl,
    ''
  ].join('\n'));
});

test('the block for nothing at all still reads well', () => {
  for (const empty of [undefined, null, {}]) {
    const block = diagnosticsBlock(empty);
    assert.match(block, /^Mask Atlas unknown version\nEditor: unknown \n/);
    assert.match(block, /Active file: none/);
    assert.match(block, /Licence: unknown\n/);
    assert.match(block, /  maxFileSizeMB = default\n/);
    assert.match(block, /  rulesFile = not set\n/);
    assert.ok(block.endsWith('\n'));
  }
});

test('the settings in the block are exactly the settings of the manifest, in order', () => {
  const declared = Object.keys(pkg.contributes.configuration.properties).map((k) => k.replace(/^maskAtlas\./, ''));
  assert.deepEqual(SETTING_KEYS, declared);
  const lines = diagnosticsBlock(INFO).split('\n').filter((l) => /^ {2}\S+ = /.test(l)).map((l) => l.trim().split(' = ')[0]);
  assert.deepEqual(lines, declared);
});

const RULES_CASES = [['', 'not set'], [undefined, 'not set'], [null, 'not set'], [0, 'not set'], ['rules.json', 'set'], ['D:\\Work\\alice\\clinic\\mask-rules.json', 'set'], ['/srv/alice/clinic-x/rules.json', 'set']];
for (const [value, shown] of RULES_CASES) {
  test('rulesFile ' + JSON.stringify(value) + ' is shown as "' + shown + '" and the path never appears', () => {
    const block = diagnosticsBlock(Object.assign({}, INFO, { settings: Object.assign({}, SETTINGS, { rulesFile: value }) }));
    assert.ok(block.includes('  rulesFile = ' + shown + '\n'));
    if (typeof value === 'string' && value.trim()) { assert.ok(!block.includes(value)); assert.ok(!/alice|clinic|\.json/.test(block)); }
  });
}

const SETTING_CASES = [[undefined, 'default'], [true, 'true'], [false, 'false'], [5, '5'], [0.5, '0.5'], ['dmy', '"dmy"'], ['quote"d', '"quote\\"d"']];
for (const [value, shown] of SETTING_CASES) {
  test('a setting with the value ' + JSON.stringify(value) + ' is shown as ' + shown, () => {
    const block = diagnosticsBlock(Object.assign({}, INFO, { settings: Object.assign({}, SETTINGS, { dateOrder: value }) }));
    assert.ok(block.includes('  dateOrder = ' + shown + '\n'), block);
  });
}

test('extra fields that a caller might pass are never printed: file names, paths, text, keys, hints, user and computer names', () => {
  const secrets = ['Hargrave-Ward-Notes.hl7', 'D:\\Work\\alice\\Desktop', '/srv/alice/notes', 'PATIENT Larkspur Evander', 'LICENCE-KEY-ABCD-1234-WXYZ', '...WXYZ', 'alice-laptop', 'alice@example.org', 'seed-passphrase-9999', 'Quillfeather'];
  const info = Object.assign({}, INFO, {
    fileName: secrets[0], path: secrets[1], folder: secrets[2], text: secrets[3], key: secrets[4], keyHint: secrets[5], hostname: secrets[6], email: secrets[7], seed: secrets[8], userName: 'alice',
    settings: Object.assign({}, SETTINGS, { secretSetting: secrets[9], customFolder: secrets[1] }),
    active: { format: 'HL7 v2', size: 99, fileName: secrets[0], path: secrets[1], text: secrets[3] },
    licence: { pro: true, via: 'server', licenceType: 'personal', hasKey: true, key: secrets[4], keyHint: secrets[5], trial: { state: 'unused' }, mode: 'live', customer: { name: 'alice', email: secrets[7] } }
  });
  const block = diagnosticsBlock(info);
  for (const s of secrets) assert.ok(!block.includes(s), 'the block holds "' + s + '"');
  assert.ok(!/alice/i.test(block));
  assert.match(block, /Licence: Pro \(personal, verified\), licence server: live/);
  assert.match(block, /Active file: HL7 v2, 99 characters\n/);
});

const LICENCE_CASES = [
  [{ pro: true, via: 'server', licenceType: 'business', trial: { state: 'unused' }, mode: 'live' }, 'Pro (business, verified), licence server: live'],
  [{ pro: true, via: 'cache', trial: { state: 'unused' }, mode: 'live' }, 'Pro (licence, verified), licence server: live'],
  [{ pro: true, via: 'grace', licenceType: 'personal', trial: { state: 'unused' }, mode: 'live' }, 'Pro (licence, offline grace period), licence server: live'],
  [{ pro: false, hasKey: true, via: 'product', trial: { state: 'active', daysLeft: 3 }, mode: 'live' }, 'Trial (stored key of another product), licence server: live'],
  [{ pro: false, hasKey: true, via: 'product', trial: { state: 'expired' }, mode: 'live' }, 'Free (stored key of another product), licence server: live'],
  [{ pro: false, hasKey: true, via: 'rejected', trial: { state: 'unused' }, mode: 'live' }, 'Free (stored key rejected by the server), licence server: live'],
  [{ pro: false, hasKey: true, via: 'expired', trial: { state: 'active', daysLeft: 1 }, mode: 'live' }, 'Trial (stored key, grace period over), licence server: live'],
  [{ pro: false, hasKey: false, via: 'none', trial: { state: 'active', daysLeft: 14 }, mode: 'live' }, 'Trial (14 days left), licence server: live'],
  [{ pro: false, hasKey: false, via: 'none', trial: { state: 'active', daysLeft: 1 }, mode: 'live' }, 'Trial (1 day left), licence server: live'],
  [{ pro: false, hasKey: false, via: 'none', trial: { state: 'expired' }, mode: 'live' }, 'Free (trial ended), licence server: live'],
  [{ pro: false, hasKey: false, via: 'none', trial: { state: 'unused' } }, 'Free (trial not started), licence server: live'],
  [{ pro: false, hasKey: false, via: 'none' }, 'Free (trial not started), licence server: live'],
  [null, 'unknown']
];
for (const [status, expected] of LICENCE_CASES) {
  test('licence line ' + JSON.stringify(status && { pro: status.pro, via: status.via, trial: status.trial && status.trial.state }) + ' reads "' + expected + '"', () => {
    assert.equal(licenceLine(status), expected);
  });
}

test('the licence line never shows a key hint even when the status has one', () => {
  for (const [status] of LICENCE_CASES) {
    if (!status) continue;
    const line = licenceLine(Object.assign({}, status, { keyHint: '...ZZ99', key: 'KEY-ZZ99' }));
    assert.ok(!line.includes('ZZ99'));
  }
});

test('the active file line: size zero, skipped files and unknown formats', () => {
  const line = (active) => diagnosticsBlock(Object.assign({}, INFO, { active: active })).split('\n')[3];
  assert.equal(line({ format: 'HL7 v2', size: 0 }), 'Active file: HL7 v2, 0 characters');
  assert.equal(line({ size: 12 }), 'Active file: format not recognised, 12 characters');
  assert.equal(line({ format: 'X12', size: 9000000, skipped: 'not examined (over 8 million characters)' }), 'Active file: X12, 9000000 characters, not examined (over 8 million characters)');
  assert.equal(line(null), 'Active file: none');
});

test('seed and last-run lines say yes/no and never more', () => {
  const block = diagnosticsBlock(Object.assign({}, INFO, { seedSet: true, lastRun: true, seed: 'my secret words' }));
  assert.match(block, /Pseudonym seed: saved\n/);
  assert.match(block, /held in memory: yes\n/);
  assert.ok(!block.includes('my secret words'));
});

// ---- help text -------------------------------------------------------------------------------

test('reportProblemText: the browser opened', () => {
  const t = reportProblemText(true);
  assert.match(t, /^A diagnostics block \(version numbers, platform, settings, licence state; no file contents, names or values\) was copied to the clipboard\. /);
  assert.match(t, /Paste it into the issue that opens in your browser/);
  assert.match(t, /small example message made of invented data\.$/);
  assert.ok(!t.includes(config.issuesUrl), 'the link is opened, not printed');
});

test('reportProblemText: the browser could not be opened, so the address is printed and a real message is refused', () => {
  const t = reportProblemText(false);
  assert.ok(t.includes(config.issuesUrl));
  assert.match(t, /create a new issue, paste the block/);
  assert.match(t, /Never attach a real patient message\.$/);
});

test('the help texts and the block hold no tool wording, no personal name and no claim about a law', () => {
  const texts = [reportProblemText(true), reportProblemText(false), diagnosticsBlock(INFO)];
  for (const t of texts) {
    for (const w of TRACE) assert.ok(!new RegExp('\\b' + w + '\\b', 'i').test(t), 'a forbidden word is in the help text');
    assert.ok(!new RegExp(['dami', 'hpatsarum', 'drrac'].map((w) => w.split('').reverse().join('')).join('|'), 'i').test(t));
    assert.ok(!/complian|certif|guarantee/i.test(t));
  }
});

// ---- the command -----------------------------------------------------------------------------

test('Report A Problem copies the block to the clipboard and opens the issue page', async () => {
  const x = await start();
  try {
    await x.run('maskAtlas.reportProblem');
    const block = x.state.clipboard;
    assert.equal(typeof block, 'string');
    assert.match(block, new RegExp('^Mask Atlas ' + pkg.version.replace(/\./g, '\\.') + '\\n'));
    assert.match(block, /Editor: Visual Studio Code 1\.99\.0\n/);
    assert.match(block, new RegExp('Platform: ' + process.platform + ' .* ' + process.arch + ', Node ' + process.versions.node.replace(/\./g, '\\.')));
    assert.match(block, /Active file: HL7 v2, \d+ characters\n/);
    assert.match(block, /  maxFileSizeMB = 20\n/);
    assert.match(block, /  rulesFile = not set\n/);
    assert.match(block, /Pseudonym seed: none\n/);
    assert.match(block, /held in memory: no\n/);
    assert.match(block, /Licence: Free \(trial not started\), licence server: live\n/);
    assert.deepEqual(x.state.opened, [config.issuesUrl]);
    assert.equal(x.state.infoMessages.length, 1);
    assert.equal(x.state.infoMessages[0].text, 'Mask Atlas: ' + reportProblemText(true));
    assert.equal(x.state.errorMessages.length, 0);
    assert.equal(x.context.globalMap.has('trial.startedAt'), false, 'the command never starts the trial');
  } finally { x.uninstall(); }
});

test('Report A Problem: the block holds nothing of the document, its name, its path, a stored key or a stored seed', async () => {
  const x = await start({ config: { rulesFile: path.join(ROOT, 'private-folder', 'my-rules.json') } }, (context) => {
    context.secretsMap.set('licence.key.live', 'LIC-QJ7Z9X-WXYZ');
    context.secretsMap.set('maskAtlas.seed', 'seedphrase-QJ7Z9X-words');
    context.globalMap.set('licence.instanceId.live', 'inst-QJ7Z9X');
  });
  try {
    await x.run('maskAtlas.reportProblem');
    const block = x.state.clipboard.split('\n').filter((l) => !l.startsWith('Issues page:')).join('\n');
    const doc = samples.sampleFor('hl7').text;
    const words = ['Larkspur', 'Evander', 'Marlowe', 'Odelia', 'Thistlewood', 'HC-7305518', '926-41-7390', 'Wren Hollow', 'Fernbury', '614-555-0187', 'HARBOURSIDE', 'secret-ward-notes', 'work/',
      'LIC-', 'QJ7Z9X', 'WXYZ', 'seedphrase', 'private-folder', 'my-rules', ROOT, path.basename(ROOT)];
    for (const w of words) assert.ok(!block.toLowerCase().includes(w.toLowerCase()), 'the block holds "' + w + '"');
    assert.ok(!block.includes(doc.slice(0, 40)));
    assert.match(block, /Pseudonym seed: saved\n/, 'the state of the seed, not the seed');
    assert.match(block, /  rulesFile = set\n/);
    assert.ok(!/[\\]/.test(block), 'no path separator');
    assert.ok(!/[A-Za-z]:\//.test(block.replace(config.issuesUrl, '')) , 'no drive letter');
  } finally { x.uninstall(); }
});

test('Report A Problem: no user name and no computer name', async () => {
  const x = await start();
  try {
    await x.run('maskAtlas.reportProblem');
    const names = [];
    try { names.push(os.userInfo().username); } catch (e) { /* not available */ }
    try { names.push(os.hostname()); } catch (e) { /* not available */ }
    names.push(path.basename(os.homedir()));
    for (const n of names) if (n && n.length >= 3) assert.ok(!x.state.clipboard.toLowerCase().includes(n.toLowerCase()), 'the block holds a user or computer name');
    assert.ok(!/@/.test(x.state.clipboard), 'no e-mail address');
  } finally { x.uninstall(); }
});

const ACTIVE_CASES = [
  ['an unrecognised text', 'Just a note about gloves and the supplier.\n', /Active file: format not recognised, 43 characters\n/],
  ['a FHIR document', samples.sampleFor('fhir').text, /Active file: FHIR JSON, \d+ characters\n/],
  ['an X12 interchange', samples.sampleFor('x12').text, /Active file: X12, \d+ characters\n/],
  ['an empty document', '', /Active file: format not recognised, 0 characters\n/]
];
for (const [name, content, expected] of ACTIVE_CASES) {
  test('Report A Problem with ' + name + ' in the editor shows the format and the size only', async () => {
    const uri = 'file:///work/secret-' + name.replace(/\W/g, '-') + '.txt';
    const x = await start({ files: { [uri]: content }, active: uri });
    try {
      await x.run('maskAtlas.reportProblem');
      assert.match(x.state.clipboard, expected);
      assert.ok(!x.state.clipboard.includes('secret-'));
      if (content.length > 10) assert.ok(!x.state.clipboard.includes(content.slice(0, 20).trim()));
    } finally { x.uninstall(); }
  });
}

test('Report A Problem with no editor open and with a very large document', async () => {
  const none = await start({ active: undefined });
  try {
    await none.run('maskAtlas.reportProblem');
    assert.match(none.state.clipboard, /Active file: none\n/);
  } finally { none.uninstall(); }
  const uri = 'file:///work/big.txt';
  const big = await start({ files: { [uri]: 'x'.repeat(8 * 1024 * 1024 + 5) }, active: uri });
  try {
    await big.run('maskAtlas.reportProblem');
    assert.match(big.state.clipboard, /Active file: format not recognised, 8388613 characters, not examined \(over 8 million characters\)\n/);
  } finally { big.uninstall(); }
});

test('Report A Problem shows the settings that the user changed, as values of the settings only', async () => {
  const x = await start({ config: { maxFileSizeMB: 5, keepEnvelopeIdentifiers: true, maskOrganisations: false, shiftDates: false, dateOrder: 'dmy', scanFreeText: false, markInProblems: false, 'export.neutraliseFormulas': false } });
  try {
    await x.run('maskAtlas.reportProblem');
    for (const line of ['maxFileSizeMB = 5', 'keepEnvelopeIdentifiers = true', 'maskOrganisations = false', 'shiftDates = false', 'dateOrder = "dmy"', 'scanFreeText = false', 'markInProblems = false', 'export.neutraliseFormulas = false']) {
      assert.ok(x.state.clipboard.includes('  ' + line + '\n'), line);
    }
  } finally { x.uninstall(); }
});

test('Report A Problem shows the trial state without starting or changing it', async () => {
  const day = 86400000;
  const running = await start({}, (context) => { context.globalMap.set('trial.startedAt', Date.now() - 3 * day); context.globalMap.set('trial.lastSeenAt', Date.now() - day); });
  try {
    await running.run('maskAtlas.reportProblem');
    assert.match(running.state.clipboard, /Licence: Trial \(1[01] days left\), licence server: live\n/);
  } finally { running.uninstall(); }
  const ended = await start({}, (context) => { context.globalMap.set('trial.startedAt', Date.now() - 20 * day); context.globalMap.set('trial.lastSeenAt', Date.now() - 19 * day); });
  try {
    await ended.run('maskAtlas.reportProblem');
    assert.match(ended.state.clipboard, /Licence: Free \(trial ended\), licence server: live\n/);
  } finally { ended.uninstall(); }
});

test('Report A Problem when the browser cannot be opened: the block is still copied and the address is printed in the message', async () => {
  const x = await start({ openExternalFails: true });
  try {
    await x.run('maskAtlas.reportProblem');
    assert.ok(typeof x.state.clipboard === 'string' && x.state.clipboard.startsWith('Mask Atlas'));
    assert.equal(x.state.opened.length, 0);
    assert.ok(x.state.warningMessages.some((m) => m.text.includes(config.issuesUrl)), 'a warning names the address');
    assert.equal(x.state.infoMessages[0].text, 'Mask Atlas: ' + reportProblemText(false));
  } finally { x.uninstall(); }
});

test('Report A Problem shows that a seed is saved and that the last run is in memory, never the contents', async () => {
  const x = await start();
  try {
    await x.run('maskAtlas.setSeed');          // starts the trial; the input box has no answer, so nothing is stored
    assert.equal(x.context.secretsMap.has('maskAtlas.seed'), false);
    x.context.secretsMap.set('maskAtlas.seed', 'another long seed phrase 13579');
    await x.run('maskAtlas.deidentifyDocument');
    await x.run('maskAtlas.reportProblem');
    assert.match(x.state.clipboard, /Pseudonym seed: saved\n/);
    assert.match(x.state.clipboard, /held in memory: yes\n/);
    assert.ok(!x.state.clipboard.includes('13579'));
    await x.run('maskAtlas.forgetRun');
    await x.run('maskAtlas.reportProblem');
    assert.match(x.state.clipboard, /held in memory: no\n/);
  } finally { x.uninstall(); }
});

test('De-identify Message asks before it works on a document above 4 MB and does nothing when the answer is no', async () => {
  const hl7 = samples.sampleFor('hl7').text;
  const big = hl7.repeat(Math.ceil(4.3 * 1048576 / hl7.length));
  const x = await start({ files: { [HL7_URI]: big }, answers: [undefined] });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    const asked = x.state.warningMessages.find((m) => /De-identifying it in the editor takes roughly/.test(m.text));
    assert.ok(asked, 'a confirmation was shown');
    assert.match(asked.text, /this document is 4\.\d MB/);
    assert.deepEqual(asked.buttons, ['Continue']);
    await x.run('maskAtlas.reportProblem');
    assert.match(x.state.clipboard, /held in memory: no\n/, 'nothing was run');
  } finally { x.uninstall(); }
});
