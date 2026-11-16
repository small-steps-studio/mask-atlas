'use strict';
// The package and the repository as a whole: the manifest is wired to the code and to the
// documents, every relative link and image in the Markdown files resolves inside the repository,
// the source holds no network, process or random-number shortcuts, and every file the extension
// requires is in the package.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const mock = require('./helpers/vscode-mock');

const ROOT = path.join(__dirname, '..');
const read = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); };
function walk(dir, out, skip) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (skip && skip.test(rel)) continue;
    if (e.isDirectory()) walk(rel, out, skip); else out.push(rel);
  }
  return out;
}

test('manifest: identity, version, pricing, engine and links', () => {
  assert.equal(pkg.name, 'mask-atlas');
  assert.equal(pkg.displayName, 'Mask Atlas');
  assert.equal(pkg.publisher, 'SmallStepsStudio');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.pricing, 'Trial');
  assert.equal(pkg.engines.vscode, '^1.82.0');
  assert.equal(pkg.homepage, 'https://github.com/small-steps-studio/mask-atlas#readme');
  assert.equal(pkg.repository.url, 'https://github.com/small-steps-studio/mask-atlas');
  assert.equal(pkg.bugs.url, 'https://github.com/small-steps-studio/mask-atlas/issues');
  assert.equal(pkg.license, 'SEE LICENSE IN LICENSE.txt');
  assert.ok(pkg.keywords.length <= 30, 'at most 30 keywords');
  for (const k of pkg.keywords) assert.doesNotMatch(k, /hipaa|gdpr|complian|certif|guarantee/i, k);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.match(pkg.description, /not a guarantee/);
  assert.equal(JSON.stringify(pkg).match(/licen[cs]e.?(mode|env|environment|server)|test.?(mode|environment)|sandbox/i), null, 'no setting or text that selects the licence environment');
  assert.equal(pkg.activationEvents.length, 0, 'commands activate the extension on use');
});

test('manifest: every command is registered by the code, titled with the product name, and listed in the README', () => {
  const m = mock.createMock();
  const ext = mock.startExtension(ROOT, pkg, m);
  const registered = new Set(Array.from(m.state.commands.keys()));
  const ids = pkg.contributes.commands.map(function (c) { return c.command; });
  assert.equal(new Set(ids).size, ids.length, 'no duplicate command ids');
  assert.equal(ids.length, 22);
  const readme = read('README.md');
  for (const c of pkg.contributes.commands) {
    assert.match(c.title, /^Mask Atlas: /, c.command);
    assert.ok(registered.has(c.command), c.command + ' is registered by the extension');
    const short = c.title.replace('Mask Atlas: ', '').replace(/ \(Pro\)$/, '');
    assert.ok(readme.indexOf(short) !== -1, 'README mentions ' + short);
  }
  for (const id of registered) if (/^maskAtlas\./.test(id)) assert.ok(ids.indexOf(id) !== -1, id + ' is declared in the manifest');
  ext.uninstall();
});

test('manifest: settings are read by the code, documented in the README and the docs, and well formed', () => {
  const props = pkg.contributes.configuration.properties;
  const readme = read('README.md');
  const source = read('src/extension.js');
  const docs = walk('docs', [], null).map(read).join('\n');
  for (const [key, p] of Object.entries(props)) {
    assert.ok(readme.indexOf('`' + key + '`') !== -1, 'README documents ' + key);
    assert.ok(docs.indexOf('`' + key + '`') !== -1, 'the docs document ' + key);
    const short = key.replace(/^maskAtlas\./, '');
    assert.ok(source.indexOf("'" + short + "'") !== -1, 'the extension reads ' + key);
    assert.ok(p.markdownDescription && p.markdownDescription.length > 40, key + ' has a description');
    assert.ok('default' in p && p.type, key + ' has a type and a default');
  }
  assert.equal(Object.keys(props).length, 9);
});

test('manifest: menus and walkthrough point at declared commands and existing files', () => {
  const ids = new Set(pkg.contributes.commands.map(function (c) { return c.command; }));
  const menus = pkg.contributes.menus;
  for (const list of Object.values(menus)) for (const item of list) if (item.command) assert.ok(ids.has(item.command), item.command);
  const walk1 = pkg.contributes.walkthroughs[0];
  assert.equal(walk1.steps.length, 5);
  for (const step of walk1.steps) {
    assert.ok(fs.existsSync(path.join(ROOT, step.media.markdown)), step.media.markdown);
    for (const m of step.description.matchAll(/\(command:([A-Za-z.]+)\)/g)) assert.ok(ids.has(m[1]), 'walkthrough link ' + m[1]);
    for (const e of step.completionEvents) if (/^onCommand:/.test(e)) assert.ok(ids.has(e.slice('onCommand:'.length)), e);
  }
  assert.ok(fs.existsSync(path.join(ROOT, pkg.icon)));
  const png = fs.readFileSync(path.join(ROOT, pkg.icon));
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 128);
  for (const j of pkg.contributes.jsonValidation) assert.ok(fs.existsSync(path.join(ROOT, j.url)), j.url);
  assert.doesNotThrow(function () { JSON.parse(read('schemas/rules.schema.json')); });
});

test('the rule file schema lists exactly the kinds, formats and date layouts that the reader accepts, and the documented examples parse', () => {
  const rules = require('../src/pro/rules');
  const schema = JSON.parse(read('schemas/rules.schema.json'));
  const item = schema.properties.rules.items.properties;
  assert.deepEqual(item.kind.enum.slice().sort(), Object.keys(rules.KINDS).sort());
  assert.deepEqual(item.format.enum, ['hl7', 'x12', 'fhir']);
  assert.equal(schema.properties.rules.maxItems, rules.MAX_RULES);
  assert.equal(rules.parseRules(rules.templateText()).ok, true);
  const text = read('docs/rules.md');
  let blocks = 0;
  for (const m of text.matchAll(/```json\n([\s\S]*?)```/g)) { blocks++; const r = rules.parseRules(m[1]); assert.equal(r.ok, true, JSON.stringify(r.errors)); }
  assert.ok(blocks >= 3);
});

test('every relative link and image of the Markdown files resolves inside the repository, anchors included', () => {
  const files = ['README.md', 'CHANGELOG.md', 'PRIVACY.md', 'TERMS.md'].concat(walk('docs', [], null), walk('media/walkthrough', [], null).filter(function (f) { return /\.md$/.test(f); }));
  const slug = function (h) { return h.toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{Nd}\s-]/gu, '').trim().replace(/\s/g, '-'); };
  const anchors = function (file) { const set = new Set(); for (const m of read(file).matchAll(/^#{1,6}\s+(.+)$/gm)) set.add(slug(m[1])); return set; };
  let links = 0;
  for (const file of files) {
    const text = read(file);
    for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|command:)/.test(target)) continue;
      links++;
      const [rel, anchor] = target.split('#');
      const resolved = rel ? path.posix.normalize(path.posix.join(path.posix.dirname(file), rel)) : file;
      assert.ok(fs.existsSync(path.join(ROOT, resolved)), file + ' links to ' + target + ', which does not exist in the repository');
      if (anchor && /\.md$/.test(resolved)) assert.ok(anchors(resolved).has(anchor), file + ' links to ' + target + ': no such heading');
    }
  }
  assert.ok(links > 60, 'links checked: ' + links);
});

test('every external address in the shipped texts is on the list of expected hosts', () => {
  const allowed = new Set(['github.com', 'marketplace.visualstudio.com', 'dodopayments.com', 'live.dodopayments.com', 'checkout.dodopayments.com', 'open-vsx.org']);
  const files = ['README.md', 'CHANGELOG.md', 'PRIVACY.md', 'TERMS.md', 'LICENSE.txt'].concat(walk('src', [], null), walk('media/walkthrough', [], null), ['package.json']);
  const found = new Set();
  for (const f of files) for (const m of read(f).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
    const host = m[1].replace(/\.$/, '');
    if (/\.example$|^localhost$|^www\.w3\.org$|^hl7\.org$|^terminology\.hl7\.org$|^loinc\.org$|^snomed\.info$|^unitsofmeasure\.org$|^portal\.|^claims\./.test(host)) continue;
    found.add(host);
  }
  for (const h of found) assert.ok(allowed.has(h) || /^[a-z0-9-]+\.example/.test(h), 'unexpected host ' + h);
});

test('the source: no random numbers, no console, no process or shell access, no network except the licence call, no eval', () => {
  const files = walk('src', [], null);
  assert.ok(files.length > 20);
  for (const f of files) {
    const text = read(f);
    assert.doesNotMatch(text, /Math\.random/, f);
    assert.doesNotMatch(text, /console\.(log|error|warn|info|debug)/, f);
    assert.doesNotMatch(text, /child_process|\beval\(|new Function\(|process\.env|require\('(node:)?(http|https|net|tls|dgram|dns)'\)/, f);
    if (f !== 'src/licence/licence.js') assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|WebSocket/, f);
    assert.doesNotMatch(text, /[A-Za-z]:\\Users\\|\/home\/[a-z]+\//, f);
  }
  const lic = read('src/licence/licence.js');
  assert.equal((lic.match(/\bfetch\b/g) || []).length > 0, true);
  assert.doesNotMatch(lic, /\.customer\b/);
});

test('every module that the extension requires exists and nothing outside src is required at run time', () => {
  const seen = new Set();
  const stack = ['src/extension.js'];
  // the engine worker is started by file name (worker_threads), not by require
  assert.ok(read('src/worker/client.js').indexOf("path.join(__dirname, 'engine-worker.js')") !== -1, 'the client starts the engine worker');
  stack.push('src/worker/engine-worker.js');
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of read(f).matchAll(/require\('([^']+)'\)/g)) {
      const name = m[1];
      if (name === 'vscode' || /^node:/.test(name)) continue;
      assert.ok(name.charAt(0) === '.', f + ' requires "' + name + '", which is neither a built-in module nor a relative file');
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), name));
      const file = fs.existsSync(path.join(ROOT, target + '.js')) ? target + '.js' : fs.existsSync(path.join(ROOT, target)) ? target : null;
      assert.ok(file, f + ' requires ' + name + ', which does not exist');
      assert.ok(/^(src\/|package\.json$)/.test(file), f + ' requires ' + file + ' outside src');
      if (/\.js$/.test(file)) stack.push(file);
    }
  }
  assert.ok(seen.size > 20, 'modules reached: ' + seen.size);
  const shipped = walk('src', [], null);
  for (const f of shipped) assert.ok(seen.has(f), f + ' is in src but never required (dead file in the package)');
});

test('the ignore files keep notes, tests, scripts and screenshots out of the package, and notes out of git', () => {
  const vsix = read('.vscodeignore').split(/\r?\n/);
  for (const needed of ['test/**', 'scripts/**', 'docs/**', '.github/**', 'STATUS*', 'SPEC-*.md', 'QA-*.md', 'TODO-BEFORE-PUBLISH.md', '**/*.vsix', 'media/screenshots/**']) assert.ok(vsix.indexOf(needed) !== -1, '.vscodeignore lists ' + needed);
  const git = read('.gitignore').split(/\r?\n/);
  for (const needed of ['STATUS*', 'SPEC-*.md', 'QA-*.md', 'TODO-BEFORE-PUBLISH.md', '*.vsix', 'test/smoke/']) assert.ok(git.indexOf(needed) !== -1, '.gitignore lists ' + needed);
  assert.ok(git.indexOf('*.log') === -1 || !walk('test/fixtures', [], null).some(function (f) { return /\.log$/.test(f); }), 'no fixture is hidden by a *.log rule');
  // every test fixture the tests read is committed: no fixture path is matched by a .gitignore rule
  for (const f of walk('test/fixtures', [], null)) for (const rule of git) {
    if (!rule || rule[0] === '#') continue;
    const re = new RegExp('^' + rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$', 'i');
    assert.ok(!re.test(f) && !re.test(path.posix.basename(f)), f + ' would be ignored by git rule ' + rule);
  }
});

test('the CI workflow follows the repository rule and claims nothing the tests do not do', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /actions\/checkout@v7/);
  assert.match(ci, /actions\/setup-node@v7/);
  assert.match(ci, /node: \[22, 24\]/);
  assert.match(ci, /ubuntu-latest, windows-latest, macos-latest/);
  assert.doesNotMatch(ci, /@v4|@v5|@v6|node: \[20/);
  assert.match(ci, /upload-artifact@v7/);
  assert.doesNotMatch(ci, /setup-python/);
  assert.doesNotMatch(ci, /secrets\./);
  for (const f of ['README.md', 'CHANGELOG.md', 'PRIVACY.md', 'TERMS.md']) assert.doesNotMatch(read(f), /\b(CI|continuous integration|workflow) (has|have) (run|passed)|build (badge|status)|tested on (macOS|Linux)/i, f);
});

test('audit 14 and 15: no keyword suggests that the product makes up data, and every use of the packaging tool names its version', () => {
  assert.ok(!pkg.keywords.some(function (k) { return /synthetic/i.test(k); }), 'keywords: ' + pkg.keywords.join(', '));
  assert.ok(pkg.keywords.length <= 30);
  const uses = [pkg.scripts.package, read('.github/workflows/ci.yml')].join('\n').match(/@vscode\/vsce(@\S+)?/g) || [];
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /@vscode\/vsce@\d+\.\d+\.\d+$/, 'unpinned: ' + u);
});

test('a time-zone variant of the suite really runs in that time zone', () => {
  if (!process.env.MASK_ATLAS_TZ) return;
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, process.env.MASK_ATLAS_TZ);
});
