'use strict';
// The seen-value matcher files every value under its first word and compares only the values
// whose first word is in the text. It must find exactly what the matcher it replaced found (one
// regular expression per kind of value, kept in test/helpers/seen-reference.js), and its time must
// grow in proportion to the number of values and texts, not with their product.
const test = require('node:test');
const assert = require('node:assert/strict');
const free = require('../src/core/free');
const { createSeenReference } = require('./helpers/seen-reference');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = function (rnd, list) { return list[Math.floor(rnd() * list.length)]; };

const NAMES = ['Quillfeather', 'Fenwick', "O'Brien", 'Mary-Anne', 'Zoe', 'Alderiq', 'Marisolveth', 'Dravenholt', 'Nguyen', 'Li', 'Rose', 'Mark', 'Brightwater', 'Van-Dyke', 'Bj' + String.fromCharCode(0xf6) + 'rn', String.fromCharCode(0xc5) + 'sa', 'Pinkerton-Valdivia', 'Pinkerton', 'Valdivia', "'Tis-Ana", '-Anneliese', '(Patricia)', '#Zedmund', "'t-Hooft"];
const STREETS = ['4127 Lindenmoor Terrace', '41 Wren Hollow Road', 'Harrow Pell Joinery', 'St. Mary Hospital', '12 Elm St.', 'Fernbury', '(c/o) Records Office', '900 Quayside Row'];
const IDS = ['HC-7305518', 'MR4471920', 'A-1B2C3', 'hm-member-4417203', 'POL/77-12', 'X9Z9Q', '#44-221'];
const PHONES = ['312-555-0141', '(614) 555-0187', '+1 603 555 0177', '5550141', '1-800-555-0100'];
const NOISE = ['the', 'patient', 'called', 'about', 'and', ',', '.', ';', '(', ')', '-', "'", '/', 'at', 'on', '12', '2026', 'x'];

function build(rnd) {
  const kinds = [['family', NAMES], ['given', NAMES], ['org', STREETS], ['street', STREETS], ['city', STREETS], ['record', IDS], ['plan', IDS], ['phone', PHONES], ['ssn', ['926-41-7390', '926 41 7390']]];
  const added = [];
  const count = 1 + Math.floor(rnd() * 9);
  for (let i = 0; i < count; i++) { const [kind, list] = pick(rnd, kinds); added.push([kind, pick(rnd, list)]); }
  const pieces = [];
  const length = 2 + Math.floor(rnd() * 14);
  for (let i = 0; i < length; i++) {
    const r = rnd();
    if (r < 0.35 && added.length) {
      let v = pick(rnd, added)[1];
      const mode = rnd();
      if (mode < 0.3) v = v.toUpperCase(); else if (mode < 0.5) v = v.toLowerCase();
      if (rnd() < 0.15) v = v.replace(/ /g, '   ');
      pieces.push(v);
    } else pieces.push(pick(rnd, NOISE));
  }
  const text = pieces.join(rnd() < 0.8 ? ' ' : '');
  return { added: added, text: text };
}

const key = function (m) { return m.start + '-' + m.end + '-' + m.kind + '-' + m.category; };

test('the head-indexed matcher finds what the regular-expression matcher found, on 6,000 random cases', () => {
  const rnd = mulberry32(20261115);
  let withMatch = 0, total = 0;
  for (let n = 0; n < 6000; n++) {
    const { added, text } = build(rnd);
    const a = free.createSeen(), b = createSeenReference();
    for (const [kind, value] of added) { a.add(kind, value); b.add(kind, value); }
    for (const only of [false, true]) {
      const x = Array.from(new Set(a.find(text, only).map(key))).sort();
      const y = Array.from(new Set(b.find(text, only).map(key))).sort();
      assert.deepEqual(x, y, JSON.stringify({ added: added, text: text, distinctiveOnly: only }));
      if (x.length) withMatch++;
      total++;
    }
  }
  assert.ok(withMatch > total * 0.3, 'the random cases produced matches: ' + withMatch + ' of ' + total);
});

test('the matcher handles overlaps between a long and a short form of a name, and a value that starts with a symbol', () => {
  const seen = free.createSeen();
  seen.add('family', 'Pinkerton-Valdivia');
  seen.add('family', 'Valdivia');
  seen.add('record', '#44-221');
  seen.add('street', '12 Elm St.');
  const text = 'Pinkerton-Valdivia and Valdivia, ref #44-221 at 12 Elm St. today';
  const found = seen.find(text, false).map(function (m) { return text.slice(m.start, m.end); }).sort();
  const reference = createSeenReference();
  reference.add('family', 'Pinkerton-Valdivia'); reference.add('family', 'Valdivia'); reference.add('record', '#44-221'); reference.add('street', '12 Elm St.');
  assert.deepEqual(found, reference.find(text, false).map(function (m) { return text.slice(m.start, m.end); }).sort());
  assert.ok(found.indexOf('Pinkerton-Valdivia') !== -1 && found.indexOf('12 Elm St.') !== -1);
});

test('time grows in proportion: 30,000 seen values and 30,000 texts in a few seconds, and twice the work takes about twice the time', () => {
  function work(n) {
    const seen = free.createSeen();
    for (let i = 0; i < n; i++) {
      seen.add('family', 'Zorbel' + String.fromCharCode(97 + (i % 26)) + 'quint' + String.fromCharCode(97 + ((i / 26) | 0) % 26) + i.toString(36).replace(/\d/g, 'x'));
      seen.add('street', (100 + (i % 800)) + ' ' + 'Pellmoor' + i.toString(36).replace(/\d/g, 'q') + ' Road');
      seen.add('record', 'MR-' + (1000000 + i));
      seen.add('phone', '(' + (200 + (i % 700)) + ') ' + (100 + ((i / 7) | 0) % 800) + '-' + String(1000 + (i % 9000)));
    }
    const started = Date.now();
    let found = 0;
    for (let i = 0; i < n; i++) found += seen.find('Spoke with the patient about 4 new items, ref 12345 and the plan of 2026-11-04 at the clinic; call back later.', false).length + seen.find('MR-' + (1000000 + i) + ' seen', true).length;
    return { ms: Date.now() - started, found: found };
  }
  const small = work(10000);
  const big = work(30000);
  assert.ok(big.ms < 8000, 'thirty thousand values and texts took ' + big.ms + ' ms');
  assert.ok(big.ms < Math.max(300, small.ms * 8), 'three times the work took ' + big.ms + ' ms against ' + small.ms + ' ms');
  assert.ok(big.found >= 30000, 'the ids were found: ' + big.found);
});
