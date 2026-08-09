---
description: |
  Link two existing cards in a Virgil paper with a bidirectional relationship
  record. Triggers on: "link these two cards", "relate this note to that todo",
  "connect this comment to the report", "mark this footnote as evidence for that
  note", or as the mechanical step behind cross-referencing cards. Resolves both
  cards via card_by_id.py, then routes a `link` op that adds a reciprocal record
  to each card's `relatedCards` field (atomic + pen-protected). Works for any
  pair of cards in a writeback panel — footnotes included, since the relationship
  lives in a dedicated field, not the anchor `links` array. REFUSES a store that
  would not keep the record: an archived snippet, an example, or a citation
  (whose anchored entry the app rebuilds from its `.tex` atom on doc open).
  Restore an archived card first. Does
  NOT anchor a card to text (use /editor/move-card) and does NOT create cards.
  Args: <docPath> <cardAId> <cardBId> [--kind <relationship>].
---

# /editor/link-cards $ARGUMENTS

Add a **bidirectional** relationship between two existing cards
(EDITOR_SKILLS_V1 §10). One of the five existing-card ops; it resolves both cards
with [`card_by_id.py`](../scripts/card_by_id.py) and routes the change through
[`apply_response.py`](../scripts/apply_response.py) — the reciprocal record on
**both** cards' sidecars lands **atomically under the pen** (so the two-card edit
is all-or-nothing), with the audit notification + version bump.

## Args

- `<docPath>` — the paper folder.
- `<cardAId>` `<cardBId>` — the two card ids to link (must differ).
- `--kind <relationship>` — the relationship label (default `related`); e.g.
  `followup`, `evidence`, `contradicts`, `seealso`. Stored on both records.

## Procedure

1. **Resolve both cards** (confirm they exist; note their kinds):
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardAId>
   python3 editor/scripts/card_by_id.py <docPath> <cardBId>
   ```
2. **Run the `link` op:**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> link \
     '{"cardAId":"<a>","cardBId":"<b>","kind":"related"}'
   ```
   It appends a record `{ id, kind, target:{type:"card", ref:{kind,id}},
   createdAt }` to **each** card's `relatedCards`, pointing at the other (so the
   link is addressable from either end). Idempotent — re-linking the same pair +
   kind adds nothing. Prints `{ok, version, op:"link", cardAId, cardBId, kind}`.

## Applicability

- **Any two cards in a writeback panel** can be linked — `footnote` included. The
  relationship is stored in `relatedCards`, a **separate** field from the
  card→text anchor `links`, so it doesn't violate the "atom-linked cards have no
  `links`" rule and needs nothing from the `.tex`.
- **Refused** — linking a card to itself; an unresolvable id; and any store that
  would not **keep** the record (task 156), since `relatedCards` is a field the
  app never wrote and so has no obligation to preserve:
  - a **`citation`** — `useCitations.syncFromEditor` rebuilds every *anchored*
    citation from its `.tex` atom on doc open (`id`/`command`/`keys`/`createdAt`
    only, carrying forward just the unanchored refs), so the record would be gone
    on the next open while the other card kept its half. Its footnote twin
    *merges*, which is why footnotes are fine — the split is survivability, not
    atom-bearingness. Link the citation's anchoring paragraph cards instead.
  - an **`archive.json` snippet** — dropped when
    [`restore-card`](restore-card.md) re-appends the verbatim `originalCard`.
    Restore it first, then link.
  - an **`example`** — `examples.json` is the app's `\ex`-derived projection, not
    a writeback target, and a row lives only as long as its block.

> **Note (manifest gap, flagged).** The manifest defines **no** card↔card
> relationship field — `links: Link[]` is strictly the card→TextObject anchor (a
> rigid union the browser validates), and atom-linked cards carry no `links` at
> all. So this op introduces a dedicated **`relatedCards`** field, reusing the
> `Link` vocabulary minus the text anchor. It is a **forward-compatible** record:
> persisted and round-tripped, but **no browser renderer reads it yet** (like
> `OriginalAnchor`). See the chip report / `apply_response.cmd_link`.

## Reply

```
Done: link-cards <cardAId> ↔ <cardBId> (<kind>). Output: <A panel>.json, <B panel>.json (+ notifications, version).
```
