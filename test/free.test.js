'use strict';
// Free-text scanning: the shape detectors, the seen-value matcher, overlap resolution and the time guard.
const test = require('node:test');
const assert = require('node:assert/strict');
const free = require('../src/core/free');
const { createRun } = require('../src/core/run');
const D = require('../src/core/dates');
const K = require('../src/core/keyed');

const KEY = K.keyFromSeed('free text tests');

function matches(text, kind, options) {
  return free.findPatterns(text, options).filter((m) => !kind || m.kind === kind).map((m) => text.slice(m.start, m.end));
}
function newRun(options) { return createRun({ mode: 'pseudonym', key: KEY, options: options }); }
function table(name, kind, positives, negatives, options) {
  for (const [text, expected] of positives) {
    test(name + ' finds ' + JSON.stringify(expected) + ' in ' + JSON.stringify(text), () => {
      const found = matches(text, kind, options);
      assert.ok(found.includes(expected), 'found ' + JSON.stringify(found));
      assert.ok(found.every((f) => f === expected), 'only that one: ' + JSON.stringify(found));
    });
  }
  for (const text of negatives) {
    test(name + ' finds nothing in ' + JSON.stringify(text.length > 50 ? text.slice(0, 50) + '...' : text), () => {
      assert.deepEqual(matches(text, kind, options), []);
    });
  }
}

// ---- shape detectors -----------------------------------------------------------------------

table('phone', 'phone', [
  ['Call 312-555-0141 now', '312-555-0141'], ['Call (312) 555-0141 now', '(312) 555-0141'], ['Call (312)555-0141 now', '(312)555-0141'], ['Call 312.555.0141 now', '312.555.0141'],
  ['Call 312 555 0141 now', '312 555 0141'], ['Call 1-312-555-0141 now', '1-312-555-0141'], ['Call 3125550141 now', '3125550141'], ['Call +44 20 7946 0958 now', '+44 20 7946 0958'],
  ['Call +49 30 1234567 now', '+49 30 1234567']
], ['invoice 12345', 'version 1.2.3', 'code 1234567', 'number 123456789', 'long 12345678901', 'oid 2.16.840.1.113883.3.1 here', 'time 10:30:45 or 08:30', 'stamp 20261105083012 here', 'ratio 120/80', 'range 2026-11-05 to 2026-11-09']);

table('SSN-like number', 'ssn', [['ssn 912-73-4408 end', '912-73-4408'], ['id 912 73 4408 end', '912 73 4408'], ['(912-73-4408)', '912-73-4408']],
  ['x 1912-73-44081 y', 'x 912-73-4408-1 y', 'x 91-273-4408 y', 'order 2026-11-05', 'phone 312-555-0141', 'x 12-345-6789 y']);

table('e-mail', 'email', [
  ['mail john.doe+tag@example.org please', 'john.doe+tag@example.org'], ['mail a_b%c@sub.example.co.uk.', 'a_b%c@sub.example.co.uk'], ['<x@y.example>', 'x@y.example'], ['at a-b@c-d.example, ok', 'a-b@c-d.example'],
  ['MAIL JOHN@EXAMPLE.ORG NOW', 'JOHN@EXAMPLE.ORG']
], ['bad @example.org', 'bad user@localhost', 'x@y.z', 'a@b', 'at sign @ alone', 'user@.example', 'user@example', '@@@@', 'a@@b.example.']);

table('IPv4 address', 'ip', [['ip 192.168.1.20 ok', '192.168.1.20'], ['ip 10.0.0.1.', '10.0.0.1'], ['ip 255.255.255.255 ok', '255.255.255.255'], ['ip 0.0.0.0 ok', '0.0.0.0']],
  ['ip 256.1.1.1 no', 'ip 1.2.3 no', 'ip 10.0.0.255.1 no', 'ip 999.1.1.1 no', 'ip 1.2.3.4.5 no', 'oid 2.16.840.1.113883.3.1 no', 'oid 1.3.6.1.4.1.12345.1.2 no', 'time 10:30:45 no']);

table('IPv6 address', 'ip', [['ip 2001:0db8:85a3:0000:0000:8a2e:0370:7334 ok', '2001:0db8:85a3:0000:0000:8a2e:0370:7334'], ['ip fe80::1 ok', 'fe80::1'], ['ip 2001:db8:: ok', '2001:db8::']],
  ['time 10:30:45', 'ratio a:b', 'x ab:cd y']);

table('URL', 'url', [
  ['see https://example.org/a/b?x=1, then', 'https://example.org/a/b?x=1'], ['see www.example.org/path.', 'www.example.org/path'], ['see ftp://files.example.org/x', 'ftp://files.example.org/x'],
  ['see (http://example.org/a) now', 'http://example.org/a'], ['SEE HTTP://UPPER.EXAMPLE/X ok', 'HTTP://UPPER.EXAMPLE/X']
], ['noturl example.org', 'see www. alone', 'awww.example.org', 'mailto:a@b.example', 'slashes // and ://']);

table('date', 'date', [['dob 1973-11-04 end', '1973-11-04'], ['dob 11/04/2026 end', '11/04/2026'], ['dob 4.11.2026 end', '4.11.2026'], ['dob 2026/11/04 end', '2026/11/04'], ['dob 1/2/2026.', '1/2/2026']],
  ['dob 99-99-9999', 'x 1/2/26 y', 'x 12345-67-89 y', 'x 2026-11 y', 'x 1.2.3 y', 'x 20261104 y', 'version 2.5.1']);

test('dates are not looked for when the caller says so', () => {
  assert.deepEqual(matches('dob 1973-11-04 and 11/04/2026', 'date', { dates: false }), []);
  assert.equal(matches('dob 1973-11-04 and 11/04/2026', 'date').length, 2);
});

test('title words open a name: Mr Mrs Ms Miss Dr Prof Mister Doctor Sir Dame Nurse Rev', () => {
  const cases = [['Mr Quillfeather came', 'Quillfeather'], ['Mrs. Rushbrook Jane arrived', 'Rushbrook Jane'], ['Dr Smithe said', 'Smithe'], ['Miss Ashworth', 'Ashworth'], ['Ms Corvane left', 'Corvane'],
    ['Prof Ellerby Moss spoke', 'Ellerby Moss'], ['mister Foxley', 'Foxley'], ['Doctor Rivers Kell Orm', 'Rivers Kell Orm'], ['Sir Pellham', 'Pellham'], ['Nurse Brightwell checked', 'Brightwell'], ['Rev Alderton', 'Alderton'],
    ['DR SMITHE SAID', 'SMITHE'], ['dr. Lowe', 'Lowe']];
  for (const [text, expected] of cases) assert.ok(matches(text, 'fullname').includes(expected), text + ' -> ' + JSON.stringify(matches(text, 'fullname')));
});

test('a title word without a capitalised name after it is not a name', () => {
  for (const text of ['Mr', 'Dr.', 'Mr lowercase words', 'Dr 12345', 'Drive carefully', 'Mrs is here', 'Miss was absent', 'Dr said hello']) assert.deepEqual(matches(text, 'fullname'), [], text);
});

test('relation words open a name when it is capitalised in mixed case', () => {
  const cases = [['wife Marisol called', 'Marisol'], ['son Tobias', 'Tobias'], ['mother Mary Ann', 'Mary Ann'], ['neighbor Pedersen said', 'Pedersen'], ['the husband Oswin Rask', 'Oswin Rask'], ['caller Janelle', 'Janelle']];
  for (const [text, expected] of cases) assert.ok(matches(text, 'fullname').includes(expected), text);
  for (const text of ['wife MARISOL', 'wife is here', 'son was born', 'mother Called today', 'friend With her', 'patient States pain', 'sister lowercase']) assert.deepEqual(matches(text, 'fullname'), [], text);
});

test('labelled identifiers are found by their label and sorted into kinds', () => {
  const cases = [['member VM-123456 ok', 'VM-123456', 'plan'], ['member id: VM-123456', 'VM-123456', 'plan'], ['MRN 7731905 ok', '7731905', 'record'], ['account number ACC-20261105-0087', 'ACC-20261105-0087', 'record'],
    ['policy no. P-998877', 'P-998877', 'plan'], ['serial SN-0042', 'SN-0042', 'device'], ['npi 1932000087 done', '1932000087', 'licence'], ['license number D-8841-77', 'D-8841-77', 'licence'], ['vin 1HGCM82633A004352 x', '1HGCM82633A004352', 'device'],
    ['claim 12ab', '12ab', 'record'], ['subscriber id=VM-55120', 'VM-55120', 'plan'], ['group number GRP-4410', 'GRP-4410', 'plan'], ['badge E-77120', 'E-77120', 'other'], ['patient id PT-88120', 'PT-88120', 'record']];
  for (const [text, token, kind] of cases) assert.ok(matches(text, kind).includes(token), text + ' ' + kind + ' -> ' + JSON.stringify(free.findPatterns(text)));
  for (const text of ['member of the club', 'order 2026-11-05', 'case 12', 'ref ABCDEFG', 'account balance', 'serial killer', 'claim is open', 'visit again soon']) assert.deepEqual(matches(text).filter((m) => !/^\d/.test(m)), [], text);
});

test('times, OIDs and long digit strings are not taken for identifiers', () => {
  for (const text of ['at 10:30:45 sharp', 'oid 2.16.840.1.113883.3.1 and 1.3.6.1.4.1.12345.1.2', 'stamp 20261105083012+0100', 'value 12.5 mg/dL', 'dose 0.25 mg', 'bp 120/80 mmHg', 'icd 786.50 code', 'page 3 of 12']) assert.deepEqual(matches(text), [], text);
});

test('texts shorter than five characters have no matches', () => {
  assert.deepEqual(free.findPatterns('a@b.c'), []);
  assert.deepEqual(free.findPatterns(''), []);
});

// ---- seen values ---------------------------------------------------------------------------

function seenFind(adds, text, distinctive) {
  const seen = free.createSeen();
  for (const [kind, value] of adds) seen.add(kind, value);
  return seen.find(text, distinctive).sort((a, b) => a.start - b.start).map((m) => text.slice(m.start, m.end));
}

test('seen names are found without regard to case, and only as whole words', () => {
  assert.deepEqual(seenFind([['family', 'Quillfeather']], 'QUILLFEATHER said quillfeather and Quillfeathers'), ['QUILLFEATHER', 'quillfeather']);
  assert.deepEqual(seenFind([['family', 'Ash']], 'Ash, Ashley ash. Smash Ash-Wood'), ['Ash', 'ash', 'Ash']);
  assert.deepEqual(seenFind([['given', 'Berenice']], '(Berenice) "berenice" Berenice123 xBerenice'), ['Berenice', 'berenice']);
});

test('a hyphenated name is found whole and by its parts', () => {
  const found = seenFind([['family', 'Marchbanner-Oyelaran']], 'Dr Oyelaran and Marchbanner-Oyelaran and Marchbanner');
  assert.deepEqual(found, ['Oyelaran', 'Marchbanner-Oyelaran', 'Marchbanner']);
});

test('a name that is also a common word is found only in its own spelling or in capitals', () => {
  const found = seenFind([['given', 'Rose'], ['family', 'Mark']], 'Rose has a rose; MARK the date; ROSE; mark and Mark');
  assert.deepEqual(found.sort(), ['MARK', 'Mark', 'ROSE', 'Rose'].sort());
});

test('names under three letters, title words and suffixes are not remembered', () => {
  assert.deepEqual(seenFind([['given', 'Li'], ['family', 'Dr'], ['family', 'Jr'], ['given', 'Mr']], 'Li Dr Jr Mr said'), []);
  assert.equal(free.createSeen().size(), 0);
});

test('a full name is remembered part by part, a "Family, Given" form too', () => {
  const found = seenFind([['fullname', 'Tallworthy, Berenice Rae']], 'Berenice and tallworthy and RAE');
  assert.deepEqual(found, ['Berenice', 'tallworthy', 'RAE']);
});

test('streets, towns and organisations are found with any amount of white space and any case', () => {
  const found = seenFind([['street', '61 Kestrelhill Road'], ['city', 'Wrenbury'], ['org', 'Haldon General Hospital']], 'lives at 61   kestrelhill\troad, WRENBURY, and works at HALDON GENERAL HOSPITAL.');
  assert.deepEqual(found, ['61   kestrelhill\troad', 'WRENBURY', 'HALDON GENERAL HOSPITAL']);
});

test('numbers are found in the shapes people write them: phones with any punctuation, ids in any case', () => {
  const found = seenFind([['phone', '312-555-0152'], ['record', 'MR-4471920']], 'call (312) 555 0152 or 1 312 555 0152 or 312.555.0152, not 3125550153; see mr-4471920. XMR-4471920 MR-44719201');
  assert.deepEqual(found, ['312) 555 0152', '1 312 555 0152', '312.555.0152', 'mr-4471920']);
});

test('with distinctiveOnly names and places are skipped but numbers are still found', () => {
  const adds = [['family', 'Quillfeather'], ['street', '61 Kestrelhill Road'], ['phone', '312-555-0152'], ['record', 'MR-4471920']];
  assert.deepEqual(seenFind(adds, 'Quillfeather at 61 Kestrelhill Road, 312-555-0152, MR-4471920', true), ['312-555-0152', 'MR-4471920']);
  assert.equal(seenFind(adds, 'Quillfeather at 61 Kestrelhill Road, 312-555-0152, MR-4471920', false).length, 4);
});

test('the seen set grows after it has been used', () => {
  const seen = free.createSeen();
  seen.add('family', 'Quillfeather');
  assert.equal(seen.find('Quillfeather and Rushbrook').length, 1);
  seen.add('family', 'Rushbrook');
  assert.equal(seen.find('Quillfeather and Rushbrook').length, 2);
  assert.equal(seen.size(), 2);
});

// ---- overlap -------------------------------------------------------------------------------

test('resolve keeps the earliest match and, at the same start, the longest', () => {
  const m = (start, end, kind) => ({ start, end, kind });
  assert.deepEqual(free.resolve([m(8, 12, 'a'), m(0, 5, 'b'), m(0, 10, 'c')]).map((x) => x.kind), ['c']);
  assert.deepEqual(free.resolve([m(0, 5, 'a'), m(5, 8, 'b'), m(8, 9, 'c')]).map((x) => x.kind), ['a', 'b', 'c']);
  assert.deepEqual(free.resolve([m(2, 4, 'a'), m(0, 10, 'b')]).map((x) => x.kind), ['b']);
  assert.deepEqual(free.resolve([m(0, 6, 'a'), m(4, 9, 'b'), m(9, 12, 'c')]).map((x) => x.kind), ['a', 'c']);
  assert.deepEqual(free.resolve([]), []);
});

test('an e-mail address that starts with a seen name is replaced as one e-mail address', () => {
  const run = newRun();
  const seen = free.createSeen();
  seen.add('family', 'Tallworthy');
  const text = 'write to tallworthy@example.org or to Tallworthy';
  const out = free.scanText(text, { run: run, seen: seen, person: run.person(['x']) });
  assert.equal(out.count, 2);
  assert.match(out.text, /^write to [a-z.]+\d*@[a-z]+\.example or to [A-Z][a-z]+$/);
  assert.equal(out.text.toLowerCase().indexOf('tallworthy'), -1);
});

// ---- scanText ------------------------------------------------------------------------------

test('scanText replaces every kind, keeps the words around them and counts the replacements', () => {
  const run = newRun();
  const seen = free.createSeen();
  seen.add('family', 'Tallworthy');
  seen.add('phone', '312-555-0152');
  const text = 'Dr Pellham saw Tallworthy on 11/04/2026; call 312-555-0152, mail a.b@zzz.example, ip 10.1.2.3, ssn 912-73-4408, member VM-123456, see www.example.org/x.';
  const out = free.scanText(text, { run: run, seen: seen, person: run.person(['p']) });
  assert.equal(out.count, 9);
  for (const s of ['Pellham', 'Tallworthy', '11/04/2026', '312-555-0152', 'a.b@zzz.example', '10.1.2.3', '912-73-4408', 'VM-123456', 'example.org']) assert.equal(out.text.indexOf(s), -1, s);
  for (const s of ['Dr ', ' saw ', ' on ', '; call ', ', mail ', ', ip ', ', ssn ', ', member ', ', see ']) assert.notEqual(out.text.indexOf(s), -1, s);
  assert.match(out.text, /on (\d\d)\/(\d\d)\/(\d{4});/);
  assert.equal(run.stats.byCategory.get('names') >= 2, true);
});

test('scanText returns the same string when nothing is found', () => {
  const run = newRun();
  for (const text of ['', 'ab', 'nothing to see here', 'dose 12.5 mg at 10:30', 'x'.repeat(5000)]) {
    const out = free.scanText(text, { run: run, seen: free.createSeen(), person: run.person([]) });
    assert.equal(out.text, text);
    assert.equal(out.count, 0);
  }
  assert.equal(free.scanText(null, { run: run }).text, null);
});

test('a written date is shifted by the offset of the person and keeps its layout', () => {
  const run = newRun();
  const person = run.person(['p1']);
  for (const [text, re] of [['on 1973-11-04.', /on (\d{4})-(\d\d)-(\d\d)\./], ['on 11/04/2026.', /on (\d\d)\/(\d\d)\/(\d{4})\./], ['on 4.11.2026.', /on (\d{1,2})\.(\d{1,2})\.(\d{4})\./]]) {
    const out = free.scanText(text, { run: run, seen: null, person: person });
    assert.match(out.text, re, text);
  }
  const iso = free.scanText('on 2026-11-04.', { run: run, person: person }).text;
  const m = /(\d{4})-(\d\d)-(\d\d)/.exec(iso);
  assert.equal(D.toDays(+m[1], +m[2], +m[3]) - D.toDays(2026, 11, 4), person.offset);
});

test('an impossible written date is masked rather than left in the text', () => {
  const run = newRun();
  const out = free.scanText('born 2026-13-45 maybe', { run: run, person: run.person([]) });
  assert.equal(out.text, 'born 9999-99-99 maybe');
});

test('"Family, Given": a capitalised word after a seen family name and a comma is a given name', () => {
  const run = newRun();
  const seen = free.createSeen();
  seen.add('family', 'Tallworthy');
  const out = free.scanText('Tallworthy, Berenice was seen; Tallworthy, the patient; Tallworthy, Called; Tallworthy, HOSPITAL', { run: run, seen: seen, person: run.person([]) });
  const parts = out.text.split('; ');
  assert.match(parts[0], /^[A-Z][a-z]+, [A-Z][a-z]+ was seen$/);
  assert.equal(parts[0].indexOf('Berenice'), -1);
  assert.match(parts[1], /^[A-Z][a-z]+, the patient$/);
  assert.match(parts[2], /^[A-Z][a-z]+, Called$/);
  assert.match(parts[3], /^[A-Z][a-z]+, HOSPITAL$/);
});

test('scanText in scan mode counts and returns the text unchanged; the known callback skips values', () => {
  const run = newRun();
  const text = 'call 312-555-0152 or 312-555-0199, mail a@b.example';
  const out = free.scanText(text, { run: run, scanOnly: true, person: run.person([]) });
  assert.equal(out.text, text);
  assert.equal(out.count, 3);
  const skipped = free.scanText(text, { run: run, scanOnly: true, person: run.person([]), known: (v) => v === '312-555-0199' });
  assert.equal(skipped.count, 2);
});

test('distinctiveOnly scans for e-mail, SSN-like numbers and IP addresses only', () => {
  const run = newRun();
  const text = 'Dr Pellham 312-555-0199 a@b.example 912-73-4408 10.1.2.3 member VM-123456 on 11/04/2026';
  const out = free.scanText(text, { run: run, person: run.person([]), distinctiveOnly: true });
  assert.ok(out.text.startsWith('Dr Pellham 312-555-0199 '));
  assert.ok(out.text.endsWith(' member VM-123456 on 11/04/2026'));
  assert.equal(out.count, 3);
});

// ---- time guard ----------------------------------------------------------------------------

// The guard is against catastrophic backtracking: quadratic time on 2 MB takes minutes, linear time takes about a second. The limits are
// therefore several times the time of a quiet machine, so that a busy or slow machine (a shared CI runner) does not fail the test.
const SLOWNESS_ALLOWED = 6;
function timed(text, baseLimitMs, patternsOnly) {
  const limitMs = baseLimitMs * SLOWNESS_ALLOWED;
  const t1 = process.hrtime.bigint();
  free.findPatterns(text);
  const ms2 = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.ok(ms2 < limitMs, 'the pattern detectors took ' + Math.round(ms2) + ' ms for ' + text.length + ' characters');
  if (patternsOnly) return;
  const run = newRun();
  const seen = free.createSeen();
  seen.add('family', 'Quillfeather'); seen.add('phone', '312-555-0152'); seen.add('record', 'MR-4471920'); seen.add('street', '61 Kestrelhill Road');
  const t0 = process.hrtime.bigint();
  const out = free.scanText(text, { run: run, seen: seen, person: run.person(['t']), path: 'x' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < limitMs, 'the scan took ' + Math.round(ms) + ' ms for ' + text.length + ' characters');
  assert.equal(typeof out.text, 'string');
}
function repeated(unit, length) { return unit.repeat(Math.ceil(length / unit.length)).slice(0, length); }

for (const [label, unit] of [['a', 'a'], ['@', '@'], ['digits', '1234567890'], ['spaces', ' '], ['one digit', '1']]) {
  test('2 MB of ' + label + ' is scanned in linear time, no catastrophic backtracking', () => { timed(repeated(unit, 2000000), 2000); });
}
for (const [label, unit] of [['dots', '.'], ['hyphens', '-'], ['a@', 'a@'], ['digit and hyphen', '1-'], ['title word and space', 'Dr '], ['label and space', 'member '], ['a and dot', 'a.'], ['digit and dot', '1.'],
  ['opening parentheses', '('], ['plus and digit', '+1'], ['letter and hyphen', 'A-'], ['name-like words', 'Quillfeather '], ['dotted mail pieces', 'a.b@'], ['colons', ':'], ['hex groups', 'f:']]) {
  test('2 MB of ' + label + ' is scanned in linear time, no catastrophic backtracking (long unit)', () => { timed(repeated(unit, 2000000), 4000); });
}
for (const [label, unit] of [['http://', 'http://'], ['www.', 'www.'], ['https://x', 'https://x']]) {
  test('300 KB of the repeated start of a web address (' + label + ') is searched for patterns in linear time', () => { timed(repeated(unit, 300000), 1000, true); });
}
