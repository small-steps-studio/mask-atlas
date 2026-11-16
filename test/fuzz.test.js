'use strict';
// Seeded fuzzing (a small random-sequence function written for this file, fixed seeds, so every run is the same):
// (1) damaged copies of the corpus files go through both modes and must never throw, hang or show
// a stack; (2) messages built by the test carry random invented identifiers in profile fields and none
// may survive; (3) hostile inputs of every shape are refused or handled in under a few seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./helpers/corpus');
const K = require('../src/core/keyed');
const engine = require('../src/core/engine');
const { createRun } = require('../src/core/run');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = function (rnd, list) { return list[Math.floor(rnd() * list.length)]; };

// ---- (1) damaged copies of the corpus ----------------------------------------------------------------

const DAMAGE = [
  function cut(t, r) { const a = Math.floor(r() * t.length); return t.slice(0, a); },
  function drop(t, r) { const a = Math.floor(r() * t.length); return t.slice(0, a) + t.slice(a + 1 + Math.floor(r() * 40)); },
  function dup(t, r) { const a = Math.floor(r() * t.length); const b = Math.min(t.length, a + Math.floor(r() * 300)); return t.slice(0, b) + t.slice(a, b) + t.slice(b); },
  function insert(t, r) { const a = Math.floor(r() * t.length); return t.slice(0, a) + pick(r, ['|', '^', '~', '&', '\\', '"', '{', '}', '[', ']', '*', ':', '\u0000', '‮', '\ud800', '\r', '\n', 'é', ' ', '﻿', ' ']) + t.slice(a); },
  function swap(t, r) { const a = Math.floor(r() * t.length); const b = Math.floor(r() * t.length); const c = t.split(''); const x = c[a]; c[a] = c[b]; c[b] = x; return c.join(''); },
  function flood(t, r) { const a = Math.floor(r() * t.length); return t.slice(0, a) + pick(r, ['|', '^', '*', '~', '"', '[', '{']).repeat(1 + Math.floor(r() * 2000)) + t.slice(a); },
  function lines(t, r) { const l = t.split(/\r\n|\r|\n/); return l.filter(function () { return r() > 0.3; }).join(pick(r, ['\r', '\n', '\r\n'])); }
];

function diffHint(a, b) {
  const lineBreak = new RegExp(String.fromCharCode(92) + "r" + String.fromCharCode(92) + "n|" + String.fromCharCode(92) + "r|" + String.fromCharCode(92) + "n");
  const x = a.split(lineBreak), y = b.split(lineBreak);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || '').length !== (y[i] || '').length) return ' | line ' + (i + 1) + ': ' + JSON.stringify((x[i] || '').slice(0, 160)) + ' -> ' + JSON.stringify((y[i] || '').slice(0, 160));
  return '';
}

function safe(r) {
  assert.ok(r && typeof r === 'object');
  if (r.ok === false) { assert.equal(typeof r.message, 'string'); assert.doesNotMatch(r.message, /node:internal|\bat .*\.js:\d+|TypeError|RangeError|undefined|\[object/); }
  else assert.equal(typeof r.text, 'string');
}

for (const seed of [11, 2026, 90210]) {
  test('damaged copies of the corpus (seed ' + seed + '): no throw, no stack, both modes, every case fast', () => {
    const rnd = mulberry32(seed);
    const files = C.manifest.files;
    let cases = 0, accepted = 0;
    const t0 = Date.now();
    for (let n = 0; n < 150; n++) {
      const entry = files[Math.floor(rnd() * files.length)];
      let text = C.readFixtureUtf8(entry.file);
      for (let k = 0, times = 1 + Math.floor(rnd() * 4); k < times; k++) text = pick(rnd, DAMAGE)(text, rnd);
      const started = Date.now();
      for (const mode of ['pseudonym', 'mask']) {
        const r = engine.processText(text, createRun({ mode: mode, key: K.keyFromSeed('fuzz key phrase 1') }), {});
        safe(r); cases++;
        if (r.ok) { accepted++; if (mode === 'mask' && r.format !== 'fhir' && r.format !== 'ndjson' && (text.indexOf('MSH|^~' + String.fromCharCode(92) + '&|') === 0 || text.indexOf('ISA*') === 0)) assert.equal(r.text.length, text.length, entry.file + ' mask keeps the length' + diffHint(text, r.text)); }
        const scan = engine.processText(text, createRun({ mode: 'pseudonym' }), { scanOnly: true });
        safe(scan);
      }
      assert.ok(Date.now() - started < 12000, 'one damaged file took ' + (Date.now() - started) + ' ms');
    }
    assert.ok(accepted > cases * 0.3, 'enough damaged files were still read: ' + accepted + ' of ' + cases);
    assert.ok(Date.now() - t0 < 120000);
  });
}

// ---- (2) built messages with random invented identifiers ---------------------------------------------

function word(rnd, min, max) {
  const cons = 'bcdfghjklmnprstvwz', vow = 'aeiou';
  let s = '';
  const n = min + Math.floor(rnd() * (max - min + 1));
  for (let i = 0; i < n; i++) s += i % 2 ? vow[Math.floor(rnd() * 5)] : cons[Math.floor(rnd() * cons.length)];
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function digits(rnd, n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(rnd() * 10); return s; }

function makeHl7(rnd) {
  const family = word(rnd, 7, 10), given = word(rnd, 6, 9), mother = word(rnd, 7, 10);
  const mrn = 'MR' + digits(rnd, 8), ssn = digits(rnd, 3) + '-' + digits(rnd, 2) + '-' + digits(rnd, 4), phone = '(' + digits(rnd, 3) + ')' + digits(rnd, 3) + '-' + digits(rnd, 4);
  const street = (1 + Math.floor(rnd() * 998)) + ' ' + word(rnd, 8, 11) + ' STREET', email = given.toLowerCase() + '.' + family.toLowerCase() + '@postbox.example';
  const text = [
    'MSH|^~\\&|REGAPP|' + word(rnd, 8, 10).toUpperCase() + ' GENERAL|LABAPP|LAB|20261105083012||ADT^A01|MSG' + digits(rnd, 8) + '|P|2.5',
    'PID|1||' + mrn + '^^^HGH^MR~' + ssn + '^^^SSA^SS||' + family + '^' + given + '||' + '19' + digits(rnd, 2) + '0' + (1 + Math.floor(rnd() * 9)) + '1' + Math.floor(rnd() * 9) + '|F|||' + street + '^^' + word(rnd, 8, 10) + '^OH^43017||' + phone + '^PRN^PH^' + email,
    'NK1|1|' + mother + '^' + word(rnd, 6, 9) + '|MTH|' + street + '|' + phone,
    'NTE|1||Spoke with the patient ' + family + ' and her mother ' + mother + '. Call ' + phone + ' or write to ' + email + '.'
  ].join('\r') + '\r';
  return { text: text, seeded: [family, given, mother, mrn, ssn, phone.replace(/\D/g, '').slice(0, 3) + ')' + phone.slice(5), street.split(' ')[1], email] };
}

function makeX12(rnd) {
  const family = word(rnd, 7, 10), given = word(rnd, 6, 9), member = 'MBR' + digits(rnd, 9), ssn = digits(rnd, 3) + '-' + digits(rnd, 2) + '-' + digits(rnd, 4);
  const street = (1 + Math.floor(rnd() * 998)) + ' ' + word(rnd, 8, 11).toUpperCase() + ' ROAD', city = word(rnd, 8, 10).toUpperCase();
  const control = digits(rnd, 9);
  const segs = ['GS*HC*SENDER*RECEIVER*20261105*0830*1*X*005010X222A1', 'ST*837*0001*005010X222A1', 'BHT*0019*00*B1*20261105*0830*CH',
    'NM1*IL*1*' + family.toUpperCase() + '*' + given.toUpperCase() + '*A***MI*' + member, 'N3*' + street, 'N4*' + city + '*TX*75001', 'DMG*D8*19800214*F', 'REF*SY*' + ssn,
    'NTE*ADD*PATIENT ' + family.toUpperCase() + ' ' + given.toUpperCase() + ' LIVES AT ' + street, 'SE*10*0001', 'GE*1*1'];
  const text = 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *261105*0830*^*00501*' + control + '*0*P*:~' + segs.join('~') + '~IEA*1*' + control + '~\n';
  return { text: text, seeded: [family.toUpperCase(), given.toUpperCase(), member, ssn, street.split(' ')[1], city] };
}

function makeFhir(rnd) {
  const family = word(rnd, 7, 10), given = word(rnd, 6, 9), mrn = 'MRN-' + digits(rnd, 8), phone = '+1 ' + digits(rnd, 3) + ' ' + digits(rnd, 3) + ' ' + digits(rnd, 4), email = given.toLowerCase() + '@postbox.example';
  const street = (1 + Math.floor(rnd() * 998)) + ' ' + word(rnd, 8, 11) + ' Lane', city = word(rnd, 8, 10);
  const pat = { resourceType: 'Patient', id: 'pt-' + digits(rnd, 6), identifier: [{ system: 'http://clinic.example/mrn', value: mrn }], name: [{ family: family, given: [given] }],
    telecom: [{ system: 'phone', value: phone }, { system: 'email', value: email }], birthDate: '19' + digits(rnd, 2) + '-0' + (1 + Math.floor(rnd() * 9)) + '-1' + Math.floor(rnd() * 9),
    address: [{ line: [street], city: city, postalCode: '43017' }] };
  const obs = { resourceType: 'Observation', id: 'ob-' + digits(rnd, 6), status: 'final', code: { text: 'Pulse' }, subject: { reference: 'Patient/' + pat.id }, note: [{ text: 'Visited by ' + given + ' ' + family + ' at ' + street + ', phone ' + phone }] };
  return { text: JSON.stringify({ resourceType: 'Bundle', type: 'collection', entry: [{ fullUrl: 'urn:uuid:' + pat.id, resource: pat }, { resource: obs }] }, null, 2), seeded: [family, given, mrn, phone, email, street.split(' ')[1], city] };
}

for (const [label, make] of [['HL7', makeHl7], ['X12', makeX12], ['FHIR', makeFhir]]) {
  test('built ' + label + ' messages with random invented identifiers: none survives a Pro run, the structure stays', () => {
    const rnd = mulberry32(label.length * 7919 + 17);
    let checked = 0;
    for (let n = 0; n < 250; n++) {
      const m = make(rnd);
      const run = createRun({ mode: 'pseudonym', key: K.keyFromSeed('built message key phrase') });
      const r = engine.processText(m.text, run, {});
      assert.equal(r.ok, true, r.message);
      const low = r.text.toLowerCase();
      for (const s of m.seeded) { assert.ok(low.indexOf(s.toLowerCase()) === -1, label + ' message ' + n + ': "' + s.slice(0, 2) + '..." (length ' + s.length + ') survived'); checked++; }
      if (label === 'HL7') assert.equal(r.text.split('\r').length, m.text.split('\r').length);
      if (label === 'X12') { assert.equal(r.text.indexOf('~'), 105, 'the ISA segment keeps its 106 characters'); assert.equal(r.text.split('~').length, m.text.split('~').length); }
      if (label === 'FHIR') assert.deepEqual(Object.keys(JSON.parse(r.text)), Object.keys(JSON.parse(m.text)));
    }
    assert.ok(checked >= 250 * 5);
  });
}

// ---- (3) hostile inputs ----------------------------------------------------------------------------------------

test('hostile inputs are refused or handled quickly, never with a stack or a hang', () => {
  const deep = '['.repeat(20000) + ']'.repeat(20000);
  const cases = {
    empty: '', spaces: '   \n\t ', nul: '\u0000'.repeat(500), bom: '﻿', bomOnlyMsh: '﻿MSH|^~\\&|',
    mshShort: 'MSH|', mshNoEnc: 'MSH|^~\\&', mshWeird: 'MSH#^~\\&#A#B', pidOnly: 'PID|1||X', manyEmpty: 'PID|\r'.repeat(100000), longField: 'MSH|^~\\&|' + 'A'.repeat(1000000),
    repetitions: 'MSH|^~\\&|A\rPID|1||' + '1^^^X~'.repeat(100000), components: 'MSH|^~\\&|A\rPID|1||' + 'a^'.repeat(100000), subcomponents: 'MSH|^~\\&|A\rPID|1||' + 'a&'.repeat(100000),
    escapes: 'MSH|^~\\&|A\rNTE|1||' + '\\F\\'.repeat(100000), unterminatedEscape: 'MSH|^~\\&|A\rNTE|1||' + '\\X0D'.repeat(50000),
    isaShort: 'ISA*00*', isaOnly: 'ISA*00*          *00*          *ZZ*A              *ZZ*B              *261105*0830*^*00501*000000001*0*P*:~',
    isaMany: ('ISA*00*          *00*          *ZZ*A              *ZZ*B              *261105*0830*^*00501*000000001*0*P*:~IEA*1*000000001~').repeat(3000),
    jsonDeep: '{"resourceType":"Patient","x":' + deep + '}', jsonDup: '{"resourceType":"Patient","id":"a","id":"b","name":[{"family":"Duplicated"}],"name":[{"family":"Second"}]}',
    jsonProto: '{"resourceType":"Patient","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"name":[{"family":"Protoname","given":["Constructor"]}]}',
    jsonBigNumber: '{"resourceType":"Observation","id":"o","valueQuantity":{"value":12345678901234567890123.456789e400}}', jsonTrailing: '{"resourceType":"Patient"} {"x":1}',
    jsonEscapes: '{"resourceType":"Patient","name":[{"family":"\\u0041lice\\ud800","given":["\\u0000\\n"]}]}', jsonNameKeys: '{"resourceType":"Patient","Zorbel Quint":"Zorbel Quint","name":[{"family":"Zorbel"}]}',
    array: '[' + '{"resourceType":"Patient","name":[{"family":"Arraymember"}]},'.repeat(5000) + '{"resourceType":"Patient"}]', ndjsonBad: '{"resourceType":"Patient"}\n{bad\n{"resourceType":"Patient"}\n',
    binary: Array.from({ length: 4000 }, function (_, i) { return String.fromCharCode((i * 131) % 256); }).join('')
  };
  const results = {};
  for (const [name, text] of Object.entries(cases)) {
    const started = Date.now();
    for (const mode of ['pseudonym', 'mask']) {
      const r = engine.processText(text, createRun({ mode: mode }), {});
      safe(r);
      results[name] = r.ok;
    }
    engine.processText(text, createRun({ mode: 'pseudonym' }), { scanOnly: true });
    assert.ok(Date.now() - started < 8000, name + ' took ' + (Date.now() - started) + ' ms');
  }
  assert.equal(({}).polluted, undefined, 'the prototype was not polluted');
  assert.equal(results.empty, false);
  assert.equal(results.nul, false);
});

test('hostile values in a FHIR resource keep their names out of the output and the structure intact', () => {
  const r = engine.processText('{"resourceType":"Patient","__proto__":{"x":1},"name":[{"family":"Protoname","given":["Constructor"]}],"id":"hostile-1"}', createRun({ mode: 'pseudonym' }), {});
  assert.equal(r.ok, true);
  assert.ok(r.text.indexOf('Protoname') === -1);
  assert.equal(({}).x, undefined);
});
