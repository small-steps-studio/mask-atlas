'use strict';
// Writes large files of invented messages for the large-file tests. Every message has its own
// patient (so the run keeps many distinct values, the hard case) and the writer is
// deterministic: message i is always the same text.

const fs = require('node:fs');

function letters(i, n) {
  let s = '';
  let v = i + 1;
  for (let k = 0; k < n; k++) { s += String.fromCharCode(97 + (v % 26)); v = Math.floor(v / 26) + (k + 3); }
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function digits(i, n, salt) { return String((i * 7919 + (salt || 0) * 104729 + 1000003) % Math.pow(10, n)).padStart(n, '0'); }
function dateOf(i) { const d = new Date(Date.UTC(1940 + (i % 60), i % 12, 1 + (i % 27))); return d.toISOString().slice(0, 10).replace(/-/g, ''); }

function hl7(i) {
  const fam = letters(i, 9), giv = letters(i * 3 + 1, 6), mrn = 'MR-' + digits(i, 7), ssn = digits(i, 3, 1) + '-' + digits(i, 2, 2) + '-' + digits(i, 4, 3);
  const phone = '(' + digits(i, 3, 4) + ')555-' + digits(i, 4, 5);
  return [
    'MSH|^~\\&|REGSYS|GENERAL ' + letters(i % 50, 5).toUpperCase() + '|ORDHUB|LAB|2026110508' + digits(i, 4, 6).slice(0, 4) + '||ADT^A01|MSG' + digits(i, 8, 7) + '|P|2.3',
    'EVN|A01|20261105083000',
    'PID|1||' + mrn + '^^^HGH^MR~' + ssn + '^^^SSA^SS||' + fam.toUpperCase() + '^' + giv.toUpperCase() + '^M||' + dateOf(i) + '|M|||' + (1 + i % 998) + ' ' + letters(i, 7).toUpperCase() + ' STREET^^' + letters(i + 5, 8).toUpperCase() + '^OH^' + digits(i, 5, 8) + '||' + phone + '|||||ACC' + digits(i, 9, 9) + '|' + ssn,
    'NK1|1|' + fam.toUpperCase() + '^' + letters(i + 9, 7).toUpperCase() + '|SPO||' + '(' + digits(i, 3, 10) + ')555-' + digits(i, 4, 11),
    'PV1|1|I|3W^312^B^HGH||||' + digits(i, 7, 12) + '^' + letters(i * 5, 8).toUpperCase() + '^' + letters(i + 2, 5).toUpperCase() + '|||MED|||||||||IP|V' + digits(i, 7, 13),
    'PV2|||Chest pain. Patient ' + fam + ' states pain began after shovelling. Wife ' + letters(i + 9, 7) + ' at bedside, call ' + '(' + digits(i, 3, 10) + ')555-' + digits(i, 4, 11),
    'DG1|1|I9|786.50^CHEST PAIN UNSPECIFIED^I9||20261105|A',
    ''
  ].join('\r');
}

function x12(i) {
  const fam = letters(i, 9).toUpperCase(), giv = letters(i * 3 + 1, 6).toUpperCase();
  const control = digits(i, 9, 14);
  const body = [
    'GS*HC*SENDER*RECEIVER*20261105*0830*' + (i % 9999 + 1) + '*X*005010X222A1',
    'ST*837*0001*005010X222A1',
    'BHT*0019*00*BATCH' + digits(i, 8, 15) + '*20261105*0830*CH',
    'NM1*41*2*' + letters(i % 40, 7).toUpperCase() + ' CARE*****46*TX' + digits(i, 5, 16),
    'HL*1**20*1',
    'NM1*85*2*' + letters(i % 40, 7).toUpperCase() + ' CARE*****XX*' + digits(i, 10, 17),
    'HL*2*1*22*0',
    'SBR*P*18**GRP-' + digits(i, 4, 18) + '*****CI',
    'NM1*IL*1*' + fam + '*' + giv + '*A***MI*MBR' + digits(i, 8, 19),
    'N3*' + (1 + i % 998) + ' ' + letters(i, 7).toUpperCase() + ' ROAD',
    'N4*' + letters(i + 5, 8).toUpperCase() + '*TX*' + digits(i, 5, 20),
    'DMG*D8*' + dateOf(i) + '*F',
    'REF*SY*' + digits(i, 3, 1) + '-' + digits(i, 2, 2) + '-' + digits(i, 4, 3),
    'CLM*ACCT-' + digits(i, 6, 21) + '*182.50***11:B:1*Y*A*Y*Y',
    'DTP*431*D8*20261029',
    'NTE*ADD*PATIENT ' + fam + ' ' + giv + ' ASKED FOR A STATEMENT',
    'SE*14*0001',
    'GE*1*' + (i % 9999 + 1)
  ];
  const isa = 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *261105*0830*^*00501*' + control + '*0*P*:~';
  return isa + body.join('~') + '~IEA*1*' + control + '~\n';
}

function ndjson(i) {
  const fam = letters(i, 9) + '-' + letters(i + 4, 6), giv = letters(i * 3 + 1, 6);
  const pid = 'p' + i;
  const patient = { resourceType: 'Patient', id: pid, identifier: [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }] }, system: 'http://sample-clinic.example/ids/mrn', value: 'MRN-' + digits(i, 8) }],
    name: [{ family: fam, given: [giv] }], telecom: [{ system: 'phone', value: '+1 ' + digits(i, 3, 4) + ' 555 ' + digits(i, 4, 5) }], gender: 'female', birthDate: dateOf(i).replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3'),
    address: [{ line: [(1 + i % 998) + ' ' + letters(i, 7) + ' Road'], city: letters(i + 5, 8), state: 'NH', postalCode: digits(i, 5, 8) }] };
  const obs = { resourceType: 'Observation', id: 'o' + i, status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] }, subject: { reference: 'Patient/' + pid },
    effectiveDateTime: '2026-11-05T08:30:00Z', valueQuantity: { value: 120 + (i % 40), unit: 'mmHg' }, note: [{ text: 'Seen with ' + giv + ' ' + fam + ' at home, phone +1 ' + digits(i, 3, 4) + ' 555 ' + digits(i, 4, 5) }] };
  return JSON.stringify(patient) + '\n' + JSON.stringify(obs) + '\n';
}

const MAKERS = { hl7: hl7, x12: x12, ndjson: ndjson };

/** Writes about `bytes` bytes of the format to `file`; returns { messages, bytes }. */
function writeLarge(format, file, bytes) {
  const make = MAKERS[format];
  const fd = fs.openSync(file, 'w');
  let written = 0, i = 0;
  try {
    while (written < bytes) {
      let block = '';
      for (let k = 0; k < 500 && written + block.length < bytes; k++, i++) block += make(i);
      fs.writeSync(fd, block);
      written += Buffer.byteLength(block);
    }
  } finally { fs.closeSync(fd); }
  return { messages: i, bytes: written };
}

module.exports = { writeLarge, hl7, x12, ndjson, letters, digits };
