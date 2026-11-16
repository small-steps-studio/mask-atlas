## See which fields can point to a person

**Scan For Identifiers** reads the message in the active editor and opens a report next to it.

* The fields are counted by **category**: names, addresses, dates, phone and fax numbers, e-mail addresses, SSN-like numbers, medical record and account numbers, plan and certificate numbers, licence numbers, vehicle and device identifiers, URLs, IP addresses, biometric and photo references, and other unique identifiers.
* Every element path (for example `PID-5.1` or `Patient.name.family`) is listed with its count and the **shape** of its first value, with letters shown as X and digits as 9. The report never shows a value.
* The same fields are marked in the **Problems** panel (HL7 and X12 per line, JSON as a summary at the top). A mark names the category and the path, never the value.

The free scan checks the fields of the built-in profile. It does not read free text; with the trial or a licence it also reads notes and comments. It is a helper, not a guarantee: read the message yourself before it leaves your hands.
