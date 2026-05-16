---
description: |
  Answer a note the user left in Virgil's Notes panel asking for AI
  help. Triggers on: "answer my note", "respond to the note I marked
  for AI", "address my margin question", or when there's a pending
  `kind: note` request in the paper's AI-request inbox. Drafts a
  sibling note anchored to the same paragraph (or a suggestion card if
  the user is asking for a doc edit). Does NOT trigger for todos (use
  answer-todo-request), revision comments (use answer-revision-comment),
  or footnote insertions (use draft-footnote). Args: <docPath> <requestId>.
---

# /editor/answer-note-request $ARGUMENTS

Resolve one AI request whose kind is `note`. The request can come from
two paths:

- A standalone note request in `ai-requests.json` (no `linkedTo`) — the
  user wants Claude to *create* a note for them, anchored to whatever
  paragraph they had in mind (`paragraphIds` on the request).
- A bridged card-flag request (id like `virtual:notes:<cardId>` or a
  real `ai-requests.json` entry with `linkedTo.panel == "notes"`) — the
  user toggled `aiRequest: true` on an existing note and wants Claude
  to *expand* / *answer* / *push back on* it.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`. May be
  `virtual:notes:<cardId>` for a bridged card flag.

## Procedure

1. **Load context.**
   - Read `<docPath>/virgil/ai-requests.json` and find the request by
     id (skip if `<requestId>` starts with `virtual:` — those are
     card-flag-only).
   - Read `<docPath>/virgil/notes.json` to find the source note when
     `linkedTo.panel == "notes"` (or for the virtual case, the cardId
     embedded in the request id).
   - Pull paragraph context for the anchored paragraph(s):
     ```bash
     python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=2
     ```
   - Pull cards anchored to the same paragraph(s) — if there's
     already a **note** making the same point, fold or skip. Cards
     in other panels (quotations, footnotes, todos, citations) are
     orthogonal context, not dedupe targets.
     ```bash
     python3 editor/scripts/cards_for_paragraph.py <docPath> <uuid>
     ```

2. **Choose your response shape.** The determining axis is: *does
   resolving this request require a `.tex` mutation?* Decide in
   order:
   - **(a)** Does the request ask to *change document prose* — i.e.
     a `.tex` mutation (rephrase a sentence, tighten a paragraph,
     fix a claim)? → emit a **suggestion card** in `revisions.json`.
     Don't mutate the source note; leave it intact as the user's
     prompt. (Note: a request that asks for a "take" / "reaction" /
     "pushback" on a note's claim is *not* a `.tex` mutation — it's a
     conversational reply, route to (b).)
   - **(b)** Else, is there a source note (`linkedTo` set OR
     `virtual:notes:<cardId>` id)? → emit a **sibling note** titled
     `Re: <source title>` anchored to the same paragraph(s).
   - **(c)** Else (standalone, no `linkedTo`) → emit a **new note**
     card.

3. **Compose.** Draft the note body as Tiptap JSONContent. The
   simplest valid shape is:
   ```json
   { "type": "doc",
     "content": [{
       "type": "paragraph",
       "content": [{ "type": "text", "text": "<your reply>" }]
     }]
   }
   ```
   Keep it tight: one to three short paragraphs. Match the user's tone
   (academic, conversational — read the source note first to gauge).

4. **Build the result card.** Generate a UUID for the new card. Mode A
   anchor — link to the same paragraphIds as the request.

   Title:
   - Path (b) (sibling): `Re: <source-note-title>`.
   - Path (c) (standalone): a short descriptive subject phrase, no
     `Re:` prefix. Match the convention of existing notes in
     `notes.json`.

   Schema (see `src/lib/types.ts` UserNote):
   ```jsonc
   { "id": "<new-uuid>",
     // Path (b): "Re: <source title>". Path (c): subject phrase, no "Re:".
     "title": "Re: <source-note-title-if-any>",
     "content": { ...tiptap JSON above },
     "createdAt": "<ISO now>",
     "aiRequest": false,
     "links": [{
       "id": "<link-uuid>",
       "kind": "anchor",
       "anchor": { "type": "anchor",
                   "paragraphIds": ["<uuid>"],
                   "margin": { "side": "right" } },
       "target": { "type": "card",
                   "ref": { "kind": "note", "id": "<new-uuid>" } },
       "createdAt": "<ISO now>"
     }]
   }
   ```
   Add `aiOriginRequestId: "<requestId>"` if `<requestId>` does NOT
   start with `virtual:` (i.e., a real `ai-requests.json` entry,
   including bridged-from-card-flag entries that have a real UUID
   plus `linkedTo`). The editor uses this to surface Accept / Reject /
   Redo buttons.

5. **Apply atomically.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   where `<op-json>` is:
   ```json
   { "requestId": "<requestId>",
     "panel": "notes",
     "card": { ...the new note... },
     "summary": "Drafted a note in reply to '<title>'",
     "clearSourceFlag": true
   }
   ```

6. **Reply.** One line:
   ```
   Done: drafted note <newId> for request <requestId>. Output: notes.json (+ ai-requests.json status, notifications, version).
   ```

## Idempotency

If the request is already `status: "complete"`, skip with:
```
Skipped <requestId> (already complete).
```

## Safety

- Never edit the source note in place. Always create a new card.
- Never mutate `document.tex` from this skill.
- If you can't decide between sibling-note and suggestion-card, prefer
  the sibling note — it's the lower-cost, more reversible choice.

## Memo

Drop a short retro under `<docPath>/.virgil/memos/<YYYY-MM-DD>-answer-note-<requestId>.md`
**only** if you encountered an ambiguity in the source request that the
user should know about. Skip the memo on a clean, expected-shape pass.
