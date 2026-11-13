---
description: |
  Apply a drafted revision/cutter suggestion into a Virgil paper's .tex —
  the "accept" half of the propose→review→apply loop (safety level 3).
  Triggers on: "accept this suggestion", "apply the proposed revision",
  "land this rewrite", "yes, make that change", "accept the cut", or as
  the mechanical apply step when the user approves a pending suggestion
  card. Resolves the card via card_by_id.py, verifies the proposal isn't
  stale, then routes an `accept` op: splice original_text →
  (user_text || suggested_text) into the .tex + flip the card status →
  accepted + complete the originating Task (result=accepted), all in ONE
  atomic pen-protected commit. Handles revision-suggestion AND
  cutter-suggestion; REFUSES a revision whose replacement is empty (an
  unfinished draft, not a deletion — only a Cutter cut deletes). Does NOT
  trigger for drafting a new suggestion (use /editor/draft-suggestion),
  dismissing one (use /editor/reject-suggestion), or editing a suggestion's
  OTHER fields — its suggested_text / user_text / explanation (use
  /editor/edit-card). The `status` transition is NOT one of those: it is this
  skill's, and edit-card refuses it by name, because flipping the field alone
  leaves the paper byte-unchanged and the Task open. Args: <docPath> <cardId>.
---

# /editor/accept-suggestion $ARGUMENTS

Consummate a **Level-3 proposal**. L3 ("propose a change for review") is the
one safety level that *drafts* but doesn't *apply*: `/editor/draft-suggestion`
(and the `answer-*-comment` responders) land a **suggestion card** —
`revision-suggestion` or `cutter-suggestion` — carrying `original_text` and a
proposed `suggested_text`, with the replacement **not applied** (a `--range`
anchor still lands — [_safety-levels.md](_safety-levels.md)) and the Task left
awaiting review. This skill closes that loop: it splices the proposal into the
document.

Like the other existing-card ops it resolves the card with
[`card_by_id.py`](../scripts/card_by_id.py) and routes the change through the one
sanctioned writeback, [`apply_response.py`](../scripts/apply_response.py). The
`accept` op does **three things in one atomic, pen-wrapped commit**: splices the
`.tex` (`original_text` → `user_text || suggested_text` via the generic
`replace-span` texEdit), flips the card `status` → `accepted`, and completes the originating
Task (`result=accepted`) — plus the audit notification + version bump. When that
Task was raised from a **todo**, the same commit also marks the todo done in
`todos.json` (`close_source_todo`, task 1043 — the todo asked for this change,
and it has now landed; [`reject-suggestion`](reject-suggestion.md) leaves it open
on purpose). A fault anywhere rolls **all of it** back together (the `.tex`, the
card, the Task, the todo).

This skill is **mechanical**: it composes no prose. The replacement text is the
suggestion the user is reviewing; the `accept` op builds the `replace-span`
splice from the card's own fields (anchor + `original_text` → `suggested_text`/
`user_text`) so the splice and its stale-guard stay inside the atomic
transaction — never hand-assemble a `texEdit` here.

## Args

- `<docPath>` — the paper folder.
- `<cardId>` — the id of the suggestion card to accept.

## Procedure

1. **Resolve + validate the proposal.** Confirm it's a reviewable AI
   suggestion:
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId> [--panel <panel>]
   ```
   An id shared across panels REFUSES as ambiguous — re-run with `--panel <panel>`
   and carry `"panel"` in the op ([_card-resolve.md](_card-resolve.md)).
   - `{found:false}` → stop (wrong id).
   - `cardKind` must be `revision-suggestion` or `cutter-suggestion`. Any other
     kind → stop (not a proposal — `accept` is for the suggestion family).
   - Read `card.status` against the **per-status verdict** in Applicability
     (one table, `card_tables.json` → `proposalVerdicts`): `pending` and
     `stale` proceed; `accepted` is a no-op; `rejected` and `applied` are
     refused — reply with that row's template and stop.
   - `card.author` should be `ai` (the proposal the user is reviewing). A
     human-authored suggestion can still be accepted, but confirm intent first.
   - The card must carry `original_text`, `suggested_text`, and an anchor
     (`links[*].anchor.textObjectIds`). Missing any → stop.
   - A `revision-suggestion` whose replacement (`user_text || suggested_text`)
     is empty or whitespace → stop: it is an unfinished draft, and the op
     refuses it (see Applicability). A Cutter suggestion with an empty
     replacement is a cut and proceeds.

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

- **Per-status verdict** — the op does not decide this per skill: it reads
  `card_tables.json` → `proposalVerdicts.accept` (in
  `apply_response._resolve_proposal` / `_proposal_door_refusal`), the one table
  every proposal door consults, over the app's whole status vocabulary
  (`SUGGESTION_STATUSES`, `src/cards/suggestion-status.ts`):
  - `pending` → **proceed** (the drafted, unapplied proposal).
  - `stale` → **proceed**: the app could not land the splice when it tried, so
    accept tries again — step 2's pre-check and the op's own stale-guard decide
    whether `original_text` still matches. If it does not, it is the stale
    refusal below.
  - `accepted` → **no-op**: `{ok, noop:true, reason:"already accepted"}`,
    nothing written.
  - `rejected` → **refused** (`refuse-terminal`): a dismissed proposal can't be
    accepted.
  - `applied` → **refused** (`refuse-applied`): its change is ALREADY live in
    the paper under the blue pending-change mark, and a second splice would
    double it; the user settles it with **Keep** or **Revert** on the card in
    the editor.
- **Acceptable** — `revision-suggestion` (in `revisions.json`) and
  `cutter-suggestion` (in `cutter.json`), in a status whose verdict is
  **proceed**. The replacement is
  `user_text` when the human typed one, else `suggested_text`. An empty
  replacement on a **Cutter** suggestion is a "cut entirely" — `accept` deletes
  the span.
- **Refused** — any non-suggestion kind; a status whose verdict is
  `refuse-terminal` (`rejected`) or `refuse-applied` (`applied`); a
  suggestion missing `original_text`/`suggested_text`/anchor; a proposal whose
  `original_text` no longer matches the `.tex` (stale); and a **revision**
  suggestion whose replacement is empty or whitespace (task 957). A human
  revision card starts with `suggested_text: ""` and invites the author to type
  into "Your text" — accepting it untyped would DELETE the passage, so the op
  refuses with "No replacement text yet — this suggestion has nothing to put in
  the paper." (the app's own Apply/Accept wording; the family rule is
  `card_tables.json` → `suggestionLanding`); and a replacement that does not
  **conserve the span's identity markers** (task 1426): every `\vcid{…}` /
  `\vfid{…}` / `\vlid{…}`…`\vlidend{…}` in `original_text` must reappear in
  the replacement, verbatim, and none may be added; a `\vfid`/`\vcid` must
  still be followed by its own footnote/citation atom, byte-for-byte
  (task 1484) — else accepting would
  detach a citation card or delete a footnote's prose. A whole Cutter cut may
  drop a citation (with its atom) or another card's range lying wholly inside
  it, never a footnote. The refusal names the marker. The op refuses these with
  a clear reason and writes nothing — `.tex`, card and Task untouched.

> **This skill OWNS the `status` transition.** `edit-card` refuses
> `--field status=…` on a suggestion by name (`apply_response.OP_OWNED_FIELDS`),
> because flipping the field alone only sets `status` — none of the rest of
> this op: the panel reads *accepted* while the paper is byte-unchanged and the Task stays
> open. Route a status change here, never through
> [`edit-card`](edit-card.md) — which owns the suggestion's *other* fields
> (`suggested_text` / `user_text` / `explanation` / `instructions`).

## Reply

One template per outcome the op can produce. On success:
```
Done: accept-suggestion <cardId> (<cardKind>) — spliced into document.tex, status=accepted, Task complete (accepted)[, source todo marked done]. Output: <cutter|revisions>.json, document.tex (+ ai-requests.json[, todos.json], notifications, version).
```
On a `noop` (already accepted):
```
Done: accept-suggestion <cardId> — already accepted; nothing to do. Nothing written.
```
On a `refuse-terminal` refusal (already rejected):
```
Done: refused <cardId> — this proposal was already rejected, so it can't be accepted. Nothing applied. Ask me to re-draft it with /editor/draft-suggestion if you want the change after all.
```
On a `refuse-applied` refusal (already applied):
```
Done: refused <cardId> — this suggestion is already applied in the paper (the blue pending change). Nothing written. Settle it with Keep or Revert on the card in the editor.
```
On a stale refusal:
```
Done: refused <cardId> — the paragraph changed since this proposal was drafted; original_text no longer matches. Nothing applied. Re-draft with /editor/draft-suggestion.
```
On an empty-revision refusal:
```
Done: refused <cardId> — this revision suggestion has no replacement text yet, so accepting it would delete the passage. Nothing applied. Type the new wording into "Your text" (or ask me to draft one with /editor/draft-suggestion), then accept.
```
On a marker-conservation refusal (the op names the marker):
```
Done: refused <cardId> — the replacement drops or adds <marker>, so accepting it would detach a citation card or delete a footnote's prose. Nothing applied. Re-draft with /editor/draft-suggestion, carrying every marker through verbatim.
```
On any other refusal (card not found, not a suggestion, a card missing
`original_text` / `suggested_text` / an anchor):
```
Done: refused <cardId> — <the op's reason, in plain words>. Nothing applied.
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
