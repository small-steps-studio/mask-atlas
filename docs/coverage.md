# Coverage and limits

Mask Atlas reduces the risk that a message identifies a person. It does not remove the risk, and it cannot promise to. This page says what was measured, which cases are known to be missed, and which kinds of identifier the engine cannot see at all. It is not legal advice, and no number on this page is a certificate of anything. You remain responsible for reading every output before it is shared.

## How identifiers are found

1. **By place.** The built-in profile names the fields in which identifiers are expected (see [formats.md](formats.md)); a [rule file](rules.md) adds more. This is the strongest route and is used by the free tier and by Pro.
2. **By earlier occurrence (Pro).** A name, street, town, organisation, telephone number or identifier found in a recognised field is looked for in the running text of the same message, bundle or interchange (in NDJSON, the Patient lines are indexed first), so that a note that repeats a patient's family name or a relative's telephone number gets the same replacement.
3. **By shape (Pro).** In running text: e-mail addresses, web addresses, IP addresses, SSN-like numbers, telephone numbers, dates in four layouts, a name after a title word or a relation word, and an identifier after a label such as `member` or `serial number`.

A value that is found by none of these routes is not replaced and is not reported.

## Measured on the sample files

The repository holds 72 invented sample messages (28 HL7 v2, 16 X12, 26 FHIR JSON documents and 2 NDJSON files) and 12 invalid files, with a manifest that lists, for every sample, the identifiers that were planted in it (1,196 in all, in places chosen when the sample was written) and the harmless strings that must survive (475: codes, units, diagnosis text). Each sample was processed by a Pro run with the default settings and one fixed key (the test `test/corpus.test.js` and the helper `test/helpers/measure.js` repeat the measurement).

| | Planted values | Gone from the output | Left |
| --- | ---: | ---: | ---: |
| HL7 v2 (28 files) | 485 | 485 | 0 |
| X12 (16 files) | 273 | 273 | 0 |
| FHIR JSON (26 files) | 395 | 395 | 0 |
| NDJSON (2 files) | 43 | 43 | 0 |
| **All 72 files** | **1,196** | **1,196** | **0** |

* How they were found: 998 by place, 162 by earlier occurrence (they also sit in a note or comment), 36 by shape.
* All 475 harmless strings were still in the output.
* With 11 different keys tried on all 72 files, 10 left no planted value; one left a single planted given name, because a town invented by the tool for another field had the same spelling. A replacement can coincide with a word that is somewhere else in the data; the verification (see [verification.md](verification.md)) does not count the words that the run itself wrote.
* The verification passed for all 72 outputs.
* A folder run over the whole sample folder (85 files, the 12 invalid files and the manifest included) wrote 76 files, skipped 8 that are not messages, reported 1 invalid JSON file with its line and column, replaced 3,249 fields and passed the verification. Four more runs with random keys gave the same counts and passed the verification too.
* Of the 12 invalid files, 8 were refused with a message (empty, whitespace only, binary data, an ISA segment of the wrong length, a JSON file without `resourceType`, invalid JSON, two plain text files); 4 (a truncated HL7 message, segments without a header, a header with unusual delimiters, an X12 interchange without a trailer) were processed as far as they go, without an error.

The same 72 files through the free **Mask Message In Place** (letters `X`, digits `9`, no free text):

| Category | Planted | Gone (free) | Gone (Pro) |
| --- | ---: | ---: | ---: |
| Names | 262 | 147 | 262 |
| Addresses | 100 | 92 | 100 |
| Dates | 104 | 100 | 104 |
| Phone and fax numbers | 101 | 58 | 101 |
| SSN-like numbers | 49 | 48 | 49 |
| Medical record and account numbers | 159 | 154 | 159 |
| Plan and certificate numbers | 65 | 62 | 65 |
| Licence numbers | 70 | 69 | 70 |
| Vehicle and device identifiers | 13 | 12 | 13 |
| E-mail addresses | 56 | 44 | 56 |
| URLs | 14 | 11 | 14 |
| IP addresses | 7 | 2 | 7 |
| Biometric and photo references | 19 | 19 | 19 |
| Other unique identifiers | 177 | 175 | 177 |
| **Total** | **1,196** | **993** | **1,196** |

The free mask removed 993 of the 1,196 (83 %). The 203 that remain are, in the sample files, 162 repetitions of a field's value inside notes and comments (which the free tier does not read), 30 shapes inside free text (such as e-mail addresses and telephone numbers) and 11 values that also occur in free text or in a segment or field outside the profile. One of the 475 harmless strings was changed by the mask (a unit designation in an address line, `Suite 12`).

**What these numbers are, and are not.** The sample files were written together with the engine, with knowledge of the places it reads. They show that the engine does what it is built to do on those files, and they catch changes that break it. They say little about your messages: real messages carry local segments, local qualifiers, free-text habits and mistakes that no sample has. Do not read "1,196 of 1,196" as a rate you can expect.

## Known misses in the sample files

The manifest also lists 14 planted values that were expected to survive when the samples were written. In the current build 6 of them survive and 8 are replaced.

| File and place | What it is | Result now |
| --- | --- | --- |
| HL7 `ZPD-5` (adt-a08-02) | identifier in an unknown `Z` segment, no recognisable shape | **stays** |
| HL7 `ZIN-2` (adt-a08-02) | member number in an unknown `Z` segment, no recognisable shape | **stays** |
| HL7 `NTE-3` (oru-r01-04) | a person named once in a note, no title word, no field that holds the name; the relation word is not English | **stays** |
| X12 `MSG-01` (claim-status-277-01) | a person named once in a message line, no title word, no field that holds the name | **stays** |
| FHIR `device.display` (observation-01) | a serial number inside a display string, not in a serial number element | **stays** |
| FHIR `note[0].text` (condition-01) | a street address that appears once in a note, with no structured counterpart | **stays** |
| HL7 `PV2-3` (adt-a01-01) | a date written in a note | replaced |
| HL7 `NTE-3` (oru-r01-02), two dates | a birth date and a retention date written in a note | replaced |
| HL7 `OBX-18` (orm-o01-02) | an equipment instance identifier | replaced |
| HL7 `OBX-5.5` (mdm-t02-02) | an image payload in an encapsulated-data value | replaced by filler |
| X12 `REF-02` (enroll-834-02) | the value of a locally defined `REF` qualifier | replaced |
| X12 `NTE-02` (claim-837p-03) | a pump serial number after the word "serial" in a note | replaced |
| FHIR `reasonCode[0].text` (encounter-01) | a spouse named once in a note, after the word "spouse" | replaced |

## What the engine cannot see

These cases were tried with invented data in a Pro run with the default settings (one message, one run). "Stays" means the planted value was still in the output.

**Names in running text**

| Case | Result |
| --- | --- |
| A name written once in a note, with no title word, relation word or field that holds it (`Spoke with Tomasz Brightwater about the results.`), also in capitals or after `c/o` | stays |
| A nickname or a different spelling of a name that sits in a field (`Quilly` for `Quill`; `Fenwik` for `Fenwick`) | stays |
| A name after a title word or relation word that is directly followed by a full stop or a comma (`with Dr Halloran Pike.`, `her daughter Marisol.`) | the name (or its last word) stays; only a name followed by a space or by the end of the text is found this way |
| The same name after a title word, followed by a space (`with Dr Halloran Pike on the ward`) | replaced |
| A name that was seen in a field, written in a note in any capitalisation, with an ending such as `'s` | replaced |
| A seen name that is also a common English word, written in lower case in a note | stays (such names are matched only in the exact capitalisation of the field, or in capitals) |
| A seen name or number shorter than three letters (names), five characters (identifiers) or seven digits (telephone numbers) | not looked for in text |
| An employer or a small town named in a note (`Works at Brightwater Dairy Cooperative`, `Moved from Tiny Hollow`) | stays |
| A name inside a text that the profile does not read: a coded observation value, an observation or service description, a relationship text (HL7 `OBX-3`, `OBX-5` of a coded type, `OBR-4`, `NK1-3`); FHIR `code.text`, `coding.display`, a device name | stays |

**Dates, numbers and addresses in running text**

| Case | Result |
| --- | --- |
| A date written in words (`November 4, 2026`), with a month name (`4 Nov 2026`) or with a two-digit year (`11/04/26`) | stays |
| A date as `2026-11-04`, `11/04/2026`, `4.11.2026` or `2026/11/04` | replaced |
| A telephone number with seven digits (`555-0188`) | stays |
| A telephone number with ten digits, with dots, spaces or an international prefix | replaced |
| An SSN-like number without separators and without a label (`926417390`) | stays |
| An SSN-like number with dashes, or any digits after the label `SSN` | replaced |
| A web address without a scheme and without `www.` (`portal.example/patient/55102`) | stays |
| An identifier with no label and no earlier occurrence (`Pulled QX-77-1204 from the archive.`) | stays |
| The same identifier after a label (`ref`, `member`, `account`, ...) | replaced |
| Ages (`93 years old`) and a rare condition written in a note | stays |

**Places the profile does not know**

| Case | Result |
| --- | --- |
| An HL7 field of a known segment that the profile does not list (for example a county text in `PID-12`) | stays |
| An identifier with no recognisable shape in an unknown HL7 segment, in an unknown X12 segment or in an unknown FHIR key, and not seen elsewhere in the message | stays |
| The same identifier when it was seen in a recognised field of the same message | replaced |
| A telephone number or a name in an unknown FHIR key, not seen elsewhere | stays |
| A FHIR extension from the list of standard extensions that carry a name, in the free mask and in Pro runs: `patient-mothersMaidenName`, `humanname-mothers-family`, `humanname-fathers-family`, `humanname-own-name`, `humanname-partner-name`, `patient-congregation` and the ISO 21090 address parts (`iso21090-ADXP-streetName`, `houseNumber`, ...) | replaced |
| A text value (`valueString`) of any other extension (a local one, or a standard one that is not on that list) with a name or number that was not seen elsewhere in the message | stays; add a rule for its path, for example `Patient.extension.valueString` (see [rules.md](rules.md)) |
| The payload of a FHIR `Binary` resource (its own `data` element, as opposed to an attachment inside another resource) | stays |
| Attachment payloads in the recognised shapes (FHIR attachment `data` and `hash`, HL7 encapsulated data) | blanked, never read |

**By design**

* **Text inside attachments and images** is not read. A recognised payload is blanked; an unrecognised one is not touched.
* **File names and folder names** are not changed. The report lists file names that contain a replaced value, but it cannot see every case.
* **Check digits** (for example in provider numbers) are not recomputed: `1982736451` becomes another ten-digit number that need not pass a check-digit test.
* **Codes, amounts, quantities, statuses, gender, state and country** are kept. So are numeric and coded observation values and the message type.
* **Ages and dates.** The dates of a patient move by one offset of 60 to 730 days. The order of the events and every interval between them stay, which keeps the timeline of a case intact: someone who knows when something happened can still recognise it. An age written in a note is not changed to match the shifted date of birth.
* **Combinations of harmless details** (a rare diagnosis, a small place, an exact age, a unique sequence of events) can point to a person even when every identifier is gone. No tool finds those; read the output with that question in mind.
* **The free tier does not read free text at all.**
* **A rule file can make things worse.** A `keep` rule leaves values in the output, and a rule for one component of an HL7 field switches off the built-in handling of the other components (see [rules.md](rules.md)).
* **The verification only checks what the run knew.** A PASS does not prove that nothing is left (see [verification.md](verification.md)).

## What to do about it

1. Run **Scan For Identifiers** on a typical message and read the paths. Whatever you know to carry an identifier and is not listed is a candidate for a rule.
2. Add rules for the local segments, qualifiers and keys of your interfaces ([rules.md](rules.md)) and run on a small sample first.
3. Read the output, in particular the notes, comments, narrative texts and any segment or key that is specific to your system, and search it for the names of the people involved.
4. Keep the output, the pseudonym map and the seed apart from where the data is going.
5. Share as little as the problem needs. A single segment is safer than a whole message.
