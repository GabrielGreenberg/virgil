---
description: |
  Respond to a request the user flagged in Virgil's Revisions panel.
  Triggers on: "answer my revision request", "respond to the revision
  question on this paragraph", "address my request in revisions", or
  when the request asks for follow-up on a previously logged revision
  exchange. Drafts a sibling revision-request card (or a revision-
  suggestion card if the user asked for an actual doc edit). Does NOT
  trigger for cuts (use answer-cutter-comment) or general notes
  (use answer-note-request). Args: <docPath> <requestId>.
---

# /editor/answer-revision-request $ARGUMENTS

Resolve one AI request originating from a Revisions-panel request with
`aiRequest: true`. The Revisions panel holds two polymorphic card
kinds: `comment` and `suggestion` (parallel to Cutter — see
the `RevisionCard` union in `src/lib/types.ts`). This skill responds to a flagged request by
appending a **sibling card** to `revisions.json` — never mutates the
source request in place.

> **Note:** Earlier drafts of this skill assumed a per-card `turns[]`
> dialogue model. That model was retired in favor of sibling-card
> threading (`migrateRevisions` in `src/hooks/useRevisions.ts`
> drops legacy turns on read). Treat the panel as a flat list of
> linked requests + suggestions.

> **Allowable-LaTeX doctrine.** Any LaTeX you compose or edit must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — usually `virtual:revisions:<cardId>`, or a real
  `ai-requests.json` id with `linkedTo.panel == "revisions"`.

> **This skill is the OWNER of `(kind: "suggestion", panel: "revisions")`.**
> `/editor/review` routes on that pair — the wire `kind` alone is ambiguous,
> because `ai_request_routing.json` maps both `revision-comment` and
> `cutter-comment` onto `suggestion` and separates them by `linkPanel`. The
> sibling half is `/editor/answer-cutter-comment` (`panel: "cutter"`);
> `/editor/draft-suggestion` owns only the **unbridged** case, and it can emit
> a suggestion only — never the report or sibling-comment shapes below.

## Procedure

1. **Load.** Source request from `<docPath>/virgil/revisions.json`
   `cards[]` via `linkedTo.cardId`. Pull paragraph context for the
   request's anchor:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=2
   ```
   Pull adjacent revision cards (same anchor) so the reply doesn't
   repeat what's already there:
   ```bash
   python3 editor/scripts/cards_for_paragraph.py <docPath> <uuid>
   ```

2. **Choose your response shape** — the shared ask-shape rule,
   [_ask-shape.md](_ask-shape.md), governs. Ask what the honest answer *is*,
   not merely whether it touches the `.tex`. Decide in order:
   - **(a)** Does the request ask to *change document prose*
     (rephrase a sentence, tighten a paragraph, swap the lede)? →
     emit a **RevisionSuggestionCard**. See `/editor/draft-suggestion`
     for the schema.
   - **(b)** Does it ask a question *about the world* whose answer is
     **findings** — "can you check this quote", "is this attribution
     right", "what does the source actually say"? → emit a **report**,
     which is where findings belong:
     ```bash
     t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-txt.XXXXXX")
     cat > "$t/title" <<'TXT'
     <short title>
     TXT
     cat > "$t/body" <<'TXT'
     <findings>
     TXT
     python3 editor/scripts/create_card.py <docPath> <requestId> --kind=report \
         --accept-task-kind suggestion --anchor <uuid> --author ai \
         --title "@$t/title" --body "@$t/body"; rc=$?
     rm -rf "$t"
     exit "$rc"
     ```
     Emit the report *instead of* a suggestion, not alongside one. That call
     drains the Task, so **skip steps 3–5 and go straight to the path-(b)
     reply in step 6**.
   - **(c)** Else (a take, a meta-remark, a question about the argument
     rather than about a source) → emit a sibling **RevisionRequestCard**
     with `aiRequest: false`, anchored to the same paragraphs.

3. **Compose.** Read the source request carefully. Match the
   conversational tone of any other revision cards anchored to the
   same paragraph. Keep it under ~200 words.

4. **Paths (a)/(c) need no hand-built card** *(path (b) — the report — is
   already landed by step 2's own `create_card.py` call; go straight to its
   reply in step 6)*. The door builds both remaining shapes (task 1044):
   `create_card.py` reads the Task's `linkedTo.panel == "revisions"`, copies
   the source request's first-link anchor **verbatim** (Mode A, or Mode B with
   its `textRange`), mints the id / timestamps / self-link (spine kind
   `revision-suggestion` / `revision-comment`), stamps `instructions` (the
   drain row's `text`, [_request-load.md](_request-load.md)), and stamps
   `aiOriginRequestId` for a real Task (never a `virtual:` one). Don't mutate
   the source request's `text` / `content` — the door lowers its `aiRequest`
   flag for you.

   **Pin to the words when the answer is about the words** (task 1197): if your
   suggestion or reply is about a specific phrase or sentence rather than the
   paragraph as a whole, add `--range "@$t/span"` with those words verbatim from
   the `.tex` — the card lands on that span (Mode B), exactly as if the user had
   selected it. A Task already filed on a selection keeps its span without the
   flag. Rule + refusals: [create-card.md](create-card.md) → "Phrase or
   paragraph?". For a suggestion the span must contain `--original`: an
   explicit `--range` that misses it is refused; an inherited span that misses it
   degrades to the whole paragraph (result `anchorDegraded`, task 1235).

5. **Land it — one call per path.** Free text goes through `@` scratch files
   ([`_op-json.md`](_op-json.md)):
   ```bash
   t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-txt.XXXXXX")

   # Path (a) — suggestion → L3 propose: the card lands, the Task is left
   # AWAITING REVIEW (status: in-progress), the .tex untouched until
   # /editor/accept-suggestion. `original_text` must be verbatim from the
   # anchored paragraph (never the %!v: marker) or NOTHING lands — the same
   # question accept's stale guard asks; an empty replacement is refused too.
   cat > "$t/original" <<'TXT'
   <the span, verbatim from the .tex>
   TXT
   cat > "$t/suggested" <<'TXT'
   <your replacement>
   TXT
   cat > "$t/explanation" <<'TXT'
   <one or two sentences>
   TXT
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=suggestion --anchor <uuid> \
       --original "@$t/original" --suggested "@$t/suggested" \
       --explanation "@$t/explanation"; rc=$?

   # Path (c) — sibling reply → terminal create (a reply is not a proposal:
   # the Task completes now, result: direct-created).
   cat > "$t/body" <<'TXT'
   <your reply>
   TXT
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=comment --anchor <uuid> \
       --body "@$t/body"; rc=$?

   rm -rf "$t"
   exit "$rc"
   ```
   Run **one** of the two calls, then the `rm`/`exit` pair. The returned
   `cardId` is the `<newId>` for the reply; a re-run on a Task whose proposal
   already exists returns a `noop` naming it (a `virtual:` id whose flag is
   already down: a `noop` with no `cardId`).

6. **Reply.** On success:
   - Path (a) — suggestion (awaiting review):
     ```
     Done: drafted revision suggestion <newId> for request <requestId> — awaiting review (accept/reject in the editor). Output: revisions.json (+ ai-requests.json status=in-progress, notifications, version).
     ```
   - Path (b) — report (created by step 2's `create_card.py`):
     ```
     Done: drafted report <newId> for revision request <requestId>. Output: reports.json (+ ai-requests.json status/result, notifications, version).
     ```
   - Path (c) — sibling request (created):
     ```
     Done: replied to revision <cardId> for request <requestId>. Output: revisions.json (+ ai-requests.json status=complete, notifications, version).
     ```

## Idempotency

One rule for every responder: [_request-load.md](_request-load.md) →
"Idempotency". The drain decides whether `<requestId>` is still open, and a
writer's `noop: true` is the belt — never a `status` test of your own.

## Safety

- Never edit the source request in place. Always create a sibling
  card.
- Never mutate `document.tex` from this skill — even on path (a),
  the suggestion card carries the proposed replacement and the user
  reviews before the `.tex` changes (the splice rides
  `/editor/accept-suggestion`; the proposal is dismissable via
  `/editor/reject-suggestion`).
