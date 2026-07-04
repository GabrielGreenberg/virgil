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

> **Allowable-LaTeX doctrine.** Any LaTeX you compose or edit must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

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

3. **Compose.** Draft the note body as plain text — `create_card.py` wraps it
   as Tiptap JSONContent (you no longer hand-build the doc node). Keep it tight:
   one to three short paragraphs. Match the user's tone (academic,
   conversational — read the source note first to gauge).

4. **Land it via the contract** *(paths (b)/(c))*. The composition above is this
   skill's job; the mechanical write is not. Hand the body to
   `create_card.py --kind=note` — it builds the `UserNote`, anchors it (Mode A),
   stamps the `aiOriginRequestId` back-pointer, flips the Task's `status`/`result`,
   clears the source flag, and bumps the version, all atomically under the pen.
   The subcommand is chosen from the Task's `safetyLevel` (none → direct create;
   1 → silent; 2 → +comment; 3 → propose) — you don't pick it. Carry the title via
   `--title`, the margin via `--margin` (notes sit on the **right**).

   - **Path (c) — standalone** (a real `ai-requests.json` id, no `linkedTo`):
     anchor is read from the Task. Title is a short descriptive subject phrase
     (no `Re:`), matching the convention of existing notes in `notes.json`:
     ```bash
     python3 editor/scripts/create_card.py <docPath> <requestId> --kind=note \
         --body "<your reply>" --title "<subject phrase>" --margin right
     ```
   - **Path (b) — sibling note** answering a source note (title `Re: <source title>`):
     - Real `requestId` (bridged flag, `linkedTo.panel == "notes"`): anchor read
       from the Task —
       ```bash
       python3 editor/scripts/create_card.py <docPath> <requestId> --kind=note \
           --body "<your reply>" --title "Re: <source title>" --margin right
       ```
     - Virtual id (`virtual:notes:<cardId>`, a pre-bridge flag with no Task row):
       pass the source note's paragraph as `--anchor` (from the request's
       `paragraphIds`, or the source note's anchor link) —
       ```bash
       python3 editor/scripts/create_card.py <docPath> virtual:notes:<cardId> \
           --kind=note --body "<your reply>" --title "Re: <source title>" \
           --anchor <uuid> --margin right
       ```

   `create_card.py` re-validates the anchor against the `.tex` and refuses if it
   isn't found (no partial write); it is idempotent — re-running on a terminal
   Task is a no-op. The `aiOriginRequestId` the editor reads for Accept / Reject /
   Redo is stamped **automatically** for a real `requestId` (never for a
   `virtual:` id — there's no Task to point at), so don't hand-build it. This
   replaces the old "hand-build the note JSON, then call `apply_response.py`"
   dance — one `create_card.py` call now owns the build + apply.

   **Path (a) — doc-edit → suggestion (L3 propose).** Emit a **suggestion card**
   in `revisions.json` and land it via the contract's propose path. See
   [`/editor/draft-suggestion`](draft-suggestion.md) for the full card shape:
   `author: "ai"`, `status: "pending"`, `original_text` verbatim from the
   anchored paragraph (the accept-time stale-guard key — exclude the `%!v:`
   marker), `suggested_text`, the canonical `links[]` anchor
   (`type: "textObject"` + `textObjectIds`), and `aiOriginRequestId:
   <requestId>` when the id isn't `virtual:`-prefixed.
   ```bash
   python3 editor/scripts/apply_response.py <docPath> complete-task --propose '<op-json>'
   ```
   ```json
   { "requestId": "<requestId>", "panel": "revisions",
     "card": { ...the suggestion... },
     "summary": "Drafted a suggestion: <first 60 chars>", "clearSourceFlag": true }
   ```
   The card lands and the Task is left **awaiting review** (`status:
   in-progress`), the `.tex` untouched until the user accepts via
   `/editor/accept-suggestion`. Leave the source note intact (the user's
   prompt); `clearSourceFlag: true` clears the note's `aiRequest` flag when the
   request was bridged from one. This is the L3 propose path — *not* legacy
   default-apply; it never edits the `.tex`.

5. **Reply.** One line, per path:
   - Path (b)/(c) — note created:
     ```
     Done: drafted note <newId> for request <requestId>. Output: notes.json (+ ai-requests.json status/result, notifications, version).
     ```
   - Path (a) — suggestion proposal (awaiting review):
     ```
     Done: drafted suggestion <newId> for request <requestId> — awaiting review (accept/reject in the editor). Output: revisions.json (+ ai-requests.json status=in-progress, notifications, version).
     ```

## Idempotency

If the request is already `status: "complete"`, skip with:
```
Skipped <requestId> (already complete).
```

## Safety

- For paths (b)/(c), don't hand-build the note JSON or call `apply_response.py`
  directly — route the write through `create_card.py` so the anchor,
  `aiOriginRequestId`, status/result, and version bump stay centralized (the
  same contract `draft-footnote` / `create-card` use). One future change to the
  contract then reaches this skill for free.
- Never edit the source note in place. Always create a new card.
- Never mutate `document.tex` from this skill.
- If you can't decide between sibling-note and suggestion-card, prefer
  the sibling note — it's the lower-cost, more reversible choice.

## Memo (cowork / paper note)

Drop a short **cowork memo** — a paper note, *about this paper* — under
`<docPath>/.virgil/memos/<YYYY-MM-DD>-answer-note-<requestId>.md`
**only** if you encountered an ambiguity in the source request that the
user should know about. Skip it on a clean, expected-shape pass. This is the
per-paper cowork channel — **not** a dev-loop reflection (those are a maintainer
tool: `/editor/reflect` → `editor/dev/memos/`, DEV mode only). Never label this
retro a "dev memo" or a "reflection."
