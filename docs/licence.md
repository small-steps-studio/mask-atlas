# Licence, trial and Pro

## Free

Everything that is not marked "(Pro)" is free, for personal and commercial use, with no key, no account and no network connection: Scan For Identifiers, Preview Masked Version, Mask Message In Place, the samples, the walkthrough, Show Documentation, Report A Problem, Forget Last Run, Clear Pseudonym Seed and the licence commands. Free features will not be moved behind the key later. See [free-tier.md](free-tier.md).

## Trial

The first Pro command you run starts a free 14-day trial of every Pro feature on this computer. The Pro commands are De-identify Message, De-identify Selected Files, De-identify Folder, Verify De-identified Output, Export Pseudonym Map, Set Pseudonym Seed and Create Rules File. The trial is recorded only in the editor's storage on this computer (start time, last use, last reminder and, once it has ended, its end); nothing is sent anywhere and no key or account is needed. **Mask Atlas: Show Licence Status** shows the days left; a reminder appears at most once a day. When the trial ends, the free features keep working and the next Pro command offers **Buy Pro** and **Enter Licence Key**.

While the trial runs (or with a licence), **Scan For Identifiers** also reads free text. The scan itself never starts the trial.

The trial counts by the clock of the computer, which Mask Atlas cannot check. A clock that is set back after the trial was used, by any amount, costs no day: the trial keeps the time it had used. A Pro command that runs while the clock is ahead counts that time: a clock 15 days ahead once ends the trial for good, and an ended trial stays ended when the clock is corrected. A trial record that was edited to start in the future ends the trial.

## Pro licences

| Licence | Price (one-time) | For | Keys and computers |
| --- | --- | --- | --- |
| Pro Personal | USD 29 | one person who pays for it; use at work is allowed | one key, up to 3 computers of that person |
| Pro Business | USD 59 per user | companies and other organisations | one key per user (a purchase for N users gives N keys), each for up to 3 computers |

Prices are those at the time of writing; the checkout page shows the final price and any taxes for your country before you pay. Pro is a one-time purchase, not a subscription; keys do not expire and cover every update published as Mask Atlas. Pro is sold outside the Visual Studio Marketplace.

**Mask Atlas: Buy Pro** asks which licence you want; for Business it asks "How many users? (1-100)" and opens the checkout for that number of keys. Payments, invoices and refunds are handled by Dodo Payments, the merchant of record; tick "Purchasing as a business" at the checkout to add a company name and tax ID to the invoice.

## Activating a key

1. The key arrives by e-mail from the payment provider right after the purchase.
2. Run **Mask Atlas: Enter Licence Key** and paste it.
3. The key is checked once with the licence service and stored in the editor's secret storage (the operating system's credential store where available).

Entering the key that is already active on this computer again does not use another activation: the service is asked whether it is valid, and that is all. Entering a different key replaces the stored one; the activation of the old key is given back as soon as the new key is accepted, so the old key does not stay in use on this computer.

What can go wrong, and what the message says:

| Message | Meaning and next step |
| --- | --- |
| not recognised | The key is unknown. Copy it again from the e-mail. |
| already active on the maximum number of computers | All 3 activations are used. Run **Remove Licence From This Machine** on one of them. |
| not active | The key exists but is disabled, expired or refunded. |
| belongs to another product | The key is for a different product. The activation made for the check is given back; if the service cannot confirm that, the message says so and you can contact support. |
| did not say which product | The service's answer was incomplete. The activation made for the check is given back; try again in a few minutes. |
| could not be reached | No connection to `live.dodopayments.com` (check proxy and firewall). |
| could not be saved in the secret storage | No credential store is available (on Linux: start GNOME Keyring or KWallet). The activation made for the check is given back; if the service cannot confirm that, the message says so. |

## Offline use

A valid key is checked with the licence service at most once every 24 hours, when a Pro feature is used. If the service cannot be reached, the last successful check keeps Pro working for a **14-day grace period**; **Show Licence Status** says until when. After the grace period without a successful check, the Pro features are off until you are online again (the key stays stored). A key that the service has answered with "not valid" does not come back through the grace period. Without a key the extension makes no network request at all, and the free features, the trial and every operation on your messages work offline.

## What is stored, and what is never stored

* The key is kept in the editor's secret storage. Only its last four characters are shown (in the status message). The key is **never written to a log** and is not part of the **Report A Problem** block.
* The activation id, the product id (which tells Personal from Business) and the times of the last checks are kept in the editor's extension storage.
* The customer details in the licence service's answer (name, e-mail address) are never stored or shown.
* The service receives the key, the text `VS Code on <platform>` and, later, the activation id. Nothing from your messages or files. See [PRIVACY.md](../PRIVACY.md).

## Removing a licence

**Mask Atlas: Remove Licence From This Machine** asks for confirmation, gives the activation back to the service (when it can be reached), and deletes the key and the activation data from this computer. The trial record stays, so the trial is not started again. If the service cannot be reached, the licence is still removed locally; the message then says that the activation may still count against the limit of 3.

## Moving a key

Run **Remove Licence From This Machine** on the old computer (this frees one activation), then **Enter Licence Key** on the new one. A Business key can be passed on to a colleague the same way. If the old computer is gone, open an issue and ask for help with your licence (never post the key itself).

## Lost key

Search the mailbox you used at checkout, including spam, for "Dodo Payments" or "Mask Atlas". Your purchases are also listed in the payment provider's customer portal.
