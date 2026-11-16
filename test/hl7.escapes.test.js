'use strict';
// Escape sequences inside identifier values: the free mask keeps every length and every escape
// (the contents of \H\, \N\, \X0D\ and \.br\ are not masked), a stray escape character stays as it
// is, delimiter escapes stay delimiter escapes, and a Pro run replaces the value without leaving
// a half escape behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/core/keyed');
const engine = require('../src/core/engine');
const { createRun } = require('../src/core/run');

const BS = String.fromCharCode(92);
const header = 'MSH|^~' + BS + '&|REGAPP|HALDRINN|LABAPP|LAB|20261105083012||ADT^A01|MSG00001|P|2.5';
const message = function (family) { return header + '\rPID|1||MR-4471920^^^HGH^MR||' + family + '^Quill||19731104|M\r'; };
const field = function (text) { return text.split('\r')[1].split('|')[5].split('^')[0]; };

function mask(family) {
  const r = engine.processText(message(family), createRun({ mode: 'mask' }), {});
  assert.equal(r.ok, true);
  return r.text;
}
function pro(family) {
  const r = engine.processText(message(family), createRun({ mode: 'pseudonym', key: K.keyFromSeed('escape test seed phrase') }), {});
  assert.equal(r.ok, true);
  return r.text;
}

test('mask: a delimiter escape stays a delimiter escape and the length does not change', () => {
  const family = 'Harrow ' + BS + 'T' + BS + ' Pell';
  const out = mask(family);
  assert.equal(field(out), 'XXXXXX ' + BS + 'T' + BS + ' XXXX');
  assert.equal(out.length, message(family).length);
});

test('mask: the contents of other escape sequences are not masked, and the length does not change', () => {
  const family = 'Ab' + BS + 'H' + BS + 'cd' + BS + 'N' + BS + 'ef' + BS + 'X0D' + BS + 'gh' + BS + '.br' + BS + 'ij';
  const out = mask(family);
  assert.equal(field(out), 'XX' + BS + 'H' + BS + 'XX' + BS + 'N' + BS + 'XX' + BS + 'X0D' + BS + 'XX' + BS + '.br' + BS + 'XX');
  assert.equal(out.length, message(family).length);
});

test('mask: a stray escape character stays as it is; the escape of the escape character stays too', () => {
  const stray = 'Perso' + BS + 'Nsync';
  assert.equal(field(mask(stray)), 'XXXXX' + BS + 'XXXXX');
  const escaped = 'Back' + BS + 'E' + BS + 'slash';
  assert.equal(field(mask(escaped)), 'XXXX' + BS + 'E' + BS + 'XXXXX');
  assert.equal(mask(escaped).length, message(escaped).length);
});

test('Pro: values with escapes are replaced, the result holds no unpaired escape character and the original is gone', () => {
  for (const family of ['Zorbelian' + BS + 'T' + BS + 'Quint', 'Zorbelian' + BS + 'H' + BS + 'Quint' + BS + 'N' + BS, 'Zorbelian' + BS + 'Quint', 'Zorbelian' + BS + 'E' + BS + 'Quint']) {
    const out = pro(family);
    assert.ok(out.toLowerCase().indexOf('zorbelian') === -1 && out.toLowerCase().indexOf('quint') === -1, JSON.stringify(field(out)));
    const value = field(out);
    const without = value.split(new RegExp(BS + BS + '[^' + BS + BS + ']{0,60}' + BS + BS)).join('');
    assert.ok(without.indexOf(BS) === -1, 'an unpaired escape character in ' + JSON.stringify(value));
  }
});

test('Pro: a replacement never carries a raw delimiter into the field', () => {
  const out = pro('Harrow ' + BS + 'T' + BS + ' Pell ' + BS + 'F' + BS + ' Joinery');
  const pid = out.split('\r')[1];
  assert.equal(pid.split('|').length, message('x').split(String.fromCharCode(13))[1].split('|').length, 'the field count of the segment did not change');
  assert.equal(pid.split('|')[5].split('^').length, 2);
});
