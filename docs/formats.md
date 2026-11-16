# Formats

Mask Atlas reads three families of healthcare messages. This page says what is recognised in each, at the level of structure: which segments, elements, resources and keys are looked at. It does not reproduce text of any standard or implementation guide, and it does not say what a field means; for that, use the specification of your own message type.

In all three formats the structure of the message is never changed: segment order, counts, delimiters, line endings and the fields that are not named here stay as they were. Codes (diagnosis, procedure, observation and unit codes), amounts, quantities, statuses, gender, state and country values and the message type are not touched.

## How a format is recognised

| Format | Recognised when |
| --- | --- |
| HL7 v2 | the text starts (after a byte order mark, an MLLP start byte or blank space) with `MSH`, `FHS` or `BHS` followed by a field separator; or it looks like loose segments (`XXX\|` at the start and a line break) |
| X12 | the text starts with an `ISA` segment of 106 characters whose 16 separators and fixed widths are correct |
| FHIR JSON | the text starts with `{` or `[` and holds `"resourceType": "<Name>"` in its first 64 KB; two or more lines that each hold one JSON object are read as NDJSON |

Anything else is reported as not recognised and left unchanged. A FHIR JSON file that is not valid JSON is reported with the line and column of the first problem; nothing is changed.

## HL7 v2

* **Delimiters.** The field, component, repetition, escape and subcomponent characters are read from the message's own `MSH` (or `FHS` or `BHS`) and used to read and to write it. Without a header the default characters are used. A message whose header declares other characters (for example `#` and `@`) is read with those.
* **Units.** A file may hold one message, several messages, or a batch with `FHS`, `BHS`, `BTS` and `FTS` segments. Each message is processed on its own; batch headers are processed too.
* **Segment terminators and framing.** Carriage returns, line feeds and both together are kept as they are, per segment. A byte order mark and MLLP framing bytes are kept.
* **Escape sequences.** In running text the five delimiter escapes are read as the characters they stand for, so a name or number that contains one is still found, and are written back as escapes. Other escape sequences are left alone. A replacement that contains a delimiter is escaped.
* **Versions.** The profile is a list of field positions and data types that is the same for every version; there is no version switch. The sample files used for the coverage measurement carry versions 2.3 to 2.8.

Segments with fields in the profile (the numbers are field positions, grouped by what the field holds):

| Segment | Fields in the profile |
| --- | --- |
| `MSH`, `FHS`, `BHS`, `MSA` | sender and receiver applications and facilities (3 to 6), time stamp (7), control ids (`MSH` 10; 9 to 12 in batch headers; `MSA` 2), organisations (`MSH` 22 and 23) |
| `EVN` | dates (2, 3, 6), name (5), facility (7) |
| `PID` | identifiers (2, 3, 4, 18, 21), names (5, 6, 9), dates (7, 29, 33), address (11), telephone and e-mail (13, 14, 40), SSN-like number (19), licence number with date (20), place (23), facility (34) |
| `PD1`, `NK1` | organisations, providers, names (`NK1` 2, 26, 30), addresses (4, 32), telephone (5, 6, 31), dates (8, 9, 16), identifiers (12, 33), SSN-like number (37) |
| `PV1`, `PV2` | locations (3, 6, 11, 42, 43), providers (7, 8, 9, 17, 52), identifier (19), organisation (23), dates (44, 45; `PV2` 8, 9, 31), free text (`PV2` 3) |
| `MRG` | identifiers (1 to 6), name (7) |
| `IN1`, `IN2`, `GT1` | organisations, names, addresses, telephone, plan and group numbers, SSN-like numbers, dates |
| `NTE`, `AL1`, `DG1` | free text (`NTE` 3, `AL1` 5, `DG1` 4), dates, providers |
| `PR1`, `PRA`, `STF`, `ROL`, `PRD`, `MFE` | procedure providers, licence numbers, staff identifiers, names, addresses, telephone, dates, master-file keys |
| `ORC`, `OBR`, `OBX` | order, filler and placer identifiers, providers, locations, telephone, addresses, dates, free text; `OBX` 14, 15, 16, 18, 19, 23, 24, 25 and the value in `OBX` 5 |
| `SPM`, `SCH`, `AIG`, `AIP`, `AIL`, `AIS` | specimen and appointment identifiers, providers, locations, telephone, addresses, dates |
| `TXA`, `FT1`, `RXA`, `RXE`, `TQ1`, `QRD`, `ACC` | document and charge identifiers, providers, dates |

* **Identifiers by type.** An identifier field is classed by its type code (the fifth component) as a record number, an SSN-like number, a licence number, a plan number or a tax number; without a recognised code a value that looks like `123-45-6789` is SSN-like and everything else is a record number. The assigning authority and facility parts of an identifier are routing identifiers.
* **`OBX` values.** The value in `OBX` 5 is read according to the value type in `OBX` 2: text types (`ST`, `TX`, `FT`) as running text; `DT`, `DTM` and `TS` as dates; `XPN`, `XAD`, `XTN`, `XCN`, `CX`, `EI`, `XON`, `ED` and `RP` as the structured types they are; numeric and coded types are kept; an unknown value type is read as running text.
* **Fields the profile does not know in a known segment.** They are searched for numbers, identifiers and e-mail addresses that were seen elsewhere in the message, for e-mail addresses, SSN-like numbers and IP addresses, and a timestamp of 12 or 14 digits is shifted like a date. Names are not looked for in such a field, and a telephone number is found there only when the same number was seen in a recognised field of the same message.
* **Lines without a segment name.** A line that does not start with a segment name (three capitals followed by the field separator), such as a note that continues after a line break, is read as running text like a `Z` segment: names seen elsewhere in the message, telephone numbers, e-mail addresses and the other patterns are replaced in it. The free mask does not read free text and leaves such a line as it is. In a report and in the Problems panel such a line is called "(line without a segment name)".
* **Segments the profile does not know.** A segment whose name starts with `Z` is read completely as running text (names and numbers seen elsewhere, e-mail addresses, telephone numbers, SSN-like numbers, URLs, IP addresses, dates, titles and labelled numbers). Any other unknown segment gets the same limited search as the unknown fields above. A [rule file](rules.md) can name any field.

## X12

* **Delimiters.** The element separator, the sub-element separator and the segment terminator are taken from the `ISA` segment; for versions from 00501 the repetition separator too. A file may hold several interchanges; whitespace between interchanges is kept.
* **Fixed widths and counts.** The fixed widths of the `ISA` segment are kept (a sender or receiver id is replaced by a value of the same length). Control numbers, segment counts and group counts (`ISA13`, `GS06`, `ST02`, `SE01`, `GE01`, `IEA01`) are not touched, so the envelope totals stay correct. A replacement never contains a separator or terminator.
* **Transaction sets.** The profile works by segment, not by transaction set, so it covers claims (837), remittances (835), eligibility (270 and 271), claim status (276 and 277), authorisations (278) and enrolment (834) alike. The sample files used for the coverage measurement carry versions 004010 and 005010.

Segments with elements in the profile (the numbers are element positions):

| Segment | Elements in the profile |
| --- | --- |
| `ISA`, `GS` | sender and receiver ids (`ISA` 06 and 08, `GS` 02 and 03), date (`ISA` 09, `GS` 04) |
| `BHT`, `BGN` | reference ids (`BHT` 03, `BGN` 02), dates (`BHT` 04, `BGN` 03) |
| `NM1`, `N1`, `N2` | names (`NM1` 03, 04, 05; `N1` 02; `N2` 01 and 02), identifiers (`NM1` 09, `N1` 04) classed by their qualifier |
| `N3`, `N4` | address lines, city, postal code, location identifier (`N4` 06) |
| `DMG`, `PAT` | birth date or date range (`DMG` 02), date (`PAT` 06) |
| `PER` | contact name or department (02), telephone, e-mail or URL by qualifier (04, 06, 08) |
| `REF`, `N9` | reference value (02) classed by its qualifier, free text (03) |
| `DTP`, `DTM` | date value (`DTP` 03 for the date formats `D8`, `DT`, `RD8` and `D6`; `DTM` 02) |
| `CLM`, `CLP`, `SBR`, `HCR`, `IDC` | claim and account numbers, subscriber and group numbers, authorisation and card numbers |
| `BPR`, `TRN` | payment trace and account identifiers, payment date |
| `PWK`, `MSG`, `NTE`, `K3` | control number (`PWK` 06), free text (`MSG` 01, `NTE` 02, `K3` 01) |

* **Other segments.** Every element of 5 or more characters in another segment (except `ST`, `SE`, `GE` and `IEA`) is searched for numbers, identifiers and e-mail addresses that were seen elsewhere in the interchange, and for e-mail addresses, SSN-like numbers and IP addresses.
* **Patient context.** The first subscriber or patient `NM1` of an interchange gives the identifiers that decide the date offset; see [pro.md](pro.md).

## FHIR JSON

* **Units.** A single resource, a bundle (resources are found at any depth), an array of resources, or NDJSON (one resource per line).
* **Data types by shape.** The same rules apply to every resource type and to R4 and R5 alike; there is no version switch. A value is recognised by the shape of the object that holds it and by its key:
  * human names (`family`, `given`, `text`), addresses (`line`, `city`, `district`, `postalCode`, `text`), contact points (`value`, replaced as e-mail, URL or telephone according to `system`);
  * identifiers (`value`, classed by the type code and the system: record, SSN-like, licence, plan, tax, device), and the address of an identifier system when it is a web address of an organisation (addresses of well-known standards bodies and terminology services stay);
  * references (`reference`, replaced by the same function as the resource `id` and `fullUrl`, so that links keep pointing to the same resource; `display`, treated as a name, an organisation or running text according to what it points to);
  * attachments (`data`, `hash` and `url` replaced; `title` read as running text); narrative (`text.div`, read as running text with the markup kept);
  * a few keys of their own: subscriber, member, policy and card numbers, device serial and lot numbers, accession and visit numbers, `position` of a location, the `address` of an endpoint, the top-level `url` of a resource that is not a conformance resource, `meta.source`, the `url` of a request, the `location` of a response, and the `url` of a bundle link.
* **Running text.** The values of keys such as `text`, `comment`, `note`, `description`, `conclusion`, `valueString`, `title`, `detail`, `summary`, `instruction`, `reasonText` and `div` are read as running text.
* **Dates.** A string that is a complete date or date-time in any key that is not code-like is shifted; a year or year-month is shifted when the key looks like a date (`birthDate`, `onsetDateTime`, `period.start`, ...).
* **Patient context.** Each resource takes the date offset of the patient it points to (`subject`, `patient`, `beneficiary`, `subscriber`, `policyHolder`, `individual`), or else of the first patient in the document.
* **Other string elements.** A string of 5 or more characters under a key that is not named above gets the limited search described for HL7 (numbers, identifiers and e-mail seen elsewhere; e-mail, SSN-like numbers and IP addresses).
* **Kept.** Code-like keys (`resourceType`, `code`, `system` of a coding, `status`, `use`, `type`, `gender`, `unit`, `language`, `contentType`, ...), numbers (apart from the coordinates of a location), booleans, and the top-level `url` of conformance resources (profiles, value sets, code systems and similar).
* **Writing.** The document is read strictly and written back with the same indentation, key order, line break style, byte order mark and trailing line break; numbers keep the text they had. The escaping of characters inside strings is normalised (a character is written as itself unless JSON requires an escape).
* **NDJSON.** Each line is processed as its own resource. In a file run, the patients of the file are indexed first, so that the names and numbers of a patient are known to the running-text search of the resources that point to that patient.
* **Contained resources** keep their local ids and `#` references.

## Encodings and sizes

* The editor commands work on the text the editor holds.
* File runs read UTF-8; a file with a UTF-16 byte order mark (little or big endian) is decoded as UTF-16 and written back in the same encoding with its mark; a file that is neither is read as Latin-1 and written back the same way, byte for byte where nothing is replaced. UTF-16 text without a byte order mark is not recognised: the report says so and writes nothing; save such a file as UTF-8 or with a byte order mark.
* Files are read in pieces of about 1 MB that end at message boundaries (HL7 messages, X12 interchanges, NDJSON lines), so memory does not grow with the file. A single FHIR JSON document is read whole; the limit is 40 MB, and such a document needs about 25 times its size in memory (measured: a 25 MB bundle peaked at 618 MB of heap). For big FHIR exports, use NDJSON.
