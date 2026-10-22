---
description: |
  Re-anchor an existing card in a Virgil paper to a different paragraph. Triggers
  on: "move this card to paragraph X", "re-anchor this note", "this comment
  belongs on the next paragraph", "point this todo at §3", or as the mechanical
  re-anchor step behind a reorganization. Resolves the card via card_by_id.py,
  validates the new anchor exists in the .tex, then routes a `move` op that
  rewrites the card's anchor (links[*].anchor), atomic + pen-protected — to a
  paragraph (Mode A), or, with a range, to a span of words in it (Mode B: the
  \vlid pair in the .tex moves with it). DEFERS + flags atom-bearing cards
  (footnote/citation — re-anchoring means moving the .tex marker). Does NOT move
  the underlying text. Args: <docPath> <cardId> <newAnchor> [<range>].
---

# /editor/move-card $ARGUMENTS

Re-anchor an **existing** card to a new paragraph (EDITOR_SKILLS_V1 §10). One of
the five existing-card ops; it resolves the card with
[`card_by_id.py`](../scripts/card_by_id.py) and routes the re-anchor through
[`apply_response.py`](../scripts/apply_response.py) — the sidecar anchor edit
lands **atomically under the pen**, with the audit notification + version bump.
The card's anchor is a **property of the card** ([anchoring.md](../../docs/workspace/anchoring.md));
moving it rewrites `links[*].anchor.textObjectIds`, never the document text.

## Args

- `<docPath>` — the paper folder.
- `<cardId>` — the id of the card to re-anchor.
- `<newAnchor>` — the **paragraph `%!v:` UUID** to anchor at. It must already
  exist in the `.tex` (the op refuses an unknown anchor rather than guess). If
  you only have a selection or a heading, resolve its paragraph uuid first with
  `get_para_context.py` / `cards_for_paragraph.py`.
- `<range>` (optional) — words **verbatim from that paragraph's `.tex`** to pin
  the card to instead of the whole paragraph (as `newRange`, plus
  `rangeOccurrence: N` when the words repeat). Same rule of thumb and refusals
  as `create-card --range` ([create-card.md](create-card.md)).

## Procedure

1. **Resolve the card** (confirm it's a movable Mode-A card):
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId> [--panel <panel>]
   ```
   An id shared across panels REFUSES as ambiguous — re-run with `--panel <panel>`
   and carry `"panel"` in the op ([_card-resolve.md](_card-resolve.md)).
2. **Run the `move` op:**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> move \
     '{"cardId":"<cardId>","newAnchor":"<uuid>"}'
   ```
   It validates the anchor against the `.tex`, sets the card's
   `anchor.textObjectIds` to `[<uuid>]` (Mode-A paragraph anchor), and commits.
   To pin it to words in that paragraph, put the op in a scratch file
   ([_op-json.md](_op-json.md)) with `"newRange": "<verbatim words>"`. A card
   that was pinned to a span loses its old `\vlid` pair in the same commit
   (range → paragraph, or range → new range, keeping its range id) — unless
   another card still stands on that span (an answer inherits its source
   card's range id), when the pair stays for it and a range → range move
   wraps the new span under a fresh id.
   Prints `{ok, version, op:"move", cardId, newAnchor, anchorsMoved[, rangeId]}`.

## Applicability (derived from the manifest)

- **Movable** — `note`, `todo`, `report`, `report-request`, `comment`,
  `cutter-comment`, and the suggestion cards, whether anchored to a paragraph
  (Mode A) or to a span of text (Mode B, `targetKind: "linkedRange"`), and
  to either.
- **Deferred + flagged** —
  - **`footnote` / `citation`** (atom-bearing): the card's tie is **id equality**
    with its `.tex \v*id` marker, and "the paragraph anchor **follows** the Atom"
    ([anchoring.md](../../docs/workspace/anchoring.md)). Re-anchoring means moving
    the `\vfid…\footnote{}` / `\vcid…\cite{}` characters in the `.tex` — an atom
    move, not a sidecar edit. The op **refuses** and points you at the in-document
    move. (v1 scope: anchor-only cards first.)
  - **Dormant links** (`archivedWith` set — "archived with its text", task 1193):
    the link's text sits in an archive snippet and returns when it is restored.
    The op skips them, and refuses a card whose links are all dormant.

> **Enforcement (task 156).** The panel side of that list lives in
> `apply_response.MUTATION_PANEL_POLICY` — one allow-list table per op, exhaustive
> over the card-store universe, asked by every mutation op. (The Mode-B range
> move is an anchor-shape branch inside `cmd_move`, not a panel question.)

## Reply

```
Done: move-card <cardId> → %!v:<newAnchor> (<cardKind>). Output: <panel>.json (+ notifications, version).
```
