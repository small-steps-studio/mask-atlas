'use strict';
// FHIR R4 / R5 JSON reader/writer for the de-identifier: single resources, bundles, arrays of
// resources and NDJSON. The tree is walked once; data types are recognised by their shape and key
// (HumanName, Address, ContactPoint, Identifier, Reference, Attachment, Narrative, Annotation,
// Coding), so the same rules cover every resource type; a few resource-specific keys are listed
// below. References, fullUrl values and resource ids are replaced through the same function, so
// the links of a bundle stay intact. Everything that is not named stays byte-for-byte (numbers are
// kept as written; the indentation of the input is reproduced).

const J = require('./json');
const { matchFhir } = require('../pro/rules');
const T = require('../core/text');
const { finishUnit } = require('../core/unit');

const EXEMPT = new Set(['resourceType', 'system', 'profile', 'code', 'version', 'versionId', 'status', 'use', 'type', 'language', 'contentType', 'unit', 'rel', 'relation',
  'method', 'mode', 'intent', 'priority', 'kind', 'gender', 'format', 'relationship', 'reference', 'fullUrl', 'canonical', 'valueCode', 'valueUri', 'valueCanonical',
  'valueOid', 'valueUuid', 'valueId', 'url', 'security', 'tag', 'label', 'sort', 'text_status', 'timing', 'rank', 'preferred', 'active', 'event', 'purpose', 'role', 'etag']);
const FREE_KEYS = new Set(['text', 'div', 'comment', 'description', 'conclusion', 'valueString', 'title', 'detail', 'summary', 'instruction', 'patientInstruction',
  'reasonText', 'note', 'narrative', 'definition', 'remarks', 'explanation', 'valueMarkdown', 'markdown', 'statement', 'justification', 'disposition', 'unstructured',
  'contentString', 'contentMarkdown', 'altText', 'valueText', 'answerString', 'resultString']);
// Standard extensions whose valueString names a person, a place or an organisation: the last part of the extension url -> the kind of the value.
// The ISO 21090 address-part extensions (house number, street name, unit, care of, ...) carry a piece of an address.
const EXTENSION_KINDS = {
  'patient-mothersMaidenName': 'family', 'humanname-mothers-family': 'family', 'humanname-fathers-family': 'family', 'humanname-own-name': 'family', 'humanname-partner-name': 'family',
  'patient-congregation': 'org'
};
const ADDRESS_PART_EXTENSIONS = /^iso21090-ADXP-(houseNumber|houseNumberNumeric|streetName|streetNameBase|streetAddressLine|unitID|postBox|careOf|additionalLocator|buildingNumberSuffix|deliveryAddressLine|direction|censusTract|precinct)$/;
function extensionKind(url) {
  const last = String(url).slice(String(url).lastIndexOf('/') + 1);
  if (Object.prototype.hasOwnProperty.call(EXTENSION_KINDS, last)) return EXTENSION_KINDS[last];
  const m = ADDRESS_PART_EXTENSIONS.exec(last);
  if (m) return m[1] === 'censusTract' || m[1] === 'precinct' ? 'city' : 'street';
  return null;
}
const KEY_KINDS = { subscriberId: 'plan', dependent: 'plan', serialNumber: 'device', lotNumber: 'device', distinctIdentifier: 'device', carrierHRF: 'device', deviceIdentifier: 'device',
  carrierAIDC: 'device', manufacturer: 'org', preAuthRef: 'plan', authorString: 'fullname', membershipId: 'plan', certificate: 'plan', policyNumber: 'plan', cardNumber: 'plan',
  accessionNumber: 'record', patientId: 'record', visitNumber: 'record' };
const CONTACT_SYSTEMS = new Set(['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other']);
const PERSON_TYPES = new Set(['Patient', 'Practitioner', 'RelatedPerson', 'Person', 'PractitionerRole']);
const ORG_TYPES = new Set(['Organization', 'Location', 'HealthcareService', 'Device', 'Endpoint']);
const PERSON_KEYS = new Set(['subject', 'patient', 'performer', 'author', 'recorder', 'requester', 'asserter', 'participant', 'individual', 'actor', 'policyHolder', 'subscriber',
  'beneficiary', 'practitioner', 'generalPractitioner', 'resultsInterpreter', 'informant', 'attester', 'party', 'contributor', 'enterer', 'sender', 'recipient', 'user', 'person',
  'relatedPerson', 'orderer', 'prescriber', 'dispenser']);
const NAMED_ORG_KEYS = new Set(['name', 'alias']);
const CONFORMANCE = new Set(['StructureDefinition', 'ValueSet', 'CodeSystem', 'CapabilityStatement', 'SearchParameter', 'OperationDefinition', 'ImplementationGuide', 'ConceptMap',
  'NamingSystem', 'StructureMap', 'CompartmentDefinition', 'MessageDefinition', 'GraphDefinition', 'ExampleScenario', 'Questionnaire', 'PlanDefinition', 'ActivityDefinition',
  'Library', 'Measure', 'TestScript', 'EventDefinition', 'TerminologyCapabilities', 'ObservationDefinition', 'SpecimenDefinition']);
const ORG_WORD = /\b(hospital|clinic|laborator(?:y|ies)|pharmacy|health|medical|centre|center|care|group|insurance|mutual|plan|imaging|services|associates|practice|institute|partners|systems|network|surgery|dental|therapy|radiology|works|instrumentation|instruments|company|corp|inc|ltd|llc)\b/i;
const DATEISH = /date|time|on$|since|until|^start$|^end$|issued|created|instant|birth|recorded|lastUpdated|authoredOn|period|born/i;
const ISO_FULL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const ISO_PARTIAL = /^\d{4}(-\d{2})?$/;
const MAX_UNITS_IN_MEMORY = 80 * 1024 * 1024;

function idKind(code, system) {
  const c = String(code || '').toUpperCase();
  const s = String(system || '').toLowerCase();
  if (c === 'SS' || /ssn|social-?security/.test(s)) return 'ssn';
  if (['DL', 'NPI', 'PRN', 'MD', 'LN', 'UPIN', 'DEA', 'MCR'].indexOf(c) !== -1 || /npi|licen[cs]e|dea\b|upin|practitioner|provider/.test(s)) return 'licence';
  if (['MB', 'MC', 'SN', 'PCP', 'MA'].indexOf(c) !== -1 || /member|policy|group|subscriber|coverage|plan|insur|payer|payor/.test(s)) return 'plan';
  if (['TAX', 'EI', 'FI'].indexOf(c) !== -1 || /tax/.test(s)) return 'taxid';
  if (/device|serial|udi/.test(s)) return 'device';
  if (['MR', 'PI', 'PT', 'AN', 'VN', 'ACSN', 'FILL', 'PLAC'].indexOf(c) !== -1 || /mrn|record|account|visit|encounter|claim|patient|accession|order/.test(s)) return 'record';
  return 'other';
}

function protectTags(text) {
  const ph = T.placeholders();
  const masked = text.replace(/<[^>]*>/g, function (m) { return ph.add(m); });
  return { text: masked, restore: function (x) { return ph.restore(x); } };
}

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof J.JsonNumber); }

function refKey(ref) {
  if (typeof ref !== 'string') return '';
  const m = /([A-Z][A-Za-z]+\/[^/?#]+)(?:\/_history\/[^/?#]+)?$/.exec(ref);
  return (m ? m[1] : ref).toLowerCase();
}

/** Patient contexts of the unit: idents for the date offset of every resource. */
function patientContexts(root) {
  const byRef = new Map();
  const resources = [];
  (function find(v, fullUrl, depth) {
    if (depth > 60 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) find(x, undefined, depth + 1); return; }
    if (v instanceof J.JsonNumber) return;
    if (typeof v.resourceType === 'string') resources.push({ res: v, fullUrl: fullUrl });
    const fu = typeof v.fullUrl === 'string' ? v.fullUrl : undefined;
    for (const k of Object.keys(v)) find(v[k], k === 'resource' ? fu : undefined, depth + 1);
  })(root, undefined, 0);

  function patientIdents(p) {
    const out = { ssn: [], id: [], name: [] };
    if (typeof p.id === 'string') out.id.push('ref:patient/' + p.id.toLowerCase());
    for (const idf of Array.isArray(p.identifier) ? p.identifier : []) {
      if (!isObject(idf) || typeof idf.value !== 'string') continue;
      const code = idf.type && Array.isArray(idf.type.coding) && idf.type.coding[0] ? idf.type.coding[0].code : '';
      const kind = idKind(code, idf.system);
      if (kind === 'ssn') out.ssn.push('ssn:' + idf.value.replace(/\D/g, ''));
      else if (kind === 'record') out.id.push('id:' + idf.value.toLowerCase());
    }
    for (const nm of Array.isArray(p.name) ? p.name : []) if (isObject(nm) && typeof nm.family === 'string') out.name.push('name:' + nm.family.toLowerCase());
    return out.ssn.concat(out.id, out.name);
  }

  let first = null;
  for (const r of resources) {
    if (r.res.resourceType !== 'Patient') continue;
    const idents = patientIdents(r.res);
    r.idents = idents;
    if (!first) first = idents;
    if (typeof r.res.id === 'string') byRef.set('patient/' + r.res.id.toLowerCase(), idents);
    if (r.fullUrl) byRef.set(r.fullUrl.toLowerCase(), idents);
  }
  const SUBJECT_KEYS = ['subject', 'patient', 'beneficiary', 'subscriber', 'policyHolder', 'individual'];
  const map = new Map();
  for (const r of resources) {
    if (r.idents) { map.set(r.res, r.idents); continue; }
    let found = null;
    for (const k of SUBJECT_KEYS) {
      const ref = r.res[k] && isObject(r.res[k]) ? r.res[k].reference : null;
      if (typeof ref !== 'string') continue;
      found = byRef.get(ref.toLowerCase()) || byRef.get(refKey(ref)) || ['ref:' + refKey(ref)];
      break;
    }
    map.set(r.res, found || first || []);
  }
  const types = new Map();
  for (const r of resources) {
    if (r.fullUrl) types.set(r.fullUrl.toLowerCase(), r.res.resourceType);
    if (typeof r.res.id === 'string') types.set(r.res.resourceType.toLowerCase() + '/' + r.res.id.toLowerCase(), r.res.resourceType);
  }
  return { map: map, first: first || [], typeOf: function (ref) { return types.get(String(ref).toLowerCase()) || types.get(refKey(ref)) || ''; } };
}

function collect(root, run, ctx) {
  const hits = ctx.hits, free = ctx.free;
  const personOf = ctx.contexts.map;

  const userRules = run.userRules || null;
  function userRule(path) { return userRules ? matchFhir(userRules, path) : null; }
  function hit(kind, value, path, parent, key, st, extra) {
    const u = userRule(path);
    if (u) {
      if (u.kind === null) { hits.push({ kind: 'keep', path: path, value: 'kept' }); return null; }
      if (u.kind === 'FREE') { freeSlot(value, path, parent, key, st, false); return null; }
      kind = u.kind;
      extra = Object.assign({}, extra, { byRule: true });
      if (u.fmt) extra.fmt = u.fmt;
    }
    const h = { kind: kind, value: value, path: path, idents: st.idents, set: function (v) { parent[key] = v; } };
    if (extra) Object.assign(h, extra);
    hits.push(h);
    return h;
  }
  function freeSlot(value, path, parent, key, st, isHtml) {
    let prot = null;
    free.push({
      path: path, sweep: false, idents: st.idents,
      get: function () { prot = isHtml ? protectTags(parent[key]) : { text: parent[key], restore: function (s) { return s; } }; return prot.text; },
      set: function (t) { parent[key] = prot.restore(t); }
    });
  }
  function sweepSlot(value, path, parent, key, st) {
    free.push({ path: path, sweep: true, idents: st.idents, get: function () { return parent[key]; }, set: function (t) { parent[key] = t; } });
  }

  function walk(v, key, parent, st) {
    if (typeof v === 'string') { leaf(v, key, parent, st); return; }
    if (v === null || typeof v !== 'object') return;
    if (v instanceof J.JsonNumber) return;
    if (Array.isArray(v)) {
      const sem = typeof key === 'string' ? key : st.sem;
      const child = Object.assign({}, st, { sem: sem });
      for (let i = 0; i < v.length; i++) walk(v[i], i, v, child);
      return;
    }
    walkObject(v, key, parent, st);
  }

  function leaf(value, key, parent, st) {
    const name = typeof key === 'string' ? key : st.sem;
    const path = st.path + (name ? '.' + name : '');
    if (value === '') return;
    const ur = userRule(path);
    if (ur) {
      if (ur.kind === null) { hits.push({ kind: 'keep', path: path, value: 'kept' }); return; }
      if (ur.kind === 'FREE') {
        // a date that a free-text rule takes over stays as it is
        if (ISO_FULL.test(value) || (ISO_PARTIAL.test(value) && DATEISH.test(name || ''))) hits.push({ kind: 'keep', path: path, value: 'kept' });
        freeSlot(value, path, parent, key, st, false);
        return;
      }
      hit(ur.kind, value, path, parent, key, st, ur.fmt ? { fmt: ur.fmt } : undefined);
      return;
    }
    if (EXEMPT.has(name)) return;
    if (ISO_FULL.test(value) || (ISO_PARTIAL.test(value) && DATEISH.test(name || ''))) { hit('date', value, path, parent, key, st, { fmt: 'iso' }); return; }
    if (Object.prototype.hasOwnProperty.call(KEY_KINDS, name)) { hit(KEY_KINDS[name], value, path, parent, key, st); return; }
    if (name === 'name' || name === 'alias') {
      if (st.resType && (st.resType === 'Location')) { hit('place', value, path, parent, key, st); return; }
      if (st.resType && ORG_TYPES.has(st.resType) && st.resType !== 'Device') { hit('org', value, path, parent, key, st); return; }
      return;
    }
    if (name === 'address' && st.resType === 'Endpoint') { hit('url', value, path, parent, key, st, { category: 'url' }); return; }
    if (name === 'location' && st.container === 'response') { hit('ref', value, path, parent, key, st); return; }
    if (FREE_KEYS.has(name)) { freeSlot(value, path, parent, key, st, name === 'div'); return; }
    if (value.length >= 5) sweepSlot(value, path, parent, key, st);
  }

  function walkObject(obj, key, parent, st0) {
    const name = typeof key === 'string' ? key : st0.sem;
    const st = Object.assign({}, st0);
    const handled = new Set();
    const isResource = typeof obj.resourceType === 'string';
    if (name === 'contained') st.contained = true;
    if (isResource) {
      st.resType = obj.resourceType;
      st.path = obj.resourceType;
      st.idents = personOf.get(obj) || ctx.contexts.first;
      if (typeof obj.id === 'string' && !st.contained) { hit('other', obj.id, st.path + '.id', obj, 'id', st); }
      handled.add('id'); handled.add('resourceType');
    } else if (typeof name === 'string' && name) st.path = st0.path + '.' + name;
    st.sem = name;
    if (name === 'request' || name === 'response') st.container = name;

    const has = function (k) { return typeof obj[k] === 'string'; };
    const keys = Object.keys(obj);

    // ---- Coding: nothing to hide
    if (!isResource && has('code') && !has('value') && !Array.isArray(obj.line)) { return; }

    // ---- Extension: the url names the extension
    if (!isResource && has('url') && keys.some(function (k) { return k.indexOf('value') === 0 || k === 'extension'; })) {
      handled.add('url');
      // the host of a local extension names the organisation that defined it, like the host of an identifier system; standard hosts stay
      if (/^https?:\/\//i.test(obj.url) && !run.isStandardSystem(obj.url)) hit('system', obj.url, st.path + '.url', obj, 'url', st, { category: 'other' });
      const ek = extensionKind(obj.url);
      if (ek && has('valueString')) { hit(ek, obj.valueString, st.path + '.valueString', obj, 'valueString', st); handled.add('valueString'); }
    }

    // ---- Attachment
    const attachment = !isResource && (has('contentType') || (has('data') && keys.length <= 8) || (has('url') && (obj.size !== undefined || has('hash') || has('title') || has('creation'))) && !handled.has('url'));
    if (attachment) {
      const p = st.path;
      if (has('data')) { hit('binary', obj.data, p + '.data', obj, 'data', st, { category: 'biometric' }); handled.add('data'); }
      if (has('hash')) { hit('binary', obj.hash, p + '.hash', obj, 'hash', st, { category: 'biometric' }); handled.add('hash'); }
      if (has('url')) { hit('url', obj.url, p + '.url', obj, 'url', st, { category: 'biometric' }); handled.add('url'); }
      if (has('title')) { freeSlot(obj.title, p + '.title', obj, 'title', st, false); handled.add('title'); }
    }

    // ---- Reference
    const refShape = !isResource && (has('reference') || (has('display') && !has('code') && !has('system') && keys.every(function (k) { return ['reference', 'type', 'identifier', 'display', 'extension', 'id'].indexOf(k) !== -1; })));
    if (refShape) {
      const p = st.path;
      if (has('reference') && obj.reference[0] !== '#') hit('ref', obj.reference, p + '.reference', obj, 'reference', st);
      handled.add('reference');
      if (has('display')) {
        const refType = has('reference') ? (/(?:^|\/)([A-Z][A-Za-z]+)\//.exec(obj.reference) || [])[1] || ctx.contexts.typeOf(obj.reference) : '';
        const dk = displayKind(name, refType, obj.display);
        if (dk) hit(dk, obj.display, p + '.display', obj, 'display', st);
        else freeSlot(obj.display, p + '.display', obj, 'display', st, false);
        handled.add('display');
      }
    }

    // ---- HumanName
    const nameShape = !isResource && (name === 'name' || name === 'valueHumanName') && (obj.family !== undefined || obj.given !== undefined || obj.text !== undefined || obj.prefix !== undefined);
    if (nameShape) {
      const p = st.path;
      if (has('family')) { hit('family', obj.family, p + '.family', obj, 'family', st); handled.add('family'); }
      if (Array.isArray(obj.given)) { obj.given.forEach(function (g, i) { if (typeof g === 'string') hit('given', g, p + '.given', obj.given, i, st); }); handled.add('given'); }
      if (has('text')) { hit('fullname', obj.text, p + '.text', obj, 'text', st); handled.add('text'); }
    }

    // ---- Address
    const addrShape = !isResource && (name === 'address' || name === 'valueAddress' || name === 'billingAddress') && (obj.line !== undefined || obj.city !== undefined || obj.postalCode !== undefined || obj.text !== undefined || obj.district !== undefined);
    if (addrShape) {
      const p = st.path;
      if (Array.isArray(obj.line)) { obj.line.forEach(function (l, i) { if (typeof l === 'string') hit('street', l, p + '.line', obj.line, i, st); }); handled.add('line'); }
      for (const k of ['city', 'district']) if (has(k)) { hit('city', obj[k], p + '.' + k, obj, k, st); handled.add(k); }
      if (has('postalCode')) { hit('zip', obj.postalCode, p + '.postalCode', obj, 'postalCode', st); handled.add('postalCode'); }
      if (has('text')) { hit('addrtext', obj.text, p + '.text', obj, 'text', st); handled.add('text'); }
    }

    // ---- ContactPoint
    const contact = !isResource && has('value') && (CONTACT_SYSTEMS.has(obj.system) || (obj.system === undefined && (name === 'telecom' || name === 'valueContactPoint')));
    if (contact) {
      const v = obj.value;
      const kind = obj.system === 'email' || v.indexOf('@') !== -1 ? 'email' : obj.system === 'url' ? 'url' : 'phone';
      hit(kind, v, st.path + '.value', obj, 'value', st);
      handled.add('value');
    }

    // ---- Identifier
    const identifier = !isResource && !contact && has('value') && (/identifier$/i.test(name || '') || has('system') || isObject(obj.type) || has('use'));
    if (identifier) {
      const code = isObject(obj.type) && Array.isArray(obj.type.coding) && isObject(obj.type.coding[0]) ? obj.type.coding[0].code : '';
      const kind = idKind(code, obj.system);
      hit(kind, obj.value, st.path + '.value', obj, 'value', st);
      handled.add('value');
      if (has('system') && /^https?:\/\//i.test(obj.system)) hit('system', obj.system, st.path + '.system', obj, 'system', st, { category: 'other' });
      handled.add('system');
    }

    // ---- Narrative
    if (!isResource && name === 'text' && has('div')) { freeSlot(obj.div, st.path + '.div', obj, 'div', st, true); handled.add('div'); handled.add('status'); }

    // ---- Coverage class
    if (!isResource && name === 'class' && st.resType === 'Coverage') {
      if (has('value')) { hit('plan', obj.value, st.path + '.value', obj, 'value', st); handled.add('value'); }
      if (has('name')) {
        if (ORG_WORD.test(obj.name)) hit('org', obj.name, st.path + '.name', obj, 'name', st);
        else freeSlot(obj.name, st.path + '.name', obj, 'name', st, false);
        handled.add('name');
      }
    }

    // ---- Location position
    if (!isResource && name === 'position') {
      for (const k of ['latitude', 'longitude']) {
        const v = obj[k];
        if (typeof v === 'number' || v instanceof J.JsonNumber) {
          const raw = String(v);
          hits.push({ kind: 'geo', lat: k === 'latitude', value: raw, path: st.path + '.' + k, idents: st.idents, set: function (t) { obj[k] = new J.JsonNumber(t); } });
          handled.add(k);
        }
      }
    }

    // ---- top-level url of a device, endpoint and similar
    if (isResource && has('url') && !CONFORMANCE.has(obj.resourceType)) { hit('url', obj.url, st.path + '.url', obj, 'url', st, { category: 'url' }); handled.add('url'); }
    if (isResource && obj.resourceType === 'Bundle') st.bundle = true;
    if (st.container === 'request' && has('url')) { hit('ref', obj.url, st.path + '.url', obj, 'url', st); handled.add('url'); }
    if (name === 'link' && has('url') && has('relation')) { hit('url', obj.url, st.path + '.url', obj, 'url', st, { category: 'url' }); handled.add('url'); }
    // canonical addresses of local profiles name the organisation that defined them, like the host of an identifier system
    if (name === 'meta' && Array.isArray(obj.profile)) {
      obj.profile.forEach(function (p, i) { if (typeof p === 'string' && /^https?:\/\//i.test(p) && !run.isStandardSystem(p)) hit('system', p, st.path + '.profile', obj.profile, i, st, { category: 'other' }); });
      handled.add('profile');
    }
    if (name === 'meta' && has('source')) { hit(/^[a-z][a-z0-9+.-]*:\/\//i.test(obj.source) || /^\d+\.\d+\.\d+\.\d+/.test(obj.source) ? 'url' : 'other', obj.source, st.path + '.source', obj, 'source', st, { category: 'url' }); handled.add('source'); }

    for (const k of keys) {
      if (handled.has(k)) continue;
      if (k === 'fullUrl' && typeof obj[k] === 'string') { hit('ref', obj[k], st.path + '.fullUrl', obj, k, st); continue; }
      walk(obj[k], k, obj, st);
    }
  }

  walk(root, null, null, { path: '', idents: ctx.contexts.first, sem: '' });
}

const ORG_KEYS = new Set(['organization', 'serviceProvider', 'custodian', 'payor', 'insurer', 'managingOrganization', 'partOf', 'onBehalfOf', 'owner', 'issuer', 'facility',
  'provider', 'assigner', 'manufacturer', 'sender', 'receiver', 'source', 'endpoint', 'author_org']);
const ID_LIKE = /^[A-Za-z0-9][A-Za-z0-9_.\/-]{4,}$/;

// What a Reference.display holds decides how it is treated: a person or organisation name is replaced
// as a whole; an identifier is replaced like any identifier; anything else (a condition, a room, a
// service) is running text that is only scanned for identifiers.
function displayKind(name, refType, text) {
  const hasAddress = /,\s*\d/.test(text);
  if (refType) {
    if (PERSON_TYPES.has(refType)) return 'fullname';
    if (refType === 'Organization' || refType === 'HealthcareService' || refType === 'Endpoint') return 'org';
    if (refType === 'Location') return hasAddress || ORG_WORD.test(text) ? 'org' : null;
  }
  if (ID_LIKE.test(text) && /\d/.test(text)) return 'other';
  if (!refType && PERSON_KEYS.has(name)) return ORG_WORD.test(text) ? 'org' : 'fullname';
  if (ORG_WORD.test(text) || hasAddress) return 'org';
  if (!refType && ORG_KEYS.has(name)) return 'org';
  return null;
}

/** Is it FHIR at all? 'fhir' or 'ndjson' (one resource per line), else null. */
function detect(text) {
  const t = T.stripBom(text);
  const head = t.slice(0, 65536);
  if (!/"resourceType"\s*:\s*"[A-Za-z]+"/.test(head)) return null;
  const lines = t.split(/\r?\n/, 3).filter(function (l) { return l.trim() !== ''; });
  if (lines.length >= 2 && lines[0].trim()[0] === '{' && lines[0].trim().slice(-1) === '}' && lines[1].trim()[0] === '{') return 'ndjson';
  return 'fhir';
}

const SUBJECT_KEYS = ['subject', 'patient', 'beneficiary', 'subscriber', 'policyHolder', 'individual'];
const MAX_PATIENT_SEEN = 200000;

/** In an NDJSON file the lines are separate resources: the names and numbers of every Patient line, found before the run, are "seen" for the resources that refer to that patient. */
function patientSeenIndex(lines) {
  const index = new Map();
  for (const line of lines) {
    if (line.indexOf('"Patient"') === -1 || !/"resourceType"\s*:\s*"Patient"/.test(line)) continue;
    let r;
    try { r = J.parse(line); } catch (e) { continue; }
    if (!isObject(r) || r.resourceType !== 'Patient' || typeof r.id !== 'string') continue;
    const entries = [];
    for (const nm of Array.isArray(r.name) ? r.name : []) {
      if (!isObject(nm)) continue;
      if (typeof nm.family === 'string') entries.push(['family', nm.family]);
      for (const g of Array.isArray(nm.given) ? nm.given : []) if (typeof g === 'string') entries.push(['given', g]);
    }
    for (const idf of Array.isArray(r.identifier) ? r.identifier : []) {
      if (!isObject(idf) || typeof idf.value !== 'string') continue;
      const code = idf.type && Array.isArray(idf.type.coding) && idf.type.coding[0] ? idf.type.coding[0].code : '';
      entries.push([idKind(code, idf.system), idf.value]);
    }
    for (const t of Array.isArray(r.telecom) ? r.telecom : []) if (isObject(t) && typeof t.value === 'string') entries.push([t.system === 'email' ? 'email' : 'phone', t.value]);
    for (const a of Array.isArray(r.address) ? r.address : []) {
      if (!isObject(a)) continue;
      for (const l of Array.isArray(a.line) ? a.line : []) if (typeof l === 'string') entries.push(['street', l]);
      if (typeof a.city === 'string') entries.push(['city', a.city]);
    }
    index.set('patient/' + r.id.toLowerCase(), entries);
    if (index.size >= MAX_PATIENT_SEEN) break;
  }
  return index;
}

function processResource(root, run, o, patientSeen) {
  const contexts = patientContexts(root);
  const ctx = { hits: [], free: [], contexts: contexts };
  collect(root, run, ctx);
  let extraSeen = null;
  if (patientSeen && root.resourceType !== 'Patient') {
    for (const k of SUBJECT_KEYS) {
      const ref = root[k] && isObject(root[k]) ? root[k].reference : null;
      if (typeof ref === 'string' && patientSeen.has(refKey(ref))) { extraSeen = patientSeen.get(refKey(ref)); break; }
    }
  }
  return finishUnit(run, 'fhir', ctx.hits, ctx.free, contexts.first, { scanOnly: o.scanOnly, extraSeen: extraSeen, known: o.known, onHit: o.onHit, verify: o.verify });
}

function eolOf(text) { return /\r\n/.test(text.slice(0, 100000)) ? '\r\n' : '\n'; }

function parseOrFail(text, line) {
  try { return { value: J.parse(text) }; } catch (e) {
    if (e instanceof J.JsonError) {
      const where = line ? 'line ' + line + ', ' : '';
      return { error: 'The JSON is not valid (' + where + 'line ' + (e.line) + ' column ' + e.column + ': ' + e.message + '). Fix the file first; nothing was changed.' };
    }
    throw e;
  }
}

function processText(text, run, o, format) {
  const bom = text.charCodeAt(0) === 0xFEFF ? T.BOM : '';
  const body = bom ? text.slice(1) : text;
  const eol = eolOf(body);
  if (format === 'ndjson') {
    // the line breaks of the input are kept as they are
    const parts = body.split(/(\r?\n)/);
    const lines = [];
    for (let i = 0; i < parts.length; i += 2) lines.push(parts[i]);
    const seenIndex = o.patientSeen || patientSeenIndex(lines);
    let changed = 0, units = 0;
    for (let i = 0; i < parts.length; i += 2) {
      const line = parts[i];
      if (line.trim() === '') continue;
      const p = parseOrFail(line, i / 2 + 1);
      if (p.error) return { ok: false, reason: 'invalid-json', message: p.error };
      const root = p.value;
      if (!isObject(root) || typeof root.resourceType !== 'string') continue;
      units++;
      const c = processResource(root, run, o, seenIndex);
      changed += c;
      if (c && !o.scanOnly) parts[i] = J.stringify(root, '', '\n');
    }
    return { text: o.scanOnly ? text : bom + parts.join(''), changed: changed, units: units };
  }
  const p = parseOrFail(body, 0);
  if (p.error) return { ok: false, reason: 'invalid-json', message: p.error };
  const root = p.value;
  const list = Array.isArray(root) ? root.filter(isObject) : [root];
  if (!list.some(function (r) { return isObject(r) && typeof r.resourceType === 'string'; })) return { ok: false, reason: 'not-recognised', message: 'The JSON has no resourceType; it is not a FHIR resource or bundle.' };
  let changed = 0, units = 0;
  for (const r of list) { if (typeof r.resourceType !== 'string') continue; units++; changed += processResource(r, run, o); }
  if (!changed || o.scanOnly) return { text: text, changed: changed, units: units };
  const indent = J.detectIndent(body);
  const trailing = /\r?\n$/.exec(body);
  return { text: bom + J.stringify(root, indent, eol) + (trailing ? trailing[0] : ''), changed: changed, units: units };
}

module.exports = { detect, processText, processResource, patientSeenIndex, collect, patientContexts, MAX_UNITS_IN_MEMORY };
