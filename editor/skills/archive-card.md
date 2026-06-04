---
description: |
  Archive an existing card in a Virgil paper — move it from its panel sidecar to
  archive.json, preserving its origin so /editor/restore-card can put it back
  exactly. Triggers on: "archive this card", "stash this note", "put this todo in
  the archive", "set this aside", or as the mechanical step behind clearing a
  panel. Resolves the card via card_by_id.py, then routes an `archive` op (a
  cross-sidecar move, atomic + pen-protected). Applies to anchored panel cards
  (note/highlight/todo/report/report-request/comment/cutter-/revision-cards);
  refuses atom-bearing cards (footnote/citation) and system kinds. Does NOT delete
  the card (it's reversible via /editor/restore-card) and does NOT remove the
  underlying .tex text. Args: <docPath> <cardId>.
---

# /editor/archive-card $ARGUMENTS

Move an **existing** card into the Archive panel (EDITOR_SKILLS_V1 §10). One of
the five existing-card ops; it resolves the card with
[`card_by_id.py`](../scripts/card_by_id.py) and routes the cross-sidecar move
through [`apply_response.py`](../scripts/apply_response.py) — the removal from the
source panel **and** the append to `archive.json` land **atomically under the
pen**, with the audit notification + version bump. Fully reversible by
[`restore-card`](restore-card.md).

## Args

- `<docPath>` — the paper folder.
- `<cardId>` — the id of the card to archive.

## Procedure

1. **Resolve the card** (confirm it's archivable — an anchored panel card, not
   atom-bearing):
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId>
   ```
2. **Run the `archive` op:**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> archive '{"cardId":"<cardId>"}'
   ```
   It removes the card from its panel sidecar and writes an `ArchivedSnippet` to
   `archive.json` carrying the standard fields (`title`, `content`, `links`)
   **plus** `originalPanel` and the verbatim `originalCard` — the origin record
   `restore-card` reads for a lossless return. Prints `{ok, version,
   op:"archive", cardId, originalPanel}`.

## Applicability (derived from the manifest)

- **Archivable** — the anchored panel cards: `note`, `highlight`, `todo`,
  `report`, `report-request`, `comment`, `cutter-comment`, `cutter-suggestion`,
  `revision-suggestion`.
- **Refused** — `footnote`/`citation` (atom-bearing: the id *is* a `.tex \v*id`
  marker, so archiving would orphan the atom — delete the atom in-document
  instead); `example` (lives in the `.tex`); an already-archived snippet;
  `bib`/`ai`/`error` (system/derived). The op refuses these with a clear reason.

> **Note (manifest extension, flagged).** `archive.json`'s documented
> `ArchivedSnippet` has no field for *where a card came from*. To make restore
> lossless this op adds `originalPanel` + `originalCard` to the snippet — a
> deliberate, forward-compatible extension (extra fields the Archive panel
> ignores). See the chip report / `apply_response.cmd_archive`.

## Reply

```
Done: archive-card <cardId> (<originalPanel> → archive). Output: <originalPanel>.json, archive.json (+ notifications, version). Reversible with /editor/restore-card.
```
