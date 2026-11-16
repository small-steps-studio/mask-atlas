'use strict';
// The tables of "What the engine cannot see" in docs/coverage.md, run as tests: every row that says
// "stays" or "replaced" is tried with invented data in a Pro run with the default settings (one
// message, one run). A row that stops being true fails here, so the page cannot overstate the tool.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/core/keyed');
const engine = require('../src/core/engine');
const { createRun } = require('../src/core/run');

function run(message) {
  const r = engine.processText(message, createRun({ mode: 'pseudonym', key: K.keyFromSeed('limits test seed phrase') }), {});
  assert.equal(r.ok, true, r.message);
  return r.text;
}
function msg(note, options) {
  const o = options || {};
  const given = o.given || 'Quill';
  const family = o.family || 'Fenwick';
  return [
    'MSH|^~\\&|REGAPP|HALDRINN GENERAL|LABAPP|BRANTWELL LAB|20261105083012||ADT^A01|MSG00048213|P|2.5',
    'PID|1||MR-4471920^^^HGH^MR||' + family + '^' + given + '||19731104|M|||4127 Lindenmoor Terrace^^Wrenbury^OH^43017|' + (o.pid12 || '') + '|312-555-0141^PRN^PH',
    (o.extra || []).join('\r'),
    'NTE|1||' + note
  ].filter(Boolean).join('\r') + '\r';
}
function lastNote(out) { return out.split(String.fromCharCode(13)).filter(Boolean).pop(); }
function stays(note, words, options) { const out = run(msg(note, options)); for (const w of words) assert.ok(out.indexOf(w) !== -1, '"' + w + '" should stay in: ' + out.split('\r').pop()); }
function replaced(note, words, options) { const out = run(msg(note, options)); for (const w of words) assert.ok(out.indexOf(w) === -1, '"' + w + '" should be replaced in: ' + out.split('\r').pop()); }

// ---- names in running text -----------------------------------------------------------------------

test('a name written once in a note, with no title word, relation word or field that holds it, stays', () => {
  stays('Spoke with Tomasz Brightwater about the results.', ['Tomasz', 'Brightwater']);
  stays('SPOKE WITH TOMASZ BRIGHTWATER ABOUT THE RESULTS.', ['TOMASZ BRIGHTWATER']);
  stays('Message left c/o Tomasz Brightwater.', ['Tomasz Brightwater']);
});

test('a nickname or another spelling of a name that sits in a field stays', () => {
  stays('Quilly came to the desk.', ['Quilly']);
  stays('Fenwik called back.', ['Fenwik']);
});

test('a name after a title word or relation word followed by a full stop or a comma stays; followed by a space it is replaced', () => {
  const dot = run(msg('Seen with Dr Halloran Pike.'));
  assert.ok(dot.indexOf('Pike') !== -1 || dot.indexOf('Halloran') !== -1, 'the name or its last word stays: ' + dot.split('\r').pop());
  const comma = run(msg('Spoke to her daughter Marisol, who agreed.'));
  assert.ok(comma.indexOf('Marisol') !== -1, 'a name before a comma stays');
  replaced('Seen with Dr Halloran Pike on the ward', ['Halloran', 'Pike']);
});

test('a name that was seen in a field and is written in a note is replaced, in any capitalisation, also with an ending', () => {
  replaced('Fenwick was calm. Then FENWICK slept; fenwick\'s chart was updated.', ['Fenwick', 'FENWICK', 'fenwick']);
  replaced('Quill asked for water.', ['Quill']);
});

test('a seen name that is also a common word is matched only in the exact capitalisation or in capitals', () => {
  const W = require('../src/core/words');
  const word = W.COMMON_WORD_NAMES.find(function (w) { return w.length >= 4; });
  assert.ok(word, 'the list of common-word names is not empty');
  const cap = word.charAt(0).toUpperCase() + word.slice(1);
  const out = run(msg('the ' + word + ' of the matter, and ' + cap + ' arrived', { family: cap }));
  assert.ok(lastNote(out).indexOf('the ' + word + ' of the matter') !== -1, 'lower case stays');
  assert.ok(lastNote(out).indexOf(cap + ' arrived') === -1, 'the exact capitalisation is replaced');
});

test('an employer or a small town named in a note stays; a seen name shorter than three letters is not looked for', () => {
  stays('Works at Brightwater Dairy Cooperative. Moved from Tiny Hollow last year.', ['Brightwater Dairy Cooperative', 'Tiny Hollow']);
  stays('Li and Al came together.', ['Li and Al'], { family: 'Li', given: 'Al' });
});

// ---- dates, numbers and addresses in running text --------------------------------------------------

test('dates in words, with a month name or with a two-digit year stay; four numeric layouts are replaced', () => {
  stays('Seen on November 4, 2026 and on 4 Nov 2026 and on 11/04/26.', ['November 4, 2026', '4 Nov 2026', '11/04/26']);
  replaced('Seen on 2026-11-04, 11/04/2026, 4.11.2026 and 2026/11/04.', ['2026-11-04', '11/04/2026', '4.11.2026', '2026/11/04']);
});

test('a seven-digit telephone number stays; ten digits with dots, spaces or an international prefix are replaced', () => {
  stays('Call 555-0188 for the ward.', ['555-0188']);
  replaced('Call 415.555.0171 or 415 555 0172 or +1 415 555 0173 please.', ['415.555.0171', '415 555 0172', '415 555 0173']);
});

test('an SSN-like number without separators and label stays; with dashes or after the label SSN it is replaced', () => {
  stays('Card number 926417390 was copied.', ['926417390']);
  replaced('Number 926-41-7390 on the card.', ['926-41-7390']);
  replaced('SSN 926417390 on file.', ['926417390']);
});

test('a web address without a scheme and without www stays', () => {
  stays('Portal: portal.example/patient/55102', ['portal.example/patient/55102']);
  replaced('Portal: https://portal.example/patient/55102', ['portal.example/patient/55102']);
});

test('an identifier without label and earlier occurrence stays; after a label it is replaced', () => {
  stays('Pulled QX-77-1204 from the archive.', ['QX-77-1204']);
  replaced('Pulled ref QX-77-1204 from the archive.', ['QX-77-1204']);
  replaced('Member QX-77-1204 asked.', ['QX-77-1204']);
});

test('ages and a rare condition written in a note stay', () => {
  stays('93 years old with a rare condition, Ondine curse.', ['93 years old', 'Ondine curse']);
});

// ---- places the profile does not know ----------------------------------------------------------------

test('a field of a known segment that the profile does not list stays (a county text in PID-12)', () => {
  const out = run(msg('ok', { pid12: 'Hennepin County' }));
  assert.ok(out.indexOf('Hennepin County') !== -1);
});

test('an identifier with no shape in an unknown segment stays, but is replaced when it was seen in a recognised field', () => {
  const out = run(msg('ok', { extra: ['ZXX|1|QX-77-1204'] }));
  assert.ok(out.indexOf('ZXX|1|QX-77-1204') !== -1, 'unknown segment, not seen elsewhere');
  const seen = run(msg('ok', { extra: ['ZXX|1|MR-4471920'] }));
  assert.ok(seen.indexOf('ZXX|1|MR-4471920') === -1, 'seen in PID-3, replaced in the unknown segment');
});

test('FHIR: a telephone number or a name in an unknown key stays; a Binary payload stays', () => {
  const bundle = JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Fenwick', given: ['Quill'] }], localNote: { contactName: 'Tomasz Brightwater', contactPhone: '+1 603 555 0177' } });
  const out = run(bundle);
  assert.ok(out.indexOf('Tomasz Brightwater') !== -1 && out.indexOf('+1 603 555 0177') !== -1);
  assert.ok(out.indexOf('Fenwick') === -1);
  const binary = run(JSON.stringify({ resourceType: 'Binary', id: 'b1', contentType: 'text/plain', data: 'U3BlYWsgdG8gUXVpbGwgRmVud2ljaw==' }));
  assert.ok(binary.indexOf('U3BlYWsgdG8gUXVpbGwgRmVud2ljaw==') !== -1);
});

test('FHIR: the standard extensions that carry a name are replaced, in a plain value of a local extension a name seen nowhere else stays', () => {
  const MAIDEN = 'http://hl7.org/fhir/StructureDefinition/patient-mothersMaidenName';
  const standard = run(JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Fenwick', given: ['Quill'] }], extension: [{ url: MAIDEN, valueString: 'Pemberthwaite' }, { url: 'http://hl7.org/fhir/StructureDefinition/patient-congregation', valueString: 'Saint Margarets North Parish' }] }));
  assert.ok(standard.indexOf('Pemberthwaite') === -1 && standard.indexOf('Saint Margarets') === -1);
  const local = run(JSON.stringify({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Fenwick', given: ['Quill'] }], extension: [{ url: 'http://example.org/ext/note', valueString: 'Tomasz Brightwater' }] }));
  assert.ok(local.indexOf('Tomasz Brightwater') !== -1);
});

test('FHIR: attachment payloads in the recognised shape are blanked, never read', () => {
  const doc = JSON.stringify({ resourceType: 'DocumentReference', id: 'd1', status: 'current', content: [{ attachment: { contentType: 'text/plain', data: 'U3BlYWsgdG8gUXVpbGwgRmVud2ljaw==' } }] });
  assert.ok(run(doc).indexOf('U3BlYWsgdG8gUXVpbGwgRmVud2ljaw==') === -1);
});

test('by design: codes, amounts and the message type stay; check digits are not recomputed', () => {
  const out = run(msg('ok'));
  assert.ok(out.indexOf('ADT^A01') !== -1, 'message type');
  assert.ok(out.indexOf('|M|') !== -1, 'gender code');
});
