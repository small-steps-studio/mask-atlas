'use strict';
// Date arithmetic for the date shifting. Expected values are worked out by hand (the arithmetic is
// in the comments); the property loops use a seeded sequence written for this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/dates');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pad(n, w) { return String(n).padStart(w, '0'); }
function dayNumber(y, m, d) { return Date.UTC(y, m - 1, d) / 86400000; }

function table(name, fn, rows) {
  for (const [input, offset, expected, note] of rows) {
    test(name + ': ' + input + ' ' + (offset >= 0 ? '+' : '') + offset + ' -> ' + expected + (note ? ' (' + note + ')' : ''), () => {
      assert.equal(fn(input, offset), expected);
    });
  }
}

// ---- civil calendar ------------------------------------------------------------------------

test('isLeap follows the Gregorian rule', () => {
  for (const y of [1600, 2000, 2024, 2028, 2400, 4]) assert.equal(D.isLeap(y), true, String(y));
  for (const y of [1900, 2100, 2023, 2025, 2026, 1700, 1]) assert.equal(D.isLeap(y), false, String(y));
});

test('daysInMonth knows every month and the leap February', () => {
  const regular = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  regular.forEach((n, i) => assert.equal(D.daysInMonth(2026, i + 1), n));
  assert.equal(D.daysInMonth(2024, 2), 29);
  assert.equal(D.daysInMonth(1900, 2), 28);
  assert.equal(D.daysInMonth(2000, 2), 29);
});

test('validCivil accepts real dates only', () => {
  assert.equal(D.validCivil(2024, 2, 29), true);
  assert.equal(D.validCivil(2023, 2, 29), false);
  assert.equal(D.validCivil(2026, 4, 31), false);
  assert.equal(D.validCivil(2026, 13, 1), false);
  assert.equal(D.validCivil(2026, 0, 1), false);
  assert.equal(D.validCivil(2026, 1, 0), false);
  assert.equal(D.validCivil(0, 1, 1), false);
  assert.equal(D.validCivil(10000, 1, 1), false);
  assert.equal(D.validCivil(1, 1, 1), true);
  assert.equal(D.validCivil(9999, 12, 31), true);
});

test('toDays counts days since 1970-01-01 (hand-computed anchors)', () => {
  assert.equal(D.toDays(1970, 1, 1), 0);
  assert.equal(D.toDays(1969, 12, 31), -1);
  // 1970..1999 is 30 years with leap days in 72 76 80 84 88 92 96 = 7: 30*365+7 = 10957 = 2000-01-01; + 31 + 29 = 11017
  assert.equal(D.toDays(2000, 1, 1), 10957);
  assert.equal(D.toDays(2000, 3, 1), 11017);
  // 56 years 1970..2025 with 14 leap days (1972..2024): 56*365+14 = 20454 = 2026-01-01; January to October is 304 days, + 11 = 315
  assert.equal(D.toDays(2026, 1, 1), 20454);
  assert.equal(D.toDays(2026, 11, 12), 20769);
});

test('toDays and fromDays agree with the platform calendar and with each other', () => {
  for (let n = -800000; n <= 1500000; n += 17) {
    const c = D.fromDays(n);
    assert.ok(D.validCivil(c.y, c.m, c.d) || c.y < 1 || c.y > 9999, 'valid civil date for day ' + n);
    assert.equal(D.toDays(c.y, c.m, c.d), n);
  }
  const rnd = mulberry32(7741);
  for (let i = 0; i < 4000; i++) {
    const y = 1 + Math.floor(rnd() * 9998);
    const m = 1 + Math.floor(rnd() * 12);
    const d = 1 + Math.floor(rnd() * D.daysInMonth(y, m));
    if (y < 100) continue;
    assert.equal(D.toDays(y, m, d), dayNumber(y, m, d), y + '-' + m + '-' + d);
  }
});

test('addDays moves across month, year and leap boundaries and leaves the supported years as null', () => {
  assert.deepEqual(D.addDays(2026, 1, 31, 1), { y: 2026, m: 2, d: 1 });
  assert.deepEqual(D.addDays(2024, 2, 28, 1), { y: 2024, m: 2, d: 29 });
  assert.deepEqual(D.addDays(2025, 12, 31, 1), { y: 2026, m: 1, d: 1 });
  assert.deepEqual(D.addDays(2026, 3, 1, -1), { y: 2026, m: 2, d: 28 });
  assert.equal(D.addDays(9999, 12, 31, 1), null);
  assert.equal(D.addDays(1, 1, 1, -1), null);
});

test('addMonths cuts the day to the end of a shorter month', () => {
  assert.deepEqual(D.addMonths(2026, 1, 31, 1), { y: 2026, m: 2, d: 28 });
  assert.deepEqual(D.addMonths(2024, 1, 31, 1), { y: 2024, m: 2, d: 29 });
  assert.deepEqual(D.addMonths(2026, 12, 15, 1), { y: 2027, m: 1, d: 15 });
  assert.deepEqual(D.addMonths(2026, 1, 15, -1), { y: 2025, m: 12, d: 15 });
  assert.deepEqual(D.addMonths(2026, 3, 31, -1), { y: 2026, m: 2, d: 28 });
  assert.equal(D.addMonths(9999, 12, 1, 1), null);
  assert.equal(D.addMonths(1, 1, 1, -1), null);
});

test('parts turns a day offset into day, month and year counts that are never zero', () => {
  // months = round(|offset| / 30.4375) but at least 2; years = round(|offset| / 365.25) but at least 1
  assert.deepEqual(D.parts(100), { days: 100, months: 3, years: 1 });     // 3.285 -> 3 ; 0.274 -> 0 -> 1
  assert.deepEqual(D.parts(-100), { days: -100, months: -3, years: -1 });
  assert.deepEqual(D.parts(60), { days: 60, months: 2, years: 1 });       // 1.971 -> 2
  assert.deepEqual(D.parts(45), { days: 45, months: 2, years: 1 });       // 1.478 -> 1 -> 2
  assert.deepEqual(D.parts(365), { days: 365, months: 12, years: 1 });    // 11.99 -> 12 ; 0.9993 -> 1
  assert.deepEqual(D.parts(550), { days: 550, months: 18, years: 2 });    // 18.07 -> 18 ; 1.506 -> 2
  assert.deepEqual(D.parts(730), { days: 730, months: 24, years: 2 });    // 23.98 -> 24 ; 1.9986 -> 2
  assert.deepEqual(D.parts(-730), { days: -730, months: -24, years: -2 });
  for (let o = 60; o <= 730; o++) for (const s of [1, -1]) {
    const p = D.parts(o * s);
    assert.ok(Math.abs(p.months) >= 2 && Math.abs(p.years) >= 1);
    assert.equal(Math.sign(p.months), s);
    assert.equal(Math.sign(p.years), s);
  }
});

// ---- HL7 date and time ---------------------------------------------------------------------

table('shiftHl7 day', D.shiftHl7, [
  // Jan 5 + 26 = Jan 31; + 28 = Feb 28 (54); + 31 = Mar 31 (85); + 15 = Apr 15 (100)
  ['20260105', 100, '20260415', 'Jan 5 plus 100 days'],
  ['20260105', -5, '20251231', 'across the year boundary'],
  // Jan 5 - 5 = Dec 31 (-5); - 31 = Nov 30 (-36); - 30 = Oct 31 (-66); - 31 = Sep 30 (-97); - 3 = Sep 27 (-100)
  ['20260105', -100, '20250927', 'negative offset over four months'],
  ['20251220', 20, '20260109', 'Dec 20 + 11 = Dec 31, + 9 = Jan 9'],
  ['20260110', -20, '20251221', 'Jan 10 - 10 = Dec 31, - 10 = Dec 21'],
  ['20260131', 1, '20260201', 'month end'],
  ['20260228', 1, '20260301', 'February end in a common year'],
  ['20261231', 1, '20270101', 'year end'],
  ['20260101', -1, '20251231', 'year start'],
  ['20260331', 30, '20260430', 'March 31 + 30'],
  ['20260430', 31, '20260531', 'April 30 + 31'],
  ['20260301', -1, '20260228', 'back into February'],
  ['20240301', -1, '20240229', 'back into a leap February'],
  ['20240228', 1, '20240229', 'leap day reached'],
  ['20240229', 1, '20240301', 'leap day left'],
  ['20230228', 1, '20230301', 'no leap day in 2023'],
  ['19000228', 1, '19000301', '1900 is not a leap year'],
  ['20000228', 1, '20000229', '2000 is a leap year'],
  ['21000228', 1, '21000301', '2100 is not a leap year'],
  // 2024-02-29 + 1 = 2024-03-01; + 365 more = 2025-03-01; so +365 = 2025-02-28
  ['20240229', 365, '20250228', 'leap day plus a year of days'],
  ['20240229', -365, '20230301', 'leap day minus a year of days'],
  // 2025-03-01 +365 = 2026-03-01, +365 = 2027-03-01, +366 = 2028-03-01; so 2024-02-29 + 1462 = 2028-03-01, + 1461 = 2028-02-29
  ['20240229', 1461, '20280229', 'four years later on the next leap day'],
  ['20000229', 365, '20010228', ''],
  ['20000229', 366, '20010301', ''],
  ['20260307', 1, '20260308', 'a daylight saving start date in North America: no hour is involved'],
  ['20261101', 1, '20261102', 'a daylight saving end date in North America']
]);

table('shiftHl7 time', D.shiftHl7, [
  ['20260105103045.123+0200', 7, '20260112103045.123+0200', 'time, fraction and zone stay'],
  ['202601051030', 30, '202602041030', 'Jan 5 + 26 = Jan 31, + 4 = Feb 4'],
  ['20260105103045', 1, '20260106103045', ''],
  ['2026010510', 10, '2026011510', 'hour precision'],
  ['20260105-0500', 1, '20260106-0500', 'date with a zone'],
  ['20260105235959-0800', 1, '20260106235959-0800', 'late evening stays late evening']
]);

table('shiftHl7 partial', D.shiftHl7, [
  // years = round(offset / 365.25), at least 1
  ['2026', 100, '2027', '0.27 -> 0 -> 1 year'],
  ['2026', 400, '2027', '1.095 -> 1'],
  ['2026', 600, '2028', '1.643 -> 2'],
  ['2026', 730, '2028', '1.9986 -> 2'],
  ['2026', -100, '2025', ''],
  ['2026', -600, '2024', ''],
  // months = round(offset / 30.4375), at least 2
  ['202603', 100, '202606', '3.285 -> 3 months'],
  ['202603', 60, '202605', '1.971 -> 2 months'],
  ['202603', 45, '202605', '1.478 -> 1 -> at least 2'],
  ['202603', 730, '202803', '24 months'],
  ['202603', -100, '202512', 'March minus 3 months'],
  // 13.14 -> 13 months back: 2026*12 + 2 - 13 = 24301 = 2025*12 + 1 -> February 2025
  ['202603', -400, '202502', '13 months back']
]);

table('shiftHl7 invalid', D.shiftHl7, [
  ['20230229', 10, null, 'no 29 February in 2023'],
  ['20260431', 10, null, 'April has 30 days'],
  ['20261301', 10, null, 'month 13'],
  ['20260100', 10, null, 'day 0'],
  ['20260132', 10, null, 'day 32'],
  ['202613', 10, null, 'month 13 without day'],
  ['202600', 10, null, 'month 0 without day'],
  ['2026-01-05', 10, null, 'ISO text is not an HL7 timestamp'],
  ['', 10, null, 'empty'],
  ['abc', 10, null, 'text'],
  ['2026011', 10, null, 'odd digit count'],
  ['20260105103', 10, null, 'odd digit count after the day'],
  ['99991231', 1, null, 'beyond the last supported year'],
  ['00010101', -1, null, 'before the first supported year'],
  ['9999', 100, null, 'year 10000'],
  ['999912', 100, null, 'month in year 10000']
]);

// ---- ISO / FHIR ----------------------------------------------------------------------------

table('shiftIso', D.shiftIso, [
  ['2026-01-05', 100, '2026-04-15', 'same arithmetic as the HL7 day case'],
  ['2026-01-05T10:30:00Z', 100, '2026-04-15T10:30:00Z', 'time and Z kept'],
  ['2026-01-05T10:30:00+02:00', -5, '2025-12-31T10:30:00+02:00', 'offset zone kept'],
  ['2026-01-05T10:30:00.123456Z', 7, '2026-01-12T10:30:00.123456Z', 'fraction kept'],
  ['2026-01-05T10:30', 7, '2026-01-12T10:30', 'no seconds'],
  ['2024-02-29', 365, '2025-02-28', 'leap day'],
  ['2024-02-29T23:59:59-08:00', 1, '2024-03-01T23:59:59-08:00', 'late evening on a leap day'],
  ['2026', 100, '2027', 'year only'],
  ['2026', -600, '2024', ''],
  ['2026-03', 100, '2026-06', 'year and month'],
  ['2026-03', -400, '2025-02', ''],
  ['2026-02-30', 10, null, 'no 30 February'],
  ['2026-13', 10, null, 'month 13'],
  ['2026-13-01', 10, null, 'month 13 with a day'],
  ['2026-00-10', 10, null, 'month 0'],
  ['26-01-05', 10, null, 'two-digit year'],
  ['2026-01-05T', 10, null, 'dangling T'],
  ['20260105', 10, null, 'no hyphens'],
  ['', 10, null, 'empty'],
  ['9999-12-31', 1, null, 'beyond the last supported year'],
  ['0001-01-01', -1, null, 'before the first supported year'],
  ['9999', 100, null, 'year 10000']
]);

// ---- X12 -----------------------------------------------------------------------------------

table('shiftD8', D.shiftD8, [
  ['20261105', 10, '20261115', ''],
  ['202611051430', 10, '202611151430', 'CCYYMMDDHHMM'],
  ['20261105143015', 10, '20261115143015', 'with seconds'],
  ['2026110514', 10, null, 'ten digits are not an X12 date'],
  ['2026-11-05', 10, null, 'hyphens'],
  ['20261105a', 10, null, 'letter'],
  ['20261305', 10, null, 'month 13'],
  ['20230229', 1, null, 'no leap day']
]);

table('shiftRd8', D.shiftRd8, [
  ['20261105-20261110', 10, '20261115-20261120', 'both ends move by ten days'],
  // Jan 25 + 10 = Feb 4 (6 to Jan 31, 4 more); Feb 5 + 10 = Feb 15
  ['20260125-20260205', 10, '20260204-20260215', 'across a month end'],
  // Dec 20 + 20 = Jan 9; Jan 5 + 20 = Jan 25; the range is 16 days before and after
  ['20261220-20270105', 20, '20270109-20270125', 'across a year end'],
  // Jan 10 - 20 = Dec 21 (Jan 10 - 10 = Dec 31); Jan 20 - 20 = Dec 31
  ['20260110-20260120', -20, '20251221-20251231', 'negative offset'],
  ['20261105-20261132', 10, null, 'second end is not a date'],
  ['20261132-20261105', 10, null, 'first end is not a date'],
  ['20261105', 10, null, 'a single date'],
  ['20261105-20261110-1', 10, null, 'three parts'],
  ['20261105 - 20261110', 10, null, 'spaces']
]);

table('shiftYymmdd', D.shiftYymmdd, [
  ['261105', 10, '261115', '26 -> 2026'],
  ['700101', 1, '700102', '70 -> 1970'],
  ['991231', 1, '000101', '1999-12-31 + 1 = 2000-01-01'],
  ['000101', -1, '991231', '2000-01-01 - 1 = 1999-12-31'],
  ['000229', 1, '000301', '2000 is a leap year'],
  ['251231', 1, '260101', ''],
  ['010229', 1, null, '2001 is not a leap year'],
  ['261305', 1, null, 'month 13'],
  ['26110', 1, null, 'five digits'],
  ['261105x', 1, null, 'letter']
]);

// ---- dates written in text -----------------------------------------------------------------

function written(order) { return (input, offset) => D.shiftWritten(input, offset, order); }

table('shiftWritten mdy', written('mdy'), [
  ['2026-11-04', 10, '2026-11-14', 'ISO form'],
  ['11/04/2026', 10, '11/14/2026', 'November 4 + 10'],
  ['04/11/2026', 10, '04/21/2026', 'April 11 + 10'],
  ['4/1/2026', 40, '5/11/2026', 'April 1 + 29 = April 30, + 11 = May 11; no zero padding'],
  ['12/31/2026', 1, '01/01/2027', ''],
  ['01/01/2027', -1, '12/31/2026', ''],
  ['02/28/2024', 1, '02/29/2024', ''],
  ['13/04/2026', 10, '23/04/2026', 'first number above 12 -> day first, April 13 + 10 = April 23'],
  ['4.11.2026', 10, '14.11.2026', 'dots always mean day first'],
  ['2026/11/04', 10, '2026/11/14', 'year first with slashes'],
  ['13/13/2026', 10, null, 'neither reading works'],
  ['02/30/2026', 10, null, 'no 30 February'],
  ['12/31/9999', 1, null, 'beyond the last supported year'],
  ['yesterday', 10, null, ''],
  ['11-04-2026', 10, null, 'hyphens between day and month are not read'],
  ['1/2/26', 10, null, 'two-digit year']
]);

table('shiftWritten dmy', written('dmy'), [
  ['04/11/2026', 10, '14/11/2026', '4 November + 10'],
  ['4.1.2026', 40, '13.2.2026', 'Jan 4 + 27 = Jan 31, + 13 = Feb 13; no zero padding'],
  ['04.01.2026', 40, '13.02.2026', 'zero padding kept'],
  ['31/12/2026', 1, '01/01/2027', ''],
  ['2026/1/4', 10, '2026/1/14', 'year first, no zero padding'],
  ['31/04/2026', 10, null, 'April has 30 days']
]);

// ---- properties ----------------------------------------------------------------------------

function randomDate(rnd) {
  const y = 1900 + Math.floor(rnd() * 201);
  const m = 1 + Math.floor(rnd() * 12);
  const d = 1 + Math.floor(rnd() * D.daysInMonth(y, m));
  return { y: y, m: m, d: d };
}
function randomOffset(rnd) { return (rnd() < 0.5 ? -1 : 1) * (60 + Math.floor(rnd() * 671)); }
function dayOf8(s) { return D.toDays(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8))); }
function dayOfIso(s) { return D.toDays(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))); }

for (const seed of [20261112, 7741, 31337042]) {
  test('intervals between two dates survive every layout for 1500 random pairs (seed ' + seed + ')', () => {
    const rnd = mulberry32(seed);
    for (let i = 0; i < 1500; i++) {
      const a = randomDate(rnd);
      const gap = Math.floor(rnd() * 3000);
      const bc = D.fromDays(D.toDays(a.y, a.m, a.d) + gap);
      const offset = randomOffset(rnd);
      const a8 = pad(a.y, 4) + pad(a.m, 2) + pad(a.d, 2), b8 = pad(bc.y, 4) + pad(bc.m, 2) + pad(bc.d, 2);
      const aIso = pad(a.y, 4) + '-' + pad(a.m, 2) + '-' + pad(a.d, 2), bIso = pad(bc.y, 4) + '-' + pad(bc.m, 2) + '-' + pad(bc.d, 2);
      const label = a8 + ' ' + b8 + ' ' + offset;

      const h1 = D.shiftHl7(a8, offset), h2 = D.shiftHl7(b8, offset);
      assert.equal(dayOf8(h2) - dayOf8(h1), gap, 'hl7 ' + label);
      assert.equal(dayOf8(h1) - dayOf8(a8), offset, 'hl7 offset ' + label);

      const i1 = D.shiftIso(aIso, offset), i2 = D.shiftIso(bIso, offset);
      assert.equal(dayOfIso(i2) - dayOfIso(i1), gap, 'iso ' + label);
      assert.equal(dayOfIso(i1) - dayOfIso(aIso), offset, 'iso offset ' + label);

      const d1 = D.shiftD8(a8, offset), d2 = D.shiftD8(b8, offset);
      assert.equal(dayOf8(d2) - dayOf8(d1), gap, 'd8 ' + label);

      const r = D.shiftRd8(a8 + '-' + b8, offset);
      const [r1, r2] = r.split('-');
      assert.equal(dayOf8(r2) - dayOf8(r1), gap, 'rd8 ' + label);
      assert.equal(r1, h1);
      assert.equal(r2, h2);

      const m1 = D.shiftWritten(pad(a.m, 2) + '/' + pad(a.d, 2) + '/' + pad(a.y, 4), offset, 'mdy');
      const m2 = D.shiftWritten(pad(bc.m, 2) + '/' + pad(bc.d, 2) + '/' + pad(bc.y, 4), offset, 'mdy');
      assert.equal(dayOf8(m2.slice(6) + m2.slice(0, 2) + m2.slice(3, 5)) - dayOf8(m1.slice(6) + m1.slice(0, 2) + m1.slice(3, 5)), gap, 'mdy ' + label);

      const e1 = D.shiftWritten(pad(a.d, 2) + '.' + pad(a.m, 2) + '.' + pad(a.y, 4), offset, 'mdy');
      assert.equal(dayOf8(e1.slice(6) + e1.slice(3, 5) + e1.slice(0, 2)) - dayOf8(a8), offset, 'dot ' + label);
    }
  });
}

test('the time of day and the zone survive 2000 random shifts untouched', () => {
  const rnd = mulberry32(2026);
  for (let i = 0; i < 2000; i++) {
    const a = randomDate(rnd);
    const time = pad(Math.floor(rnd() * 24), 2) + pad(Math.floor(rnd() * 60), 2) + pad(Math.floor(rnd() * 60), 2);
    const zone = (rnd() < 0.5 ? '+' : '-') + pad(Math.floor(rnd() * 14), 2) + (rnd() < 0.5 ? '00' : '30');
    const base = pad(a.y, 4) + pad(a.m, 2) + pad(a.d, 2);
    const out = D.shiftHl7(base + time + '.5' + zone, randomOffset(rnd));
    assert.equal(out.slice(8), time + '.5' + zone);
    assert.match(out, /^\d{8}\d{6}\.5[+-]\d{4}$/);
  }
});

test('no offset between 60 and 730 days in either direction leaves a date, a month or a year where it was', () => {
  for (let o = 60; o <= 730; o++) for (const s of [1, -1]) {
    const off = o * s;
    assert.notEqual(D.shiftHl7('20260615', off), '20260615');
    assert.notEqual(D.shiftHl7('202606', off), '202606');
    assert.notEqual(D.shiftHl7('2026', off), '2026');
    assert.notEqual(D.shiftIso('2026-06-15', off), '2026-06-15');
    assert.notEqual(D.shiftIso('2026-06', off), '2026-06');
    assert.notEqual(D.shiftIso('2026', off), '2026');
  }
});

test('shifted dates are always real dates', () => {
  const rnd = mulberry32(99);
  for (let i = 0; i < 3000; i++) {
    const a = randomDate(rnd);
    const out = D.shiftHl7(pad(a.y, 4) + pad(a.m, 2) + pad(a.d, 2), randomOffset(rnd));
    assert.equal(D.validCivil(Number(out.slice(0, 4)), Number(out.slice(4, 6)), Number(out.slice(6, 8))), true, out);
  }
});

test('the year and month layouts keep their width and move forward or back as the offset says', () => {
  assert.equal(D.shiftHl7('2026', 200).length, 4);
  assert.equal(D.shiftHl7('202606', 200).length, 6);
  assert.ok(Number(D.shiftHl7('202606', 200)) > 202606);
  assert.ok(Number(D.shiftHl7('202606', -200)) < 202606);
  assert.ok(Number(D.shiftIso('2026', 300)) > 2026);
  assert.ok(Number(D.shiftIso('2026', -300)) < 2026);
});
