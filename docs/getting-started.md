# Getting started with Mask Atlas

Mask Atlas hides names, addresses, dates and identifiers in HL7 v2, FHIR JSON and X12 healthcare messages, so that a test message can go into a ticket, a vendor chat or a test system with a lower risk of pointing to a person. It is a helper, not a guarantee: you remain responsible for reading the result before it is shared. Nothing in this documentation is legal advice.

## Install

Install **Mask Atlas** (publisher Small Steps Studio) from the Extensions view (`Ctrl+Shift+X`). It is built for VS Code 1.82 or newer. It is plain JavaScript with no native parts.

## Which messages

* **HL7 v2**: a message or a batch. Recognised by its first characters (`MSH`, `FHS` or `BHS` followed by the field separator), whatever the file extension. A text of loose segments without a header (`PID|...` on several lines) is read with the default delimiters.
* **FHIR JSON**: one resource, a bundle, an array of resources, or NDJSON (one resource per line). Recognised by a `resourceType` in the first 64 KB.
* **X12**: healthcare interchanges (claims, remittances, eligibility, enrolment, authorisations, status). Recognised by a well-formed `ISA` segment.

The editor context menu offers a **Mask Atlas** submenu for files with the extensions `.hl7`, `.json`, `.ndjson`, `.x12`, `.edi`, `.837`, `.835`, `.834`, `.270`, `.271`, `.276`, `.277`, `.278`, `.txt` and `.dat`. The commands in the Command Palette (`Ctrl+Shift+P`, type "Mask Atlas") work on the active editor whatever its file name. Details of what is read in each format: [formats.md](formats.md).

## First steps

1. Run **Mask Atlas: Open Sample HL7 Message** (or the FHIR or X12 sample). The samples contain invented people and places only. You can also open one of your own test messages; use invented or already masked data in anything you share.
2. Run **Mask Atlas: Scan For Identifiers**. A report opens beside the message: the number of fields per category, the element path of each, and the shape of the first value of each path with letters as `X` and digits as `9`. The report never shows a value. The same fields are marked in the Problems panel.
3. Run **Mask Atlas: Preview Masked Version**. The original and the masked text open side by side; nothing is changed yet.
4. Run **Mask Atlas: Mask Message In Place**. The text of the editor is replaced by the masked text. The file on disk is not touched until you save; `Ctrl+Z` undoes it.
5. Run **Mask Atlas: De-identify Message (Pro)** to see the realistic version: invented names, streets, towns and e-mail addresses, numbers that keep their shape, dates moved by one offset per patient, notes and comments read for names and numbers. The first Pro command starts the free 14-day trial on this computer (no key, no account, no network). The copy opens in a new, unsaved editor and the report says whether the verification passed.
6. **Help > Welcome > Get started with Mask Atlas** (or **Mask Atlas: Open Getting Started Guide**) walks through the same steps with buttons.

## Reading the result

Always read the output before it leaves your hands. The report of every run ends with a list of limits: what the profile does not know, what free text can hide, and what the verification cannot see. A name written once in a note, a number in a field of an unknown segment and a rare combination of harmless details are the typical remains. [coverage.md](coverage.md) lists them, with the numbers that were measured.

## Where things go

* Scan, Preview and Mask work on the text in the editor. Size limit: setting `maskAtlas.maxFileSizeMB` (20 MB by default, at most 64).
* De-identify Message opens a new editor; your original is not changed.
* De-identify Folder and De-identify Selected Files write copies to a new folder next to the source folder (`<name>-masked`, or `<name>-masked-2` if that exists) and read the copies back to verify them. Large files are read in pieces from disk.

## More

* [Formats](formats.md)
* [Free features](free-tier.md)
* [Pro features](pro.md)
* [Rule files](rules.md)
* [Verification](verification.md)
* [Coverage and limits](coverage.md)
* [The 14 categories](categories.md)
* [Licence, trial and Pro](licence.md)
* [Troubleshooting](troubleshooting.md)
