# Rule files (Pro)

The built-in profile knows the usual places of identifiers (see [formats.md](formats.md)). Your messages may carry identifiers in other places: a local `Z` segment in HL7, a locally defined `REF` qualifier in X12, an extension in FHIR. A rule file adds those places, changes how a place is treated, or switches a built-in place off.

Rule files are used by the Pro commands that replace values (**De-identify Message**, **De-identify Selected Files**, **De-identify Folder**) and by the verification of their output. **Scan For Identifiers** and **Mask Message In Place** do not use them.

A rule file holds paths and kinds only, never values, so it can be shared with your team.

## Create and use

1. Run **Mask Atlas: Create Rules File (Pro)**. It writes `mask-atlas-rules.json` with four example rules to the first folder of the workspace, sets the setting `maskAtlas.rulesFile` for the workspace to point to it, and opens it. If the file already exists it is only opened. Without an open folder, the template opens as an unsaved document; save it and set `maskAtlas.rulesFile` to its path. The four example rules of the template are active as soon as the setting points to the file (one of them is a `keep` rule), so edit or delete them before your first run.
2. Edit the rules. Files named `mask-atlas-rules.json` or ending in `.mask-rules.json` are checked by the editor against a JSON schema, so you get completion and error marks while you type.
3. Run a Pro command. The report states how many rules were loaded ("Rule file: N rules from the rule file"). If the file has a problem, the command stops before anything is changed and names the problem (see [troubleshooting.md](troubleshooting.md)).

The setting `maskAtlas.rulesFile` takes an absolute path or a path relative to the first workspace folder. The file may be at most 1 MB and hold at most 2,000 rules.

## Grammar

```json
{
  "version": 1,
  "rules": [
    { "format": "hl7",  "path": "ZPD-2",                          "kind": "record" },
    { "format": "hl7",  "path": "Z*-4",                           "kind": "id" },
    { "format": "hl7",  "path": "PV1-3",                          "kind": "keep" },
    { "format": "hl7",  "path": "ZPD-3",                          "kind": "date", "dateFormat": "hl7" },
    { "format": "x12",  "path": "REF[REF01=ZZ]-02",               "kind": "id" },
    { "format": "x12",  "path": "PER-02",                         "kind": "keep" },
    { "format": "fhir", "path": "Patient.extension.valueString",  "kind": "name" },
    { "format": "fhir", "path": "*.address.postalCode",           "kind": "keep" }
  ]
}
```

Each rule has:

| Key | Meaning |
| --- | --- |
| `format` | `hl7`, `x12` or `fhir`. The rule applies only to messages of that format. |
| `path` | Where the value is. At most 200 characters; the grammar for each format is below. |
| `kind` | What the value is, and therefore how it is replaced. One of the kinds in the table below. |
| `dateFormat` | Only for the kind `date`: the layout of the value. One of `hl7` (`YYYYMMDD` with optional time), `iso` (`YYYY-MM-DD` and date-times), `d8` (`CCYYMMDD`), `rd8` (`CCYYMMDD-CCYYMMDD`), `yymmdd`. Default: `hl7` for HL7, `d8` for X12, `iso` for FHIR. |

**The first rule that matches a place wins.** Rules are tried in the order of the file.

### HL7 paths

* `SEG-n` is field n of every segment `SEG` (for example `PID-5`, `ZPD-2`); `SEG-n.m` is component m of that field (`PID-5.2`). Repetitions and subcomponents of the field or component are included. Field numbers follow the usual HL7 numbering, in which the field separator is `MSH-1`.
* `Z*-n` stands for field n of every segment whose name starts with `Z`.
* The segment may be one the profile knows (to change it) or any other three-character segment name (to add it).
* **A rule for a field takes over that whole field.** The built-in handling of a field is switched off as soon as any rule names the field or one of its components, and only the components that a rule names are handled. A rule for the whole field (`PID-5`) takes precedence over rules for its components. So `PID-5.2` with the kind `keep` does **not** keep just the second component: it leaves the whole of `PID-5` (all name components) as it is. To keep one component and still replace the others, write a rule for each of the others, for example `PID-5.1` as `family`, `PID-5.2` as `keep` and `PID-5.3` as `given`.
* An unknown field that a rule names is no longer searched as running text.

### X12 paths

* `SEG-NN` is element NN (two digits) of every segment `SEG`: `NM1-09`, `REF-02`, `PER-02`.
* `SEG[SEGnn=value]-NN` applies the rule only to segments in which element `nn` is exactly `value` (case-sensitive, 1 to 20 letters or digits), for example `NM1[NM101=IL]-09` or `REF[REF01=ZZ]-02`. The segment name in the test must be the segment of the rule.
* For one element, the first rule whose test matches wins; a rule whose test does not match is skipped.
* A built-in place is changed or switched off by naming the same element.

### FHIR paths

* Dotted element names without indexes: `Patient.name.family`, `Patient.contact.name.text`, `Observation.note.text`. A path always starts at a resource, also inside a bundle (`Patient.name.family` matches the patients in a bundle).
* A path that starts with an upper-case resource name or with `*` is **anchored**: it must name the whole path. `*` stands for one element name or one resource name: `*.address.postalCode` is the postal code of an address directly in any resource.
* A path that starts with a lower-case name matches the end of any path: `valueString` matches every `valueString`, `address.city` every `address.city`.
* A rule applies to string values. It is also tried before the built-in handling of the same place, so a rule can switch off or change a built-in treatment.
* At most 12 elements per path.

## Kinds

| Kind | Treated as | Category | Replacement (Pro) |
| --- | --- | --- | --- |
| `keep` | switches the place off | none | the value stays |
| `name` | a full name | Names | each name part replaced; titles and suffixes kept |
| `family` | a family name | Names | an invented family name |
| `given` | a given name | Names | an invented given name |
| `org` | an organisation or place name | Other unique identifiers | an invented name; the type word (`Clinic`, `Services`, ...) is kept (follows `maskAtlas.maskOrganisations`) |
| `street` | a street line | Addresses | invented street name, other digits in the numbers |
| `city` | a town | Addresses | an invented town |
| `zip` | a postal code | Addresses | other digits, same length |
| `address` | a whole address text | Addresses | replaced part by part, parts separated by commas |
| `date` | a date | Dates | moved by the patient's offset (needs `dateFormat` if the layout is not the default) |
| `phone` | a telephone number | Phone and fax numbers | other digits, same layout |
| `email` | an e-mail address | E-mail addresses | an invented address ending in `.example` |
| `ssn` | an SSN-like number | SSN-like numbers | other digits, same layout |
| `url` | a web address | URLs | invented host ending in `.example`, other letters and digits in the path |
| `ip` | an IP address | IP addresses | another valid address |
| `record` | a record or account number | Medical record and account numbers | letter for letter, digit for digit |
| `plan` | a plan or certificate number | Plan and certificate numbers | the same |
| `licence` | a licence number | Licence numbers | the same |
| `device` | a device or vehicle identifier | Vehicle and device identifiers | the same |
| `id` | any other identifier | Other unique identifiers | the same |
| `free-text` | running text | (by what is found in it) | searched for names, numbers and patterns as described in [pro.md](pro.md) |
| `binary` | an attachment payload | Biometric and photo references | filler of the same length |

Dates that cannot be read in the given layout are replaced like identifiers, letter for letter and digit for digit.

## Examples

Local segment with a staff number and a free-text remark (HL7):

```json
{ "version": 1, "rules": [
  { "format": "hl7", "path": "ZPD-2", "kind": "record" },
  { "format": "hl7", "path": "ZPD-4", "kind": "free-text" }
] }
```

`ZPD|1|STAFF-77421|20260101|BX-77-1` then has its second field replaced as a record number (`STAFF-77421` becomes a value of the same shape such as `WHTTR-08422`). All fields of a segment that starts with `Z` are already searched as running text, so `free-text` is needed only for other segments.

A locally defined reference qualifier (X12):

```json
{ "version": 1, "rules": [ { "format": "x12", "path": "REF[REF01=ZZ]-02", "kind": "id" } ] }
```

An extension that holds a name (FHIR):

```json
{ "version": 1, "rules": [ { "format": "fhir", "path": "Patient.extension.valueString", "kind": "name" } ] }
```

A value you want to stay, so that a test system can still find it (FHIR):

```json
{ "version": 1, "rules": [ { "format": "fhir", "path": "Patient.address.city", "kind": "keep" } ] }
```

A `keep` rule leaves the value in the output on purpose. The verification uses the same rules, so a kept place is not reported as an unreplaced field; but a kept value that the run also replaced somewhere else can be reported as a replaced value that is still present. Remember that you decided to keep it.

**Kinds that change only digits.** The kinds `phone`, `ssn` and `ip` change the digits of a value and keep its letters. On a value with words, such as a street line, the words stay: `12 OAK ST` becomes `37 OAK ST`. The verification looks for this in the values that a rule of your rule file turned into a replacement: a run of two or more letters (between any two characters that are not letters, so `FERN-LANE` and `ST.MARYS` count as two words each) that the replacement shares with its original is not accepted as a replacement, and the remaining words are reported as a field that holds a value the run did not create (FAIL). A single letter is not looked for, and the check only knows the values that the run recorded, so it is a safety net and not a guarantee: do not use these kinds for address lines. Use `street` or `address`. A `phone` rule on an HL7 telephone field that holds words, such as the use and equipment codes of `^PRN^PH^^1^503^5550144`, is reported as a failure of the verification every time, because those codes stay; this errs on the safe side. Use the kind `phone` only on the number component.

**Rules that leave places are named in every report.** Besides `keep`, a rule of the kind `free-text` or `binary` on a place that the built-in profile replaces, and a rule for one component of an HL7 field, leave values in the output (the value is only read as free text, or the other components are not handled). The report of a run lists the rule file (how many rules, how many of them `keep` a place and how many can take a field over) and a table of the places that the rules left, with the number of fields; when a rule left a place that the built-in profile would have replaced, the verdict reads "PASS, with weakened settings" instead of "PASS". The setting `maskAtlas.rulesFile` is restricted for untrusted workspaces: in a workspace that you have not trusted, a rule file named by the workspace is ignored. A relative path points into the first workspace folder, so such a file counts as the workspace's even when your user settings name it, and it is not read at all in a workspace that is not trusted (use an absolute path in your user settings for a file of your own). In a trusted workspace, a Pro run whose rule file has `keep`, `free-text`, `binary` or single-component rules and comes from the workspace (named by the workspace settings, or by a relative path) asks for a confirmation that names the setting before it starts.

## Tips

* Start from a scan: the report lists the paths that are recognised. Whatever you know to hold an identifier and is not in that list is a candidate for a rule.
* After adding rules, run the Pro command on a small sample and read the result and the report.
* Rules cannot find a value that has no place: a name written once in a note is not helped by a rule unless you know the field that holds the note.
