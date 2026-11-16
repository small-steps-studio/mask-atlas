'use strict';
// Short sample messages made of invented data (no real person, institution or vendor text), used
// by the "Open Sample" commands, the walkthrough and the README screenshots.

const HL7 = [
  'MSH|^~\\&|REGISTRY|HARBOURSIDE CLINIC|RESULTS|HARBOURSIDE LAB|20261104091530||ADT^A01|MSG20261104-0042|P|2.5',
  'EVN|A01|20261104091500',
  'PID|1||HC-7305518^^^HSC^MR~926-41-7390^^^SSA^SS||Larkspur^Evander^Marlowe||19810322|M|||41 Wren Hollow Road^^Fernbury^OH^43055||614-555-0187^PRN^PH~^NET^Internet^evander.larkspur@mail.example||||||HC-ACC-228814|926-41-7390',
  'NK1|1|Larkspur^Odelia|SPO|41 Wren Hollow Road^^Fernbury^OH^43055|614-555-0143',
  'PV1|1|I|2N^204^A^HSC||||6102257^Thistlewood^Corisande^^^MD|||MED|||||||6102257^Thistlewood^Corisande^^^MD|IP|HC-V-905527|||||||||||||||||||||||||20261104090000',
  'PV2|||Chest tightness since Monday. Patient Larkspur says it began after shovelling. Wife Odelia is at the bedside, call 614-555-0143.',
  'NTE|1||Insurance card shows member HM-MEMBER-4417203. Send the summary to evander.larkspur@mail.example.',
  'DG1|1|I10|I20.9^Angina pectoris, unspecified^I10||20261104|A',
  ''
].join('\r');

const FHIR = JSON.stringify({
  resourceType: 'Bundle',
  id: 'sample-visit-bundle',
  type: 'collection',
  timestamp: '2026-11-04T09:20:00Z',
  entry: [
    {
      fullUrl: 'urn:uuid:7c1d5b0e-2a64-4f1b-9e0a-3d55b7a1c201',
      resource: {
        resourceType: 'Patient',
        id: '7c1d5b0e-2a64-4f1b-9e0a-3d55b7a1c201',
        identifier: [
          { type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }] }, system: 'http://harbourside.example/ids/mrn', value: 'HC-7305518' },
          { type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'SS' }] }, system: 'http://hl7.org/fhir/sid/us-ssn', value: '926-41-7390' }
        ],
        name: [{ use: 'official', family: 'Larkspur', given: ['Evander', 'Marlowe'] }],
        telecom: [{ system: 'phone', value: '614-555-0187', use: 'home' }, { system: 'email', value: 'evander.larkspur@mail.example' }],
        gender: 'male',
        birthDate: '1981-03-22',
        address: [{ use: 'home', line: ['41 Wren Hollow Road'], city: 'Fernbury', state: 'OH', postalCode: '43055' }]
      }
    },
    {
      fullUrl: 'urn:uuid:3a9e8c44-61d7-4d0c-8b52-90e1f2a6b302',
      resource: {
        resourceType: 'Observation',
        id: '3a9e8c44-61d7-4d0c-8b52-90e1f2a6b302',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }] },
        subject: { reference: 'urn:uuid:7c1d5b0e-2a64-4f1b-9e0a-3d55b7a1c201', display: 'Evander Larkspur' },
        effectiveDateTime: '2026-11-04T09:05:00Z',
        valueQuantity: { value: 148, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
        note: [{ text: 'Mr Larkspur felt dizzy; his wife Odelia can be reached on 614-555-0143.' }]
      }
    }
  ]
}, null, 2) + '\n';

const X12 = [
  'ISA*00*          *00*          *ZZ*HARBOURSIDEMED *ZZ*NORTHWAYPAYER  *261104*0930*^*00501*000000231*0*P*:~',
  'GS*HC*HARBOURSIDEMED*NORTHWAYPAYER*20261104*0930*231*X*005010X222A1~',
  'ST*837*0001*005010X222A1~',
  'BHT*0019*00*BATCH-HM-1104*20261104*0930*CH~',
  'NM1*41*2*HARBOURSIDE MEDICAL GROUP*****46*HM10442~',
  'PER*IC*BILLING OFFICE*TE*6145550110*EM*billing@harbourside.example~',
  'NM1*40*2*NORTHWAY PAYER SERVICES*****46*NW20917~',
  'HL*1**20*1~',
  'NM1*85*2*HARBOURSIDE MEDICAL GROUP*****XX*1982736451~',
  'N3*900 QUAYSIDE AVENUE~',
  'N4*FERNBURY*OH*43055~',
  'REF*EI*466012345~',
  'HL*2*1*22*0~',
  'SBR*P*18**GRP-HM-2210*****CI~',
  'NM1*IL*1*LARKSPUR*EVANDER*M***MI*NWP4417203~',
  'N3*41 WREN HOLLOW ROAD~',
  'N4*FERNBURY*OH*43055~',
  'DMG*D8*19810322*M~',
  'REF*SY*926-41-7390~',
  'NM1*PR*2*NORTHWAY PAYER SERVICES*****PI*NW20917~',
  'CLM*ACCT-HM-905527*182.50***11:B:1*Y*A*Y*Y~',
  'DTP*431*D8*20261029~',
  'NTE*ADD*PATIENT LARKSPUR ASKED FOR A STATEMENT AT 41 WREN HOLLOW ROAD~',
  'HI*ABK:I209~',
  'LX*1~',
  'SV1*HC:99213*95*UN*1***1~',
  'DTP*472*D8*20261029~',
  'SE*26*0001~',
  'GE*1*231~',
  'IEA*1*000000231~',
  ''
].join('\n');

const SAMPLES = {
  hl7: { name: 'sample-adt-a01.hl7', language: 'plaintext', text: HL7 },
  fhir: { name: 'sample-visit-bundle.json', language: 'json', text: FHIR },
  x12: { name: 'sample-claim-837.x12', language: 'plaintext', text: X12 }
};

function sampleFor(kind) { return SAMPLES[kind]; }

module.exports = { sampleFor, SAMPLES };
