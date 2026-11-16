# Changelog

## 0.1.0

First release. The free features need no key, no account and no network connection. The Pro features can be tried free for 14 days and are then unlocked with a one-time licence key sold outside the Marketplace.

Formats:

* HL7 v2 messages and batches (field, component and subcomponent delimiters are read from each message), FHIR JSON (single resources, bundles, arrays of resources and NDJSON, data types recognised by their shape) and X12 interchanges (ISA fixed widths kept, delimiters read from the ISA segment, several interchanges in one file).
* The structure of a message is never changed: segment order, counts, delimiters, line endings, indentation and numbers that are not identifiers stay as they were.

Free:

* Scan For Identifiers: an identifier risk report with counts in 14 categories, element paths and the shape of the first value (letters as X, digits as 9, never a value), and marks in the Problems panel (setting `maskAtlas.markInProblems`).
* Preview Masked Version: the original and the masked text side by side before anything is changed.
* Mask Message In Place: letters become X and digits become 9, every value keeps its length; undo with Ctrl+Z.
* Open Sample HL7 Message, Open Sample FHIR Bundle and Open Sample X12 Claim (invented data), a five-step walkthrough, Show Documentation and Report A Problem (diagnostics without message content, names or key).
* Settings for the editor size limit, envelope identifiers, organisation names, date order and the Problems marks.

Pro (14-day trial, then a licence key):

* De-identify Message, De-identify Selected Files and De-identify Folder: invented names, streets, towns, organisations and e-mail addresses; numbers that keep their shape and length; replacements that are the same everywhere in a run and, for names, streets, towns, organisations, hosts and e-mail addresses, never the same for two different originals; FHIR references and links kept intact.
* Keyed pseudonyms: a 256-bit key from the system's random source for each run, or from a seed you set with Set Pseudonym Seed (kept in the editor's secret storage; Clear Pseudonym Seed removes it).
* Dates moved per patient by one offset of 60 to 730 days, so that order and intervals stay (setting `maskAtlas.shiftDates`).
* Free-text scanning of notes, comments and narrative for names and numbers seen elsewhere in the message and for e-mail addresses, telephone numbers, SSN-like numbers, IP addresses, dates and labelled numbers (setting `maskAtlas.scanFreeText`).
* Large files read in pieces from disk; folder runs write copies to a new folder, never touch the originals, and list every file that was left unchanged, skipped or could not be processed.
* Verify De-identified Output: the output is read again and checked in three ways (replaced values still present, foreign patterns, fields of the profile that hold an unreplaced value); a finding is reported with its place (file, message or interchange, element and kind, never the value); the verdict says "PASS, with weakened settings" when settings or rules (of any kind: keep, free-text, binary, a single component of an HL7 field) left places as they are, found by reading the output once more with the rule file switched off (a rule of the kind phone, ssn or ip on a value with words, such as a street line, keeps the words: the verification reports words of two or more letters that such a rule left, but you should use street or address for address lines); the report states what the check cannot see.
* Rule files (JSON, with a schema for the editor) to add paths, change their kind or switch built-in paths off, created with Create Rules File.
* A place in a report, in the verification result and in the Problems panel is a segment and element number of HL7 or X12, or names of the FHIR standard (anything else is shown as "(other element)"); it never holds text of a message. HL7 lines without a segment name are read like a note.
* Settings that keep identifiers or switch off a protection are restricted in a workspace that is not trusted, a workspace that weakens a run is named in a confirmation, and every run report lists the settings and rules that differ from the defaults and where they come from.
* The engine runs in a worker thread: long runs do not freeze the editor, show progress with a cancel button and can be stopped at any time.
* Export Pseudonym Map (only on request, after a warning, as CSV with formula neutralisation) and Forget Last Run.
