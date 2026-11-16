'use strict';
// FHIR JSON: resources, bundles, NDJSON, arrays; links, number text, indentation, refusals.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRun } = require('../src/core/run');
const engine = require('../src/core/engine');
const K = require('../src/core/keyed');
const D = require('../src/core/dates');

const KEY = K.keyFromSeed('fhir tests');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function proc(text, mode, options, extra) {
  const run = createRun({ mode: mode || 'pseudonym', key: KEY, options: options });
  const r = engine.processText(text, run, extra);
  assert.equal(r.ok, true, r.message);
  r.run = run;
  return r;
}
function pretty(o, indent) { return JSON.stringify(o, null, indent === undefined ? 2 : indent) + '\n'; }
function skeleton(v) {
  if (Array.isArray(v)) return v.map(skeleton);
  if (v && typeof v === 'object') { const o = Object.create(null); for (const k of Object.keys(v)) o[k] = skeleton(v[k]); return o; }
  return typeof v;
}
function sameShape(a, b) { assert.equal(JSON.stringify(skeleton(JSON.parse(b))), JSON.stringify(skeleton(JSON.parse(a)))); }
function gone(text, list) { const low = text.toLowerCase(); for (const s of list) assert.equal(low.indexOf(s.toLowerCase()), -1, s + ' is still in the output'); }
function kept(text, list) { for (const s of list) assert.notEqual(text.indexOf(s), -1, s + ' is missing from the output'); }
function dayOf(s) { return D.toDays(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))); }

const CODING = (system, code) => ({ coding: [{ system: system, code: code }] });
const V2 = 'http://terminology.hl7.org/CodeSystem/v2-0203';
const PATIENT = {
  resourceType: 'Patient', id: 'pat-7731',
  meta: { versionId: '3', lastUpdated: '2026-11-05T08:30:00Z', profile: ['http://hl7.org/fhir/StructureDefinition/Patient'] },
  identifier: [{ use: 'usual', type: CODING(V2, 'MR'), system: 'http://rosewyn-health.example/mrn', value: 'RW-5550101' }, { type: CODING(V2, 'SS'), system: 'http://hl7.org/fhir/sid/us-ssn', value: '912-73-4408' }],
  active: true, name: [{ use: 'official', family: 'Tallworthy', given: ['Berenice', 'Raelynn'], prefix: ['Ms'] }],
  telecom: [{ system: 'phone', value: '312-555-0141', use: 'home' }, { system: 'email', value: 'berenice.t@postbox.example' }], gender: 'female', birthDate: '1973-11-04',
  address: [{ use: 'home', line: ['4127 Lindenmoor Terrace'], city: 'Wrenbury', state: 'OH', postalCode: '43017', country: 'US' }],
  contact: [{ relationship: [CODING('http://terminology.hl7.org/CodeSystem/v2-0131', 'N')], name: { family: 'Tallworthy', given: ['Marisolveth'] }, telecom: [{ system: 'phone', value: '312-555-0152' }] }],
  generalPractitioner: [{ reference: 'Practitioner/prac-9', display: 'Dr Esmerik Dravenholt' }], managingOrganization: { reference: 'Organization/org-3', display: 'Rosewyn Family Clinic' }
};
const ORG_REF = { reference: 'Organization/org-3', display: 'Rosewyn Family Clinic' };
const PAT_REF = { reference: 'Patient/pat-7731', display: 'Berenice Tallworthy' };
const PRAC_REF = { reference: 'Practitioner/prac-9', display: 'Dr Esmerik Dravenholt' };
const NPI = 'http://hl7.org/fhir/sid/us-npi';

const RESOURCES = [
  { name: 'Patient', res: PATIENT,
    gone: ['Tallworthy', 'Berenice', 'Raelynn', 'Marisolveth', 'RW-5550101', '912-73-4408', '312-555-0141', '312-555-0152', 'postbox', 'Lindenmoor', 'Wrenbury', '43017', '1973-11-04', 'pat-7731', 'prac-9', 'org-3', 'Dravenholt', 'Esmerik', 'Rosewyn', '2026-11-05'],
    kept: ['"Patient"', '"female"', '"OH"', '"US"', '"Ms"', '"official"', 'http://hl7.org/fhir/sid/us-ssn', V2, '"MR"', '"SS"', '"home"', '"3"', 'http://hl7.org/fhir/StructureDefinition/Patient'] },
  { name: 'Practitioner', gone: ['Dravenholt', 'Esmerik', '1932000087', 'D-8841-77', '312-555-0188', 'e.dravenholt', 'Zephyr', '1969-02-14', 'QUAL-5531', 'prac-9'], kept: ['"male"', '"Dr"', '"MD"', '"work"', NPI, '"DL"'],
    res: { resourceType: 'Practitioner', id: 'prac-9', identifier: [{ system: NPI, value: '1932000087' }, { type: CODING(V2, 'DL'), system: 'http://rosewyn-health.example/licences', value: 'D-8841-77' }], active: true,
      name: [{ family: 'Dravenholt', given: ['Esmerik', 'A'], prefix: ['Dr'], suffix: ['MD'] }], telecom: [{ system: 'phone', value: '312-555-0188', use: 'work' }, { system: 'email', value: 'e.dravenholt@postbox.example' }],
      address: [{ line: ['10 Zephyr Lane'], city: 'Wrenbury', state: 'OH', postalCode: '43017' }], gender: 'male', birthDate: '1969-02-14', qualification: [{ identifier: [{ value: 'QUAL-5531' }], code: { text: 'MD' } }] } },
  { name: 'RelatedPerson', gone: ['Tallworthy', 'Marisolveth', '312-555-0152', '1970-06-01', 'Lindenmoor', 'pat-7731', 'rp-1', 'Berenice'], kept: ['"SPS"', '"male"', 'http://terminology.hl7.org/CodeSystem/v3-RoleCode'],
    res: { resourceType: 'RelatedPerson', id: 'rp-1', active: true, patient: PAT_REF, relationship: [CODING('http://terminology.hl7.org/CodeSystem/v3-RoleCode', 'SPS')], name: [{ family: 'Tallworthy', given: ['Marisolveth'] }],
      telecom: [{ system: 'phone', value: '312-555-0152' }], gender: 'male', birthDate: '1970-06-01', address: [{ line: ['4127 Lindenmoor Terrace'], city: 'Wrenbury', postalCode: '43017' }] } },
  { name: 'Organization', gone: ['Rosewyn', '1417000042', '312-555-0100', 'rosewyn-clinic', 'Haverstock', 'Wrenbury', '43017', 'org-3', 'ep-1'], kept: ['"OH"', NPI, '"url"'],
    res: { resourceType: 'Organization', id: 'org-3', identifier: [{ system: NPI, value: '1417000042' }], active: true, name: 'Rosewyn Family Clinic', alias: ['Rosewyn FC'],
      telecom: [{ system: 'phone', value: '312-555-0100' }, { system: 'url', value: 'http://www.rosewyn-clinic.example' }], address: [{ line: ['2210 Haverstock Row'], city: 'Wrenbury', state: 'OH', postalCode: '43017' }], endpoint: [{ reference: 'Endpoint/ep-1' }] } },
  { name: 'Location', gone: ['North Wing', '312-555-0111', 'Haverstock', 'Wrenbury', '43017', 'loc-1', 'org-3'], kept: ['"OH"'],
    res: { resourceType: 'Location', id: 'loc-1', name: 'North Wing Imaging Suite', telecom: [{ system: 'phone', value: '312-555-0111' }], address: { line: ['2210 Haverstock Row'], city: 'Wrenbury', state: 'OH', postalCode: '43017' },
      position: { longitude: -83.2718, latitude: 40.1234 }, managingOrganization: { reference: 'Organization/org-3' } } },
  { name: 'Observation', gone: ['Tallworthy', 'Berenice', '312-555-0141', 'berenice.t@postbox.example', 'VM-123456', '2026-11-04', 'Dravenholt', 'obs-1', 'pat-7731'], kept: ['Heart rate', '8867-4', 'http://loinc.org', 'beats/minute', '/min', '"final"', 'http://unitsofmeasure.org', '72'],
    res: { resourceType: 'Observation', id: 'obs-1', status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }], text: 'Heart rate' }, subject: PAT_REF, effectiveDateTime: '2026-11-04T10:15:00+01:00',
      issued: '2026-11-04T10:20:00.123Z', performer: [PRAC_REF], valueQuantity: { value: 72, unit: 'beats/minute', system: 'http://unitsofmeasure.org', code: '/min' },
      note: [{ text: 'Berenice reports a racing heart; call 312-555-0141 or write berenice.t@postbox.example. Member VM-123456.' }] } },
  { name: 'Claim', gone: ['Tallworthy', 'Berenice', 'CLM-20261105-77', 'AUTH-77001', '2026-10-29', '2026-11-05', 'rosewyn-health', 'Rosewyn', 'claim-88', 'cov-5', 'org-3'],
    kept: ['"professional"', 'R07.9', '99213', '"USD"', 'http://www.ama-assn.org/go/cpt', 'icd-10-cm', '"active"', '"claim"'],
    res: { resourceType: 'Claim', id: 'claim-88', status: 'active', type: CODING('http://terminology.hl7.org/CodeSystem/claim-type', 'professional'), use: 'claim', patient: PAT_REF, created: '2026-11-05', provider: ORG_REF,
      insurance: [{ sequence: 1, focal: true, coverage: { reference: 'Coverage/cov-5' }, preAuthRef: ['AUTH-77001'] }], identifier: [{ system: 'http://rosewyn-health.example/claims', value: 'CLM-20261105-77' }],
      diagnosis: [{ sequence: 1, diagnosisCodeableConcept: CODING('http://hl7.org/fhir/sid/icd-10-cm', 'R07.9') }],
      item: [{ sequence: 1, productOrService: CODING('http://www.ama-assn.org/go/cpt', '99213'), servicedDate: '2026-10-29', unitPrice: { value: 95.5, currency: 'USD' } }], total: { value: 95.5, currency: 'USD' } } },
  { name: 'ExplanationOfBenefit', gone: ['Tallworthy', 'Berenice', 'Vantrel', 'eob-4', 'claim-88', 'cov-5', '2026-10-29', 'EOB-77-1234'], kept: ['"complete"', '"USD"', 'http://terminology.hl7.org/CodeSystem/claim-type'],
    res: { resourceType: 'ExplanationOfBenefit', id: 'eob-4', status: 'active', type: CODING('http://terminology.hl7.org/CodeSystem/claim-type', 'professional'), use: 'claim', patient: PAT_REF, created: '2026-10-29',
      insurer: { display: 'Vantrel Mutual Health' }, provider: ORG_REF, claim: { reference: 'Claim/claim-88' }, outcome: 'complete', identifier: [{ system: 'http://vantrel-mutual.example/eob', value: 'EOB-77-1234' }],
      insurance: [{ focal: true, coverage: { reference: 'Coverage/cov-5' } }], total: [{ category: CODING('http://terminology.hl7.org/CodeSystem/adjudication', 'submitted'), amount: { value: 95.5, currency: 'USD' } }] } },
  { name: 'Coverage', gone: ['Tallworthy', 'Berenice', 'VM-998877', 'GRP-DK-4410', 'Vantrel', '2026-01-01', '2026-12-31', 'cov-5'], kept: ['"group"', '"self"', '"active"', 'http://terminology.hl7.org/CodeSystem/coverage-class'],
    res: { resourceType: 'Coverage', id: 'cov-5', status: 'active', subscriberId: 'VM-998877', beneficiary: PAT_REF, relationship: CODING('http://terminology.hl7.org/CodeSystem/subscriber-relationship', 'self'), period: { start: '2026-01-01', end: '2026-12-31' },
      payor: [{ reference: 'Organization/org-9', display: 'Vantrel Mutual Health' }], class: [{ type: CODING('http://terminology.hl7.org/CodeSystem/coverage-class', 'group'), value: 'GRP-DK-4410', name: 'Vantrel Standard Group' }] } },
  { name: 'DiagnosticReport', gone: ['Tallworthy', 'Berenice', 'Dravenholt', '312-555-0141', 'JVBERi0xLjQKJcfsj6IKJWRh', '2026-11-04', 'dr-1'], kept: ['application/pdf', '"final"', '58410-2', 'http://loinc.org'],
    res: { resourceType: 'DiagnosticReport', id: 'dr-1', status: 'final', code: CODING('http://loinc.org', '58410-2'), subject: PAT_REF, effectiveDateTime: '2026-11-04T09:00:00Z', performer: [PRAC_REF],
      conclusion: 'Berenice Tallworthy reviewed with Dr Dravenholt; callback 312-555-0141.', presentedForm: [{ contentType: 'application/pdf', data: 'JVBERi0xLjQKJcfsj6IKJWRh', title: 'Report for Berenice Tallworthy' }] } },
  { name: 'Device', gone: ['SN4471920', 'LOT-77120', '00844588003288', 'DEV-5512', 'Rosewyn', 'Instrumentation', 'dev-1', 'pat-7731'], kept: ['Pulse monitor', '"active"', 'user-friendly-name'],
    res: { resourceType: 'Device', id: 'dev-1', identifier: [{ system: 'http://rosewyn-health.example/devices', value: 'DEV-5512' }], udiCarrier: [{ deviceIdentifier: '00844588003288', carrierHRF: '(01)00844588003288(21)SN4471920' }], status: 'active',
      manufacturer: 'Instrumentation Works Ltd', serialNumber: 'SN4471920', lotNumber: 'LOT-77120', deviceName: [{ name: 'Pulse monitor', type: 'user-friendly-name' }], patient: { reference: 'Patient/pat-7731' }, owner: ORG_REF } },
  { name: 'DocumentReference', gone: ['Dravenholt', 'docs.rosewyn-health.example', 'JVBERi0xLjQKJcfsj6IKJWRhdGEK', '2jmj7l5rSw0yVb/vlWAYkK/YBwk=', '2026-11-05', 'doc-1', 'pat-7731'], kept: ['application/pdf', '"current"', '2048', '"en"'],
    res: { resourceType: 'DocumentReference', id: 'doc-1', status: 'current', subject: { reference: 'Patient/pat-7731' }, date: '2026-11-05T08:00:00Z', author: [PRAC_REF],
      content: [{ attachment: { contentType: 'application/pdf', language: 'en', data: 'JVBERi0xLjQKJcfsj6IKJWRhdGEK', url: 'http://docs.rosewyn-health.example/files/report-77.pdf', size: 2048, hash: '2jmj7l5rSw0yVb/vlWAYkK/YBwk=', title: 'Discharge letter for Dr Dravenholt', creation: '2026-11-05' } }] } }
];

for (const c of RESOURCES) {
  test(c.name + ': identifying values go, codes and structure stay, key order and array lengths are unchanged', () => {
    const text = pretty(c.res);
    assert.equal(engine.detectFormat(text), 'fhir');
    const out = proc(text);
    assert.ok(out.changed > 3);
    assert.equal(JSON.parse(out.text).resourceType, c.res.resourceType);
    sameShape(text, out.text);
    gone(out.text, c.gone);
    kept(out.text, c.kept);
    assert.equal(out.text.endsWith('}\n'), true);
  });
}

test('Patient: names, codes and dates in detail', () => {
  const out = JSON.parse(proc(pretty(PATIENT)).text);
  assert.match(out.name[0].family, /^[A-Z][a-z]+$/);
  assert.match(out.name[0].given[0], /^[A-Z][a-z]+$/);
  assert.match(out.name[0].given[1], /^[A-Z][a-z]+$/);
  assert.equal(out.contact[0].name.family, out.name[0].family);
  assert.match(out.identifier[1].value, /^\d{3}-\d{2}-\d{4}$/);
  assert.equal(out.identifier[0].value.length, 'RW-5550101'.length);
  assert.match(out.telecom[0].value, /^\d{3}-\d{3}-\d{4}$/);
  assert.match(out.telecom[1].value, /^[a-z.]+\d*@[a-z]+\.example$/);
  assert.match(out.address[0].line[0], /^\d{4} [A-Z][a-z]+( [A-Z][a-z]+)* Terrace$/);
  assert.match(out.address[0].postalCode, /^\d{5}$/);
  assert.match(out.identifier[0].system, /^http:\/\/[a-z0-9-]+\.example\/mrn$/);
  assert.equal(out.generalPractitioner[0].reference.split('/')[0], 'Practitioner');
  assert.match(out.generalPractitioner[0].display, /^Dr [A-Z][a-z]+ [A-Z][a-z]+$/);
  const shift = dayOf(out.birthDate) - dayOf('1973-11-04');
  assert.ok(Math.abs(shift) >= 60 && Math.abs(shift) <= 730);
  assert.equal(dayOf(out.meta.lastUpdated) - dayOf('2026-11-05'), shift);
  assert.equal(out.meta.lastUpdated.slice(10), 'T08:30:00Z');
});

test('Location: coordinates keep their number of decimals and move; Observation values stay', () => {
  const locText = proc(pretty(RESOURCES[4].res)).text;
  const loc = JSON.parse(locText);
  assert.match(locText, /"latitude": -?\d+\.\d{4}\n/);
  assert.match(locText, /"longitude": -?\d+\.\d{4},\n/);
  assert.notEqual(loc.position.latitude, 40.1234);
  assert.notEqual(loc.position.longitude, -83.2718);
  assert.ok(Math.abs(loc.position.latitude) <= 80 && Math.abs(loc.position.longitude) <= 170);
  const obs = JSON.parse(proc(pretty(RESOURCES[5].res)).text);
  assert.equal(obs.valueQuantity.value, 72);
  assert.equal(dayOf(obs.issued) - dayOf('2026-11-04'), dayOf(obs.effectiveDateTime) - dayOf('2026-11-04'));
  assert.equal(obs.effectiveDateTime.slice(10), 'T10:15:00+01:00');
  assert.equal(obs.issued.slice(10), 'T10:20:00.123Z');
});

test('attachment data, hash and url are replaced by text of the same length and alphabet', () => {
  const src = JSON.parse(pretty(RESOURCES[11].res));
  const out = JSON.parse(proc(pretty(src)).text).content[0].attachment;
  const a = src.content[0].attachment;
  assert.equal(out.data.length, a.data.length);
  assert.equal(out.hash.length, a.hash.length);
  assert.match(out.data, /^[A-Za-z0-9+/=]+$/);
  assert.equal(out.hash.endsWith('='), true);
  assert.match(out.url, /^http:\/\/[a-z0-9-]+\.example\/[A-Za-z0-9/-]+\.pdf$/);
  assert.equal(out.size, 2048);
  assert.equal(out.contentType, 'application/pdf');
  const dr = JSON.parse(proc(pretty(RESOURCES[9].res)).text).presentedForm[0];
  assert.equal(dr.data.length, 'JVBERi0xLjQKJcfsj6IKJWRh'.length);
});

// ---- bundles and links ---------------------------------------------------------------------

const U1 = '4d2f9a60-7b13-4c58-9e21-0a5d3c7b8e01', U2 = '5e3a0b71-8c24-4d69-8f32-1b6e4d8c9f02', U3 = '6f4b1c82-9d35-4e7a-8043-2c7f5e9d0a03';
const BUNDLE = {
  resourceType: 'Bundle', id: 'bundle-1', type: 'transaction', meta: { source: 'http://hosp-one.example/feed' },
  link: [{ relation: 'self', url: 'http://fhir.rosewyn-health.example/fhir/Patient?name=Tallworthy' }],
  entry: [
    { fullUrl: 'urn:uuid:' + U1, resource: { resourceType: 'Patient', id: U1, name: [{ family: 'Tallworthy', given: ['Berenice'] }], birthDate: '1987-07-19', identifier: [{ system: 'http://rosewyn-health.example/mrn', value: 'RW-5550101' }] }, request: { method: 'PUT', url: 'Patient/' + U1 } },
    { fullUrl: 'urn:uuid:' + U2, resource: { resourceType: 'Observation', id: U2, status: 'final', subject: { reference: 'urn:uuid:' + U1, display: 'Berenice Tallworthy' }, effectiveDateTime: '2026-11-04T10:00:00Z', note: [{ text: 'Berenice felt dizzy' }] }, request: { method: 'POST', url: 'Observation' } },
    { fullUrl: 'urn:uuid:' + U3, resource: { resourceType: 'Encounter', id: U3, status: 'finished', subject: { reference: 'Patient/' + U1 }, serviceProvider: { reference: 'http://fhir.rosewyn-health.example/fhir/Organization/org-3' } }, request: { method: 'POST', url: 'Encounter' } },
    { fullUrl: 'http://fhir.rosewyn-health.example/fhir/Organization/org-3', resource: { resourceType: 'Organization', id: 'org-3', name: 'Rosewyn Family Clinic' }, request: { method: 'PUT', url: 'Organization/org-3' } }
  ]
};

test('bundle: fullUrl, id and every reference to a resource get the same replacement; a urn:uuid stays a valid UUID', () => {
  const out = JSON.parse(proc(pretty(BUNDLE)).text);
  const [p, o, e, g] = out.entry;
  const tail = (s) => s.slice(s.lastIndexOf('/') + 1);
  assert.match(p.resource.id, UUID);
  assert.notEqual(p.resource.id, U1);
  assert.equal(p.fullUrl, 'urn:uuid:' + p.resource.id);
  assert.equal(o.fullUrl, 'urn:uuid:' + o.resource.id);
  assert.equal(e.fullUrl, 'urn:uuid:' + e.resource.id);
  assert.match(o.resource.id, UUID);
  assert.equal(o.resource.subject.reference, p.fullUrl);
  assert.equal(e.resource.subject.reference, 'Patient/' + p.resource.id);
  assert.equal(p.request.url, 'Patient/' + p.resource.id);
  assert.equal(o.request.url, 'Observation');
  assert.equal(e.request.url, 'Encounter');
  assert.equal(p.request.method, 'PUT');
  assert.equal(new Set([p.resource.id, o.resource.id, e.resource.id]).size, 3);
  assert.equal(g.fullUrl, e.resource.serviceProvider.reference, 'absolute URL of an entry equals the reference to it');
  assert.equal(tail(g.fullUrl), g.resource.id);
  assert.equal(tail(g.request.url), g.resource.id);
  assert.match(g.fullUrl, /^http:\/\/[a-z0-9-]+\.example\/fhir\/Organization\/[A-Za-z0-9-]+$/);
  assert.notEqual(out.id, 'bundle-1');
  assert.match(out.meta.source, /^http:\/\/[a-z0-9-]+\.example\/[a-z]+$/);
  assert.equal(out.link[0].relation, 'self');
  assert.equal(out.link[0].url.indexOf('Tallworthy'), -1);
  assert.equal(o.resource.subject.display, p.resource.name[0].given[0] + ' ' + p.resource.name[0].family);
  assert.equal(o.resource.note[0].text, 'Berenice felt dizzy'.replace('Berenice', p.resource.name[0].given[0]));
});

test('bundle: every patient has an own date offset and the resources that refer to a patient use hers', () => {
  const patient = (id, fam) => ({ resourceType: 'Patient', id: id, name: [{ family: fam, given: ['Pat'] }], birthDate: '1980-01-01', identifier: [{ type: CODING(V2, 'MR'), value: 'MRN-' + id }] });
  const obs = (id, ref) => ({ resourceType: 'Observation', id: id, status: 'final', subject: { reference: 'Patient/' + ref }, effectiveDateTime: '2026-11-04' });
  const b = { resourceType: 'Bundle', type: 'collection', entry: [patient('a1', 'Ashgrove'), patient('b2', 'Coxwell'), obs('o1', 'a1'), obs('o2', 'b2'), obs('o3', 'a1')].map((r) => ({ resource: r })) };
  const out = JSON.parse(proc(pretty(b)).text).entry.map((x) => x.resource);
  const shift = (r) => dayOf(r.birthDate || r.effectiveDateTime) - dayOf(r.birthDate ? '1980-01-01' : '2026-11-04');
  assert.notEqual(shift(out[0]), shift(out[1]));
  assert.equal(shift(out[2]), shift(out[0]));
  assert.equal(shift(out[4]), shift(out[0]));
  assert.equal(shift(out[3]), shift(out[1]));
});

test('system URLs of well-known hosts stay; institution hosts are replaced, the path stays; one host, one replacement', () => {
  const ids = [['http://hl7.org/fhir/sid/us-ssn', 'SS'], ['http://rosewyn-health.example/ids/mrn', 'MR'], ['http://rosewyn-health.example/ids/acc', 'AN'], ['https://fhir.nhs.uk/Id/nhs-number', 'PI'], ['http://www.nlm.nih.gov/research/umls/rxnorm', 'PT'],
    ['http://loinc.org', 'PT'], ['urn:oid:2.16.840.1.113883.4.1', 'PT']];
  const p = { resourceType: 'Patient', id: 'p1', identifier: ids.map(([system, code], i) => ({ type: CODING(V2, code), system: system, value: 'V-' + (1000 + i) })) };
  const out = JSON.parse(proc(pretty(p)).text).identifier.map((x) => x.system);
  assert.equal(out[0], ids[0][0]);
  assert.equal(out[4], ids[4][0]);
  assert.equal(out[5], ids[5][0]);
  assert.equal(out[6], ids[6][0]);
  assert.match(out[1], /^http:\/\/[a-z0-9-]+\.example\/ids\/mrn$/);
  assert.match(out[2], /^http:\/\/[a-z0-9-]+\.example\/ids\/acc$/);
  assert.equal(out[1].split('/')[2], out[2].split('/')[2]);
  assert.match(out[3], /^https:\/\/[a-z0-9-]+\.example\/Id\/nhs-number$/);
  assert.equal(out[1].indexOf('rosewyn'), -1);
});

test('the host of a local extension url and of a local profile is replaced (the path stays), standard hosts stay, extension values are scanned', () => {
  const p = { resourceType: 'Patient', id: 'p1', meta: { profile: ['http://rosewyn-health.example/StructureDefinition/special'] }, name: [{ family: 'Tallworthy' }],
    extension: [{ url: 'http://rosewyn-health.example/StructureDefinition/nick', valueString: 'Berry Tallworthy' }, { url: 'http://rosewyn-health.example/StructureDefinition/outer', extension: [{ url: 'inner', valueCode: 'abc' }, { url: 'ref', valueUri: 'http://rosewyn-health.example/x' }] }] };
  const out = JSON.parse(proc(pretty(p)).text);
  assert.ok(out.extension[0].url.endsWith('/StructureDefinition/nick') && out.extension[0].url.indexOf('rosewyn') === -1, out.extension[0].url);
  assert.equal(out.extension[0].url.split('/')[2], out.extension[1].url.split('/')[2], 'the same host gets the same replacement everywhere');
  assert.ok(out.extension[1].url.endsWith('/StructureDefinition/outer'));
  assert.equal(out.extension[1].extension[0].url, 'inner');
  assert.equal(out.extension[1].extension[0].valueCode, 'abc');
  assert.equal(out.extension[1].extension[1].valueUri, 'http://rosewyn-health.example/x');
  assert.ok(out.meta.profile[0].endsWith('/StructureDefinition/special') && out.meta.profile[0].indexOf('rosewyn') === -1, out.meta.profile[0]);
  assert.equal(out.meta.profile[0].split('/')[2], out.extension[0].url.split('/')[2]);
  assert.equal(out.extension[0].valueString.indexOf('Tallworthy'), -1);
  assert.ok(out.extension[0].valueString.startsWith('Berry '));
});

test('narrative: tags and attributes stay, the text between them is scanned', () => {
  const div = '<div xmlns="http://www.w3.org/1999/xhtml"><p class="note">Berenice Tallworthy, <b>MRN RW-5550101</b>, tel 312-555-0141</p><br/><a href="http://example.org/x">link</a></div>';
  const p = { resourceType: 'Patient', id: 'p1', text: { status: 'additional', div: div }, name: [{ family: 'Tallworthy', given: ['Berenice'] }], identifier: [{ system: 'http://rosewyn-health.example/mrn', value: 'RW-5550101' }] };
  const out = JSON.parse(proc(pretty(p)).text);
  const tags = (s) => s.match(/<[^>]*>/g);
  assert.deepEqual(tags(out.text.div), tags(div));
  assert.equal(out.text.status, 'additional');
  gone(out.text.div, ['Tallworthy', 'Berenice', 'RW-5550101', '312-555-0141']);
  assert.ok(out.text.div.indexOf(out.name[0].family) !== -1);
  assert.ok(out.text.div.indexOf(out.identifier[0].value) !== -1);
});

test('contained resources keep their local ids and references', () => {
  const p = { resourceType: 'Patient', id: 'p1', contained: [{ resourceType: 'Organization', id: 'org1', name: 'Rosewyn Family Clinic' }], managingOrganization: { reference: '#org1' }, name: [{ family: 'Tallworthy' }] };
  const out = JSON.parse(proc(pretty(p)).text);
  assert.equal(out.contained[0].id, 'org1');
  assert.equal(out.managingOrganization.reference, '#org1');
  assert.equal(out.contained[0].name.indexOf('Rosewyn'), -1);
});

// ---- number text, layout, special keys -----------------------------------------------------

test('numbers are written back exactly as they were', () => {
  const raw = '{"resourceType":"Observation","id":"o1","status":"final","subject":{"reference":"Patient/p1","display":"Berenice Tallworthy"},"valueQuantity":{"value":1.10,"unit":"mg"},' +
    '"component":[{"valueInteger":12345678901234567890},{"valueDecimal":1e3},{"valueDecimal":-0.0},{"valueDecimal":0.1e-2},{"valueDecimal":1E+2},{"valueDecimal":123456789012345678.123456789},{"valueInteger":0},{"valueInteger":-17}]}';
  const out = proc(raw).text;
  for (const n of ['1.10', '12345678901234567890', '1e3', '-0.0', '0.1e-2', '1E+2', '123456789012345678.123456789', ':0}', ':-17}']) assert.notEqual(out.indexOf(n), -1, n);
  assert.equal(out.indexOf('Tallworthy'), -1);
});

test('indentation of the input is kept: 2 spaces, 4 spaces, tab, compact; a missing or present final newline too', () => {
  for (const indent of [2, 4, '\t', 0]) for (const final of ['', '\n']) {
    const text = JSON.stringify(PATIENT, null, indent) + final;
    const out = proc(text).text;
    const a = text.split('\n'), b = out.split('\n');
    assert.equal(b.length, a.length, 'line count for indent ' + JSON.stringify(indent));
    for (let i = 0; i < a.length; i++) assert.equal(/^\s*/.exec(b[i])[0], /^\s*/.exec(a[i])[0], 'indent of line ' + i);
    assert.equal(out.endsWith('\n'), final === '\n');
    if (indent === 0) assert.equal(out.replace(/\n$/, '').indexOf('\n'), -1);
  }
});

test('CRLF line endings of a pretty-printed file are kept', () => {
  const text = pretty(PATIENT).replace(/\n/g, '\r\n');
  const out = proc(text).text;
  assert.equal(out.split('\r\n').length, text.split('\r\n').length);
  assert.equal(out.replace(/\r\n/g, '').indexOf('\n'), -1);
  assert.ok(out.endsWith('}\r\n'));
});

test('a byte order mark is kept', () => {
  const out = proc(String.fromCharCode(0xFEFF) + pretty(PATIENT)).text;
  assert.equal(out.charCodeAt(0), 0xFEFF);
  assert.equal(out[1], '{');
});

test('a key called __proto__ or constructor is an ordinary key and does not touch the prototype', () => {
  const raw = '{"resourceType":"Patient","id":"p1","__proto__":{"polluted":"yes"},"name":[{"family":"Tallworthy","__proto__":{"x":1}}],"constructor":{"prototype":{"polluted2":"yes"}},"hasOwnProperty":"Tallworthy"}';
  const out = proc(raw);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted2, undefined);
  assert.notEqual(out.text.indexOf('"__proto__":{"polluted":"yes"}'), -1);
  assert.notEqual(out.text.indexOf('"__proto__":{"x":1}'), -1);
  assert.notEqual(out.text.indexOf('"constructor":{"prototype":{"polluted2":"yes"}}'), -1);
  assert.equal(out.text.indexOf('"family":"Tallworthy"'), -1);
});

test('escapes in untouched strings are written back; the characters U+2028 and U+2029 are written as escapes', () => {
  const ls = String.fromCharCode(0x2028), ps = String.fromCharCode(0x2029);
  const note = 'He said "hi"\n\tand \\ left ' + ls + ' and ' + ps + ' emoji ' + String.fromCodePoint(0x1F600);
  const p = { resourceType: 'Patient', id: 'p1', name: [{ family: 'Tallworthy' }], text: { status: 'additional', div: '<div>x</div>' }, note: [{ text: note }] };
  const raw = JSON.stringify(p);
  assert.ok(raw.indexOf(ls) !== -1 && raw.indexOf(ps) !== -1, 'the input holds the raw characters');
  const out = proc(raw).text;
  assert.equal(JSON.parse(out).note[0].text, note);
  assert.notEqual(out.indexOf('\\' + 'u2028'), -1);
  assert.notEqual(out.indexOf('\\' + 'u2029'), -1);
  assert.equal(out.indexOf(ls), -1);
  assert.notEqual(out.indexOf('\\"hi\\"\\n\\tand \\\\ left'), -1);
});

test('a resource without anything to replace is returned as it came', () => {
  const text = '{"resourceType":"Patient"}\n';
  const out = proc(text);
  assert.equal(out.text, text);
  assert.equal(out.changed, 0);
});

// ---- arrays and NDJSON ---------------------------------------------------------------------

test('a top-level array of resources keeps its layout and treats every resource', () => {
  const arr = [PATIENT, Object.assign({}, PATIENT, { id: 'pat-2', name: [{ family: 'Ashgrove', given: ['Oswin'] }] })];
  const text = pretty(arr);
  const out = proc(text);
  assert.equal(out.units, 2);
  sameShape(text, out.text);
  gone(out.text, ['Tallworthy', 'Ashgrove', 'Oswin', 'pat-2']);
  assert.equal(out.text.split('\n').length, text.split('\n').length);
  const o = JSON.parse(out.text);
  assert.notEqual(o[0].name[0].family, o[1].name[0].family);
});

const ND = [
  '{"resourceType":"Patient","id":"p1","name":[{"family":"Tallworthy","given":["Berenice"]}],"birthDate":"1973-11-04","telecom":[{"system":"phone","value":"312-555-0141"}]}',
  '{"resourceType":"Observation","id":"o1","status":"final","subject":{"reference":"Patient/p1"},"note":[{"text":"Berenice Tallworthy felt dizzy; call 312-555-0141"}]}',
  '{"resourceType":"Condition","id":"c1","subject":{"reference":"Patient/p1"},"note":[{"text":"Tallworthy history of asthma"}]}'
];
for (const eol of ['\n', '\r\n']) for (const final of [true, false]) {
  test('NDJSON with ' + JSON.stringify(eol) + ' line ends' + (final ? '' : ' and no final line end') + ': ends kept, patient names found in later lines', () => {
    const text = ND.join(eol) + (final ? eol : '');
    const out = proc(text);
    assert.equal(out.units, 3);
    assert.equal(out.format, 'ndjson');
    assert.equal((out.text.match(/\r\n/g) || []).length, (text.match(/\r\n/g) || []).length);
    assert.equal(out.text.split(/\r?\n/).length, text.split(/\r?\n/).length);
    gone(out.text, ['Tallworthy', 'Berenice', '312-555-0141', '1973-11-04']);
    const lines = out.text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines[1].subject.reference, 'Patient/' + lines[0].id);
    assert.equal(lines[2].subject.reference, 'Patient/' + lines[0].id);
    assert.notEqual(lines[0].id, 'p1');
    assert.ok(lines[1].note[0].text.startsWith(lines[0].name[0].given[0] + ' ' + lines[0].name[0].family + ' felt dizzy; call '));
    assert.ok(lines[2].note[0].text.startsWith(lines[0].name[0].family + ' history'));
  });
}

test('NDJSON: blank lines stay, and a patient line that comes after the lines that refer to it is still used', () => {
  const text = [ND[1], '', ND[2], '  ', ND[0], ''].join('\n');
  const out = proc(text);
  assert.equal(out.text.split('\n').length, text.split('\n').length);
  assert.equal(out.text.split('\n')[1], '');
  assert.equal(out.text.split('\n')[3], '  ');
  gone(out.text, ['Tallworthy', 'Berenice']);
});

// ---- refusals ------------------------------------------------------------------------------

const BROKEN = [
  ['trailing comma in an object', '{"resourceType":"Patient","family":"SECRETNAME",}'],
  ['trailing comma in an array', '{"resourceType":"Patient","name":["SECRETNAME",]}'],
  ['missing colon', '{"resourceType":"Patient","SECRETNAME" "x"}'],
  ['unterminated string', '{"resourceType":"Patient","name":"SECRETNAME'],
  ['text after the document', '{"resourceType":"Patient","name":"SECRETNAME"} SECRETNAME'],
  ['single quotes', "{\"resourceType\":\"Patient\",'name':'SECRETNAME'}"],
  ['control character in a string', '{"resourceType":"Patient","name":"SECRETNAME' + String.fromCharCode(1) + '"}'],
  ['a bad number', '{"resourceType":"Patient","SECRETNAME":01}'],
  ['an unknown word', '{"resourceType":"Patient","SECRETNAME":nope}'],
  ['a comment', '{"resourceType":"Patient", /* SECRETNAME */ "id":"x"}']
];
for (const [name, text] of BROKEN) {
  test('invalid JSON (' + name + ') is refused with line and column and without any text of the file', () => {
    for (const mode of ['pseudonym', 'mask']) {
      const r = engine.processText(text, createRun({ mode: mode, key: KEY }));
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'invalid-json');
      assert.match(r.message, /line \d+ column \d+/);
      assert.equal(r.message.indexOf('SECRETNAME'), -1);
      assert.ok(r.message.length < 300);
    }
  });
}

test('the line and column of the error point at the first problem', () => {
  const text = '{\n  "resourceType": "Patient",\n  "name": [ {"family": "X",} ]\n}';
  const r = engine.processText(text, createRun({ mode: 'pseudonym', key: KEY }));
  assert.match(r.message, /line 3 column 28/);
});

test('invalid JSON in one NDJSON line is refused as invalid JSON, with the line number and no text of the file', () => {
  const text = [ND[0], '{"resourceType":"Observation","id":"o1","note":"SECRETNAME",}', ND[2]].join('\n');
  const r = engine.processText(text, createRun({ mode: 'pseudonym', key: KEY }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-json');
  assert.match(r.message, /line 2/);
  assert.equal(r.message.indexOf('SECRETNAME'), -1);
});

test('JSON that is not FHIR is refused: no resourceType, wrong type of resourceType, resourceType only in a nested object', () => {
  for (const text of ['{"ticket":1,"name":"Tallworthy","phone":"312-555-0141"}', '[1,2,3]', '{"resourceType":5,"name":"x"}', '{"data":{"resourceType":"Patient","name":[{"family":"Tallworthy"}]}}', '[{"a":1},{"b":2}]', '"just a string"', 'null', '42']) {
    for (const mode of ['pseudonym', 'mask']) {
      const r = engine.processText(text, createRun({ mode: mode, key: KEY }));
      assert.equal(r.ok, false, text);
      assert.equal(r.reason, 'not-recognised', text);
      assert.equal(r.message.indexOf('Tallworthy'), -1);
    }
  }
  const forced = engine.processText('{"ticket":1}', createRun({ mode: 'pseudonym', key: KEY }), { format: 'fhir' });
  assert.equal(forced.ok, false);
  assert.equal(forced.reason, 'not-recognised');
});

// ---- mask mode, scan -----------------------------------------------------------------------

test('mask mode: same key structure and layout, strings masked to the same length, numbers and codes kept', () => {
  const text = pretty(BUNDLE);
  const out = proc(text, 'mask');
  assert.equal(out.text.length, text.length);
  sameShape(text, out.text);
  const o = JSON.parse(out.text);
  assert.equal(o.resourceType, 'Bundle');
  assert.equal(o.entry[0].resource.name[0].family, 'XXXXXXXXXX');
  assert.equal(o.entry[0].resource.birthDate, '9999-99-99');
  assert.equal(o.entry[0].resource.id, U1.replace(/[0-9]/g, '9').replace(/[a-f]/g, 'X'));
  assert.equal(o.entry[0].request.method, 'PUT');
  assert.equal(o.entry[1].request.url, 'Observation', 'the resource type in a request url is not an identifier');
  assert.equal(o.entry[1].resource.status, 'final');
  assert.equal(proc(out.text, 'mask').text, out.text);
});

test('scanOnly counts without changing the text and without calling set', () => {
  const text = pretty(BUNDLE);
  const run = createRun({ mode: 'pseudonym', key: KEY });
  const cats = new Set();
  const out = engine.processText(text, run, { scanOnly: true, onHit: (h, c) => { cats.add(c); h.set = function () { throw new Error('set was called'); }; } });
  assert.equal(out.ok, true);
  assert.equal(out.text, text);
  for (const c of ['names', 'dates', 'other']) assert.ok(cats.has(c), c);
});

test('Organization names are kept with maskOrganisations false; people are still replaced', () => {
  const out = proc(pretty(PATIENT), 'pseudonym', { maskOrganisations: false }).text;
  kept(out, ['Rosewyn Family Clinic']);
  gone(out, ['Tallworthy', 'Berenice']);
});
