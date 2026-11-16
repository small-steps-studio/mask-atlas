# Free features

Everything that is not marked "(Pro)" is free, for personal and commercial use, with no key, no account and no network connection: the identifier risk report, the Problems marks, the masked preview, masking in place, the samples, the walkthrough, the documentation links, Report A Problem, Forget Last Run, Clear Pseudonym Seed and the licence commands. Free features will not be moved behind the key later.

## Scan For Identifiers

**Mask Atlas: Scan For Identifiers** reads the whole document in the active editor and opens a report beside it. Nothing is changed.

The report (Markdown) holds:

* the format and the number of messages or documents found;
* the number of fields that hold a value that can point to a person, and a table with the count per [category](categories.md);
* **Where they are**: a table of element paths (for example `PID-5.1`, `NM1-03`, `Patient.name.family`) with the category, the number of fields and the **shape of the first value** with letters shown as `X` and digits as `9` (`HC-7305518` is shown as `XX-9999999`). The 40 paths with the most fields are listed. The report never shows a value;
* **What this scan does not look at**: how many free-text fields were found and not read, fields the profile does not know, and text inside pictures and encoded attachments.

The same fields are marked in the **Problems** panel (setting `maskAtlas.markInProblems`): a mark is an information-level entry from the source "Mask Atlas" with the code `MA-<category>`, a message such as `Names: PID-5.1 (possible identifier)`, and no value. In HL7 and X12 documents the mark sits on the line of the field; in JSON documents there is one mark per category and path at the top of the file. At most 1,000 marks are shown. The marks disappear when you edit the document or mask it.

Free text is not read by the free scan. While the Pro trial is running, or with a licence, the scan also reads notes and comments and counts what it finds there (the paths then end in `(free text)`). The scan itself never starts the trial.

## Preview Masked Version

**Mask Atlas: Preview Masked Version** opens the original and the masked text side by side in the editor's compare view, titled "Original <-> masked preview". The masked side is a read-only document held in memory; nothing is written to disk.

## Mask Message In Place

**Mask Atlas: Mask Message In Place** replaces the text of the editor with the masked text:

* every letter becomes `X` and every digit becomes `9`; punctuation, spaces and delimiters stay;
* every value keeps its length, so fixed-width fields (the X12 `ISA` segment) and counts stay valid, and the structure of the message does not change;
* the file on disk is not changed until you save; `Ctrl+Z` undoes the masking.

The message afterwards says how many fields were masked, per category, and reminds you that free text is not read by the free tier.

What the mask does with the fields of the [profile](formats.md):

* Names, addresses, dates, telephone and fax numbers, e-mail addresses, SSN-like numbers, record, plan, licence and device numbers, URLs, IP addresses and other identifiers in the fields of the profile are masked.
* Dates become `9` digits (`19810322` becomes `99999999`), so a masked date is no longer a date.
* Organisation names and envelope identifiers (sender, receiver, facility, control numbers) are masked as well. The setting `maskAtlas.maskOrganisations` keeps organisation names; the setting `maskAtlas.keepEnvelopeIdentifiers` keeps the envelope identifiers.
* In FHIR JSON, the web address of an identifier's system is masked when it names an organisation (`http://clinic.example/ids/mrn`); the addresses of well-known standards bodies and terminology services (`http://hl7.org/fhir/sid/us-ssn`) stay. Resource ids and links are masked by their shape. A masked bundle is therefore valid JSON but no longer a usable FHIR example.
* Attachment payloads are replaced by `X` characters.

## What the free tier does not do

* **It does not read free text.** A name, a telephone number or an e-mail address that sits in a note, a comment, a narrative text or a text value stays as it is, also when the same value was masked in its field. The sample HL7 message, masked, still shows the family name, a relative's name and a telephone number in its notes. Use the Pro de-identification, which reads free text, or review these fields yourself.
* It does not keep replacements consistent across fields, messages or files in a way that helps a test system: every value of a given shape becomes the same masked text.
* It does not shift dates, process folders, check the result or use rule files. These are [Pro features](pro.md).

## Samples, walkthrough, help

* **Open Sample HL7 Message**, **Open Sample FHIR Bundle** and **Open Sample X12 Claim** open short messages made of invented people, places and numbers in new editors.
* **Open Getting Started Guide** opens the walkthrough of five steps.
* **Show Documentation** opens the project page in your browser (the README, with links to these documentation pages).
* **Report A Problem** copies a diagnostics block (versions, platform, settings, licence state; no message content, no values, no names, no key) and opens the issues page. See [troubleshooting.md](troubleshooting.md).

## Settings that apply to the free features

| Setting | Effect |
| --- | --- |
| `maskAtlas.maxFileSizeMB` | Largest document, in megabytes, that Scan, Preview and Mask work on (20 by default, at most 64). |
| `maskAtlas.keepEnvelopeIdentifiers` | Keep sender, receiver, facility and control identifiers. |
| `maskAtlas.maskOrganisations` | Mask organisation names (on by default). |
| `maskAtlas.markInProblems` | Mark the scanned fields in the Problems panel (on by default). |

When one of the two settings that keep identifiers is on, the notification of **Scan For Identifiers**, **Mask Message In Place** and **Preview Masked Version** says so and names where the setting comes from (your user settings, the workspace or a workspace folder), and the risk report lists it. In a workspace that is not trusted, the values that the workspace sets for these two settings are ignored.

The other settings are described in [pro.md](pro.md).
