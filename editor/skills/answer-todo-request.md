---
description: |
  Take care of a todo the user marked for AI in Virgil's Todos panel.
  Triggers on: "do this todo", "knock out my todo about X", "handle the
  AI todo here", "address the todo I flagged", or when there's a pending
  `kind: todo` request in the paper's AI-request inbox. Decides whether
  the todo asks for a doc edit (drafts a suggestion card), a footnote/
  citation (delegates to the matching specialist), or analysis (drafts
  a sibling note). Does NOT trigger for the user's own task-management
  todos outside of Virgil. Args: <docPath> <requestId>.
---

# /editor/answer-todo-request $ARGUMENTS

Resolve one AI request whose kind is `todo`. Todos are heterogeneous —
they can ask for anything from "tighten this paragraph" (text edit) to
"add a citation here" (delegate to find-citation) to "explain why this
matters" (write a note). Read the todo and dispatch.

> **Allowable-LaTeX doctrine.** Any LaTeX you compose or edit must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

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

3. **Land the result** per the chosen shape:

   - **Analysis / explanation → sibling note** *(migrated to the contract)*.
     Compose the note in chat, then land it via `create_card.py --kind=note`.
     A `note` answering a `todo` Task is a cross-kind answer, so declare it with
     `--accept-task-kind todo`. The one call builds the note, anchors it
     (Mode A), stamps `aiOriginRequestId`, sets the todo Task's two-field
     `status`/`result`, clears the todo's `aiRequest` flag, and bumps the version
     — atomically under the pen:
     ```bash
     # real todo requestId (bridged flag, kind=todo):
     python3 editor/scripts/create_card.py <docPath> <requestId> --kind=note \
         --accept-task-kind todo --body "<your note>" --title "<subject>" --margin right
     # virtual:todos:<cardId> (pre-bridge flag — anchor from the source todo):
     python3 editor/scripts/create_card.py <docPath> virtual:todos:<cardId> \
         --kind=note --body "<your note>" --title "<subject>" --anchor <uuid> --margin right
     ```
     `create_card.py` picks the subcommand from the Task's `safetyLevel` — none →
     direct create, 1 → silent, 2 → +comment, 3 → **propose** — you don't pick it.
     At level 3 the note still lands (it's sidecar-only — there's no `.tex` to
     withhold), but the Task is left `in-progress`, awaiting review. **Read the
     returned JSON `status`** to finalize (step 4): `complete` is terminal;
     `in-progress` means the answer is a proposal, *not done yet*.

   - **Text edit → suggestion card (L3 propose).** Build the
     `RevisionSuggestionCard` (`kind`, `id`, `createdAt`, `author: "ai"`,
     `original_text` — verbatim from the anchored paragraph, **excluding** its
     trailing `%!v:<uuid>` marker (it is the accept-time stale-guard key) —
     `suggested_text`, `explanation`, `user_text: ""`,
     `instructions: "<request.text>"`, `status: "pending"`, the canonical
     `links[]` anchor (`type: "textObject"` + `textObjectIds`), plus
     `aiOriginRequestId: <requestId>` when not `virtual:`-prefixed; see
     [`/editor/draft-suggestion`](draft-suggestion.md)), then land it via the
     contract's **propose** path:
     ```bash
     python3 editor/scripts/apply_response.py <docPath> complete-task --propose '<op-json>'
     # op: { requestId, panel:"revisions", card:{…}, summary, clearSourceFlag:true }
     ```
     The card lands and the todo's Task is left **awaiting review** (`status:
     in-progress`), the `.tex` untouched until the user accepts via
     `/editor/accept-suggestion`. This is the L3 propose path, *not* legacy
     default-apply.

   - **Footnote / citation / quotation → follow-up** and **action you can't
     take → complete-with-note**: unchanged (step 2) — file the follow-up
     request, or `apply_response.py <docPath> complete-only <id> --note "<limit>"`;
     neither creates a card here.

4. **Finalize the source todo by the returned outcome** — don't mark a proposal
   done:
   - **Sibling note with `status: complete`** (a direct / silent / auto-applied
     create) **or complete-with-limit**: set `done: true` on the source todo in
     `<docPath>/virgil/todos.json` after the create returns. `aiRequest` is
     already cleared by the contract; the contract has no `flipDone` op yet, so
     this stays a small post-step Edit (a future chip routes it through the
     `update` op).
   - **Sibling note with `status: in-progress`** (a level-3 **proposal**): leave
     the todo `done: false` and open — the note is drafted for review, and a
     later `/editor/review` re-lists the Task until the user accepts. Don't flip
     `done` on an answer the user hasn't accepted.
   - **Suggestion card** path: no — leave `done: false`; the accept flow flips
     it when the user accepts the suggestion.

5. **Reply.** Use the path-specific template:
   - Suggestion card path (awaiting review):
     ```
     Done: drafted suggestion <newId> for todo <cardId>, request <requestId> — awaiting review (accept/reject in the editor). Output: revisions.json (+ ai-requests.json status=in-progress, todos.json aiRequest cleared, notifications, version).
     ```
   - Sibling note path (`status: complete`):
     ```
     Done: drafted note <newId> for todo <cardId>, request <requestId>. Output: notes.json (+ ai-requests.json, todos.json done+aiRequest, notifications, version).
     ```
   - Sibling note path (`status: in-progress`, a level-3 proposal):
     ```
     Drafted note <newId> as a proposal for todo <cardId>, request <requestId> — awaiting review (todo left open). Output: notes.json (+ ai-requests.json status, todos.json aiRequest cleared, notifications, version).
     ```
   - Follow-up filed (footnote/citation/quotation):
     ```
     Done: filed follow-up <kind> request <newRequestId> for todo <cardId>. Output: ai-requests.json (+ todos.json aiRequest cleared, notifications, version).
     ```
   - Limit-explanation:
     ```
     Skipped <requestId>: <reason>. Source todo <cardId> marked done with note.
     ```

## Safety

- The note branch routes through `create_card.py` (the same contract
  `draft-footnote` / `create-card` use) — don't hand-build the note JSON or call
  `apply_response.py` directly for it. `--accept-task-kind todo` is what lets a
  `note` answer a `todo` Task.
- Don't fabricate completed todos. If the todo's intent is unclear,
  mark complete with a note rather than guessing.
- Suggestion cards land via the contract's `complete-task --propose` path with
  `status: "pending"`, the Task left awaiting review — the user always reviews,
  and the `.tex` changes only when they accept (`/editor/accept-suggestion`).
