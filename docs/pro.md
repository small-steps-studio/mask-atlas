# Pro features

Pro is unlocked by the free 14-day trial (it starts with your first Pro command) or by a one-time licence key; see [licence.md](licence.md). Pro replaces identifiers with invented, realistic values instead of masking them, reads free text, works on files and folders, checks the result and takes rule files. Like the free features, it is a helper, not a guarantee: you remain responsible for reading the output before it is shared.

## De-identify Message

**Mask Atlas: De-identify Message (Pro)** de-identifies the message in the active editor and opens the result in a new, unsaved editor beside it. Your original is not changed. The result is read again and checked (see [verification.md](verification.md)); a notification gives the number of replaced fields, the verification result and a **Show Report** button. If nothing in the message is recognised as an identifier, no copy is made and the command says so.

## De-identify Selected Files and De-identify Folder

**Mask Atlas: De-identify Folder (Pro)** (also in the Explorer menu of a folder) and **Mask Atlas: De-identify Selected Files (Pro)** (Explorer menu of files, or a file picker) process files on disk:

* After a confirmation, de-identified copies are written to a new folder next to the source folder: `<name>-masked`, or `<name>-masked-2`, `-3`, ... if that name exists. Your originals are never changed. Relative paths are kept; two files that would get the same name get a counter.
* Every file below the folder is read; folders named `node_modules`, `.git`, `.hg` and `.svn` and symbolic links are skipped. A run reads at most 50,000 files; split larger folders.
* A file that is not HL7, FHIR JSON or X12 is **skipped** and listed in the report. A file in which nothing is recognised as an identifier is **not copied** and is listed as "unchanged: nothing recognised, NOT written", so that a missing copy is never mistaken for a de-identified one. A file that cannot be processed (for example invalid JSON, with the line and column of the problem) is listed as an error and nothing is written for it.
* Large files are read in pieces of about 1 MB that end at message boundaries, so memory does not grow with the file (see "Large files" below). Each output file is written to a temporary file and moved into place only when the whole file was processed. The run shows a progress notification and can be cancelled; files already written stay in the target folder and are not a complete result.
* When the run is finished, the written copies are **read back from disk** and verified. The report lists every file with its format, its result and the number of replaced fields, warns about file names that contain a value that was replaced inside the files (file names are not changed), and ends with the limits of the check.
* Everything in one run shares one registry: the same patient, name, number or address gets the same replacement in the HL7, FHIR and X12 files of that run, and no two different names, streets, towns, organisations, hosts or e-mail addresses share a replacement.

The size limit `maskAtlas.maxFileSizeMB` applies to the editor commands only. A single FHIR JSON document is read whole (limit 40 MB, about 25 times its size in memory); use NDJSON for very large FHIR exports.

## How the pseudonyms are made

* **The key.** Every run has a 256-bit key. Without a seed it comes from the operating system's random source and is not stored: a later run gives different replacements. With a seed (**Mask Atlas: Set Pseudonym Seed (Pro)**) the key is derived from the seed with scrypt, so the same seed gives the same replacements for the same values in later runs. All invented values, the number replacements and the date offsets are computed from the key with HMAC-SHA256; no general-purpose pseudo-random number function is used.
* **The seed.** A passphrase of at least 12 characters, entered in a masked input box and kept in the editor's secret storage. It is never shown or logged. **Mask Atlas: Clear Pseudonym Seed** deletes it. Treat it like a password: anyone who knows it can recompute the replacements of values they can guess.
* **Consistent and different.** Within a run, the same original always becomes the same replacement (names compare without regard to capitalisation), and two different originals never share one replacement when they are names, streets, towns, organisations, hosts or e-mail addresses, whatever their kind (a family name and a town do not end up with the same invented word). They are kept in one registry that tries the next candidate when a replacement is already taken; numbers and identifiers are replaced by a keyed one-to-one mapping of their shape (digit for digit, upper case for upper case, lower case for lower case, punctuation and length kept), which cannot produce the same output for two inputs. With a seed, a later run repeats the replacements, except that when two different names would collide in one run the second one gets the next candidate, which depends on the order in which values are met.
* **Dates.** The dates of a patient move by one offset of 60 to 730 days, earlier or later, taken from the key and the patient's identifiers (SSN-like number first, then record number, then family name). Order, intervals and the time of day stay; a date range moves at both ends by the same offset. A resource, an interchange or a message takes the offset of the patient it concerns. To give the same patient the same offset in different files, the files need an identifier in common. Setting: `maskAtlas.shiftDates` (on by default; off keeps dates as they are).
* **Free text.** Notes, comments, narrative and text values are read for: names, streets, towns, organisations, telephone numbers and identifiers that were seen in a recognised field of the same message or document (whole words, any capitalisation, with the same replacement as in the field); a name after a title word (`Dr`, `Mrs`, `Nurse`, ...) or after a relation word (`wife`, `daughter`, `neighbour`, `patient`, ...); e-mail addresses, web addresses, IP addresses, SSN-like numbers and telephone numbers; dates written as `2026-11-04`, `11/04/2026`, `4.11.2026` or `2026/11/04` (setting `maskAtlas.dateOrder` decides month first or day first for the slash form); and identifiers after a label such as `member`, `policy`, `account`, `mrn`, `ssn`, `npi`, `claim`, `serial number`. Setting: `maskAtlas.scanFreeText` (on by default). What free text hides that no rule can see is listed in [coverage.md](coverage.md).
* **FHIR links.** Resource ids, `fullUrl` values and references are replaced by the same function, so references keep pointing to the same resource: in the 26 FHIR sample documents used for the coverage measurement, the 59 references that resolved before the run (of 107) still resolved afterwards, and none was lost or created.
* **Envelope and routing identifiers.** Sender, receiver and facility names, application names, assigning authorities, message and batch control numbers and the X12 interchange sender and receiver ids are replaced as well, so that the first line of a message does not name who sent it. The setting `maskAtlas.keepEnvelopeIdentifiers` keeps them. Organisation names follow the setting `maskAtlas.maskOrganisations`.
* **Structure.** Delimiters never appear in a replacement, the fixed widths of the X12 `ISA` segment are kept, and counts and control numbers are untouched, so the output has the same structure as the input.

How each of the [14 categories](categories.md) is replaced is described there.

## Verify De-identified Output

**Mask Atlas: Verify De-identified Output (Pro)** checks an output against the run that made it, in three ways, and says PASS or FAIL. It works on the output folder of the last folder or file run, or on the document in the active editor. The run is kept in memory for one hour. Details and limits: [verification.md](verification.md).

## Pseudonym map and forgetting a run

* The key, the replaced values and the date offsets of the last Pro run (**De-identify Message**, **De-identify Selected Files** or **De-identify Folder**) are kept in memory for at most one hour, for verification and for the map export. **Mask Atlas: Forget Last Run** removes them at once; they are also gone when the editor window closes. Nothing is stored on disk.
* **Mask Atlas: Export Pseudonym Map (Pro)** writes the map to a CSV file (UTF-8 with a byte order mark; columns `category`, `original`, `replacement`; one row per replaced value, plus one row per patient with the date offset, whose "original" is an internal identifier of the patient). It asks for confirmation first, because **anyone who gets this file can undo the de-identification of the run**: it holds the original values. Save it only on a protected disk and never send it with the data. The setting `maskAtlas.export.neutraliseFormulas` (on by default) puts an apostrophe before every cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return, so that a spreadsheet shows it as text; turn it off only if you need the exact values and open the file in a program that does not run formulas. A run that replaced more than 1,500,000 distinct values holds an incomplete map; the export and the verification then say so.

## Rule files

**Mask Atlas: Create Rules File (Pro)** and the setting `maskAtlas.rulesFile` add paths to the built-in profile, change their kind or switch them off. See [rules.md](rules.md).

## Settings used by Pro runs

| Setting | Default | Effect |
| --- | --- | --- |
| `maskAtlas.keepEnvelopeIdentifiers` | off | Keep sender, receiver, facility, application and control identifiers. |
| `maskAtlas.maskOrganisations` | on | Replace organisation names. |
| `maskAtlas.shiftDates` | on | Move the dates of a patient by one offset; off keeps dates. |
| `maskAtlas.dateOrder` | `mdy` | Reading of `04/09/2026` in free text: `mdy` or `dmy`. Dates with a dot are always day first. |
| `maskAtlas.scanFreeText` | on | Read free text. When off, notes, comments and narrative are not read at all: a name or number that appears only there stays, the report says "found and NOT read" and the number of such fields, and a name that the run replaced in a field and that is still in a note makes the verification FAIL. |
| `maskAtlas.rulesFile` | empty | Path of a rule file, absolute or relative to the first workspace folder. |
| `maskAtlas.export.neutraliseFormulas` | on | Formula neutralisation in the map CSV. |

## Workspace settings, rule files and Restricted Mode

A workspace can carry settings and a rule file of its own (a `.vscode/settings.json`, a `.code-workspace` file, a rule file in the folder). Six settings keep identifiers or switch off a protection: `keepEnvelopeIdentifiers` on, `maskOrganisations`, `shiftDates`, `scanFreeText` off, and a `rulesFile` with rules that can leave places as they are: `keep` rules, rules of the kinds `free-text` and `binary`, and rules for a single component of an HL7 field (a rule for a field takes that field over from the built-in profile). A seventh setting, `export.neutraliseFormulas` off, concerns only the CSV of the pseudonym map and is named where the map is exported. For the six:

* **Restricted Mode.** They are declared restricted for workspaces that are not trusted: in a workspace that you have not trusted, the values that the workspace sets are ignored and only your own user settings (or the defaults) apply.
* **A confirmation.** In a trusted workspace, a Pro run in which one of them comes from the workspace or a workspace folder (not from your user settings) asks for a confirmation first, naming each setting and its effect. A folder run names them in its confirmation of the target folder; De-identify Message asks once before it starts. Declining runs nothing.
* **The notification and the report.** Every Pro run lists the settings and rules that differ from the defaults, where each one is set (user, workspace, workspace folder), the number of fields that rules left as they are (the verification reads the output once more with the rule file switched off and counts what the built-in profile would have replaced) and the places they left. The verdict reads "PASS, with weakened settings" when a setting or a rule left places as they are. The free commands name the two settings that apply to them (`keepEnvelopeIdentifiers`, `maskOrganisations`) in their notification.

## Working in the background

The engine runs in a worker thread of the extension, not in the extension host, so a long run does not freeze the editor or the other extensions. A notification with a **Cancel** button shows while a large text or a folder is processed; cancelling stops the worker at once. What it holds is gone with it, including the last run that was kept for verification and the map. Only one run works at a time; a second command during a run says so and does nothing. A worker that runs out of memory (its limit is 3 GB) is stopped and the command says so.

## Large files

Files are processed in pieces, so the memory use of a file run depends on the size of one message and on the registry of replaced values (every distinct value of a run is kept in memory), not on the size of the file. The measurements below were made on 2026-11-15 on a laptop (11th generation Intel Core i5 with 4 cores, 40 GB of memory, Windows 11, Node.js 24) while other programs were running, with the worker that runs the engine limited to a 1 GB heap (in the extension the limit is 3 GB), on invented data in which every message names a different patient, which is the hardest case for the registry. "Peak heap in use" is the largest heap size seen during the run; with the 1 GB limit every run finished. The repository holds the test that makes them (`MASK_ATLAS_LARGE=50 node --test test/large.test.js`). While each run worked, a timer on the extension's own thread measured the longest time that thread did not answer: 28 to 53 milliseconds in all four runs.

| File | Size | Messages, interchanges or resources | Fields replaced | Time to de-identify | Time to verify from disk | Peak heap in use | Verification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| HL7 v2, one message per patient | 50 MB | 89,946 | 2,788,326 | 80 s | 20 s | 843 MB | PASS |
| X12 837, one interchange per claim | 50 MB | 79,156 | 1,978,900 | 81 s | 14 s | 555 MB | PASS |
| FHIR NDJSON, a Patient and an Observation per patient | 50 MB | 61,550 | 861,700 | 51 s | 12 s | 479 MB | PASS |
| FHIR bundle in one JSON file | 30 MB | n/a | 504,000 | 29 s | 9 s | 661 MB | PASS |

What the table shows and does not show:

* In the X12 run the verification reported a few places as "kept on purpose" (6 in one run): the control numbers of the interchanges, which the run keeps by design, equal the digits of a replaced SSN-like number of another claim. They are not findings; the report shows their number. See [False alarms](verification.md#false-alarms). The verdict of a run depends on the random pseudonyms of that run only through such coincidences.
* A batch in one interchange or one bundle takes time in proportion to its size (a test compares 1,000 and 3,000 claim loops in one interchange); the table also holds a 30 MB bundle. A single FHIR JSON document needs about 25 times its size in memory (a 25 MB bundle peaked at 618 MB of heap) and is limited to 40 MB; use NDJSON beyond that.
* The editor commands (Scan, Mask Message In Place, Preview, De-identify Message, Verify) also run in the worker, so the editor stays usable and a notification with a **Cancel** button shows for a large text. On 5 MB of HL7 the measured times were 0.7 s for Scan, 1.1 s for Mask Message In Place and 12 s for De-identify Message with its verification; on 5 MB of X12 0.3 s, 0.5 s and 12 s. The longest time that the extension's own thread did not answer during these runs was 55 milliseconds.
* With a rule file, the verification reads each output twice (once with the rules and once without them, to find the places that the rules left), so it takes longer: on 6 MB of HL7 it took 4.4 s without a rule file and 6.2 s with one. The table above was measured without a rule file.
* Times depend on the processor, the disk, the messages and the number of distinct values. A run that replaces a very large number of distinct values keeps them in memory (up to 1,500,000, beyond which the map and the verification are marked incomplete).
