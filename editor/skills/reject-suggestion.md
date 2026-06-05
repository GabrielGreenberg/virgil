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
  card (use /editor/archive-card). Args: <docPath> <cardId>.
---

# /editor/reject-suggestion $ARGUMENTS

Dismiss a **Level-3 proposal**. The mirror of
[`accept-suggestion`](accept-suggestion.md): where accept splices the proposal
into the document, reject turns it down — the `.tex` is **never touched**.

Like the other existing-card ops it resolves the card with
[`card_by_id.py`](../scripts/card_by_id.py) and routes the change through the one
sanctioned writeback, [`apply_response.py`](../scripts/apply_response.py). The
`reject` op flips the suggestion card `status` → `rejected` and completes the
originating Task (`result=rejected`) in one atomic, pen-wrapped commit (with the
audit notification + version bump). No document edit, no `texEdit` — rejecting a
proposal is purely a card-lifecycle transition.

## Args

- `<docPath>` — the paper folder.
- `<cardId>` — the id of the suggestion card to reject.

## Procedure

1. **Resolve the card.** Confirm it's a suggestion proposal to dismiss:
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId>
   ```
   - `{found:false}` → stop (wrong id).
   - `cardKind` must be `revision-suggestion` or `cutter-suggestion`. Any other
     kind → stop (`reject` is for the suggestion family — to set aside a
     different card, use [`archive-card`](archive-card.md)).
   - If `card.status` is already `rejected`, skip (the op is idempotent). If it's
     already `accepted`, stop: an applied proposal can't be rejected (undo the
     `.tex` edit in the editor instead).

2. **Run the `reject` op:**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> reject '{"cardId":"<cardId>"}'
   ```
   It flips `status` → `rejected` and completes the Task it answers (read from
   the card's `aiOriginRequestId`, or pass `"requestId":"<id>"`). Prints
   `{ok, version, op:"reject", cardId, cardKind, result:"rejected"}`. The
   document `.tex` is left byte-for-byte unchanged.

## Applicability

- **Rejectable** — `revision-suggestion` (in `revisions.json`) and
  `cutter-suggestion` (in `cutter.json`), `status: pending`.
- **Refused** — any non-suggestion kind; a proposal already `accepted` (already
  spliced — undo in the editor). Re-rejecting a `rejected` card is a no-op.

## Reply

```
Done: reject-suggestion <cardId> (<cardKind>) — status=rejected, Task complete (rejected), document.tex unchanged. Output: <cutter|revisions>.json (+ ai-requests.json, notifications, version).
```

## Safety

- Rejecting **never** edits the `.tex` — it's a card-status transition plus the
  Task completion. The proposal card stays in its panel marked `rejected` (a
  record of what was considered and declined), not deleted.
- To both decline *and* clear the card out of the panel, reject first, then
  [`archive-card`](archive-card.md) the rejected card.
