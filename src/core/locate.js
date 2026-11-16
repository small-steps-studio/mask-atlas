'use strict';
// Where in an output text a finding of the verification sits: the message (HL7), the interchange
// (X12) or the line (FHIR), and the element path. Only places are reported, never a value: a segment
// name is accepted only when it has the shape of one and is followed by the separator of its own
// message or interchange, and a name of a FHIR resource or element is shown only when it is a name of
// the standard (everything else is "(other element)"), so that text of a message cannot end up in a place.

const LINE_BREAK = /\r\n|\r|\n/g;
const NO_SEGMENT = '(line without a segment name)';
const OTHER_ELEMENT = '(other element)';
const SEGMENT_ID = /^[A-Z][A-Z0-9]{1,2}$/;

// the elements of an X12 interchange that a run keeps on purpose: control numbers and counts, and the
// version numbers of the standard (ISA12 "00501", GS08 and ST03 "005010X222A1"), which a real postal code
// or number can equal ("00501" is a postal code), so that the check does not report every envelope
const X12_KEPT = new Set(['ISA-13', 'IEA-02', 'GS-06', 'GE-02', 'ST-02', 'SE-02', 'ISA-12', 'GS-08', 'ST-03', 'IEA-01', 'GE-01', 'SE-01']);

const RESOURCE_TYPES = new Set(('Account ActivityDefinition AdverseEvent AllergyIntolerance Appointment AppointmentResponse AuditEvent Basic Binary BiologicallyDerivedProduct BodyStructure Bundle ' +
  'CapabilityStatement CarePlan CareTeam CatalogEntry ChargeItem ChargeItemDefinition Claim ClaimResponse ClinicalImpression CodeSystem Communication CommunicationRequest CompartmentDefinition ' +
  'Composition ConceptMap Condition Consent Contract Coverage CoverageEligibilityRequest CoverageEligibilityResponse DetectedIssue Device DeviceDefinition DeviceMetric DeviceRequest ' +
  'DeviceUseStatement DiagnosticReport DocumentManifest DocumentReference EffectEvidenceSynthesis Encounter Endpoint EnrollmentRequest EnrollmentResponse EpisodeOfCare EventDefinition Evidence ' +
  'EvidenceVariable ExampleScenario ExplanationOfBenefit FamilyMemberHistory Flag Goal GraphDefinition Group GuidanceResponse HealthcareService ImagingStudy Immunization ImmunizationEvaluation ' +
  'ImmunizationRecommendation ImplementationGuide InsurancePlan Invoice Library Linkage List Location Measure MeasureReport Media Medication MedicationAdministration MedicationDispense ' +
  'MedicationKnowledge MedicationRequest MedicationStatement MedicinalProduct MessageDefinition MessageHeader MolecularSequence NamingSystem NutritionOrder Observation ObservationDefinition ' +
  'OperationDefinition OperationOutcome Organization OrganizationAffiliation Parameters Patient PaymentNotice PaymentReconciliation Person PlanDefinition Practitioner PractitionerRole Procedure ' +
  'Provenance Questionnaire QuestionnaireResponse RelatedPerson RequestGroup ResearchDefinition ResearchStudy ResearchSubject RiskAssessment Schedule SearchParameter ServiceRequest Slot Specimen ' +
  'SpecimenDefinition StructureDefinition StructureMap Subscription Substance SupplyDelivery SupplyRequest Task TerminologyCapabilities TestReport TestScript ValueSet VerificationResult VisionPrescription').split(' '));

const ELEMENT_NAMES = new Set(('id meta text div contained extension modifierExtension identifier active name use family given prefix suffix period start end telecom system value rank gender birthDate ' +
  'deceasedBoolean deceasedDateTime address type line city district state postalCode country maritalStatus multipleBirthBoolean multipleBirthInteger photo contact relationship organization ' +
  'communication language preferred generalPractitioner managingOrganization link other status category code subject patient encounter effectiveDateTime effectivePeriod issued performer ' +
  'valueQuantity valueString valueCodeableConcept valueDateTime valueBoolean valueInteger valueRange valueRatio valueTime valueAttachment valueReference valueIdentifier valueHumanName ' +
  'valueContactPoint valueAddress valueUri valueUuid valueDate valueDecimal valuePeriod valueCoding valueText note authorString authorReference time interpretation comment bodySite method ' +
  'specimen device referenceRange low high component entry resource fullUrl request response url search mode score total timestamp display reference assigner coding userSelected data ' +
  'contentType size hash title creation payload contentString contentMarkdown contentAttachment contentReference sent received sender recipient topic reasonCode reasonReference requester ' +
  'onsetDateTime onsetString abatementDateTime recordedDate recorder asserter clinicalStatus verificationStatus severity evidence detail stage dosage doseAndRate route site sequence timing ' +
  'repeat boundsPeriod count frequency periodUnit when offset authoredOn occurrenceDateTime occurrencePeriod insurance subscriber subscriberId beneficiary dependent policyHolder payor ' +
  'order network costToBeneficiary group plan class provider priority supportingInfo diagnosis procedure item productOrService quantity unitPrice net adjudication amount submitted benefit ' +
  'careTeam facility prescription originalPrescription payee claim outcome disposition preAuthRef preAuthPeriod addItem processNote billablePeriod created insurer enterer referral entered ' +
  'patientInstruction instruction description summary conclusion presentedForm result resultsInterpreter media image study series instance serviceProvider participant individual actor required ' +
  'location hospitalization origin destination admitSource dischargeDisposition diet specialArrangement account episodeOfCare partOf basedOn statusHistory classHistory reason serviceType ' +
  'appointmentType slot minutesDuration custodian attester party section orderedBy emptyReason focus hours daysOfWeek allDay openingTime closingTime availableTime notAvailable endpoint ' +
  'characteristic physicalType position alias manufacturer manufactureDate expirationDate lotNumber serialNumber deviceName modelNumber partNumber udiCarrier deviceIdentifier carrierHRF ' +
  'carrierAIDC distinctIdentifier owner safety parent version lastUpdated versionId profile security tag source question answer linkId authored questionnaire altText answerString resultString ' +
  'membershipId certificate policyNumber cardNumber accessionNumber patientId visitNumber geolocation latitude longitude altitude').split(' '));

/**
 * A place text that is safe to show: an element path of HL7 or X12 (SEG-n or SEG-n.m), or dotted names of the
 * FHIR standard. Anything else becomes "(other element)": a place never carries text of a message.
 */
function safePlace(path) {
  const text = String(path === undefined || path === null ? '' : path);
  if (text === '(further places)' || text === NO_SEGMENT) return text;
  if (/^[A-Z][A-Z0-9]{1,2}-\d{1,3}(\.\d{1,2})?$/.test(text)) return text;
  const parts = text.split('.');
  if (parts.length > 16) return OTHER_ELEMENT;
  return parts.map(function (p) { return /^\d{1,4}$/.test(p) || p === '*' || RESOURCE_TYPES.has(p) || ELEMENT_NAMES.has(p) ? p : OTHER_ELEMENT; }).join('.');
}

const NEWLINE = String.fromCharCode(10);
const RESOURCE_TYPE = new RegExp('^"resourceType"' + String.fromCharCode(92) + 's*:' + String.fromCharCode(92) + 's*"([A-Za-z]+)"');
const KEY = new RegExp('"([A-Za-z_][A-Za-z0-9_]*)"' + String.fromCharCode(92) + 's*:');

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function countChar(text, ch) {
  let n = 0;
  for (let i = text.indexOf(ch); i !== -1; i = text.indexOf(ch, i + 1)) n++;
  return n;
}

/** The index of the last start that is not after `offset` (starts is sorted). */
function startBefore(starts, offset) {
  let lo = 0, hi = starts.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

function hl7Locator(text) {
  const starts = [], units = [], fds = [], cds = [];
  let unit = 0;
  let pos = 0;
  LINE_BREAK.lastIndex = 0;
  let m;
  // each message states its own separators in its own MSH (the field separator after the name, the component separator next to it)
  let fd = '|', cd = '^';
  const add = function (from) {
    const head = text.substr(from, 3);
    if (head === 'MSH') {
      unit++;
      const f = text.charAt(from + 3);
      if (f && !/[A-Za-z0-9\s]/.test(f)) { fd = f; const c = text.charAt(from + 4); if (c && !/[A-Za-z0-9\s]/.test(c) && c !== f) cd = c; }
    }
    starts.push(from); units.push(Math.max(unit, 1)); fds.push(fd); cds.push(cd);
  };
  add(0);
  while ((m = LINE_BREAK.exec(text)) !== null) { pos = m.index + m[0].length; add(pos); }
  return function (offset) {
    const k = startBefore(starts, offset);
    const fd = fds[k], cd = cds[k];
    const start = starts[k];
    const end = k + 1 < starts.length ? starts[k + 1] : text.length;
    const seg = text.slice(start, end).replace(/[\r\n]+$/, '');
    const id = seg.slice(0, 3);
    // a segment name has the shape of one and is followed by the field separator (or ends the line); other lines are running text
    if (!/^[A-Z][A-Z0-9]{2}$/.test(id) || (seg.length > 3 && seg.charAt(3) !== fd)) return { unit: units[k], path: NO_SEGMENT, line: k + 1 };
    const prefix = text.slice(start, offset);
    const fields = countChar(prefix, fd);
    const n = id === 'MSH' || id === 'FHS' || id === 'BHS' ? fields + 1 : fields;
    let path = id + '-' + n;
    if (fields > 0) {
      const field = seg.split(fd)[fields] || '';
      if (field.indexOf(cd) !== -1) path += '.' + (countChar(prefix.slice(prefix.lastIndexOf(fd) + 1), cd) + 1);
    }
    return { unit: units[k], path: safePlace(path), line: k + 1 };
  };
}

function x12Locator(text) {
  // each interchange states its own separators in its own ISA (element separator after "ISA", terminator at offset 105)
  const starts = [], units = [], seps = [];
  let unit = 0;
  let sep = '*', term = '~';
  let from = 0;
  while (from < text.length) {
    let a = from;
    while (a < text.length && a - from < 8 && /[\s﻿]/.test(text.charAt(a))) a++;
    if (text.substr(a, 3) === 'ISA' && text.length > a + 105 && !/[A-Za-z0-9\s]/.test(text.charAt(a + 3)) && !/[A-Za-z0-9 	]/.test(text.charAt(a + 105))) {
      unit++;
      sep = text.charAt(a + 3);
      term = text.charAt(a + 105);
    }
    starts.push(from); units.push(Math.max(unit, 1)); seps.push(sep);
    const end = text.indexOf(term, from);
    if (end === -1) break;
    from = end + 1;
    while (from < text.length && (text.charAt(from) === '\r' || text.charAt(from) === '\n')) from++;
  }
  if (!starts.length) { starts.push(0); units.push(1); seps.push('*'); }
  return function (offset) {
    const k = startBefore(starts, offset);
    const start = starts[k];
    const s = seps[k];
    const head = text.slice(start, start + 8);
    const m = /^[\s﻿]*([A-Z][A-Z0-9]{1,2})/.exec(head);
    if (!m || !SEGMENT_ID.test(m[1]) || head.charAt(m[0].length) !== s) return { unit: units[k], path: NO_SEGMENT, line: null, kept: false };
    const prefix = text.slice(start, offset);
    const n = countChar(prefix, s);
    const path = m[1] + '-' + pad2(n);
    return { unit: units[k], path: path, line: null, kept: X12_KEPT.has(path) };
  };
}

function jsonLocator(text, ndjson) {
  let breaks = null; // the offsets of the line feeds, built when the first place is asked for
  return function (offset) {
    if (!breaks) { breaks = []; for (let i = text.indexOf(NEWLINE); i !== -1; i = text.indexOf(NEWLINE, i + 1)) breaks.push(i); }
    const line = countBefore(breaks, offset) + 1;
    // the resource type that the text most recently named
    let resource = '';
    const r = text.lastIndexOf('"resourceType"', offset);
    if (r !== -1) { const m = RESOURCE_TYPE.exec(text.slice(r, r + 80)); if (m) resource = m[1]; }
    // the key of the value: the last key before the offset (on this line, else on the lines above: an array of strings)
    let key = '';
    const near = text.slice(Math.max(0, offset - 4000), offset);
    const re = new RegExp(KEY.source, 'g');
    let m;
    while ((m = re.exec(near)) !== null) key = m[1];
    return { unit: ndjson ? line : 1, path: safePlace((resource ? resource + '.' : '') + (key || 'value')), line: line };
  };
}

/** How many offsets of the sorted array are smaller than `offset`. */
function countBefore(sorted, offset) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < offset) lo = mid + 1; else hi = mid; }
  return lo;
}
/** A function from an offset of `text` to { unit, path, line, kept } for the given format. */
function createLocator(text, format) {
  if (format === 'hl7') return hl7Locator(text);
  if (format === 'x12') return x12Locator(text);
  return jsonLocator(text, format === 'ndjson');
}

module.exports = { createLocator, safePlace, X12_KEPT, NO_SEGMENT };
