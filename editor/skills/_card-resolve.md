# Resolving a card id — `card_by_id.py` (shared include)

Every card-op skill (accept / reject a suggestion, archive / restore / move /
edit / link a card, revise a flagged footnote) starts by resolving the card id
it was handed:

```bash
python3 editor/scripts/card_by_id.py <docPath> <cardId> [--panel <panel>]
```

It prints `{found, cardId, panel, filename, listKey, archived, cardKind, card}`
(exit 0), or `{found: false, cardId}` (exit 1) when no sidecar holds the id.

**An id resolves to ONE card or the script REFUSES** (task 1112). Two panels
can hold cards sharing an id — a footnote and the citation minted beside it are
the common pair — and an op that silently took the first match would mutate the
wrong card. So a bare call on such an id exits with:

> card id `<id>` is ambiguous — it names N cards: footnotes (…), citations (…).
> Re-run naming the panel (op.panel / --panel <panel>).

Answer it the way it asks, on BOTH halves of the procedure:

- **`--panel <panel>`** — re-run `card_by_id.py` with the panel the Task (or
  the user) actually means: `linkedTo.panel` on a flagged card's request, or the
  panel the user named. Never pick one of the listed panels by guess.
- **`"panel":"<panel>"`** in the op JSON — `update`, `archive`, `restore`,
  `move`, and the `accept` / `reject` proposal ops resolve the card through the
  same `find_card`, so they refuse the same way until told. `link` takes one
  qualifier per end: `"panelA"` / `"panelB"`.

A refusal that names ONE panel twice ("names 2 cards inside `<panel>`") is not
ambiguity — the sidecar holds a duplicate id. `--panel` cannot answer it;
surface it to the user (the sidecar needs repair) rather than mutating.
