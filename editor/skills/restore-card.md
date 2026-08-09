---
description: |
  Restore an archived card in a Virgil paper — move it back from archive.json to
  the panel it came from, exactly as it was. Triggers on: "restore this card",
  "unarchive this note", "bring back the todo I stashed", "undo that archive", or
  as the inverse of /editor/archive-card. Resolves the snippet via card_by_id.py,
  reads the originalPanel + originalCard that archive-card preserved, then routes
  a `restore` op (a cross-sidecar move, atomic + pen-protected). Refuses a native
  archive snippet (one not created by /editor/archive-card, so it carries no
  recorded origin). Does NOT trigger for archiving (use /editor/archive-card).
  Args: <docPath> <cardId>.
---

# /editor/restore-card $ARGUMENTS

Move an **archived** card back to its home panel (EDITOR_SKILLS_V1 §10) — the
inverse of [`archive-card`](archive-card.md). It resolves the snippet with
[`card_by_id.py`](../scripts/card_by_id.py) and routes the move through
[`apply_response.py`](../scripts/apply_response.py) — the removal from
`archive.json` **and** the re-append to the original panel land **atomically
under the pen**, with the audit notification + version bump.

## Args

- `<docPath>` — the paper folder.
- `<cardId>` — the id of the archived snippet to restore.

## Procedure

1. **Resolve the snippet** (confirm it's archived and has a recorded origin):
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId>
   ```
   Expect `archived:true`. (The snippet must carry `originalPanel` +
   `originalCard` — present only on snippets that `archive-card` wrote.)
2. **Run the `restore` op:**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> restore '{"cardId":"<cardId>"}'
   ```
   It removes the snippet from `archive.json` and re-appends the verbatim
   `originalCard` to its `originalPanel`. Prints `{ok, version, op:"restore",
   cardId, panel}`.

## Applicability

- **Restorable** — any snippet that `archive-card` created (it carries
  `originalPanel` + `originalCard`).
- **Refused** — a **native** archive snippet (user-cut text archived in the app,
  not via this skill): it has no recorded origin, so the op refuses rather than
  guess a destination. Restore it by hand if intended. A card that isn't in
  `archive.json` at all is refused by the shared panel policy below, which names
  the panel it actually lives in.

> **Enforcement (task 156).** `archive` is this op's only legal source panel, and
> that is declared — not re-derived — in `apply_response.MUTATION_PANEL_POLICY`:
> one allow-list table per op, exhaustive over the card-store universe, asked by
> every mutation op.

## Reply

```
Done: restore-card <cardId> (archive → <panel>). Output: archive.json, <panel>.json (+ notifications, version).
```
