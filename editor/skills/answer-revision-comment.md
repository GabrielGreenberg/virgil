---
description: Answer a flagged Revisions-panel comment — drafts a sibling RevisionCommentCard (or a RevisionSuggestionCard if the user asked for a doc edit). Args - <docPath> <requestId>.
---

# /editor/answer-revision-comment $ARGUMENTS

Resolve one AI request originating from a Revisions-panel comment with
`aiRequest: true`. The Revisions panel holds two polymorphic card
kinds: `comment` and `suggestion` (parallel to Cutter — see
`src/lib/types.ts:76`). This skill responds to a flagged comment by
appending a **sibling card** to `revisions.json` — never mutates the
source comment in place.

> **Note:** Earlier drafts of this skill assumed a per-card `turns[]`
> dialogue model. That model was retired in favor of sibling-card
> threading (`migrateRevisions` in `src/hooks/useRevisions.ts:104`
> drops legacy turns on read). Treat the panel as a flat list of
> linked comments + suggestions.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — usually `virtual:revisions:<cardId>`, or a real
  `ai-requests.json` id with `linkedTo.panel == "revisions"`.

## Procedure

1. **Load.** Source comment from `<docPath>/virgil/revisions.json`
   `cards[]` via `linkedTo.cardId`. Pull paragraph context for the
   comment's anchor:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=2
   ```
   Pull adjacent revision cards (same anchor) so the reply doesn't
   repeat what's already there:
   ```bash
   python3 editor/scripts/cards_for_paragraph.py <docPath> <uuid>
   ```

2. **Choose your response shape.** The determining axis is whether
   resolving the comment requires a `.tex` mutation. Decide in order:
   - **(a)** Does the comment ask to *change document prose*
     (rephrase a sentence, tighten a paragraph, swap the lede)? →
     emit a **RevisionSuggestionCard**. See `/editor/draft-suggestion`
     for the schema.
   - **(b)** Else (the comment is a question, a take, a meta-remark)
     → emit a sibling **RevisionCommentCard** with
     `aiRequest: false`, anchored to the same paragraphs.

3. **Compose.** Read the source comment carefully. Match the
   conversational tone of any other revision cards anchored to the
   same paragraph. Keep it under ~200 words.

4. **Build the result card.**

   For path (b) — sibling RevisionCommentCard
   (see `src/lib/types.ts:76`):
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
        "anchor": {
           "type": "anchor",
           "paragraphIds": ["...copy from source comment's anchor..."],
           "margin": {"side": "...copy from source comment..."}
        },
        "target": {
           "type": "card",
           "ref": {"kind": "comment", "id": "<new-uuid>"}
        },
        "createdAt": "<ISO now>"
     }]
   }
   ```

   For path (a) — RevisionSuggestionCard: see `/editor/draft-suggestion`
   for the full schema. Required: `kind: "suggestion"`, `id`,
   `createdAt`, `author: "ai"`, `original_text` (verbatim from .tex,
   excluding the `%!v:<uuid>` marker), `suggested_text`,
   `explanation`, `user_text: ""`, `instructions: "<request.text>"`,
   `status: "pending"`, `links[]` (same anchor copy rule),
   `aiOriginRequestId: <requestId>` if the id doesn't start with
   `virtual:`.

   Don't mutate the source comment's top-level `text` / `content`
   fields — those are the originating framing. The bridge clears
   `aiRequest` via `clearSourceFlag: true`.

5. **Apply.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   ```json
   { "requestId": "<requestId>",
     "panel": "revisions",
     "card": { ...the new card... },
     "summary": "Replied to revision comment <cardId>",
     "clearSourceFlag": true
   }
   ```
   `clearSourceFlag: true` flips the source comment's `aiRequest`
   to `false`.

6. **Reply.** On success:
   ```
   Done: replied to revision <cardId> for request <requestId>. Output: revisions.json (+ ai-requests.json, notifications, version).
   ```

## Idempotency

If the request is already `status: "complete"`, skip with:
```
Skipped <requestId> (already complete).
```

If a sibling reply card with `aiOriginRequestId == <requestId>`
already exists, skip with the same message — don't re-reply.

## Safety

- Never edit the source comment in place. Always create a sibling
  card.
- Never mutate `document.tex` from this skill — even on path (a),
  the suggestion card carries the proposed replacement and the user
  reviews before the .tex changes.
