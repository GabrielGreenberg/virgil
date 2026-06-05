---
description: |
  Apply a drafted revision/cutter suggestion into a Virgil paper's .tex —
  the "accept" half of the propose→review→apply loop (safety level 3).
  Triggers on: "accept this suggestion", "apply the proposed revision",
  "land this rewrite", "yes, make that change", "accept the cut", or as
  the mechanical apply step when the user approves a pending suggestion
  card. Resolves the card via card_by_id.py, verifies the proposal isn't
  stale, then routes an `accept` op: splice original_text → suggested_text
  into the .tex + flip the card status → accepted + complete the
  originating Task (result=accepted), all in ONE atomic pen-protected
  commit. Handles revision-suggestion AND cutter-suggestion. Does NOT
  trigger for drafting a new suggestion (use /editor/draft-suggestion),
  dismissing one (use /editor/reject-suggestion), or editing a card's
  fields (use /editor/edit-card). Args: <docPath> <cardId>.
---

# /editor/accept-suggestion $ARGUMENTS

Consummate a **Level-3 proposal**. L3 ("propose a change for review") is the
one safety level that *drafts* but doesn't *apply*: `/editor/draft-suggestion`
(and the `answer-*-comment` responders) land a **suggestion card** —
`revision-suggestion` or `cutter-suggestion` — carrying `original_text` and a
proposed `suggested_text`, with the `.tex` **untouched** and the Task left
awaiting review. This skill closes that loop: it splices the proposal into the
document.

Like the other existing-card ops it resolves the card with
[`card_by_id.py`](../scripts/card_by_id.py) and routes the change through the one
sanctioned writeback, [`apply_response.py`](../scripts/apply_response.py). The
`accept` op does **three things in one atomic, pen-wrapped commit**: splices the
`.tex` (`original_text` → `suggested_text` via the generic `replace-span`
texEdit), flips the card `status` → `accepted`, and completes the originating
Task (`result=accepted`) — plus the audit notification + version bump. A fault
anywhere rolls **all three** back together (the `.tex`, the card, and the Task).

This skill is **mechanical**: it composes no prose. The replacement text is the
suggestion the user is reviewing; the `accept` op builds the `replace-span`
splice from the card's own fields (anchor + `original_text` → `suggested_text`/
`user_text`) so the splice and its stale-guard stay inside the atomic
transaction — never hand-assemble a `texEdit` here.

## Args

- `<docPath>` — the paper folder.
- `<cardId>` — the id of the suggestion card to accept.

## Procedure

1. **Resolve + validate the proposal.** Confirm it's a reviewable, pending AI
   suggestion:
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId>
   ```
   - `{found:false}` → stop (wrong id).
   - `cardKind` must be `revision-suggestion` or `cutter-suggestion`. Any other
     kind → stop (not a proposal — `accept` is for the suggestion family).
   - `card.status` must be `pending`. If it's already `accepted`, skip (the
     op is idempotent — re-accepting is a no-op). If it's `rejected`, stop: a
     dismissed proposal can't be accepted.
   - `card.author` should be `ai` (the proposal the user is reviewing). A
     human-authored suggestion can still be accepted, but confirm intent first.
   - The card must carry `original_text`, `suggested_text`, and an anchor
     (`links[*].anchor.textObjectIds`). Missing any → stop.

2. **Stale-match pre-check (L3 trust).** Read the anchored paragraph and confirm
   `original_text` still appears there verbatim:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <anchorUuid>
   ```
   If the paragraph changed since the proposal was drafted and `original_text`
   no longer matches, **refuse** — don't splice a stale edit. (The `accept` op
   re-checks this atomically and dies on a mismatch regardless, so this is a
   friendly pre-flight; the contract is the real guard.) Tell the user the
   proposal is stale and offer to re-draft via `/editor/draft-suggestion`.

3. **Run the `accept` op:**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> accept '{"cardId":"<cardId>"}'
   ```
   It derives the `replace-span` texEdit from the card, splices the `.tex`,
   flips `status` → `accepted`, and completes the Task it answers (read from the
   card's `aiOriginRequestId`, or pass `"requestId":"<id>"` to target a specific
   Task). Prints `{ok, version, op:"accept", cardId, cardKind, anchorUuid,
   result:"accepted"}`. On a stale mismatch it exits non-zero with a clear
   `replace-span: … stale proposal` message and writes **nothing**.

## Applicability

- **Acceptable** — `revision-suggestion` (in `revisions.json`) and
  `cutter-suggestion` (in `cutter.json`), `status: pending`. An empty
  `suggested_text` is a Cutter "cut entirely" — `accept` deletes the span.
- **Refused** — any non-suggestion kind; a proposal already `rejected`; a
  suggestion missing `original_text`/`suggested_text`/anchor; a proposal whose
  `original_text` no longer matches the `.tex` (stale). The op refuses these
  with a clear reason rather than splice blindly.

## Reply

On success:
```
Done: accept-suggestion <cardId> (<cardKind>) — spliced into document.tex, status=accepted, Task complete (accepted). Output: <cutter|revisions>.json, document.tex (+ ai-requests.json, notifications, version).
```
On a stale refusal:
```
Done: refused <cardId> — the paragraph changed since this proposal was drafted; original_text no longer matches. Nothing applied. Re-draft with /editor/draft-suggestion.
```

## Safety

- **Never hand-splice the `.tex`.** Route through `apply_response.py accept` so
  the splice, the status flip, the Task completion, the pen, and the
  stale-guard all live in one atomic transaction.
- The stale-match guard is **load-bearing** for L3 trust: a proposal drafted
  against an older version of the paragraph must not silently overwrite newer
  text. If in doubt, refuse and re-draft.
- Reversible: the splice is a normal document edit — the user can undo it in the
  editor, or you can re-draft the inverse. (There is no `revert` for `accept`;
  it lands as an ordinary `.tex` change.)
