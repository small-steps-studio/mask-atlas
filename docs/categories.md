# The 14 categories

Every field that Mask Atlas recognises belongs to one of 14 categories. The scan report and the Problems marks count fields by category, and the run reports do the same for the fields that were replaced. All example values on this page are invented. The pseudonym examples show the kind and shape of a result, not a value that you will get: every key gives other invented values.

Two replacement modes exist:

* **Mask** (free): every letter becomes `X` and every digit becomes `9`; punctuation, spaces and delimiters stay, and every value keeps its length. Nothing is read in free text.
* **Pseudonym** (Pro): invented, realistic values. Within one run the same original always gets the same replacement, and two different originals of the same kind never get the same replacement. Details below.

In both modes the structure of the message is unchanged.

## Names

* **What goes in.** Family, given and middle names of patients, relatives, guarantors, subscribers and providers; full-name strings (`Dr. Evander Larkspur Jr.`); the names of people in `Reference.display` strings; names found in running text (see [free-tier.md](free-tier.md) and [pro.md](pro.md)).
* **Mask.** `Larkspur` becomes `XXXXXXXX`; `Larkspur, Evander` becomes `XXXXXXXX, XXXXXXX`.
* **Pseudonym.** Each name part is replaced by an invented name built from the extension's own lists, word by word: `Larkspur` becomes `Oakburn`, `LARKSPUR` becomes `OAKBURN`, `Okonkwo-Reyes` becomes `Glenorwall-Stoneinburn`. Capitalisation style (upper, lower, title) is kept. An initial becomes another initial (`M.` becomes `W.`). Titles (`Dr`, `Mr`, `Mrs`, ...) and suffixes (`Jr`, `III`, `MD`, ...) are kept: `Dr. Evander Larkspur Jr.` becomes `Dr. Huginna Oakburn Jr.`. A name in the form `Family, Given` is recognised. Given names and family names are told apart by their position and by what was seen before.

## Addresses

* **What goes in.** Street lines, house numbers, units, post office boxes, towns and districts, postal codes, address strings, and the coordinates of a location. State and country values are not replaced.
* **Mask.** `41 Wren Hollow Road, Apt 4B` becomes `99 XXXX XXXXXX XXXX, XXX 9X`; `43055` becomes `99999`; `41.8781` becomes `99.9999`.
* **Pseudonym.** The street name and the town are replaced by invented ones (`Fernbury` becomes `Pellmouth`); the street type word (`Road`, `Avenue`, ...) is kept; the house number and the digits of a unit are replaced by other digits (`41 Wren Hollow Road, Apt 4B` becomes `13 Linderburg Road, Apt 6B`); a post office box number is replaced by another number; a postal code becomes another code of the same length, with no relation to a real place (`43055-1234` becomes `72757-2163`); an address string is replaced part by part; the state stays (`41 Wren Hollow Road, Fernbury, OH 43055` becomes `13 Linderburg Road, Pellmouth, OH 95524`). A latitude or longitude becomes another value with the same number of decimals.

## Dates

* **What goes in.** Birth, death, admission, discharge, service, claim and message dates and times in HL7 (`YYYYMMDD[HHMMSS]`), FHIR (`date`, `dateTime`, `instant`), X12 (`D8`, `DT`, `RD8` and the six-digit `D6` forms), and dates written in running text (`2026-11-04`, `11/04/2026`, `04.11.2026`, `2026/11/04`).
* **Mask.** Every digit becomes `9`: `19810322` becomes `99999999` and `2026-11-04T09:20:00Z` becomes `9999-99-99X99:99:99X`. The masked value is no longer a date.
* **Pseudonym.** The dates of a patient move by one offset of 60 to 730 days, earlier or later, taken from the run's key and the patient's identifiers. Order, intervals and the time of day stay: `19810322` becomes `19811208` and `20261104091530` becomes `20270723091530` for an offset of 261 days. A date with only a year and month moves by whole months (at least two) and a year by whole years (at least one). A date range moves at both ends by the same offset. A value in a date field that cannot be read as a valid date is replaced like an identifier, digit for digit. The setting `maskAtlas.shiftDates` turns shifting off (dates are then kept in Pro runs); the setting `maskAtlas.dateOrder` decides whether `04/09/2026` in running text is month first or day first.

## Phone and fax numbers

* **What goes in.** Telephone, fax and pager numbers in contact fields, and telephone numbers found in running text.
* **Mask.** `614-555-0187` becomes `999-999-9999`.
* **Pseudonym.** The digits are replaced by other digits and everything else stays: `614-555-0187` becomes `959-498-7647` and `+1 (614) 555-0187` becomes `+1 (959) 498-7647`. A leading country digit `1` of an 11-digit number is kept.

## E-mail addresses

* **What goes in.** E-mail addresses in contact fields and in running text.
* **Mask.** `evander.larkspur@mail.example` becomes `XXXXXXX.XXXXXXXX@XXXX.XXXXXXX`.
* **Pseudonym.** An invented address on a domain that ends in `.example` (a reserved name that cannot reach a real mailbox): `evander.larkspur@mail.example` becomes `oleerdon.knollland@post.example`. The same address always gives the same replacement.

## SSN-like numbers

* **What goes in.** Social-security-style numbers in the `123-45-6789` layout, in fields that hold them, in identifiers of the SSN type, in X12 `REF` segments with the matching qualifier, and in running text (with the dashes or after a label such as `SSN`).
* **Mask.** `926-41-7390` becomes `999-99-9999`.
* **Pseudonym.** Other digits in the same layout: `926-41-7390` becomes `933-45-5201`.

## Medical record and account numbers

* **What goes in.** Patient, medical record, account, visit, encounter, claim, order and accession numbers, and the references that a message uses to tie records together (`BHT`, `CLM`, `CLP`, `TRN` and `REF` values).
* **Mask.** `HC-7305518` becomes `XX-9999999`.
* **Pseudonym.** Every digit becomes another digit and every letter A to Z another letter of the same case; letters outside A to Z (such as Ä, Ł or Ỉ) stay as they are, which the verification does not report; punctuation and length stay: `HC-7305518` becomes `YB-0896101` and `ACC20261104-0087` becomes `SDK25025890-9784`. A UUID or a hexadecimal digest stays a UUID or digest of the same length. For identifiers of one shape the replacement is a one-to-one mapping, so two different originals never share a replacement; no single-digit or short value maps to itself.

## Plan and certificate numbers

* **What goes in.** Member, subscriber, group, policy, plan and certificate numbers, and the same numbers found after a label in running text (`member HM-MEMBER-4417203`).
* **Mask.** `NWP4417203` becomes `XXX9999999`.
* **Pseudonym.** As for record numbers: `NWP4417203` becomes `HUS0812155`.

## Licence numbers

* **What goes in.** Provider numbers and registration numbers (national provider identifiers and similar), professional licence numbers and driver licence numbers.
* **Mask.** `1982736451` becomes `9999999999`.
* **Pseudonym.** As for record numbers: `1982736451` becomes `0461627744`. Check digits are not recomputed, so the replacement may not pass a check-digit test that the original passed.

## Vehicle and device identifiers

* **What goes in.** Device serial numbers, lot numbers and unique device identifiers (the FHIR keys `serialNumber`, `lotNumber`, `distinctIdentifier` and the device identifier carrier keys, and FHIR identifiers whose system names a device), numbers written after a label such as `serial number`, `VIN` or `plate` in running text, and any field to which a [rule file](rules.md) gives the kind `device`.
* **Mask.** `SN-DM-7741920` becomes `XX-XX-9999999`.
* **Pseudonym.** As for record numbers: `SN-DM-7741920` becomes `YU-FX-8469788`.

## URLs

* **What goes in.** Web addresses in contact fields, endpoint and link addresses, the address of a resource, and addresses written in running text (starting with `http://`, `https://`, `ftp://` or `www.`). A web address that names an organisation in an identifier's system is counted under Other unique identifiers, and the address of an attachment under Biometric and photo references.
* **Mask.** Every letter becomes `X` and every digit `9`; `https://portal.harbourside.example/patients/55102` becomes `XXXXX://XXXXXX.XXXXXXXXXXX.XXXXXXX/XXXXXXXX/99999`.
* **Pseudonym.** The scheme stays; the host becomes an invented host name ending in `.example`; the letters and digits of path segments and query values are replaced (words that look like FHIR resource names and the words `fhir`, `api` and `_history` stay); a user name before `@` becomes `user`; an IPv4 host is replaced like an IP address. `https://portal.harbourside.example/patients/55102?visit=77120` becomes `https://nashland.example/qkofsyew/88648?visit=96076`.

## IP addresses

* **What goes in.** IPv4 and IPv6 addresses in fields and in running text.
* **Mask.** `198.51.100.24` becomes `999.99.999.99`.
* **Pseudonym.** Each part of the address is replaced by another valid part, one to one: `198.51.100.24` becomes `110.64.56.230`; the hexadecimal groups of an IPv6 address are replaced by other hexadecimal groups.

## Biometric and photo references

* **What goes in.** The parts of an attachment that carry or point to its content: the `data`, `hash` and `url` of a FHIR attachment (for example in a document, a media resource or a patient photo), and the data of an HL7 encapsulated-data value (`OBX` 5 of type `ED`). The content of such a payload is not read or interpreted; it is only blanked. (A `Binary` resource that holds its payload directly in its own `data` element is not recognised as an attachment; see [coverage.md](coverage.md).)
* **Mask.** Every character becomes `X`.
* **Pseudonym.** The `data` and the `hash` are replaced by filler of the same length: `A` characters (with the `=` padding kept) for a base64-looking text, `X` characters otherwise. The `url` of an attachment is replaced like any other URL.

## Other unique identifiers

* **What goes in.** Everything else that can point to an organisation or a person and has no category of its own: names of organisations and places (hospitals, laboratories, payers, employers, locations); sender and receiver applications and facilities, assigning authorities and routing identifiers in the envelope; message, batch and control identifiers; tax identifiers; FHIR resource `id`, `fullUrl` and `reference` values and the addresses of identifier systems that name an organisation; identifiers found in running text that were seen elsewhere in the same message.
* **Mask.** Letters become `X`, digits become `9`: `MSG20261104-0042` becomes `XXX99999999-9999`; `Harbourside Medical Group` becomes `XXXXXXXXXXX XXXXXXX XXXXX`.
* **Pseudonym.** Organisation and place names become an invented name that keeps the organisation type word of the original (`Hospital`, `Clinic`, `Services`, ...) or gets `Health Services` if there is none: `Harbourside Medical Group` becomes `Jenngate Medical Group`. Identifiers are replaced like record numbers (`MSG20261104-0042` becomes `SFU78720126-0404`). A resource `id`, a `fullUrl` and a `reference` that name the same resource get the same replacement, so the links of a bundle keep pointing to the right resource (`Patient/7c1d5b0e` becomes `Patient/8t4p7v6p`). The address of an identifier system gets an invented host (`http://harbourside.example/ids/mrn` becomes `http://collcrest.example/ids/mrn`); addresses of well-known standards bodies and terminology services stay (`http://hl7.org/fhir/sid/us-npi` is kept). The settings `maskAtlas.maskOrganisations` and `maskAtlas.keepEnvelopeIdentifiers` switch organisation names and envelope identifiers off.

## What is not in any category

Codes (diagnosis, procedure, observation and unit codes), amounts, quantities, statuses, gender, the state and country of an address and the message type are not identifiers in this sense and are not replaced. They can still contribute to re-identification in combination with other details; see [coverage.md](coverage.md).
