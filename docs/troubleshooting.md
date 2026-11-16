# Troubleshooting

Messages of Mask Atlas start with "Mask Atlas:". Where a message is quoted below, it is quoted in part. A message never contains a value from your messages.

## The text is not recognised

**"The text is not recognised as an HL7 v2 message, a FHIR JSON resource or bundle, or an X12 interchange. Nothing was changed."** The active editor does not look like one of the three formats. Check that:

* HL7 starts with `MSH`, `FHS` or `BHS` followed by the field separator (a byte order mark, blank space or an MLLP start byte before it is fine), or is a run of segments such as `PID|...` on several lines;
* X12 starts with an `ISA` segment of exactly 106 characters in which every element has its fixed width (a sender or receiver id that is not padded to 15 characters makes the interchange unrecognisable);
* FHIR JSON starts with `{` or `[` and holds `"resourceType": "<Name>"` within its first 64 KB. A JSON file without `resourceType` (a support ticket exported as JSON, for example) is not FHIR and is left alone.

In a folder run, a file like this is listed as "skipped: format not recognised".

**"The JSON has no resourceType; it is not a FHIR resource or bundle."** The name `resourceType` appears near the start, but not at the top level of the document.

## Invalid JSON

**"The JSON is not valid (line 5 column 57: expected a key). Fix the file first; nothing was changed."** The reader is strict: trailing commas, comments, single quotes and unquoted keys are errors. The line and column are those of the first problem. In an NDJSON file the number of the line in the file comes first ("line 3, line 1 column 57"), because each line is its own document. In a folder run the file is listed as an error and nothing is written for it.

## The document is larger than the limit

**"The document is larger than the limit of 20 MB set for the editor commands."** The editor commands (Scan, Preview, Mask, De-identify Message) work on text held in the editor and stop above the setting `maskAtlas.maxFileSizeMB` (20 by default, at most 64). Raise it, or use **De-identify Folder** or **De-identify Selected Files** (Pro), which read files from disk in pieces and have no such limit.

## Another run is still working

**"Another run is still working. Wait for it to finish, or cancel it, and try again."** One command works at a time. Cancel the progress notification of the first one, or wait for it.

## Cancelled runs

Cancelling a run stops it at once. Nothing is kept of an unfinished run except the files that a folder run had already written; they are not a complete or verified result, and the report is not made. The engine of the extension is stopped with it, so the runs that it held are gone too, including the last run that was kept for **Verify De-identified Output** and **Export Pseudonym Map**; run again for a new one.

## The run used too much memory

**"The run needed more memory than the editor allows for it."** The run (it works in a worker with a memory limit of 3 GB) replaced a very large number of distinct values or read a very large JSON document. Split the input, or de-identify fewer files at a time.

## Nothing to do

* **"No field of the built-in profile was found, so nothing was masked."** (also "...so there is nothing to preview") The message holds no field of the profile. It may still hold identifiers in free text or in places the profile does not know; read it, and consider a [rule file](rules.md).
* **"Nothing was recognised as an identifier, so no copy was made."** The same for De-identify Message.
* **"The editor refused the change (is the file read-only?)."** Make the file writable or use De-identify Message, which opens a new editor.
* **"Open an HL7 v2, FHIR JSON or X12 file first."** No editor is active.

## Rule file problems

A rule file problem stops the Pro command before anything is changed. The message names the setting and, for the content, the first five problems, each with the number of the rule:

* "The setting "maskAtlas.rulesFile" is a relative path but no folder is open." Open a folder or use an absolute path.
* "The rule file named in "maskAtlas.rulesFile" could not be read." The path is wrong or the file cannot be read.
* "The rule file is larger than 1 MB." or "..is not valid JSON." or "...must be a JSON object with "version" and "rules"."
* ""version" must be 1." and ""rules" must be a list." and ""rules" may hold at most 2000 rules."
* "Rule N: must be an object." / ""format" must be hl7, x12 or fhir." / ""path" must be a text of at most 200 characters." / ""kind" must be one of keep, name, family, ..." / ""dateFormat" must be one of hl7, iso, d8, rd8, yymmdd."
* "Rule N: the HL7 path must look like PID-5, PID-5.2 or Z*-3." / "the X12 path must look like NM1-09 or NM1[NM101=IL]-09." / "the element test must name the same segment (for example NM1[NM101=IL]-09)." / "the FHIR path must be dotted element names such as Patient.contact.name.text or *.note.text."

The grammar is in [rules.md](rules.md). The editor checks files named `mask-atlas-rules.json` or `*.mask-rules.json` against a schema while you type.

## Files left unchanged

In a folder or file run the report lists every file with a result:

* **de-identified copy written**: the copy is in the target folder.
* **unchanged: nothing recognised, NOT written**: the file is a message, but no field of the profile held an identifier, so no copy was made. This is deliberate: a copy of an untouched file in the target folder would look like a de-identified one. Look at the file yourself, or add a rule.
* **skipped: format not recognised**: not an HL7, FHIR JSON or X12 file (an image, a text file, a manifest).
* **error**: invalid JSON, a single FHIR JSON document larger than 40 MB ("Split it, or export it as NDJSON"), or a file that could not be read. Nothing is written for it.

The summary line says how many of each there were ("3 files had nothing recognised and were NOT written").

**The run was cancelled.** "Files already written stay in "<name>-masked"; they are not a complete or verified result." Delete the folder and run again, or run again into a new folder (the next free name `-masked-2` is used).

**A file `name.part-<number>` is left next to an output.** The editor was closed or crashed while the file was being written. Delete it.

**A file name contains a name.** File names and folder names are not changed. The report warns about file names that contain a value that was replaced inside the files. Rename the files before you share them.

## Verification FAIL

Read the report ("Show Report"): it gives the count for each of the three checks and the element paths of the third. The first two checks report counts only, because a report never prints a value. See [verification.md](verification.md) for how to find the cause, for false alarms and for what a PASS does not mean.

* **"The check is incomplete because the run replaced more distinct values than are kept for it."** More than 1,500,000 distinct values were replaced in one run. Split the work into several runs.
* A file larger than 64 MB is not read by the verification and counts as a file with findings.

**"there is no run to verify against"** / **"there is no run to export"**. The result of a run is kept in memory for one hour and is removed by **Forget Last Run** and when the window closes. Run the de-identification again.

## Large files

* A file run reads about 1 MB at a time, so memory use depends on the size of one message and of the list of replaced values, not on the size of the file. Measurements are in [pro.md](pro.md).
* Speed depends on the processor and the number of distinct values. A file of 50 MB with about 90,000 HL7 messages took about 80 seconds to de-identify and 20 seconds to verify in the measurement in [pro.md](pro.md). The progress notification of a folder run shows the file number; it can be cancelled.
* A single FHIR JSON document is read whole and needs memory in proportion to its size. Use NDJSON (one resource per line) for large FHIR exports.
* If the editor becomes slow when you open a very large message, use the folder commands instead of the editor commands.

## Encodings and line endings

File runs read UTF-8. A file with a UTF-16 byte order mark is read as UTF-16 and written back as UTF-16 with its mark; UTF-16 text without a byte order mark is refused with a message that says so (nothing is written for it), and has to be saved as UTF-8 or with a mark first. Any other file that is not valid UTF-8 is read as Latin-1 and written back the same way. A byte order mark is kept. Line endings (carriage return, line feed or both) are kept. If a value looks wrong after the run, check the encoding of the source file.

## Replacements

* **A name looks odd.** Names are built from syllables, not taken from a list of real names; that is intended.
* **Each run gives different replacements.** Without a seed, every run uses a new random key. Set a seed with **Set Pseudonym Seed (Pro)** to repeat replacements across runs. "Use at least 12 characters; a short seed can be guessed."
* **The same value got different replacements in two files.** They were processed in different runs. Use one run (a folder, or a selection of files) or a seed. Dates of one patient match across files only when the files share an identifier (see [pro.md](pro.md)).
* **A date is not valid after masking.** The free mask turns digits into `9`. Use the Pro de-identification, which keeps dates valid.

## Licence messages

**A Pro command shows the Pro message although you have a key.** Run **Mask Atlas: Show Licence Status**; it names the state and offers **Enter Licence Key** and **Lost your key?**. See [licence.md](licence.md).

## Other messages

**"the command could not be completed. If this keeps happening, run "Mask Atlas: Report A Problem"."** A command failed for a reason that is not described by a more specific message. No stack trace and no message content is shown.

**"cancelled. Nothing was kept of the unfinished run except the files already written."** You cancelled a command.

## Reporting a problem without sending patient data

Run **Mask Atlas: Report A Problem**. It copies a diagnostics block to the clipboard (versions, platform, the format and size of the active document, your settings, whether a seed is saved, the licence state; no message content, no values, no names or paths, no key) and opens the issues page of the project: <https://github.com/small-steps-studio/mask-atlas/issues>. Issues are public.

* Never attach or paste a real message. Make a small example from invented data that shows the same problem: keep the segment names, field positions or element names, and replace every value.
* Describe the format (HL7 v2 version, X12 transaction set, FHIR resource type), what you did, what you expected and what happened. If a field was missed, name its path (for example `PV1-8.2` or `Patient.extension.valueString`) instead of quoting its value.
* Never post a licence key or a pseudonym seed.
