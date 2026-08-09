---
description: |
  Re-anchor an existing card in a Virgil paper to a different paragraph. Triggers
  on: "move this card to paragraph X", "re-anchor this note", "this comment
  belongs on the next paragraph", "point this todo at §3", or as the mechanical
  re-anchor step behind a reorganization. Resolves the card via card_by_id.py,
  validates the new anchor exists in the .tex, then routes a `move` op that
  rewrites the card's Mode-A paragraph anchor (links[*].anchor.textObjectIds),
  atomic + pen-protected. Handles paragraph-anchored (Mode-A) cards only;
  DEFERS + flags atom-bearing cards (footnote/citation — re-anchoring means
  moving the .tex marker) and Mode-B text-range anchors. Does NOT move the
  underlying text. Args: <docPath> <cardId> <newAnchor>.
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

## Procedure

1. **Resolve the card** (confirm it's a movable Mode-A card):
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId>
   ```
2. **Run the `move` op:**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> move \
     '{"cardId":"<cardId>","newAnchor":"<uuid>"}'
   ```
   It validates the anchor against the `.tex`, sets the card's
   `anchor.textObjectIds` to `[<uuid>]` (Mode-A paragraph anchor), and commits.
   Prints `{ok, version, op:"move", cardId, newAnchor, anchorsMoved}`.

## Applicability (derived from the manifest)

- **Movable (Mode-A paragraph anchor)** — `note`, `todo`, `report`,
  `report-request`, `comment`, `cutter-comment`, and the suggestion cards, when
  anchored to a paragraph.
- **Deferred + flagged** —
  - **`footnote` / `citation`** (atom-bearing): the card's tie is **id equality**
    with its `.tex \v*id` marker, and "the paragraph anchor **follows** the Atom"
    ([anchoring.md](../../docs/workspace/anchoring.md)). Re-anchoring means moving
    the `\vfid…\footnote{}` / `\vcid…\cite{}` characters in the `.tex` — an atom
    move, not a sidecar edit. The op **refuses** and points you at the in-document
    move. (v1 scope: anchor-only cards first.)
  - **Mode-B (text-range) anchors** (`targetKind: "linkedRange"`): re-anchoring a
    range needs a fresh `linkedAnchor` mark in the `.tex` — deferred; the op
    refuses.

> **Enforcement (task 156).** The panel side of that list lives in
> `apply_response.MUTATION_PANEL_POLICY` — one allow-list table per op, exhaustive
> over the card-store universe, asked by every mutation op. (The Mode-B deferral
> is an anchor-shape check inside `cmd_move`, not a panel question.)

## Reply

```
Done: move-card <cardId> → %!v:<newAnchor> (<cardKind>). Output: <panel>.json (+ notifications, version).
```
