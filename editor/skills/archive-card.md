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
   - **Archiving a flagged card RESOLVES its AI request** (the terminal
     transition alongside answer and delete): if the card had `aiRequest: true`,
     the op closes its open `ai-requests.json` row (flips it terminal) **and**
     lowers the flag on the archived snapshot, so the request stops surfacing in
     `list_requests.py` / `/editor/review` on either leg. A `restore` brings the
     card back **unflagged** — un-archiving does not re-open the request. On an
     unflagged card this is a guarded no-op. See task 2026-07-05-049.

## Applicability (derived from the manifest)

- **Archivable** — the anchored panel cards: `note`, `highlight`, `todo`,
  `report`, `report-request`, `comment`, `cutter-comment`, `cutter-suggestion`,
  `revision-suggestion`.
- **Refused** — `footnote`/`citation` (atom-bearing: the id *is* a `.tex \v*id`
  marker, so archiving would orphan the atom — delete the atom in-document
  instead); `example` (lives in the `.tex`); an already-archived snippet;
  `bib`/`ai`/`error` (system/derived). The op refuses these with a clear reason.

> **Enforcement (task 156).** The panel side of that list lives in
> `apply_response.MUTATION_PANEL_POLICY` — one allow-list table per op, exhaustive
> over the card-store universe, asked by every mutation op. Read it there rather
> than trusting this prose; it is where a refusal is actually enforced.

> **Note (origin record).** To make restore lossless this op adds
> `originalPanel` + the verbatim `originalCard` + `archivedAt` to the snippet.
> Since task 712 these are part of the app's `ArchivedSnippet` contract
> (`src/lib/types.ts`, read through `src/lib/archive-origin.ts`): opening the
> paper keeps them, and the Archive panel's own Restore puts the card back in
> its panel ("Restore to Notes") rather than pasting its body into the prose.
> The app's sidecar loaders carry any key they don't know through a load
> (`src/lib/sidecar-migrate.ts`), so a future extension survives too.

## Reply

```
Done: archive-card <cardId> (<originalPanel> → archive). Output: <originalPanel>.json, archive.json (+ notifications, version). Reversible with /editor/restore-card.
```
