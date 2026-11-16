'use strict';
// HL7 v2 reader and writer: structure, delimiters, terminators, escapes, field handling by type.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRun } = require('../src/core/run');
const engine = require('../src/core/engine');
const K = require('../src/core/keyed');
const D = require('../src/core/dates');

const KEY = K.keyFromSeed('hl7 tests');
const KEY2 = K.keyFromSeed('hl7 tests, other key');
const CR = '\r', LF = '\n', CRLF = '\r\n';
const VT = String.fromCharCode(11), FS = String.fromCharCode(28);

function proc(text, mode, options, key) {
  const run = createRun({ mode: mode || 'pseudonym', key: key || KEY, options: options });
  const r = engine.processText(text, run);
  assert.equal(r.ok, true, r.message);
  r.run = run;
  return r;
}
function segsOf(text) { return text.replace(new RegExp('[' + VT + FS + ']', 'g'), '').split(/\r\n|\r|\n/).filter(Boolean); }
function idsOf(text) { return segsOf(text).map((s) => s.slice(0, 3)); }
function termsOf(text) { return (text.match(/\r\n|\r|\n/g) || []).join(''); }
function count(s, ch) { return s.split(ch).length - 1; }
function fieldOf(text, id, n, occ) {
  const seg = segsOf(text).filter((s) => s.startsWith(id + '|'))[occ || 0];
  assert.ok(seg, 'segment ' + id + ' missing');
  const f = seg.split('|');
  return id === 'MSH' || id === 'FHS' || id === 'BHS' ? f[n - 1] : f[n];
}
function shape(s) { return s.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/\d/g, '9'); }
function dayOf(ts) { return D.toDays(Number(ts.slice(0, 4)), Number(ts.slice(4, 6)), Number(ts.slice(6, 8))); }
function sameStructure(a, b, delims) {
  assert.deepEqual(idsOf(b), idsOf(a), 'segment order');
  assert.equal(termsOf(b), termsOf(a), 'terminators');
  const sa = segsOf(a), sb = segsOf(b);
  for (let i = 0; i < sa.length; i++) for (const ch of delims || ['|', '^', '~', '&']) {
    if (sa[i].startsWith('MSH') || sa[i].startsWith('FHS') || sa[i].startsWith('BHS')) continue;
    assert.equal(count(sb[i], ch), count(sa[i], ch), 'count of ' + ch + ' in segment ' + i + ' (' + sa[i].slice(0, 3) + ')');
  }
}

const ADT = [
  'MSH|^~\\&|REGSYS|HALDON GENERAL|LABHUB|BRANTLEY LAB|20261105083012+0100||ADT^A01|MSG00048213|P|2.5',
  'EVN|A01|20261105083000',
  'PID|1||MR-4471920^^^HGH^MR~912-73-4408^^^SSA^SS||TALLWORTHY^BERENICE^R||19731104|F|||4127 LINDENMOOR TERRACE^^WRENBURY^OH^43017||312-555-0141^PRN^PH~^NET^Internet^berenice.t@postbox.example|||||ACC20261105-0087|912-73-4408',
  'NK1|1|TALLWORTHY^MARISOLVETH|SPO|4127 LINDENMOOR TERRACE^^WRENBURY^OH^43017|312-555-0152',
  'PV1|1|I|3W^312^B^HGH||||7731905^DRAVENHOLT^ESMERIK^A^^DR|||MED|||||||7731905^DRAVENHOLT^ESMERIK^A^^DR|IP|V7750213|' + '|'.repeat(24) + '20261105082500',
  'PV2|||CHEST PAIN. PATIENT TALLWORTHY STATES PAIN BEGAN 11/04/2026. WIFE MARISOLVETH AT BEDSIDE, CALL 312-555-0152',
  'DG1|1|I9|786.50^CHEST PAIN UNSPECIFIED^I9||20261105|A',
  'NTE|1||Contact member VM-123456 or write to marisolveth.t@postbox.example',
  'ZPD|1|TALLWORTHY|reference 998-99-1234'
];
function adt(term) { return ADT.join(term || CR) + (term || CR); }

// ---- structure -----------------------------------------------------------------------------

for (const [name, term] of [['CR', CR], ['LF', LF], ['CRLF', CRLF]]) {
  test('ADT with ' + name + ' terminators: segments, delimiters and terminators stay, the profile fields change', () => {
    const text = adt(term);
    const out = proc(text);
    assert.ok(out.changed > 20);
    sameStructure(text, out.text);
    assert.equal(fieldOf(out.text, 'MSH', 2), '^~\\&');
    assert.notEqual(fieldOf(out.text, 'PID', 5), fieldOf(text, 'PID', 5));
    for (const secret of ['TALLWORTHY', 'BERENICE', 'MARISOLVETH', 'DRAVENHOLT', 'ESMERIK', '4471920', '912-73-4408', '312-555-0141', '312-555-0152', 'LINDENMOOR', 'WRENBURY', '43017', 'postbox', 'VM-123456', '998-99-1234', '7731905'])
      assert.equal(out.text.toLowerCase().indexOf(secret.toLowerCase()), -1, secret);
  });
}

test('mixed terminators (CR, LF, CRLF in one message) come back in the same order', () => {
  const text = ADT.map((s, i) => s + [CR, LF, CRLF][i % 3]).join('');
  const out = proc(text);
  sameStructure(text, out.text);
  assert.equal(termsOf(out.text), termsOf(text));
});

test('a message without a final terminator gets none', () => {
  const text = ADT.join(CR);
  const out = proc(text);
  assert.equal(out.text.endsWith(CR), false);
  sameStructure(text, out.text);
});

test('output is deterministic for a key and differs for another key', () => {
  const text = adt();
  assert.equal(proc(text).text, proc(text).text);
  assert.notEqual(proc(text).text, proc(text, 'pseudonym', null, KEY2).text);
});

test('a byte order mark in front of the message is kept', () => {
  const bom = String.fromCharCode(0xFEFF);
  const out = proc(bom + adt());
  assert.equal(out.text.charCodeAt(0), 0xFEFF);
  assert.ok(out.text.slice(1).startsWith('MSH|^~\\&|'));
});

// ---- MLLP ----------------------------------------------------------------------------------

test('MLLP start and end bytes are kept around one message', () => {
  const text = VT + adt() + FS + CR;
  const out = proc(text);
  assert.equal(out.text[0], VT);
  assert.ok(out.text.endsWith(FS + CR));
  assert.equal(out.text.indexOf('TALLWORTHY'), -1);
  sameStructure(text, out.text);
});

test('every message of a text with several MLLP frames is de-identified, headers included', () => {
  const m1 = ['MSH|^~\\&|SENDA|FACA|RECVA|FACB|20261105083012||ADT^A01|CTRL0001|P|2.5', 'PID|1||MR-1111111^^^HGH^MR||TALLWORTHY^BERENICE||19731104|F'].join(CR) + CR;
  const m2 = ['MSH|^~\\&|SENDA|FACA|RECVA|FACB|20261105083012||ADT^A01|CTRL0002|P|2.5', 'PID|1||MR-2222222^^^HGH^MR||ASHGROVE^OSWIN||19650102|M'].join(CR) + CR;
  const text = VT + m1 + FS + CR + VT + m2 + FS + CR;
  const out = proc(text);
  assert.equal(out.units, 2, 'two messages');
  for (const secret of ['CTRL0002', 'CTRL0001', 'SENDA', 'FACA', 'RECVA', 'FACB', 'ASHGROVE', 'OSWIN', 'TALLWORTHY', '2222222'])
    assert.equal(out.text.indexOf(secret), -1, secret + ' is still in the output');
  assert.notEqual(fieldOf(out.text, 'MSH', 7, 1), '20261105083012', 'the time stamp of the second header moves too');
});

// ---- envelope ------------------------------------------------------------------------------

test('MSH-3 to MSH-6 and MSH-10 are replaced, with the shape of MSH-10 kept', () => {
  const out = proc(adt());
  for (const n of [3, 4, 5, 6, 10]) assert.notEqual(fieldOf(out.text, 'MSH', n), fieldOf(adt(), 'MSH', n), 'MSH-' + n);
  assert.equal(shape(fieldOf(out.text, 'MSH', 10)), shape('MSG00048213'));
  assert.equal(fieldOf(out.text, 'MSH', 9), 'ADT^A01');
  assert.equal(fieldOf(out.text, 'MSH', 11), 'P');
  assert.equal(fieldOf(out.text, 'MSH', 12), '2.5');
});

test('keepEnvelope keeps MSH-3 to MSH-6 and MSH-10 and still replaces the patient', () => {
  const out = proc(adt(), 'pseudonym', { keepEnvelope: true });
  for (const n of [3, 4, 5, 6, 10]) assert.equal(fieldOf(out.text, 'MSH', n), fieldOf(adt(), 'MSH', n), 'MSH-' + n);
  assert.notEqual(fieldOf(out.text, 'PID', 5), fieldOf(adt(), 'PID', 5));
  assert.equal(out.text.indexOf('TALLWORTHY'), -1);
});

test('maskOrganisations false keeps organisation names but not the routing codes', () => {
  const text = ['MSH|^~\\&|REGSYS|HALDON GENERAL|LABHUB|BRANTLEY LAB|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||MR1^^^X^MR||TALLWORTHY^BERENICE',
    'PD1|||ASHMERE FAMILY PRACTICE^L^4451'].join(CR) + CR;
  const out = proc(text, 'pseudonym', { maskOrganisations: false });
  assert.equal(fieldOf(out.text, 'MSH', 4), 'HALDON GENERAL');
  assert.equal(fieldOf(out.text, 'MSH', 6), 'BRANTLEY LAB');
  assert.notEqual(fieldOf(out.text, 'MSH', 3), 'REGSYS');
  assert.equal(fieldOf(out.text, 'PD1', 3).split('^')[0], 'ASHMERE FAMILY PRACTICE');
  const masked = proc(text);
  assert.notEqual(fieldOf(masked.text, 'PD1', 3).split('^')[0], 'ASHMERE FAMILY PRACTICE');
});

test('batch segments FHS BHS BTS FTS keep their order, their counts and their delimiters', () => {
  const batch = [
    'FHS|^~\\&|BATCHSYS|MERIDALE CLINIC|BATCHIN|MERIDALE LAB|20261106020000||FILE-ML-20261106|HDRCMT7|CTL-FILE-0042|REF-0041',
    'BHS|^~\\&|BATCHSYS|MERIDALE CLINIC|BATCHIN|MERIDALE LAB|20261106020000||BATCH-ML-1|BHSCMT7|CTL-BATCH-0042|REF-0041',
    'MSH|^~\\&|REGSYS|MERIDALE CLINIC|ENTBUS|MERIDALE LAB|20261105080000||ADT^A04|ML-B1-0001|P|2.5',
    'PID|1||KD-3304518^^^MC^MR||KODALYVANE^ISAMBARD||19820714|M',
    'BTS|1|batch note', 'FTS|1'].join(CR) + CR;
  const out = proc(batch);
  sameStructure(batch, out.text);
  assert.equal(fieldOf(out.text, 'BTS', 1), '1');
  assert.equal(fieldOf(out.text, 'FTS', 1), '1');
  for (const secret of ['CTL-FILE-0042', 'CTL-BATCH-0042', 'ML-B1-0001', 'KODALYVANE', 'KD-3304518', 'FILE-ML-20261106', 'BATCHSYS', 'MERIDALE'])
    assert.equal(out.text.indexOf(secret), -1, secret);
  assert.equal(shape(fieldOf(out.text, 'BHS', 11)), shape('CTL-BATCH-0042'));
  const kept = proc(batch, 'pseudonym', { keepEnvelope: true });
  for (const n of [3, 4, 5, 6, 9, 10, 11, 12]) {
    assert.equal(fieldOf(kept.text, 'FHS', n), fieldOf(batch, 'FHS', n), 'FHS-' + n);
    assert.equal(fieldOf(kept.text, 'BHS', n), fieldOf(batch, 'BHS', n), 'BHS-' + n);
  }
  assert.equal(fieldOf(kept.text, 'MSH', 10), 'ML-B1-0001');
  assert.equal(kept.text.indexOf('KODALYVANE'), -1);
});

// ---- identifiers, names, addresses ---------------------------------------------------------

test('PID-3 identifiers are replaced by type and keep their shape; the type codes stay', () => {
  const out = proc(adt());
  const [mr, ssn] = fieldOf(out.text, 'PID', 3).split('~');
  const [mrOld, ssnOld] = fieldOf(adt(), 'PID', 3).split('~');
  assert.equal(shape(mr.split('^')[0]), shape('MR-4471920'));
  assert.notEqual(mr.split('^')[0], 'MR-4471920');
  assert.match(ssn.split('^')[0], /^\d{3}-\d{2}-\d{4}$/);
  assert.notEqual(ssn.split('^')[0], '912-73-4408');
  assert.equal(mr.split('^')[4], 'MR');
  assert.equal(ssn.split('^')[4], 'SS');
  assert.notEqual(mr.split('^')[3], mrOld.split('^')[3], 'assigning authority is routing information');
  assert.notEqual(ssn.split('^')[3], ssnOld.split('^')[3]);
});

test('an SSN in PID-19 gets the same replacement as the same number in PID-3', () => {
  const out = proc(adt());
  assert.equal(fieldOf(out.text, 'PID', 19), fieldOf(out.text, 'PID', 3).split('~')[1].split('^')[0]);
  assert.equal(shape(fieldOf(out.text, 'PID', 18)), shape('ACC20261105-0087'));
});

test('names are replaced by invented names in the same case; the same name gets the same replacement everywhere', () => {
  const out = proc(adt());
  const [fam, giv, mid] = fieldOf(out.text, 'PID', 5).split('^');
  assert.match(fam, /^[A-Z]+$/);
  assert.match(giv, /^[A-Z]+$/);
  assert.match(mid, /^[A-Z]$/);
  assert.notEqual(fam, 'TALLWORTHY');
  assert.equal(fieldOf(out.text, 'NK1', 2).split('^')[0], fam);
  assert.ok(fieldOf(out.text, 'PV2', 3).indexOf(fam) !== -1, 'seen family name replaced by the same name in free text');
  assert.ok(fieldOf(out.text, 'ZPD', 2) === fam, 'Z segment');
  const doc = fieldOf(out.text, 'PV1', 7).split('^');
  assert.equal(doc[0].length, 7);
  assert.notEqual(doc[1], 'DRAVENHOLT');
  assert.equal(doc[4], '');
  assert.equal(doc[5], 'DR');
  assert.equal(fieldOf(out.text, 'PV1', 17), fieldOf(out.text, 'PV1', 7), 'same doctor, same replacement');
});

test('addresses, phone numbers and e-mail addresses are replaced; component structure and state stay', () => {
  const out = proc(adt());
  const addr = fieldOf(out.text, 'PID', 11).split('^');
  assert.equal(addr.length, 5);
  assert.equal(addr[3], 'OH');
  assert.notEqual(addr[0], '4127 LINDENMOOR TERRACE');
  assert.match(addr[0], /^\d{4} [A-Z ]+ TERRACE$/);
  assert.match(addr[4], /^\d{5}$/);
  assert.notEqual(addr[4], '43017');
  assert.equal(fieldOf(out.text, 'NK1', 4), fieldOf(out.text, 'PID', 11));
  const [phone, mail] = fieldOf(out.text, 'PID', 13).split('~');
  assert.match(phone.split('^')[0], /^\d{3}-\d{3}-\d{4}$/);
  assert.equal(phone.split('^').slice(1).join('^'), 'PRN^PH');
  assert.match(mail.split('^')[3], /^[a-z.]+\d*@[a-z]+\.example$/);
  assert.equal(mail.split('^').slice(0, 3).join('^'), '^NET^Internet');
});

test('repetitions and components are all replaced and their delimiters stay', () => {
  const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||MR1^^^X^MR~MR2^^^X^MR~MR3^^^X^MR||ASH^BEN^C~COX^DEL^E||19800101|F'].join(CR) + CR;
  const out = proc(text);
  sameStructure(text, out.text);
  const ids = fieldOf(out.text, 'PID', 3).split('~').map((r) => r.split('^')[0]);
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) assert.match(id, /^[A-Z]{2}\d$/);
  const names = fieldOf(out.text, 'PID', 5).split('~');
  assert.equal(names.length, 2);
  assert.notEqual(names[0].split('^')[0], names[1].split('^')[0]);
});

test('subcomponents of an assigning authority: names and OIDs change, the type code in the third part stays', () => {
  const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||MR-1^^^HGH&2.16.840.1.113883.3.1&ISO^MR||ASH^BEN'].join(CR) + CR;
  const out = proc(text);
  const auth = fieldOf(out.text, 'PID', 3).split('^')[3].split('&');
  assert.equal(auth.length, 3);
  assert.notEqual(auth[0], 'HGH');
  assert.notEqual(auth[1], '2.16.840.1.113883.3.1');
  assert.match(auth[1], /^\d\.\d{2}\.\d{3}\.\d\.\d{6}\.\d\.\d$/);
  assert.equal(auth[2], 'ISO');
});

// ---- dates ---------------------------------------------------------------------------------

test('every date of one patient moves by the same number of days; time of day and zone stay', () => {
  const out = proc(adt());
  const pairs = [
    [fieldOf(adt(), 'MSH', 7), fieldOf(out.text, 'MSH', 7)],
    [fieldOf(adt(), 'EVN', 2), fieldOf(out.text, 'EVN', 2)],
    [fieldOf(adt(), 'PID', 7), fieldOf(out.text, 'PID', 7)],
    [fieldOf(adt(), 'DG1', 5), fieldOf(out.text, 'DG1', 5)],
    [fieldOf(adt(), 'PV1', 44), fieldOf(out.text, 'PV1', 44)]
  ];
  const diffs = pairs.map(([a, b]) => dayOf(b) - dayOf(a));
  assert.equal(new Set(diffs).size, 1, 'one offset: ' + diffs.join(','));
  assert.ok(Math.abs(diffs[0]) >= 60 && Math.abs(diffs[0]) <= 730, 'offset ' + diffs[0]);
  assert.equal(pairs[0][1].slice(8), pairs[0][0].slice(8), 'time and zone of MSH-7');
  assert.equal(pairs[1][1].slice(8), '083000');
  const written = /(\d\d)\/(\d\d)\/(\d{4})/.exec(fieldOf(out.text, 'PV2', 3));
  assert.equal(D.toDays(Number(written[3]), Number(written[1]), Number(written[2])) - D.toDays(2026, 11, 4), diffs[0], 'written date in the note');
});

test('two patients of one batch get their own offsets; the same patient keeps hers', () => {
  const one = (i, mrn, fam, dob) => ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL' + i + '|P|2.5', 'PID|1||' + mrn + '^^^X^MR||' + fam + '^PAT||' + dob + '|F'].join(CR) + CR;
  const text = one(1, 'MR-1000001', 'ASHGROVE', '19700101') + one(2, 'MR-2000002', 'COXWELL', '19700101') + one(3, 'MR-1000001', 'ASHGROVE', '19700101');
  const out = proc(text);
  const dobs = [0, 1, 2].map((i) => fieldOf(out.text, 'PID', 7, i));
  assert.notEqual(dobs[0], dobs[1]);
  assert.equal(dobs[0], dobs[2]);
});

test('a date value with a day that does not exist is masked instead of shifted', () => {
  const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||MR1^^^X^MR||ASH^BEN||19730230|F'].join(CR) + CR;
  const out = proc(text);
  assert.equal(out.run.stats.unparsedDates, 1);
  assert.notEqual(fieldOf(out.text, 'PID', 7), '19730230');
  assert.equal(fieldOf(out.text, 'PID', 7).length, 8);
});

test('shiftDates false keeps the dates as they are', () => {
  const out = proc(adt(), 'pseudonym', { shiftDates: false });
  assert.equal(fieldOf(out.text, 'PID', 7), '19731104');
  assert.equal(fieldOf(out.text, 'DG1', 5), '20261105');
  assert.notEqual(fieldOf(out.text, 'PID', 5), fieldOf(adt(), 'PID', 5));
});

// ---- free text, escapes, unknown fields ----------------------------------------------------

test('free text fields (NTE-3, PV2-3) are scanned for seen names, phones, e-mail and labelled ids', () => {
  const out = proc(adt());
  const note = fieldOf(out.text, 'NTE', 3);
  assert.ok(note.startsWith('Contact member '));
  assert.match(note, /^Contact member [A-Z]{2}-\d{6} or write to [a-z.]+\d*@[a-z]+\.example$/);
  const pv2 = fieldOf(out.text, 'PV2', 3);
  assert.ok(pv2.startsWith('CHEST PAIN. PATIENT '));
  assert.ok(pv2.indexOf('312-555-0152') === -1 && pv2.indexOf('312-555-0141') === -1);
  assert.equal(pv2.slice(pv2.indexOf('CALL ') + 5), fieldOf(out.text, 'NK1', 5), 'same phone as in NK1-5');
});

test('Z segments are scanned in full: names seen elsewhere, titles, SSN-like numbers and written dates', () => {
  const text = adt() + 'ZXY|1|Dr Quenby Moorfield saw her on 11/04/2026|SSN 998-99-1234' + CR;
  const out = proc(text);
  const zpd = fieldOf(out.text, 'ZPD', 2);
  assert.notEqual(zpd, 'TALLWORTHY');
  assert.match(fieldOf(out.text, 'ZPD', 3), /^reference \d{3}-\d{2}-\d{4}$/);
  const zxy = fieldOf(out.text, 'ZXY', 2);
  assert.ok(zxy.startsWith('Dr '));
  assert.equal(zxy.indexOf('Moorfield'), -1);
  assert.equal(zxy.indexOf('Quenby'), -1);
  assert.equal(zxy.indexOf('11/04/2026'), -1);
});

test('unknown fields of known segments are only swept: e-mail and SSN-like numbers go, names and plain phones stay', () => {
  const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||MR1^^^X^MR||TALLWORTHY^BERENICE||19800101|F',
    'PV1|1|I|3W^312^B^HGH' + '|'.repeat(9) + 'ref TALLWORTHY mail zed@postbox.example ssn 123-45-6789 tel 312-555-9999'].join(CR) + CR;
  const out = proc(text);
  assert.equal(fieldOf(out.text, 'PID', 5).indexOf('TALLWORTHY'), -1);
  const f = fieldOf(out.text, 'PV1', 12);
  assert.ok(f.startsWith('ref TALLWORTHY mail '), f);
  assert.equal(f.indexOf('zed@postbox.example'), -1);
  assert.equal(f.indexOf('123-45-6789'), -1);
  assert.ok(f.endsWith('tel 312-555-9999'));
});

test('escape sequences in free text come through unchanged while identifiers around them are replaced', () => {
  const note = 'NTE|1||Call TALLWORTHY \\F\\ left message \\.br\\ at 312-555-0152 \\X0D\\ done \\S\\ and \\T\\ and \\R\\ and \\E\\ end';
  const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||MR1^^^X^MR||TALLWORTHY^BERENICE||19800101|F', note].join(CR) + CR;
  const out = proc(text);
  const f = fieldOf(out.text, 'NTE', 3);
  const escapes = (s) => s.match(/\\[A-Z.][A-Za-z0-9]*\\/g);
  assert.deepEqual(escapes(f), escapes(fieldOf(text, 'NTE', 3)));
  assert.equal(f.indexOf('TALLWORTHY'), -1);
  assert.equal(f.indexOf('312-555-0152'), -1);
  sameStructure(text, out.text);
});

test('a free-text field without identifiers is returned byte for byte, escapes and all', () => {
  const body = 'Line one\\.br\\Line two \\F\\ pipe \\S\\ caret \\T\\ amp \\R\\ tilde \\E\\ esc \\X0D\\ hex \\H\\bold\\N\\ plain';
  const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ORU^R01|CTRL1|P|2.5', 'OBX|1|FT|N^x||' + body + '|||||F', 'NTE|1||' + body].join(CR) + CR;
  const out = proc(text);
  assert.equal(fieldOf(out.text, 'OBX', 5), body);
  assert.equal(fieldOf(out.text, 'NTE', 3), body);
});

test('mask mode writes a replaced value that held an escaped delimiter back with its escape, same length', () => {
  const rows = [['SMITH\\T\\JONES^ANN', 'XXXXX\\T\\XXXXX^XXX'], ['O\\F\\NEIL^PAT', 'X\\F\\XXXX^XXX'], ['AB\\E\\CD^PAT', 'XX\\E\\XX^XXX'], ['AB\\S\\CD^PAT', 'XX\\S\\XX^XXX'], ['AB\\R\\CD^PAT', 'XX\\R\\XX^XXX']];
  for (const [name, expected] of rows) {
    const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||X1||' + name].join(CR) + CR;
    const out = proc(text, 'mask');
    assert.equal(fieldOf(out.text, 'PID', 5), expected);
    assert.equal(out.text.length, text.length);
  }
});

test('pseudonym mode never lets a replacement break the field structure when the original held escaped delimiters', () => {
  for (const name of ['SMITH\\T\\JONES^ANN', 'O\\F\\NEIL^PAT', 'AB\\E\\CD^PAT', 'AB\\S\\CD^PAT', 'AB\\R\\CD^PAT']) {
    const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||X1||' + name].join(CR) + CR;
    const out = proc(text);
    sameStructure(text, out.text);
    assert.equal(fieldOf(out.text, 'PID', 5).split('^').length, 2);
  }
});

// ---- OBX value types -----------------------------------------------------------------------

const ORU = [
  'MSH|^~\\&|LABSYS|MERIDALE LAB|EHR|MERIDALE CLINIC|20261105101500||ORU^R01|ORU0001|P|2.5',
  'PID|1||MR-5550101^^^MCL^MR||ROSEWYN^TAMERLIN||19800410|F',
  'OBR|1|ORD-77001|FIL-88002|1234-5^Panel^LN|||20261105090000',
  'OBX|1|ST|T1^Short||Seen with ROSEWYN today|||||F',
  'OBX|2|TX|T2^Text||Line one\\.br\\Call 415-555-0199\\.br\\Dr Hollowmere|||||F',
  'OBX|3|FT|T3^Formatted||Escapes \\F\\ pipe \\S\\ caret \\T\\ amp \\R\\ tilde \\E\\ esc \\X0D\\ hex|||||F',
  'OBX|4|NM|T4^Number||12.5|mg/dL|||||F',
  'OBX|5|CWE|T5^Coded||A01^Some code^L|||||F',
  'OBX|6|XPN|T6^Person||WINDERMOOR^HALVARD^J|||||F',
  'OBX|7|XAD|T7^Address||88 FERNWOOD ROAD^^ASHMERE^NC^27601|||||F',
  'OBX|8|XTN|T8^Phone||(919)555-0127^PRN^PH|||||F',
  'OBX|9|DT|T9^Date||19800410|||||F',
  'OBX|10|TS|T10^Stamp||20261105103000+0100|||||F',
  'OBX|11|ED|T11^Image||^Image^JPEG^Base64^QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=|||||F'
];

test('OBX-5 is handled by the value type in OBX-2', () => {
  const text = ORU.join(CR) + CR;
  const out = proc(text);
  sameStructure(text, out.text);
  const v = (n) => fieldOf(out.text, 'OBX', 5, n - 1);
  assert.equal(v(3), fieldOf(text, 'OBX', 5, 2), 'FT without identifiers is untouched');
  assert.equal(v(4), '12.5');
  assert.equal(v(5), 'A01^Some code^L');
  assert.ok(v(1).startsWith('Seen with ') && v(1).indexOf('ROSEWYN') === -1 && v(1).endsWith(' today'));
  assert.ok(v(2).indexOf('\\.br\\') !== -1 && v(2).indexOf('415-555-0199') === -1 && v(2).indexOf('Hollowmere') === -1);
  assert.notEqual(v(6).split('^')[0], 'WINDERMOOR');
  assert.match(v(6), /^[A-Z]+\^[A-Z]+\^[A-Z]$/);
  assert.match(v(7), /^\d\d [A-Z ]+ ROAD\^\^[A-Z ]+\^NC\^\d{5}$/);
  assert.match(v(8), /^\(\d{3}\)\d{3}-\d{4}\^PRN\^PH$/);
  const shift = dayOf(v(9)) - dayOf('19800410');
  assert.ok(Math.abs(shift) >= 60 && Math.abs(shift) <= 730);
  assert.equal(shift, dayOf(fieldOf(out.text, 'PID', 7)) - dayOf('19800410'), 'DT shifts like the birth date');
  assert.equal(v(10).slice(8), '103000+0100');
  assert.equal(dayOf(v(10)) - dayOf('20261105'), shift, 'TS shifts like the birth date');
  const ed = v(11).split('^');
  assert.equal(ed.slice(0, 4).join('^'), '^Image^JPEG^Base64');
  assert.equal(ed[4].length, 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='.length);
  assert.notEqual(ed[4], 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=');
  assert.equal(ed[4].slice(-1), '=');
});

// ---- other delimiters, headerless and cut messages -----------------------------------------

test('a message with its own delimiters is read with them and written back with them', () => {
  const text = ['MSH#@~\\&#SA#SF#RA#RF#20260105101500##ADT@A01#CTRL5#P#2.5',
    'PID#1##MR77@@@HQ@MR##WRENFIELD@CORVIN#@#19800101#F###12 ELM STREET@@TOWNSEND@OH@12345##555-222-3333@PRN@PH'].join(CR) + CR;
  const out = proc(text);
  sameStructure(text, out.text, ['#', '@', '~']);
  assert.equal(out.text.indexOf('|'), -1);
  assert.ok(out.text.startsWith('MSH#@~\\&#'));
  for (const secret of ['WRENFIELD', 'CORVIN', 'MR77', 'ELM STREET', 'TOWNSEND', '555-222-3333', 'CTRL5']) assert.equal(out.text.indexOf(secret), -1, secret);
});

test('a header with an unusual set of delimiters keeps them all', () => {
  const text = ['MSH!*+?$!SA!SF!RA!RF!20260105101500!!ADT*A01!CTRL5!P!2.5', 'PID!1!!MR77***HQ*MR!!WRENFIELD*CORVIN!!19800101!F'].join(CR) + CR;
  const out = proc(text);
  sameStructure(text, out.text, ['!', '*', '+', '$']);
  assert.ok(out.text.startsWith('MSH!*+?$!'));
  assert.equal(out.text.indexOf('WRENFIELD'), -1);
});

test('segments without an MSH are read with the default delimiters', () => {
  const text = ['PID|1||MR-1^^^X^MR||ASHGROVE^OSWIN||19650102|M', 'PV1|1|I', 'NTE|1||ASHGROVE called'].join(LF) + LF;
  const out = proc(text);
  sameStructure(text, out.text);
  assert.equal(out.text.indexOf('ASHGROVE'), -1);
  assert.equal(out.text.indexOf('OSWIN'), -1);
  assert.notEqual(fieldOf(out.text, 'PID', 7), '19650102');
});

test('a message cut off in the middle of a field is still de-identified and gets no terminator', () => {
  const text = ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL1|P|2.5', 'PID|1||MR1^^^X^MR||TALLWOR'].join(CR);
  const out = proc(text);
  assert.equal(out.text.indexOf('TALLWOR'), -1);
  assert.equal(termsOf(out.text), CR);
  assert.equal(count(segsOf(out.text)[1], '|'), 5);
});

test('minimal and odd messages do not throw', () => {
  for (const text of ['MSH|^~\\&|', 'MSH|^~\\&|A|B|C|D|E', 'MSH|^~\\&|A' + CR + 'PID', 'MSH|^~\\&|A' + CR + 'PID|' + CR + CR + CR + 'PV1||', 'MSH|^~\\&|A|B|C|D|20261105||ADT^A01|C1|P|2.5' + CR + CR + CR])
    for (const mode of ['pseudonym', 'mask']) {
      const out = engine.processText(text, createRun({ mode: mode, key: KEY }));
      assert.equal(out.ok, true);
      assert.equal(termsOf(out.text), termsOf(text));
    }
});

// ---- modes, consistency --------------------------------------------------------------------

test('mask mode: letters become X, digits 9, the length and every delimiter stay, free text is not read', () => {
  const text = adt();
  const out = proc(text, 'mask');
  assert.equal(out.text.length, text.length);
  sameStructure(text, out.text);
  assert.equal(fieldOf(out.text, 'PID', 5), 'XXXXXXXXXX^XXXXXXXX^X');
  assert.equal(fieldOf(out.text, 'PID', 7), '99999999');
  assert.equal(fieldOf(out.text, 'PID', 8), 'F');
  assert.equal(fieldOf(out.text, 'MSH', 9), 'ADT^A01');
  assert.equal(fieldOf(out.text, 'PV2', 3), fieldOf(text, 'PV2', 3), 'mask mode only touches the profile fields');
  assert.equal(proc(out.text, 'mask').text, out.text, 'masking twice equals masking once');
});

test('the same patient in two messages gets the same invented name; 80 patients get 80 different ones', () => {
  const one = (i) => ['MSH|^~\\&|A|B|C|D|20261105083012||ADT^A01|CTRL' + i + '|P|2.5', 'PID|1||MR-' + (1000000 + i) + '^^^X^MR||FAM' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)) + 'SON^GIV' + i].join(CR) + CR;
  let text = '';
  for (let i = 0; i < 80; i++) text += one(i);
  text += one(5);
  const out = proc(text);
  const fams = [];
  for (let i = 0; i < 81; i++) fams.push(fieldOf(out.text, 'PID', 5, i).split('^')[0]);
  assert.equal(new Set(fams.slice(0, 80)).size, 80);
  assert.equal(fams[80], fams[5]);
  assert.equal(out.units, 81);
});

test('scanOnly counts the hits, calls onHit with a category, and neither changes the text nor calls set', () => {
  const text = adt();
  const run = createRun({ mode: 'pseudonym', key: KEY });
  const hits = [];
  const out = engine.processText(text, run, {
    scanOnly: true,
    onHit: (h, category) => { hits.push(category); h.set = function () { throw new Error('set was called in a scan'); }; }
  });
  assert.equal(out.ok, true);
  assert.equal(out.text, text);
  assert.ok(hits.length > 25);
  assert.ok(hits.includes('names') && hits.includes('phone') && hits.includes('ssn') && hits.includes('dates'));
  assert.ok(run.stats.total >= hits.length);
});

test('a batch of 3,000 OBX segments is processed and keeps its shape', () => {
  const lines = ['MSH|^~\\&|A|B|C|D|20261105083012||ORU^R01|CTRL1|P|2.5', 'PID|1||MR1^^^X^MR||ASHGROVE^OSWIN||19650102|M'];
  for (let i = 1; i <= 3000; i++) lines.push('OBX|' + i + '|ST|T^x||value ' + i + ' for ASHGROVE|||||F');
  const text = lines.join(CR) + CR;
  const out = proc(text);
  assert.equal(segsOf(out.text).length, 3002);
  assert.equal(out.text.indexOf('ASHGROVE'), -1);
  sameStructure(text, out.text);
});
