---
description: Answer a flagged Revisions-panel comment — appends a Claude turn to the comment's dialogue. Args - <docPath> <requestId>.
---

# /editor/answer-revision-comment $ARGUMENTS

Resolve one AI request originating from a Revisions-panel comment with
`aiRequest: true`. Revisions are **multi-party dialogues**: each
RevisionCard holds a `turns[]` array of authored entries. Don't close
the card — append a new turn authored by Claude.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — usually `virtual:revisions:<cardId>`, or a real
  `ai-requests.json` id with `linkedTo.panel == "revisions"`.

## Procedure

1. **Load.** Source revision card from `revisions.json` via
   `linkedTo.cardId`. The card has `turns[]` — read all prior turns to
   get the conversation context. Pull paragraph context too.

2. **Compose.** Read the latest user turn (the one with
   `aiRequest: true` flag prompting this skill) and respond *to it*,
   not to the original comment alone. Match the conversational tone of
   prior turns. Keep it under ~200 words.

3. **Append a turn** to the source card's `turns[]`. Don't replace the
   array — push to it. Turn shape (consult the live schema; usually):
   ```json
   { "id": "<turn-uuid>",
     "authorId": "claude",
     "createdAt": "<ISO now>",
     "content": { ...tiptap JSONContent of your reply },
     "text": "<plain-text mirror>"
   }
   ```

4. **Apply.** This is the one ambiguous responder where the result
   isn't a *new card*; we're updating an *existing* one. Two paths:

   a. *(Preferred when supported)* Add an `update` op to
      `apply_response.py` and use it to splice the new turn in.

   b. *(Fallback today)* Edit `<docPath>/virgil/revisions.json`
      directly to push the turn, then call:
      ```bash
      python3 editor/scripts/apply_response.py <docPath> --complete-only <requestId> --note "Replied to revision comment <cardId>"
      ```
      Plus manually clear the source comment's `aiRequest: true` flag.

5. **Reply.**
   ```
   Done: appended turn to revision <cardId> for request <requestId>. Output: revisions.json (+ ai-requests.json, notifications, version).
   ```

## Safety

- Never delete prior turns. The dialogue is the audit trail.
- If the latest turn is *yours* (Claude already replied), don't
  re-reply on the same request — mark complete with "no-op, dialogue
  already current."
