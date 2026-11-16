# Verification (Pro)

After a Pro run, Mask Atlas reads the output again and checks it against the run that made it. The result is PASS, PASS with weakened settings, or FAIL. A PASS means that three specific checks found nothing. It does not prove that the output is free of identifiers, and it is not a certificate of any kind; read the limits on this page and in the report.

## When it runs

* **De-identify Message**: the new document is checked before the notification appears.
* **De-identify Folder** and **De-identify Selected Files**: the copies are **read back from disk** (not taken from memory) and checked; the notification and the report show the result.
* **Mask Atlas: Verify De-identified Output (Pro)** checks again on request, against the last run, which is kept in memory for one hour: either the output folder of the last file or folder run, or the document in the active editor. You can open a single output file in the editor and verify it alone.

There is no verification for the free masking; the free tier has no run to compare with.

## The three checks

1. **A replaced value is still in the output.** The run knows every value it replaced. The output is read word by word and number by number, and a hit is counted when something the run replaced is still there: a name part of four or more letters, the first word of an organisation name (six or more letters), a word of seven or more letters from an address, a host name of five or more letters, an identifier or e-mail address of five or more characters, a telephone or SSN-like number of seven or more digits. Values that the run itself wrote as replacements are not counted, and common words that are also names, organisation type words and title words are left out. Short values are not looked for.
2. **A pattern that this run did not create.** An e-mail address, SSN-like number, telephone number or IP address in the output that is not one of the run's replacements. Dates and web addresses are not part of this check.
3. **A field of the profile that holds an unreplaced value.** The output is read again with the same profile and the same rule file as the run, and every recognised field (and, when `maskAtlas.scanFreeText` is on, every free-text hit) whose value is not one of the run's replacements is counted. Dates, attachment payloads and coordinates are not part of this check. A place that a rule of the rule file switches off is not counted (the same check is run once more with the rule file switched off, and the places it finds there are listed as kept by your rules), and neither are the control numbers of X12 interchanges (`ISA13`, `IEA02`, `GS06`, `GE02`, `ST02`, `SE02`), their counts (`IEA01`, `GE01`, `SE01`) and the version numbers of the standard (`ISA12`, `GS08`, `ST03`), which the run keeps by design; the report counts both.

## PASS and FAIL

**PASS** means all three counts are zero and the check was complete. **FAIL** means at least one finding, or an incomplete check.

**PASS, with weakened settings** is a pass in a run in which a setting or a rule left places as they are: envelope identifiers kept, organisation names kept, dates kept, free text not read, or a rule of your rule file (`keep`, `free-text`, `binary`, or for one component of an HL7 field) that left places the built-in profile would have replaced. The check does not count what these leave, so the label says that the pass covers only what the run replaced, and the notification and the report list the settings and the number of fields that the rules kept. A pass of a run with every setting at its default is a plain PASS. With `maskAtlas.scanFreeText` off the notes are not read, so a name that the run replaced in a field and that is still in a note is found by the first check: that run ends in FAIL, which is what it should do.

A check is **incomplete** when the run replaced more distinct values than are kept for it (more than 1,500,000), or when an output file is larger than 64 MB (it is not read, and it is counted as a file with findings).

The report (opened with **Show Report**) shows the result, the number of files checked and how many had findings, the count for each of the three checks and a table of **where the findings are**: the file (for a folder run), the number of the message or interchange in the file, the element (an HL7 field such as `PID-3.1`, an X12 element such as `NM1-09`, a FHIR path such as `Patient.name.family`; for a note or comment the place of the note), the kind of the value, the check that found it and how often (the first 40 places; the counts above cover all of them). A report never prints a value: it names a place and a kind, so you can open the file at that message and element and read the value yourself. Fix the cause (often a rule file entry, see [rules.md](rules.md)) and run again.

As a plain check of the checker: verifying the unchanged sample HL7 message against a run that replaced it reports FAIL, with 28 replaced values still present, 7 patterns that the run did not create and 38 unreplaced fields.

## False alarms

The first check compares strings and digits, so a FAIL can be a coincidence. In tests with invented data (every message names a different patient), a 50 MB HL7 file of 89,946 messages and a 50 MB NDJSON file of 61,550 resources were de-identified and checked in one run each, and the check reported no finding; a 50 MB X12 file of 79,156 interchanges was checked too. Its control numbers (`ISA13` and `IEA02`), which the run keeps by design, can equal the digits of a replaced SSN-like number of another claim: they are not counted as findings, and the report shows how many such places there were ("kept on purpose"). The same holds for the version numbers of the standard (`ISA12` is `00501`, which is also a real postal code that a patient record can hold). The findings of smaller runs that were traced were coincidences of two kinds:

* a value that the run kept by design (an interchange control number, a shifted date) equals the digits of a replaced SSN-like or account number of another record (the X12 case above);
* a value that the run wrote as a replacement happens to be equal to the original of another value (a replacement patient reference equal to the original reference of another patient). The check never counts a word that the run wrote itself, wherever it appears in the output, so that a replacement is not reported as a left-over: the original that equals it is then also not found by the first check where it stays (see the blind spot below).

Such coincidences become more likely the more distinct values a run replaces and the shorter and more uniform their shapes are. Look at the report and at the output before you decide that a FAIL is a false alarm, and treat it as a finding until you have.

## What the verification cannot see

* The check only knows the values that this run replaced and the shapes and fields that Mask Atlas recognises.
* A word that the run itself wrote as a replacement is never counted as a left-over, anywhere in the output. When a replacement happens to equal an original value of another record (for example the replacement of one family name is the real family name of a later patient), that original is not found by the first check in a place where it stays, for example in a note; the third check still reads the fields of the profile. The chance grows with the number of distinct values in a run.
* A name, address or number that was never in a recognised field, was not seen elsewhere in the same message and has no recognisable shape cannot be found by the check or by the de-identification.
* Text inside pictures, scanned documents and encoded attachments is not read.
* File names and folder names are not changed and not checked. The report lists file names that contain a replaced value, but it cannot see every case.
* Combinations of harmless-looking details (rare diagnoses, small places, exact ages) can still point to a person; review the output yourself.
* Values that a rule file keeps are, by your decision, left in the output; with `maskAtlas.scanFreeText` off, notes and comments are left as they are. The report lists both, and the verdict says "with weakened settings".
* Check digits (for example of provider numbers) are not recomputed.

See [coverage.md](coverage.md) for what was measured.

## After a FAIL

1. Open the report and read the table of where the findings are.
2. Look at those places in the output files. Replace the cause: add a rule for a place the profile does not know, remove a `keep` rule, turn `maskAtlas.scanFreeText` on.
3. Run again. Replacements are not kept between runs unless you set a seed, so the new output differs from the old one.
4. Whatever the result, read the output before it leaves your hands.
