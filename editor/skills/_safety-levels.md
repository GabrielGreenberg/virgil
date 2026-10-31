# What a Level-3 proposal withholds — the CHANGE, never the ANCHOR (shared include)

A Task's `safetyLevel` picks how a card-create lands
(`create_card.py` → `apply_response.py`): **1** → silent apply, **2** → apply +
a sibling comment, **3** → propose (the card is drafted, the Task left
`in-progress`, awaiting the user's accept/reject), **none** → direct create.

**Level 3 withholds the proposed CHANGE.** The paper write the card *proposes*
is not made until the user accepts it:

- an atom splice — a footnote's `\vfid…\footnote{}`, a citation's
  `\vcid…\cite{}`;
- a `.bib` rider (the entry a citation would add to `references.bib`);
- a suggestion's replacement text (`original_text` → `suggested_text`, landed
  later by `/editor/accept-suggestion`).

**The ANCHOR is not a proposed change, so it lands at every level** (task
1197; `apply_response.py`, step 5 of the write). A card pinned to a span with
`--range` (Mode B) is anchored by a `\vlid{…}…\vlidend{…}` pair around
that span — and that pair is written into the `.tex` in the same commit as the
card, Level 3 included. A paragraph-anchored card (Mode A) needs no write: its
`%!v:` uuid is already in the file. An answer that INHERITS its source card's
span (task 1230) reuses that pair and writes no new one.

So never tell the user a Level-3 proposal left "the `.tex` untouched". Say what
is true: the card is **drafted and awaiting review — the change is not
applied**. If it was pinned with `--range`, its anchor pair is already in the
`.tex`.

`editor/skills/__tests__/l3-anchor-promise-census.test.ts` pins this: no skill
may claim the `.tex` is untouched on the Level-3 path without citing this file.
