'use strict';
// Regression tests for the findings of the first re-check of the audit (N1 to N8). Each case is the
// reproduction of the re-check; it failed before the fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const K = require('../src/core/keyed');
const engine = require('../src/core/engine');
const V = require('../src/core/verify');
const { createRun } = require('../src/core/run');
const { createClient } = require('../src/worker/client');
const locate = require('../src/core/locate');
const report = require('../src/report');
const settings = require('../src/settings');
const samples = require('../src/samples');
const gen = require('./helpers/large-gen');
const pkg = require('../package.json');
const M = require('./helpers/vscode-mock');

const ROOT = path.join(__dirname, '..');
const BS = String.fromCharCode(92);
const URI = 'file:///work/adt.hl7';
const HDR = 'MSH|^~' + BS + '&|REGAPP|HALDRINN|LABAPP|LAB|20261105083012||ADT^A01|MSG00001|P|2.5\r';
const PLAIN = HDR + 'EVN|A01|20261104091500\rPID|1||MR-445566^^^HSC^MR||Quillfeather^Roderick^Q||19700101|M|||5 Orchard Lane^^Marlby^OH^43055\r';

function scratch(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-' + name + '-')); }
function ruleFile(rules) {
  const dir = scratch('rc1');
  const file = path.join(dir, 'rules.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, rules: rules }));
  return { dir: dir, file: file };
}
function sourcesOf(config, source) { const out = {}; for (const k of Object.keys(config)) out[k] = source; return out; }
function answerAll(log) {
  return (kind, text, buttons) => {
    if (log) log.push({ kind: kind, text: text, buttons: buttons });
    for (const b of ['Run With These Settings', 'Write Copies', 'Save Map', 'Show Report', 'Continue']) if (buttons.indexOf(b) !== -1) return b;
    return undefined;
  };
}
function start(options) {
  const mock = M.createMock(Object.assign({ files: { [URI]: PLAIN }, active: URI, folders: [{ uri: M.Uri.file(path.join(ROOT, 'test')), name: 'work' }] }, options || {}));
  return M.startExtension(ROOT, pkg, mock, 1);
}
const reportOf = (x) => x.state.openedDocs.map((d) => d.getText()).find((t) => /^# Mask Atlas: de-identification report/.test(t));

// ---- N1: rules of every kind that leave places as they are weaken the run, not only "keep" ----------------------------

async function engineRun(format, text, rules) {
  const client = createClient({});
  try {
    const runId = client.newRunId();
    const created = await client.request('createRun', { runId: runId, mode: 'pseudonym', options: {}, rulesText: JSON.stringify({ version: 1, rules: rules }) });
    assert.equal(created.rulesErrors, undefined, JSON.stringify(created.rulesErrors));
    const r = await client.request('processText', { runId: runId, text: text, format: format, verify: true });
    assert.equal(r.ok, true, r.message);
    return { out: r, created: created };
  } finally { await client.dispose(); }
}

const CASES = [
  ['HL7 one component of PID-5', 'hl7', () => samples.sampleFor('hl7').text, [{ format: 'hl7', path: 'PID-5.2', kind: 'given' }, { format: 'hl7', path: 'PID-11.1', kind: 'street' }], /PID-(5|11)/],
  ['HL7 free-text on PID-5', 'hl7', () => samples.sampleFor('hl7').text, [{ format: 'hl7', path: 'PID-5', kind: 'free-text' }], /PID-5/],
  ['HL7 free-text on PID-7', 'hl7', () => samples.sampleFor('hl7').text, [{ format: 'hl7', path: 'PID-7', kind: 'free-text' }], /PID-7/],
  ['X12 free-text on NM1-03', 'x12', () => samples.sampleFor('x12').text, [{ format: 'x12', path: 'NM1-03', kind: 'free-text' }], /NM1-03/],
  ['FHIR free-text on Patient.name.family', 'fhir', () => JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Brightmoor', given: ['Celestine'] }], birthDate: '1980-02-03' }), [{ format: 'fhir', path: 'Patient.name.family', kind: 'free-text' }], /Patient\.name\.family/]
];
for (const [label, format, text, rules, where] of CASES) {
  test('N1: ' + label + ' leaves places in clear: the run counts them as kept by the rules, names them, and the pass is a weakened pass', async () => {
    const { out, created } = await engineRun(format, text(), rules);
    assert.equal(created.rules.takeoverCount > 0, true, 'the rule file is known to take places over');
    // dates are not read back by the verification (a shifted date is not a value the run knows); the run itself counts the date places a rule hands over
    if (!/PID-7/.test(label)) assert.ok(out.verification.leftByRules > 0, 'places left by the rules: ' + out.verification.leftByRules);
    assert.ok(out.stats.keptByRule > 0, 'counted as kept by the rules: ' + out.stats.keptByRule);
    assert.ok(Array.from(out.stats.keptPaths.keys()).some((p) => where.test(p)), 'the place is named: ' + Array.from(out.stats.keptPaths.keys()).join(', '));
  });
}

test('N1: a free-text rule on a path the built-in profile does not know leaves nothing: no places are counted', async () => {
  const { out } = await engineRun('hl7', samples.sampleFor('hl7').text, [{ format: 'hl7', path: 'ZPD-5', kind: 'free-text' }]);
  assert.equal(out.verification.leftByRules, 0);
  assert.equal(out.stats.keptByRule, 0);
});

test('N1: a rule file with a single-component rule, from the workspace, asks first and the verdict is "weakened"; the report names the places', async () => {
  const rules = ruleFile([{ format: 'hl7', path: 'PID-5.2', kind: 'given' }, { format: 'hl7', path: 'PID-11.1', kind: 'street' }]);
  const config = { rulesFile: rules.file };
  const log = [];
  const x = start({ config: config, configSources: sourcesOf(config, 'workspace'), answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    const modal = log.find((m) => m.buttons.indexOf('Run With These Settings') !== -1);
    assert.ok(modal, 'a confirmation came before the run');
    assert.match(modal.text, /free-text, binary or single-component rule can be left as they are \(workspace setting maskAtlas\.rulesFile\)/);
    const note = log.find((m) => /fields replaced in a new, unsaved editor/.test(m.text));
    assert.match(note.text, /Verification: PASS, with weakened settings \(.*left as they are by rules of your rule file; \d+ fields? kept by your rules\)/);
    const copy = x.state.openedDocs.find((d) => /^MSH\|/.test(d.getText())).getText();
    assert.ok(copy.indexOf('Quillfeather') !== -1, 'the family name stays: the rule took PID-5 over');
    const rep = reportOf(x);
    assert.match(rep, /\*\*Result: PASS, with weakened settings\*\*/);
    assert.match(rep, /maskAtlas\.rulesFile` \| 2 rules, 2 can take over fields \| workspace/);
    assert.match(rep, /Places kept by your rules[^]*`PID-5`/);
    assert.match(rep, /This run was weakened by settings or rules/);
  } finally { x.uninstall(); fs.rmSync(rules.dir, { recursive: true, force: true }); }
});

test('N1: free-text rules from the user\'s own settings need no confirmation but the notification and the report still say so', async () => {
  const rules = ruleFile([{ format: 'hl7', path: 'PID-5', kind: 'free-text' }, { format: 'hl7', path: 'PID-7', kind: 'free-text' }]);
  const config = { rulesFile: rules.file };
  const log = [];
  const x = start({ config: config, configSources: sourcesOf(config, 'user'), answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    assert.equal(log.filter((m) => m.buttons.indexOf('Run With These Settings') !== -1).length, 0);
    const note = log.find((m) => /fields replaced in a new, unsaved editor/.test(m.text));
    assert.match(note.text, /PASS, with weakened settings/);
    const copy = x.state.openedDocs.find((d) => /^MSH\|/.test(d.getText())).getText();
    assert.ok(copy.indexOf('19700101') !== -1 || copy.indexOf('Quillfeather') !== -1, 'a value stays in clear');
    assert.doesNotMatch(reportOf(x), /\*\*Result: PASS\*\*/);
  } finally { x.uninstall(); fs.rmSync(rules.dir, { recursive: true, force: true }); }
});

test('N1: the rule kinds that replace a place by another kind are not counted as weakening', () => {
  const none = settings.describeSettings({}, { rulesFile: 'workspace' }, { count: 3, keepCount: 0, takeoverCount: 0 }, false);
  assert.deepEqual(none.weakening, []);
  const some = settings.describeSettings({}, { rulesFile: 'workspace' }, { count: 3, keepCount: 0, takeoverCount: 2 }, false);
  assert.deepEqual(some.weakening.map((r) => r.setting), ['maskAtlas.rulesFile']);
  assert.equal(some.workspaceWeakening.length, 1);
  const rules = require('../src/pro/rules');
  const parsed = rules.parseRules(JSON.stringify({ version: 1, rules: [{ format: 'hl7', path: 'PID-5', kind: 'family' }, { format: 'hl7', path: 'PID-5.2', kind: 'given' }, { format: 'x12', path: 'NM1-03', kind: 'free-text' }, { format: 'fhir', path: 'Patient.photo.data', kind: 'binary' }, { format: 'hl7', path: 'PV1-3', kind: 'keep' }] }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.keepCount, 1);
  assert.equal(parsed.takeoverCount, 3);
});

// ---- N2: a place never carries text of the message ---------------------------------------------------------------------

function isa(sep, term, control) {
  const pad = (v, n) => String(v).padEnd(n, ' ');
  return ['ISA', '00', pad('', 10), '00', pad('', 10), 'ZZ', pad('SENDER', 15), 'ZZ', pad('RECEIVER', 15), '261105', '0830', '^', '00501', control, '0', 'P', ':'].join(sep) + term;
}
function interchange(sep, term, control, body) {
  return isa(sep, term, control) + ['GS', 'HC', 'S', 'R', '20261105', '0830', '1', 'X', '005010X222A1'].join(sep) + term + body.join(term) + term + ['GE', '1', '1'].join(sep) + term + ['IEA', '1', control].join(sep) + term;
}
const PLANTED = ['KESTRELMOOR', '503-555-0166', 'Quenstedt', 'Rosalind', '503-555-0177', 'Brennick'];
function noPlanted(value, what) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const p of PLANTED) assert.equal(text.toLowerCase().indexOf(p.toLowerCase()), -1, what + ' carries ' + p);
}

test('N2: X12 interchanges with different separators: the places of the findings name no text of the message, in the check and in the report', () => {
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('place never text seed') });
  const base = engine.processText(samples.sampleFor('x12').text, r, {});
  assert.equal(base.ok, true);
  const claim = (sep, term, control, extra) => interchange(sep, term, control, ['ST' + sep + '837' + sep + '0001' + sep + '005010X222A1', 'NM1' + sep + 'IL' + sep + '1' + sep + 'DRAVENKORT' + sep + 'SELMIRA'].concat(extra || [], ['SE' + sep + '4' + sep + '0001']));
  const text = claim('*', '~', '000000001') + claim('|', '~', '000000002', ['ZZZ|ADD|CALL 503-555-0166 KESTRELMOOR FAMILY']) + claim('*', '~', '000000003', ['REF*SY*503-555-0166']);
  const check = V.createVerifier(r).check(text, 'x12');
  assert.equal(check.pass, false);
  assert.ok(check.locations.length > 0);
  noPlanted(check.locations, 'a location');
  for (const l of check.locations) assert.match(l.path, /^([A-Z][A-Z0-9]{1,2}-\d{1,3}(\.\d{1,2})?|\(line without a segment name\)|\(further places\)|\(other element\))$/, l.path);
  // the report that shows these places
  const total = V.newTotal();
  V.combine(total, check, '');
  total.pass = false;
  total.paths = Array.from(total.paths.values());
  const md = report.runReportMarkdown({ stats: r.snapshotStats(), title: 'x', keyNote: 'k', dateNote: 'd', keepEnvelope: false, maskOrganisations: true, settingsRows: [], weakening: [], files: [], verification: Object.assign({}, total, { pass: false, files: 1, fromDisk: false, weakText: '' }) });
  noPlanted(md, 'the report');
});

test('N2: an HL7 line without a segment name is located as such, never by its first letters', () => {
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('place never text seed two') });
  engine.processText(PLAIN, r, {});
  const text = HDR + 'PID|1||MR-1^^^H^MR||Zz^Yy||19700101|M\rRosalind Quenstedt on 503-555-0177 at home\rNTE|1||call 503-555-0177\r';
  const check = V.createVerifier(r).check(text, 'hl7');
  noPlanted(check.locations, 'a location');
  const loc = locate.createLocator(text, 'hl7')(text.indexOf('503-555-0177'));
  assert.equal(loc.path, '(line without a segment name)');
  assert.equal(loc.line, 3);
  assert.equal(locate.createLocator(text, 'hl7')(text.lastIndexOf('503-555-0177')).path, 'NTE-3');
});

test('N2: FHIR places name only names of the standard; a hostile key or resource type becomes "(other element)"', () => {
  const doc = JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Zz' }], Rosalind_Quenstedt: ['503-555-0177'], Brennick: { note: 'x' } }, null, 2);
  const loc = locate.createLocator(doc, 'fhir')(doc.indexOf('503-555-0177'));
  assert.equal(loc.path, 'Patient.(other element)');
  noPlanted(loc, 'a location');
  const typed = JSON.stringify({ resourceType: 'RosalindQuenstedt', value: '503-555-0177' });
  assert.equal(locate.createLocator(typed, 'fhir')(typed.indexOf('503-555-0177')).path, '(other element).value');
  assert.equal(locate.safePlace('Patient.name.family'), 'Patient.name.family');
  assert.equal(locate.safePlace('NM1-03'), 'NM1-03');
  assert.equal(locate.safePlace('PID-5.2'), 'PID-5.2');
  assert.equal(locate.safePlace('Bundle.entry.resource'), 'Bundle.entry.resource');
  assert.equal(locate.safePlace('CALL 503-555-0166 KESTRELMOOR~SE|4-00'), '(other element)');
  assert.equal(locate.safePlace('ZZZ|ADD|CALL 503-555-0166-00'), '(other element)');
});

test('N2: the paths of the report and the Problems marks go through the same filter', () => {
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('place never text seed three') });
  const stats = r.snapshotStats();
  stats.byPath.set('x\u0000names', { path: 'Patient.Rosalind_Quenstedt', category: 'names', count: 1, changed: 1, shape: 'Xxx' });
  stats.byCategory.set('names', 1);
  stats.keptPaths.set('Patient.Brennick.value', 1);
  const md = report.runReportMarkdown({ stats: stats, title: 't', keyNote: 'k', dateNote: 'd', keepEnvelope: false, maskOrganisations: true, settingsRows: [{ setting: 'maskAtlas.rulesFile', value: '1 rule', source: 'user', effect: 'e', weakens: false }], weakening: [], files: [], verification: null });
  noPlanted(md, 'the report');
});

// ---- N3: cancelling a folder run leaves no partial file ---------------------------------------------------------------

function partFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...partFiles(full)); else if (/\.part-\d+$/.test(e.name)) out.push(full);
  }
  return out;
}

test('N3: after Cancel the output folder holds no *.part-<pid> file', { timeout: 300000 }, async () => {
  const dir = scratch('n3');
  const client = createClient({});
  try {
    const input = path.join(dir, 'in');
    const out = path.join(dir, 'out');
    fs.mkdirSync(input);
    gen.writeLarge('hl7', path.join(input, 'big.hl7'), 12 * 1000 * 1000);
    const runId = client.newRunId();
    await client.request('createRun', { runId: runId, mode: 'pseudonym', options: {}, rulesText: '' });
    const long = client.request('runFiles', { runId: runId, folder: input, outDir: out });
    const outcome = long.then(() => 'finished', (e) => (e.cancelled ? 'cancelled' : 'failed: ' + e.message));
    // wait until the temporary file exists, then cancel
    const until = Date.now() + 60000;
    while (Date.now() < until && !(fs.existsSync(out) && partFiles(out).length)) await new Promise((r) => setTimeout(r, 20));
    assert.ok(partFiles(out).length > 0, 'the run was writing its temporary file');
    await client.cancel();
    assert.equal(await outcome, 'cancelled');
    assert.deepEqual(partFiles(out), [], 'the temporary file was removed');
    assert.deepEqual(fs.readdirSync(out), [], 'and nothing else was left of the file');
  } finally { await client.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- N4: lines without a segment name are read like a note --------------------------------------------------------------

test('N4: a note that continues after a line break (a line without a segment name) is read: seen names and phone numbers are replaced', () => {
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('line without segment seed') });
  const text = HDR + 'PID|1||MR-1^^^H^MR||Quenstedt^Rosalind||19731104|M\rRosalind Quenstedt on 503-555-0177 at home\r';
  const out = engine.processText(text, r, {});
  assert.equal(out.ok, true);
  for (const p of ['Rosalind', 'Quenstedt', '503-555-0177']) assert.equal(out.text.indexOf(p), -1, p);
  assert.equal(out.text.split('\r').length, text.split('\r').length, 'the lines are the same');
  assert.equal(V.createVerifier(r).check(out.text, 'hl7').pass, true);
  // the free tier reads no free text: it masks the fields, and says so
  const free = engine.processText(text, createRun({ mode: 'mask' }), {});
  assert.equal(free.ok, true);
  assert.ok(free.text.indexOf('Rosalind Quenstedt on') !== -1, 'the free mask does not read free text');
});

// ---- N7: plural -------------------------------------------------------------------------------------------------------

test('N7: one finding is "1 finding", more are "findings"', async () => {
  const text = PLAIN + 'NTE|1||Visitor Quillfeather came\r';
  const config = { scanFreeText: false };
  const log = [];
  const x = start({ config: config, configSources: sourcesOf(config, 'user'), files: { [URI]: text }, answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    const note = log.find((m) => /fields replaced in a new, unsaved editor/.test(m.text));
    assert.match(note.text, /Verification: FAIL, 1 finding\b(?!s)/, note.text);
    assert.doesNotMatch(note.text, /1 findings/);
  } finally { x.uninstall(); }
});

// ---- N8: the two wordings ---------------------------------------------------------------------------------------------

test('N8: the formula setting from a workspace does not weaken a run (it asks nothing before it and is no "weakened" label); the map export names it', async () => {
  const config = { 'export.neutraliseFormulas': false };
  const log = [];
  const x = start({ config: config, configSources: sourcesOf(config, 'workspace'), answer: answerAll(log) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    assert.equal(log.filter((m) => m.buttons.indexOf('Run With These Settings') !== -1).length, 0, 'no confirmation: the run does not write a CSV');
    const note = log.find((m) => /fields replaced in a new, unsaved editor/.test(m.text));
    assert.doesNotMatch(note.text, /weakened/);
    assert.doesNotMatch(note.text, /formula/);
    const rep = reportOf(x);
    assert.match(rep, /\*\*Result: PASS\*\*/);
    assert.match(rep, /maskAtlas\.export\.neutraliseFormulas` \| false \| workspace \|.*\(weakens the export of the map, not the run\)/);
    assert.doesNotMatch(rep, /This run was weakened/);
  } finally { x.uninstall(); }
});

// ---- R1 (re-check 2): a rule whose kind changes only digits on an address line ------------------------------------------------

const X12_ADDRESS = interchange('*', '~', '000000001', ['ST*837*0001*005010X222A1', 'NM1*IL*1*DRAVENKORT*SELMIRA', 'N3*14 FERN LANE*UNIT 9', 'N4*MARLBY*OH*43055', 'SE*5*0001']);
const FHIR_ADDRESS = JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Brightmoor', given: ['Celestine'] }], address: [{ line: ['14 FERN LANE', 'Flat 2 Quarry Hill'], city: 'Marlby' }] });

function x12Street(line) { return interchange('*', '~', '000000001', ['ST*837*0001*005010X222A1', 'NM1*IL*1*DRAVENKORT*SELMIRA', 'N3*' + line, 'SE*4*0001']); }
function fhirStreet(line) { return JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Brightmoor', given: ['Celestine'] }], address: [{ line: [line], city: 'Marlby' }] }); }

for (const [label, format, text, rules, leftover] of [
  ['X12 N3-01 as phone', 'x12', X12_ADDRESS, [{ format: 'x12', path: 'N3-01', kind: 'phone' }], 'FERN'],
  ['X12 N3-02 as ssn', 'x12', X12_ADDRESS, [{ format: 'x12', path: 'N3-02', kind: 'ssn' }], 'UNIT'],
  ['FHIR address.line as ssn', 'fhir', FHIR_ADDRESS, [{ format: 'fhir', path: 'Patient.address.line', kind: 'ssn' }], 'FERN LANE'],
  ['FHIR address.line as phone', 'fhir', FHIR_ADDRESS, [{ format: 'fhir', path: 'address.line', kind: 'phone' }], 'FERN LANE'],
  ['X12 "12 OAK ST" as phone (short words)', 'x12', x12Street('12 OAK ST'), [{ format: 'x12', path: 'N3-01', kind: 'phone' }], 'OAK'],
  ['X12 "5 ELM RD" as ssn', 'x12', x12Street('5 ELM RD'), [{ format: 'x12', path: 'N3-01', kind: 'ssn' }], 'ELM'],
  ['X12 "14 FERN-LANE" as phone (words joined by a hyphen)', 'x12', x12Street('14 FERN-LANE'), [{ format: 'x12', path: 'N3-01', kind: 'phone' }], 'FERN'],
  ['X12 "7 ST.MARYS RD" as phone (words joined by a dot)', 'x12', x12Street('7 ST.MARYS RD'), [{ format: 'x12', path: 'N3-01', kind: 'phone' }], 'MARYS'],
  ['FHIR "12 OAK ST" as phone', 'fhir', fhirStreet('12 OAK ST'), [{ format: 'fhir', path: 'Patient.address.line', kind: 'phone' }], 'OAK'],
  ['FHIR "14 FERN-LANE" as ssn', 'fhir', fhirStreet('14 FERN-LANE'), [{ format: 'fhir', path: 'address.line', kind: 'ssn' }], 'FERN'],
  ['FHIR "7 ST.MARYS RD" as ssn', 'fhir', fhirStreet('7 ST.MARYS RD'), [{ format: 'fhir', path: 'address.line', kind: 'ssn' }], 'MARYS']
]) {
  test('R1: ' + label + ' leaves the street in clear: the run does not end in a plain PASS', async () => {
    const { out } = await engineRun(format, text, rules);
    assert.ok(out.text.toLowerCase().indexOf(leftover.toLowerCase()) !== -1, 'the part of the address stays in the output (the rule changed only digits)');
    const v = out.verification;
    assert.ok(v.pass === false || v.leftByRules > 0 || out.stats.keptByRule > 0, 'not a plain pass: pass ' + v.pass + ', left ' + v.leftByRules + ', kept ' + out.stats.keptByRule);
  });
}

test('R1: a street replaced by the built-in profile keeps its suffix word and is still known (no false alarm)', async () => {
  const { out } = await engineRun('x12', X12_ADDRESS, [{ format: 'x12', path: 'REF-02', kind: 'id' }]);
  assert.equal(out.verification.pass, true);
  assert.equal(out.verification.fields, 0);
});

// ---- C1: places in unusual layouts ---------------------------------------------------------------------------------------------

test('C1: X12 with a line break as terminator and HL7 messages with different field separators are located correctly and never carry a value', () => {
  const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('place layouts seed') });
  engine.processText(samples.sampleFor('x12').text, r, {});
  const lf = interchange('*', '\n', '000000001', ['ST*837*0001*005010X222A1', 'NM1*IL*1*DRAVENKORT*SELMIRA', 'REF*SY*503-555-0166', 'SE*4*0001']);
  const at = lf.indexOf('503-555-0166');
  const loc = locate.createLocator(lf, 'x12')(at);
  assert.equal(loc.path, 'REF-02');
  assert.equal(loc.unit, 1);
  const check = V.createVerifier(r).check(lf, 'x12');
  noPlanted(check.locations, 'a location');
  // two messages, the second with other separators
  const m2 = 'MSH#^~' + BS + '&#A#B#C#D#20261105083012##ADT^A01#M2#P#2.5\rNTE#1##call 503-555-0177\r';
  const text = PLAIN + 'NTE|1||call 503-555-0166\r' + m2;
  const L = locate.createLocator(text, 'hl7');
  assert.equal(L(text.indexOf('503-555-0166')).path, 'NTE-3');
  const second = L(text.indexOf('503-555-0177'));
  assert.equal(second.path, 'NTE-3');
  assert.equal(second.unit, 2);
});

// ---- C2: the "Set in" cell ----------------------------------------------------------------------------------------------------

test('C2: a relative rule path from the user settings reads in one clear phrase in the report', async () => {
  const rules = ruleFile([{ format: 'hl7', path: 'PID-5', kind: 'keep' }]);
  const config = { rulesFile: 'rules.json' };
  const x = start({ config: config, configSources: { rulesFile: 'user' }, folders: [{ uri: M.Uri.file(rules.dir), name: 'work' }], answer: answerAll([]) });
  try {
    await x.run('maskAtlas.deidentifyDocument');
    const rep = reportOf(x);
    assert.match(rep, /maskAtlas\.rulesFile` \| 1 rule, 1 keeps a place \| rule file inside the workspace folder, path set in your user settings \|/);
    assert.doesNotMatch(rep, /workspace folder, rule file inside/);
  } finally { x.uninstall(); fs.rmSync(rules.dir, { recursive: true, force: true }); }
});

test('R1: digit kinds of the built-in profile on values with letters are no false alarm (account numbers, labelled phones and SSNs, the samples)', () => {
  const cases = [
    ['hl7', HDR + 'PID|1||MR1^^^H^MR||Zz^Yy||19700101|M|||||WORK EXT 12 541-555-0193\r'],
    ['hl7', HDR + 'PID|1||MR1^^^H^MR||Zz^Yy||19700101|M||||||||||||SSN 123-45-6789\r'],
    ['hl7', HDR + 'PID|1||MR1^^^H^MR||Zz^Yy||19700101|M|||||||||||||HC-ACC-228814\r'],
    ['x12', interchange('*', '~', '000000001', ['ST*837*0001*005010X222A1', 'NM1*IL*1*DRAVENKORT*SELMIRA', 'PER*IC*MAIN OFFICE*TE*503 555 0123 MAIN', 'SE*4*0001'])],
    ['fhir', JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Brightmoor' }], telecom: [{ system: 'phone', value: '503-555-0101 (mobile, evenings)' }, { system: 'url', value: 'host 10.20.30.40 gateway' }] })],
    ['hl7', samples.sampleFor('hl7').text], ['x12', samples.sampleFor('x12').text], ['fhir', samples.sampleFor('fhir').text]
  ];
  for (const [format, text] of cases) {
    const r = createRun({ mode: 'pseudonym', key: K.keyFromSeed('no false alarm seed') });
    const out = engine.processText(text, r, {});
    assert.equal(out.ok, true);
    const c = V.createVerifier(r).check(out.text, format);
    assert.equal(c.pass, true, format + ': ' + JSON.stringify([c.originalValues, c.patterns, c.fields, c.locations.slice(0, 2)]));
  }
});
