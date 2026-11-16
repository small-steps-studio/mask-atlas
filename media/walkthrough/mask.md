## Preview and mask

**Preview Masked Version** opens the original and the masked text side by side, so you can see what would change before you change anything.

**Mask Message In Place** replaces the text of the editor (the file on disk is not touched until you save, and Ctrl+Z undoes it):

* letters become `X` and digits become `9`; punctuation, spaces and delimiters stay,
* every value keeps its length, so fixed-width fields (the X12 `ISA` segment) and segment counts stay valid,
* the structure of the message does not change.

Masked values are not realistic. When a test system needs believable names, addresses and dates that stay consistent across messages, use the Pro de-identification in the next step.
