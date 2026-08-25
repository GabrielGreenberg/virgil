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
`src/lib/types.ts:76`). This skill responds to a flagged request by
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
     python3 editor/scripts/create_card.py <docPath> <requestId> --kind=report \
         --accept-task-kind suggestion --anchor <uuid> --author ai \
         --title "<short title>" --body "<findings>"
     ```
     Emit the report *instead of* a suggestion, not alongside one.
   - **(c)** Else (a take, a meta-remark, a question about the argument
     rather than about a source) → emit a sibling **RevisionRequestCard**
     with `aiRequest: false`, anchored to the same paragraphs.

3. **Compose.** Read the source request carefully. Match the
   conversational tone of any other revision cards anchored to the
   same paragraph. Keep it under ~200 words.

4. **Build the result card** *(paths (a)/(c) only)*. Path (b) — the report —
   is already landed by its own `create_card.py` call in step 2, which builds
   the card, flips the Task and clears the source flag in one atomic write.
   It needs nothing from steps 4 and 5; go straight to the path-(b) reply in
   step 6.

   For path (c) — sibling RevisionRequestCard
   (`RevisionRequestCard`, `src/lib/types.ts`):
   ```json
   { "kind": "comment",
     "id": "<new-uuid>",
     "createdAt": "<ISO now>",
     "text": "<plain-text mirror of content>",
     "content": {
        "type": "doc",
        "content": [{
           "type": "paragraph",
           "content": [{ "type": "text", "text": "<your reply>" }]
        }]
     },
     "aiRequest": false,
     "links": [{
        "id": "<new-link-uuid>",
        "kind": "anchor",
        "anchor": { ...COPIED VERBATIM from the source request's first-link anchor... },
        "target": {
           "type": "card",
           "ref": {"kind": "comment", "id": "<new-uuid>"}
        },
        "createdAt": "<ISO now>"
     }]
   }
   ```
   **The link anchor (paths (a) and (c)):** copy the source request's first-link
   `anchor` object **verbatim** — it is already in the canonical on-disk
   `LinkAnchor` shape (`type: "textObject"` + `textObjectIds`,
   plus `textRange` if the request is Mode B; SSOT
   `src/links/_shared/types.ts`,
   [anchoring.md](../../docs/workspace/anchoring.md)). Copying preserves the
   mode and paragraph id(s) in one move; do **not** hand-rebuild it
   into the retired `type: "anchor"`/`paragraphIds` form. Then mint a fresh
   link `id`, and set `target.ref.id` to the new card's own id (self-target).

   For path (a) — RevisionSuggestionCard: see `/editor/draft-suggestion`
   for the full schema. Required: `kind: "suggestion"`, `id`,
   `createdAt`, `author: "ai"`, `original_text` (verbatim from .tex,
   excluding the `%!v:<uuid>` marker — it is the accept-time stale-guard
   key), `suggested_text`, `explanation`, `user_text: ""`,
   `instructions: "<request.text>"`, `status: "pending"`, `links[]` (the
   verbatim-copy anchor rule above, `target.ref.kind: "suggestion"`), and
   `aiOriginRequestId: <requestId>` (load-bearing — `accept-suggestion`
   reads it) if the id doesn't start with `virtual:`.

   Don't mutate the source request's top-level `text` / `content`
   fields — those are the originating framing. The bridge clears
   `aiRequest` via `clearSourceFlag: true`.

5. **Land it via the contract** *(paths (a)/(c))* — the subcommand depends
   on the path:

   - **Path (a) — suggestion → L3 propose.** A suggestion is a *proposal*:
     `complete-task --propose` lands the card and leaves the Task **awaiting
     review** (`status: in-progress`), the `.tex` untouched until the user
     accepts via `/editor/accept-suggestion`.
     ```bash
     python3 editor/scripts/apply_response.py <docPath> complete-task --propose '<op-json>'
     ```
   - **Path (c) — sibling request → terminal create.** A request is not a
     proposal (nothing to accept), so it lands as a **direct create**:
     `complete-task` completes the Task now (`status: complete`,
     `result: direct-created`).
     ```bash
     python3 editor/scripts/apply_response.py <docPath> complete-task '<op-json>'
     ```

   Both take the same op shape (only the subcommand differs); both move off the
   legacy default-apply path:
   ```json
   { "requestId": "<requestId>",
     "panel": "revisions",
     "card": { ...the new card... },
     "summary": "Replied to revision request <cardId>",
     "clearSourceFlag": true
   }
   ```
   `clearSourceFlag: true` flips the source request's `aiRequest` to `false`.

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

If a sibling reply card with `aiOriginRequestId == <requestId>` already exists
(path a — the proposal carries that back-pointer) **or** the request is already
`status: "complete"` (paths (b)/(c) — the landed card completed the Task),
skip with:
```
Skipped <requestId> (already answered).
```
A path-(a) proposal leaves the Task `in-progress` (awaiting review), **not**
`complete` — so the *card-existence* check, not the status check, is what
prevents a double-draft. Don't re-draft a proposal just because its Task isn't
terminal yet. (As of the resultId-gated drain rule, `list_requests.py` already
stops surfacing an `in-progress`-with-`resultId` proposal — so this guard is now
belt-and-suspenders against a duplicate dispatch, no longer the only defense.)

## Safety

- Never edit the source request in place. Always create a sibling
  card.
- Never mutate `document.tex` from this skill — even on path (a),
  the suggestion card carries the proposed replacement and the user
  reviews before the `.tex` changes (the splice rides
  `/editor/accept-suggestion`; the proposal is dismissable via
  `/editor/reject-suggestion`).
