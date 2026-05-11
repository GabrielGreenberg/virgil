---
description: Answer a flagged Cutter comment — drafts a CutterSuggestionCard responding to the comment's request. Args - <docPath> <requestId>.
---

# /editor/answer-cutter-comment $ARGUMENTS

Resolve one AI request originating from a Cutter-panel comment with
`aiRequest: true`. The Cutter panel is for drafting cuts to text; the
comment usually asks "is this paragraph really pulling its weight?"
or "trim this part." Default response is a **CutterSuggestionCard**
the user can accept (which queues the textual replacement).

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — usually `virtual:cutter:<cardId>` for a card-flag
  bridge, or a real `ai-requests.json` id with `linkedTo.panel ==
  "cutter"`.

## Procedure

1. **Load.** Source comment from `cutter.json` via `linkedTo.cardId`.
   Paragraph context via `get_para_context.py` (neighbors=2).
   Adjacent cards via `cards_for_paragraph.py`.

2. **Compose.** Identify the slice of the anchored paragraph(s) you'd
   cut or rewrite. Mode B: if `selectedText` is set on the comment,
   that's already the target span. Mode A: pick a coherent subspan
   from the paragraph to address the comment.

3. **Build the CutterSuggestionCard** (see `src/lib/types.ts:345`):
   ```json
   { "kind": "suggestion",
     "id": "<new-uuid>",
     "createdAt": "<ISO now>",
     "author": "ai",
     "original_text": "<verbatim slice from the .tex>",
     "suggested_text": "<your replacement, or empty for a cut>",
     "explanation": "<one or two sentences>",
     "user_text": "",
     "instructions": "<request.text>",
     "status": "pending",
     "selectedText": "<source comment's selectedText, if any>",
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
           "ref": {"kind": "suggestion", "id": "<new-uuid>"}
        },
        "createdAt": "<ISO now>"
     }],
     "aiOriginRequestId": "<requestId, if not virtual:-prefixed>"
   }
   ```
   `aiOriginRequestId` is forward-looking — the type doesn't yet
   declare it (see editor/AGENTS.md "Future work"), but emit it so
   the field is in place when the editor's Accept/Reject/Redo UI
   lands.

   For the link: copy `anchor.paragraphIds` and `anchor.margin` from
   the source comment's first link, generate a fresh link id, set
   `target.ref.kind` to `"suggestion"`, and set `target.ref.id` to
   the new card's own id (self-target — this is how the editor
   matches the card to its anchor at render time).

   `instructions` carries the source comment's `text` (the prompt
   that generated this AI draft) — gives the user a Redo-style replay
   handle. The type comment in `src/lib/types.ts:363` makes this its
   intended use.

4. **Apply.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   ```json
   { "requestId": "<requestId>",
     "panel": "cutter",
     "card": { ...the suggestion card... },
     "summary": "Drafted a cut suggestion: <first 60 chars of suggested_text>",
     "clearSourceFlag": true
   }
   ```

5. **Reply.**
   ```
   Done: drafted cutter suggestion <newId> for request <requestId>. Output: cutter.json (+ ai-requests.json, notifications, version).
   ```

## Safety

- `original_text` must be **verbatim** from the .tex — the editor
  uses it for accept-time matching. Don't paraphrase.
- Empty `suggested_text` means "cut entirely" — fine if the comment
  asks for a cut, otherwise propose a replacement.
- Never edit the source comment in place.
