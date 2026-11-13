---
description: |
  Dismiss a drafted revision/cutter suggestion in a Virgil paper — the
  "reject" half of the propose→review→apply loop (safety level 3).
  Triggers on: "reject this suggestion", "dismiss the proposed revision",
  "no, don't make that change", "decline this rewrite", "drop the cut",
  or as the mechanical dismissal step when the user turns down a pending
  suggestion card. Resolves the card via card_by_id.py, then routes a
  `reject` op: flip the card status → rejected + complete the originating
  Task (result=rejected), with the .tex UNTOUCHED, in one atomic
  pen-protected commit. Handles revision-suggestion AND cutter-suggestion.
  Does NOT trigger for applying a suggestion (use /editor/accept-suggestion),
  drafting one (use /editor/draft-suggestion), or archiving an arbitrary
  card (use /editor/archive-card). Editing a suggestion's OTHER fields
  (suggested_text / user_text / explanation) is /editor/edit-card's — but the
  `status` transition is NOT: it is this skill's, and edit-card refuses it by
  name. Args: <docPath> <cardId>.
---

# /editor/reject-suggestion $ARGUMENTS

Dismiss a **Level-3 proposal**. The mirror of
[`accept-suggestion`](accept-suggestion.md): where accept splices the proposal
into the document, reject turns it down — the `.tex` is **never touched** (a
`--range` card's `\vlid` pair, placed when it was drafted, stays where it is —
[_safety-levels.md](_safety-levels.md)).

Like the other existing-card ops it resolves the card with
[`card_by_id.py`](../scripts/card_by_id.py) and routes the change through the one
sanctioned writeback, [`apply_response.py`](../scripts/apply_response.py). The
`reject` op flips the suggestion card `status` → `rejected` and completes the
originating Task (`result=rejected`) in one atomic, pen-wrapped commit (with the
audit notification + version bump). No document edit, no `texEdit` — rejecting a
proposal is purely a card-lifecycle transition. A **todo** the Task was raised
from stays **open** on purpose: the change it asked for did not land, so the
todo is still to do — where [`accept-suggestion`](accept-suggestion.md) marks
it done (`close_source_todo`, task 1043). Don't "symmetrise" the two.

## Args

- `<docPath>` — the paper folder.
- `<cardId>` — the id of the suggestion card to reject.

## Procedure

1. **Resolve the card.** Confirm it's a suggestion proposal to dismiss:
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId> [--panel <panel>]
   ```
   An id shared across panels REFUSES as ambiguous — re-run with `--panel <panel>`
   and carry `"panel"` in the op ([_card-resolve.md](_card-resolve.md)).
   - `{found:false}` → stop (wrong id).
   - `cardKind` must be `revision-suggestion` or `cutter-suggestion`. Any other
     kind → stop (`reject` is for the suggestion family — to set aside a
     different card, use [`archive-card`](archive-card.md)).
   - Read `card.status` against the **per-status verdict** in Applicability
     (one table, `card_tables.json` → `proposalVerdicts`): `pending` and
     `stale` proceed; `rejected` is a no-op; `accepted` and `applied` are
     refused — reply with that row's template and stop.

2. **Run the `reject` op:**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> reject '{"cardId":"<cardId>"}'
   ```
   It flips `status` → `rejected` and completes the Task it answers (read from
   the card's `aiOriginRequestId`, or pass `"requestId":"<id>"`). Prints
   `{ok, version, op:"reject", cardId, cardKind, result:"rejected"}`. The
   document `.tex` is left byte-for-byte unchanged.

## Applicability

- **Per-status verdict** — the op does not decide this per skill: it reads
  `card_tables.json` → `proposalVerdicts.reject` (in
  `apply_response._resolve_proposal` / `_proposal_door_refusal`), the one table
  every proposal door consults, over the app's whole status vocabulary
  (`SUGGESTION_STATUSES`, `src/cards/suggestion-status.ts`):
  - `pending` → **proceed**.
  - `stale` → **proceed**: the paragraph drifted so the app could not land the
    splice — turning the proposal down is the natural move, and nothing in the
    `.tex` needs to match for a reject.
  - `rejected` → **no-op**: `{ok, noop:true, reason:"already rejected"}`,
    nothing written.
  - `accepted` → **refused** (`refuse-terminal`): already spliced — undo the
    `.tex` edit in the editor instead.
  - `applied` → **refused** (`refuse-applied`): live under a pending-change
    mark — Keep or Revert it in the editor first (task 1109).
- **Rejectable** — `revision-suggestion` (in `revisions.json`) and
  `cutter-suggestion` (in `cutter.json`), in a status whose verdict is
  **proceed**.
- **Refused** — any non-suggestion kind, and a status whose verdict is
  `refuse-terminal` (`accepted`) or `refuse-applied` (`applied`).

> **This skill OWNS the `status` transition** (with
> [`accept-suggestion`](accept-suggestion.md)). `edit-card` refuses
> `--field status=…` on a suggestion by name
> (`apply_response.OP_OWNED_FIELDS`): flipping the field alone leaves the
> originating Task open, so the request never leaves the inbox. Route a status
> change here; [`edit-card`](edit-card.md) owns the suggestion's *other* fields
> (`suggested_text` / `user_text` / `explanation` / `instructions`).

## Reply

One template per outcome the op can produce. On success:
```
Done: reject-suggestion <cardId> (<cardKind>) — status=rejected, Task complete (rejected), document.tex unchanged[, source todo left open]. Output: <cutter|revisions>.json (+ ai-requests.json, notifications, version).
```
On a `noop` (already rejected):
```
Done: reject-suggestion <cardId> — already rejected; nothing to do. Nothing written.
```
On a `refuse-terminal` refusal (already accepted):
```
Done: refused <cardId> — this proposal was already accepted into the paper, so it can't be rejected. Nothing written. Undo the edit in the editor if you want the old wording back.
```
On a `refuse-applied` refusal (already applied):
```
Done: refused <cardId> — this suggestion is already applied in the paper (the blue pending change). Nothing written. Settle it with Keep or Revert on the card in the editor (Revert puts the old wording back).
```
On any other refusal (card not found, not a suggestion):
```
Done: refused <cardId> — <the op's reason, in plain words>. Nothing written.
```

## Safety

- Rejecting **never** edits the `.tex` — it's a card-status transition plus the
  Task completion. The proposal card stays in its panel marked `rejected` (a
  record of what was considered and declined), not deleted.
- To both decline *and* clear the card out of the panel, reject first, then
  [`archive-card`](archive-card.md) the rejected card.
