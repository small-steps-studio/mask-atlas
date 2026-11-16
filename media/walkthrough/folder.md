## Folders, verification and limits

**De-identify Folder (Pro)** (also in the Explorer context menu) reads every recognised HL7, FHIR and X12 file below a folder and writes de-identified copies to a new folder next to it. Large files are read in pieces, so memory use does not grow with the file.

* A file in which nothing is recognised is **not copied**; the report lists it, so that nothing is mistaken for de-identified.
* The copies are read back from disk and checked against the run. The report ends with the limits of the check.
* The same patient gets the same replacement in the HL7, FHIR and X12 files of one run. With **Set Pseudonym Seed (Pro)** the replacements are also the same in a later run.
* The pseudonym map (original next to replacement) exists only in memory. **Export Pseudonym Map (Pro)** writes it only when you ask, after a warning.

Read the documentation for what is and is not covered, and always review the output yourself.
