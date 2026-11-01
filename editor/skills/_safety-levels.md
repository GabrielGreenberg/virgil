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

## Where the level does NOT apply

`safetyLevel` gates exactly one thing: an ANCHORED card-create. Two paths sit
outside it, and a skill on either must not promise a proposal:

- **An `--unanchored` create is always direct**, whatever the level
  (`create_card.py`, the subcommand pick). It touches no prose — the user's own
  drag places it, and that drag is its review — and a Level-3 proposal would
  withhold its `.bib` rider, leaving a card that cites a key the bibliography
  never received. So `/editor/find-citation` (which always creates unanchored)
  lands its citation card and its `references.bib` entry together at every
  level; the `.bib` rider in the withheld list above is withheld only for an
  ANCHORED citation create.
- **An in-place revision (`update`) is not gated by the level; it applies.**
  Revising an existing card — `/editor/draft-footnote` E3 rewriting a flagged
  footnote, `/editor/edit-card` — completes the Task `auto-applied` at every
  level. No proposal card kind exists for an edit to an existing footnote or
  note (a revision-suggestion proposes a change to PROSE, `original_text` →
  `suggested_text`), so there is nothing a Level-3 update could draft instead.
  If the user wants to review a rewrite first, that is a suggestion, not an
  update — route it to `/editor/draft-suggestion`.

## Citing this file

State the level mapping here, once. A skill that needs it says "the subcommand
is picked from the Task's `safetyLevel` — see [_safety-levels.md](_safety-levels.md)"
rather than re-listing what Level 3 does, because every re-listing drifts (it
was a re-listing that said a Level-3 footnote "splices the `.tex`").

`editor/skills/__tests__/l3-anchor-promise-census.test.ts` pins this: no skill
may claim the `.tex` is untouched on the Level-3 path, and no skill may restate
the level mapping (`3 → propose`), without citing this file in the same
paragraph.
