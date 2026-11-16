# Privacy

Last updated: 2026-11-15 (Mask Atlas 0.1.0)

Mask Atlas works on your computer. This page states exactly what the extension stores and what it sends over the network, which is very little. Your messages never leave the computer.

## What stays on your computer

* **Your messages and files.** Reading, scanning, masking, de-identification, verification and the rule files are performed locally, in the editor's extension process (in a worker thread that the extension starts, so that long runs do not freeze the editor), and nothing about them is sent anywhere. In a remote window (SSH, container, WSL) the extension runs on the remote machine, so the messages are processed there.
* **Reports and marks.** A report holds counts, element paths, the shape of a value (letters shown as `X`, digits as `9`) and file names. It never holds a value from a message. The marks in the Problems panel name a category and an element path, never a value. Reports open as unsaved documents; they are written to disk only if you save them.
* **The result of a Pro run.** The key of the run, the list of replaced values and the date offsets are kept in memory only, for at most one hour after a De-identify command, so that **Verify De-identified Output** and **Export Pseudonym Map** can use them. **Forget Last Run** removes them at once, and they are gone when the editor window closes. Nothing is written to disk, to the extension's storage or to a log.
* **The pseudonym map.** It is written to a file only when you run **Export Pseudonym Map** and confirm the warning. That file lists every original value next to its replacement. It is yours to protect; the extension keeps no copy and does not record where you saved it.
* **The pseudonym seed.** Only if you run **Set Pseudonym Seed**: it is kept in the editor's secret storage (the credential store of your operating system where available). It is never shown, never written to a log and never sent anywhere. **Clear Pseudonym Seed** deletes it. Without a seed, each run uses a new random 256-bit key from the operating system's random source, and the key is not stored.
* **The copies you create.** De-identified copies are written to a new folder next to the source folder, and the editor commands open their result in an unsaved editor. While a file is being written, a temporary file with the extension `.part-<number>` exists next to the target and is removed when the file is finished or when the run is cancelled. Your originals are not changed.
* **The free 14-day trial of the Pro features.** Its start time, the time it was last used, the time of the last reminder and, once it has ended, its end are kept in the editor's extension storage on this computer. Nothing about the trial is sent anywhere, not even to the payment provider, and it needs no account.
* There is **no telemetry**, no usage statistics, no crash reporting and no advertising. The extension writes a line to its output channel only if one of its parts fails to start; that line never contains message content. The editor's own settings, including its own telemetry setting, are separate and are not controlled by this extension.

## The one network request: the licence check (Pro only)

The optional Pro tier is unlocked with a licence key. After you enter a key (**Mask Atlas: Enter Licence Key**), the extension talks to the licence service of the payment provider, Dodo Payments, at `live.dodopayments.com`. It uses only the provider's public licence endpoints, to activate, validate and deactivate a key.

Each request contains:

* the **licence key**, and
* for activation, the text **`VS Code on <platform>`**, for example `VS Code on Windows`, `VS Code on macOS` or `VS Code on Linux`. This label lets you tell your activations apart. It never contains your computer's name, your user name, your files or anything else about you or your machine.
* for validation and deactivation, the activation id that the service returned when you activated the key.

Nothing from your messages, files, folders, reports, rule files or settings is part of a request. As with any internet request, the service sees your IP address.

Who receives it, where it goes and how long it is kept:

* The recipient is Dodo Payments, the payment provider and merchant of record that sells the licence key. The data is sent to its servers at `live.dodopayments.com` and to nobody else. The author of the extension does not run a server and receives none of it.
* The provider may process data in several countries. How long it keeps data, and under which legal basis, is set out in its own privacy policy: <https://dodopayments.com/legal/privacy-policy>.
* The answer to an activation names the product the key belongs to (the extension keeps that product id to know which licence it is) and contains customer details of the purchase; the extension never stores or shows those customer details.
* The data is **not anonymous**. A licence key belongs to a purchase and therefore to the buyer's record at the payment provider. The platform label contains no personal data.
* No data from these requests is used for advertising, analytics or profiling by the extension.

When it happens:

* **Never without a key.** If you have not entered a licence key, the extension makes no network request. The free features, the trial and every operation on your messages work entirely offline.
* On activation (when you enter the key).
* On validation: a successful validation is remembered for 24 hours; the extension asks again at the next Pro feature use after that. If the service cannot be reached, the last successful validation keeps Pro working for 14 days.
* On deactivation (**Mask Atlas: Remove Licence From This Machine**), and when a key of another product is entered or a key cannot be stored (the activation made for the check is given back; if that request fails, the message says so). Entering the key that is already active on this computer only asks the service whether it is valid and uses no further activation.
* **Show Licence Status** asks the service right away when a key is stored.

## What is stored locally for the licence

* The licence key, in the editor's secret storage (your operating system's credential store where available). Only the last four characters of a key are ever shown, in the status message. The key is not written to a log and is not part of the **Report A Problem** block.
* The activation id, the product id, the time of the last check and the time of the last successful validation, in the editor's extension storage.
* The trial record (start, last use, last reminder and, once the trial has ended, its end), in the editor's extension storage.

**Remove Licence From This Machine** deletes the key and the activation data and frees the activation. The trial record is kept, so that the trial is not started again.

## Report A Problem

**Mask Atlas: Report A Problem** copies a short diagnostics block to your clipboard and opens the public issues page in your browser. The block contains the extension and editor versions, the operating system with its release and architecture, the Node.js version of the editor, the format and the size (in characters) of the active document, your Mask Atlas settings (the rule file setting appears only as "set" or "not set"), whether a pseudonym seed is saved, whether the result of a run is held in memory, and the licence state (Free, Trial or Pro). It never contains message content, values, file names, paths, the seed, the licence key, user names or computer names. Nothing is sent until you paste it into an issue yourself. Please do not attach real patient data to an issue.

## Buying

The **Buy Pro** command opens the payment provider's checkout page in your browser. Payment details are entered on that page and handled by the payment provider; the extension never sees them. Their privacy policy applies to the purchase.

## Questions

Open an issue at <https://github.com/small-steps-studio/mask-atlas/issues>. Please do not include real patient data or confidential information in a report.
