'use strict';
// The hand-written number walk of src/core/free.js must find exactly what the regular expression
// it replaced found, and the quick tests in front of the seen-value expressions must never rule
// out a text that an expression matches. Random texts come from a small function written here.
const test = require('node:test');
const assert = require('node:assert/strict');
const free = require('../src/core/free');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// the expression that the walk replaced (kept here as the reference)
function referenceSpans(text, tail) {
  const body = tail.split('').join('[\\s().\\-/]{0,2}');
  const re = new RegExp('(?<!\\d)(?:\\+?1[\\s.-]?)?' + body + '(?!\\d)', 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) { if (m[0].length === 0) { re.lastIndex++; continue; } out.push([m.index, m.index + m[0].length]); }
  return out;
}

test('digitSpans: hand-written cases', () => {
  const tail = '3125550141';
  const cases = [
    ['call 312-555-0141 now', [[5, 17]]],
    ['call (312) 555-0141.', [[6, 19]]],
    ['call +1 312 555 0141 now', [[5, 20]]],
    ['call 1-312-555-0141', [[5, 19]]],
    ['3125550141', [[0, 10]]],
    ['3125550141 and 3125550141', [[0, 10], [15, 25]]],
    ['31255501412', []],
    ['93125550141', []],
    ['312   555 0141', []],
    ['312-555-0141 5 times', [[0, 12]]],
    ['no number here', []],
    ['', []]
  ];
  for (const [text, want] of cases) {
    assert.deepEqual(free.digitSpans(text, tail), want, JSON.stringify(text));
    assert.deepEqual(referenceSpans(text, tail), want, 'the reference agrees on ' + JSON.stringify(text));
  }
});

test('digitSpans agrees with the regular expression on 20,000 random texts', () => {
  const rnd = mulberry32(20261115);
  const pieces = ['3', '1', '2', '5', '0', '4', '-', ' ', '.', '(', ')', '/', '+', 'x', 'a', '  ', '1 ', '+1 ', '312', '555', '0141', '1-', '9'];
  const tails = ['3125550141', '5550141', '1234567', '31255501'];
  let differences = 0, withMatch = 0;
  for (let n = 0; n < 20000; n++) {
    const tail = tails[n % tails.length];
    let text = '';
    const len = 1 + Math.floor(rnd() * 14);
    for (let k = 0; k < len; k++) {
      if (rnd() < 0.18) text += tail.split('').map(function (c) { return c + (rnd() < 0.3 ? ['-', ' ', '.', '()', '/'][Math.floor(rnd() * 5)] : ''); }).join('');
      else text += pieces[Math.floor(rnd() * pieces.length)];
    }
    const a = free.digitSpans(text, tail), b = referenceSpans(text, tail);
    if (b.length) withMatch++;
    if (JSON.stringify(a) !== JSON.stringify(b)) { differences++; if (differences < 6) assert.deepEqual(a, b, JSON.stringify(text) + ' with ' + tail); }
  }
  assert.equal(differences, 0);
  assert.ok(withMatch > 2000, 'the random texts produced matches: ' + withMatch);
});

test('foldLow: a text that a case-insensitive expression matches is never ruled out by the quick test', () => {
  const rnd = mulberry32(77);
  const alphabet = ['a', 'b', 's', 'k', 'o', String.fromCharCode(0x17f), String.fromCharCode(0x3c2), String.fromCharCode(0x3c3), String.fromCharCode(0x3a3), String.fromCharCode(0xb5), String.fromCharCode(0x3bc), 'S', 'K', String.fromCharCode(0xdf), String.fromCharCode(0x1e9e), String.fromCharCode(0xe9), String.fromCharCode(0xc9), 'e'];
  let hits = 0;
  for (let n = 0; n < 20000; n++) {
    let word = '';
    for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) word += alphabet[Math.floor(rnd() * alphabet.length)];
    let text = '';
    for (let k = 0; k < 2 + Math.floor(rnd() * 4); k++) text += alphabet[Math.floor(rnd() * alphabet.length)];
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'iu');
    if (re.test(text)) { hits++; assert.ok(free.foldLow(text).indexOf(free.foldLow(word)) !== -1, JSON.stringify([word, text])); }
  }
  assert.ok(hits > 200, 'matches seen: ' + hits);
});

test('createSeen finds a phone number and a name in a note exactly as before', () => {
  const seen = free.createSeen();
  seen.add('phone', '(312)555-0141');
  seen.add('ssn', '912-73-4408');
  seen.add('family', 'Quillfeather');
  seen.add('street', '4127 Lindenmoor Terrace');
  const note = 'Wife of QUILLFEATHER called 312.555.0141 from 4127  Lindenmoor Terrace; SSN 912 73 4408.';
  const found = seen.find(note, false).map(function (m) { return note.slice(m.start, m.end) + ':' + m.kind; }).sort();
  assert.deepEqual(found, ['312.555.0141:phone', '4127  Lindenmoor Terrace:street', '912 73 4408:ssn', 'QUILLFEATHER:family'].sort());
  assert.deepEqual(seen.find('nothing of the kind here', false), []);
  assert.deepEqual(seen.find('Quillfeather 312-555-0141', true).map(function (m) { return m.kind; }), ['phone'], 'only numbers in a swept field');
});
