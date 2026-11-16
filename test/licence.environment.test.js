'use strict';
// The licence environment: an installed copy knows the live environment only (no test host, no
// test product id, no environment variable), the live product ids are the real ones, and the
// trial and Remove Licence tell the truth in the cases found in the sister products.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const F = require('./helpers/licence-fakes');
const messages = require('../src/licence/messages');

const ROOT = path.join(__dirname, '..');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const LIVE_PERSONAL = 'pdt_0Nrr95iSK7tpaVTCZvmUE';
const LIVE_BUSINESS = 'pdt_0Nrr9B7uPq2EyvvTKNiMt';

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('packaged form: the licence files alone reach the live host, name no test product and ignore a requested test mode', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maskatlas-packaged-'));
  try {
    for (const f of ['config.js', 'licence.js']) fs.copyFileSync(path.join(ROOT, 'src', 'licence', f), path.join(dir, f));
    const text = fs.readFileSync(path.join(dir, 'config.js'), 'utf8') + fs.readFileSync(path.join(dir, 'licence.js'), 'utf8');
    assert.doesNotMatch(text, /test\.(checkout\.)?dodopayments|pdt_0Ns19(sl5vz87CnhS3h8UL|z2nP3liY0trp6mAh)|process\.env/);
    const config = require(path.join(dir, 'config.js'));
    const L = require(path.join(dir, 'licence.js'));
    assert.deepEqual(config.knownEnvironments(), ['live']);
    assert.equal(config.resolve('test').mode, 'live');
    assert.equal(config.resolve('test').api, 'https://live.dodopayments.com');
    assert.deepEqual(config.allowedProductIds('test'), [LIVE_PERSONAL, LIVE_BUSINESS]);
    assert.equal(config.buyUrlFor('test', 'business', 2), 'https://checkout.dodopayments.com/buy/' + LIVE_BUSINESS + '?quantity=2');
    assert.deepEqual(config.placeholderIds(), []);
    assert.equal(config.assertShippable(require('../package.json')), true);
    const urls = [];
    const stores = F.stores();
    const lic = L.createLicence({ secrets: stores.secrets, globalState: stores.globalState, getMode: () => 'test', fetch: async (url) => { urls.push(url); return { status: 404, json: async () => ({}) }; } });
    await lic.activate('SOME-KEY');
    assert.deepEqual(urls, ['https://live.dodopayments.com/licenses/activate']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('nothing under src names a test environment, reads an environment variable or registers one', () => {
  for (const f of walk(path.join(ROOT, 'src'), [])) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    assert.doesNotMatch(text, /process\.env/, rel + ' reads an environment variable');
    assert.doesNotMatch(text, /test\.(checkout\.)?dodopayments|pdt_0Ns19(sl5vz87CnhS3h8UL|z2nP3liY0trp6mAh)|MASK_ATLAS_LICENCE/, rel + ' names a test environment or a placeholder id');
    if (rel !== 'src/licence/config.js') assert.doesNotMatch(text, /registerTestEnvironment/, rel + ' registers an environment');
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'licence', 'test-environment.js')), false);
});

test('the live product ids are the two real ones and the checkout links use them', () => {
  const config = require('../src/licence/config');
  assert.equal(config.products.live.personal, LIVE_PERSONAL);
  assert.equal(config.products.live.business, LIVE_BUSINESS);
  assert.equal(config.buyUrlFor('live', 'personal', 1), 'https://checkout.dodopayments.com/buy/' + LIVE_PERSONAL + '?quantity=1');
  assert.equal(config.buyUrlFor('live', 'business', 100), 'https://checkout.dodopayments.com/buy/' + LIVE_BUSINESS + '?quantity=100');
});

test('the manifest offers no setting or command that selects the licence environment', () => {
  const config = require('../src/licence/config');
  assert.deepEqual(config.environmentSwitches(require('../package.json')), []);
  const bad = { contributes: { configuration: { properties: { 'maskAtlas.licenceMode': {} } }, commands: [{ command: 'maskAtlas.useTestEnvironment', title: 'Use test environment' }] } };
  assert.equal(config.environmentSwitches(bad).length, 2);
});

// ---- the trial clock -----------------------------------------------------------------------------

test('trial: a clock set back to before the start and then corrected costs no days', async () => {
  const m = F.make();
  await m.lic.startTrial(); // 2026-11-12 10:00
  m.advance(3 * DAY);
  await m.lic.touchTrial();
  m.advance(-5 * DAY); // clock two days before the start
  assert.equal((await m.lic.checkTrial()).state, 'active');
  assert.equal(m.lic.trialStatus().daysLeft, 11, 'no extra day while the clock is wrong');
  m.advance(5 * DAY); // the clock is right again (day 3)
  const st = await m.lic.checkTrial();
  assert.equal(st.state, 'active');
  assert.equal(st.daysLeft, 11);
  assert.equal(st.endsAt, Date.UTC(2026, 10, 26, 10, 0, 0), 'the end is still day 14 after the start');
});

test('trial: the end date shown after the clock was set back is the true end', async () => {
  const m = F.make();
  const start = m.now();
  await m.lic.startTrial();
  m.advance(14 * DAY + 3 * HOUR);
  assert.equal((await m.lic.checkTrial()).state, 'expired');
  m.advance(-11 * DAY); // set back to day 3
  const st = m.lic.trialStatus();
  assert.equal(st.state, 'expired');
  assert.equal(st.endsAt, start + 14 * DAY, 'not day 3');
  assert.match(messages.proNoticeText('De-identify Message', st), /ended/);
});

test('trial: used time is kept when the clock is ahead at the start and later corrected within a day', async () => {
  const m = F.make();
  await m.lic.startTrial();
  m.advance(-HOUR * 12);
  assert.equal((await m.lic.checkTrial()).state, 'active');
  assert.equal(m.lic.trialStatus().daysLeft, 14);
});

test('trial: a record edited to start far in the future ends the trial', async () => {
  const a = F.make();
  a.s.globalMap.set('trial.startedAt', a.now() + 1000 * DAY);
  assert.equal((await a.lic.checkTrial()).state, 'expired');
});

test('trial: a clock set back 30 days after five days of use, then corrected, costs no day and records no end', async () => {
  const m = F.make();
  await m.lic.startTrial();
  m.advance(5 * DAY);
  await m.lic.touchTrial();
  m.advance(-30 * DAY); // a dead clock battery or a restored snapshot
  const during = await m.lic.checkTrial();
  assert.equal(during.state, 'active', 'still running while the clock is wrong');
  assert.equal(m.s.globalMap.has('trial.expiredAt'), false, 'nothing is recorded as ended');
  assert.equal(await m.lic.hasAccess(), true);
  m.advance(30 * DAY); // the clock is right again (day 5)
  const after = await m.lic.checkTrial();
  assert.equal(after.state, 'active');
  assert.equal(after.daysLeft, 9, 'nine of the fourteen days are left');
  m.advance(10 * DAY);
  assert.equal((await m.lic.checkTrial()).state, 'expired', 'it ends on day 14 as it should');
});

test('trial: it needs no network and no key, and starts only at the first Pro command', async () => {
  const m = F.make();
  assert.equal(m.lic.trialStatus().state, 'unused');
  assert.equal(await m.lic.hasAccess(), false, 'looking at the state never starts the trial');
  assert.equal((await m.lic.startTrial()).state, 'active');
  assert.equal(await m.lic.hasAccess(), true);
  assert.equal(m.srv.calls.length, 0, 'no request was made');
});

// ---- Remove Licence ------------------------------------------------------------------------------

test('Remove Licence says why an activation could not be freed: no answer, or another status', async () => {
  const a = F.make();
  await a.lic.activate('KEY-PERSONAL');
  a.srv.options.noDeactivate = true;
  const refused = await a.lic.remove();
  assert.deepEqual(refused, { ok: true, deactivated: false, reason: 'status', status: 500 });
  assert.equal(a.s.secretsMap.size, 0, 'the key is removed from this computer anyway');

  const b = F.make();
  await b.lic.activate('KEY-PERSONAL');
  b.srv.options.down = true;
  const offline = await b.lic.remove();
  assert.deepEqual(offline, { ok: true, deactivated: false, reason: 'network' });

  const c = F.make();
  await c.lic.activate('KEY-PERSONAL');
  assert.deepEqual(await c.lic.remove(), { ok: true, deactivated: true });
  assert.equal(c.srv.active.size, 0, 'the seat is free again');
  const none = F.make();
  assert.deepEqual(await none.lic.remove(), { ok: true, deactivated: true });
});

test('customer details of the activation answer are never stored and never reach a log call', async () => {
  const m = F.make();
  await m.lic.activate('KEY-PERSONAL');
  const stored = JSON.stringify(Array.from(m.s.globalMap.entries())) + JSON.stringify(Array.from(m.s.secretsMap.entries()));
  assert.doesNotMatch(stored, /buyer@example\.com|Test Buyer|cus_1|lic_1|bus_1/);
  const source = fs.readFileSync(path.join(ROOT, 'src', 'licence', 'licence.js'), 'utf8');
  assert.doesNotMatch(source, /\.customer\b|console\.|appendLine/);
});
