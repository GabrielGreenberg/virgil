---
description: Answer a `kind: todo` AI request — decides whether the todo asks for a doc edit (→ suggestion card), a footnote/citation (→ delegate), or analysis (→ sibling note). Args - <docPath> <requestId>.
---

# /editor/answer-todo-request $ARGUMENTS

Resolve one AI request whose kind is `todo`. Todos are heterogeneous —
they can ask for anything from "tighten this paragraph" (text edit) to
"add a citation here" (delegate to find-citation) to "explain why this
matters" (write a note). Read the todo and dispatch.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`. Often
  `virtual:todos:<cardId>` for a card-flag bridge.

## Procedure

1. **Load.** The request from `ai-requests.json` (or `linkedTo` from
   the virtual id), the source todo from `todos.json`, paragraph
   context for the anchored paragraph(s).

2. **Classify.** Read `todo.text` + `todo.notes` and decide:
   - **Text edit** ("tighten X", "rewrite Y", "fix the closing
     paragraph") → emit a **suggestion card** in `revisions.json`
     (`author: "ai"`, `status: "pending"`, with `original_text` from
     the anchored paragraph and `suggested_text` your proposal).
   - **Footnote / citation / quotation** → file a follow-up AI request
     of the appropriate kind via the storage layer, then mark the todo
     request complete with a note pointing at the new request.
     (Future: dispatch directly to the relevant subskill from this
     skill — for now, defer.)
   - **Analysis / explanation** ("why does this matter", "how does
     this connect to X") → emit a sibling **note** card.
   - **Action you can't take** ("get permission from coauthor",
     "check the dataset"): mark complete with a note explaining the
     limit; don't pretend.

3. **Build the result card** per the chosen shape (see
   `/editor/draft-suggestion` for revision-suggestion shape;
   `/editor/answer-note-request` for note shape).

4. **Apply.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   `clearSourceFlag: true` so the todo's `aiRequest` flag flips off.
   On a successful response, also flip the todo's `done: true` (this
   is part of the same `apply_response.py` write).

   *(If `done` flip isn't supported by the current `apply_response.py`
   op shape, do the source-card edit yourself by Editing
   `<docPath>/virgil/todos.json` directly after `apply_response.py`
   returns.)*

5. **Reply.**
   ```
   Done: <action> for todo <cardId> request <requestId>. Output: <files>.
   ```

## Safety

- Don't fabricate completed todos. If the todo's intent is unclear,
  mark complete with a note rather than guessing.
- Suggestion cards default to `status: "pending"` — the user always
  reviews before the suggestion changes the .tex.
