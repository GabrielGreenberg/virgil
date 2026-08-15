---
description: |
  Propose a revision to a paragraph in a Virgil paper. Triggers on:
  "Virgil, suggest a rewrite here", "propose an edit to this passage",
  "draft a revision of this paragraph", "tighten this for me", or when
  there's a pending `kind: suggestion` request in the paper's
  AI-request inbox. Creates a revision-suggestion card with author=ai
  for the user to accept or reject — does NOT edit the document
  directly. Use answer-revision-request instead for responding to a
  revision-thread request, or answer-note-request for adding a note.
  Args: <docPath> <requestId>.
---

# /editor/draft-suggestion $ARGUMENTS

Resolve one AI request whose kind is `suggestion`. The user is asking
for a textual revision: rephrase, restructure, tighten, expand. Emit
a **RevisionSuggestionCard** with `author: "ai"`, `status: "pending"`.
The user accepts or rejects in the editor; never edit the .tex from
this skill.

> **Allowable-LaTeX doctrine.** Any LaTeX you compose or edit must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

> **Ask-shape doctrine.** A `suggestion` request means the user commented in
> the revisions or cutter panel — it does **not** guarantee they want
> replacement text. Before composing, read
> [_ask-shape.md](_ask-shape.md) and check that a rewrite is what this ask
> actually calls for. A verification question ("can you check this quote",
> "is this right") wants **findings**, and findings do not fit in a
> suggestion's `explanation`.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

1. **Load.** Request from `ai-requests.json`. Paragraph context
   (neighbors=2) for whatever paragraph(s) the request anchors to. If
   `selectedText` is set on the request, that's the precise target;
   otherwise the whole anchored paragraph is the target.

2. **Check the ask-shape** ([_ask-shape.md](_ask-shape.md)) — before you
   write a word of replacement text. Read the request's `text` and ask what
   the honest answer *is*, not what it is about. A command to change the prose
   ("tighten this", "rewrite the opening") is this skill's job; proceed. A
   question about the world ("can you check this quote against the source",
   "is this attribution right", "find me the reference") wants **findings**,
   and its home is a report:
   ```bash
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=report \
       --accept-task-kind suggestion --author ai \
       --title "<short title>" --body "<findings>"
   ```
   That one call drains the `suggestion` Task, so do **not** also emit a
   suggestion — name both kinds in the `Done:` line so the redirect is
   visible. On a genuine coin-flip the panel wins: draft the suggestion and
   put the answer in its `explanation`.

3. **Compose.**
   - `original_text`: copy verbatim from the .tex (selected slice for
     Mode B, full paragraph for Mode A). Include `\vcid{...}`,
     `\vfid{...}`, and inline LaTeX verbatim — don't invent fresh
     UUIDs for citations that already had them. Exclude the trailing
     `%!v:<uuid>` paragraph marker comment (editor-managed metadata).
   - `suggested_text`: your proposed replacement. Honor the request's
     constraints. If the request mentions a complaint that doesn't
     apply to the anchored paragraph (e.g. "too many em-dashes" when
     the paragraph has none), treat it as a *negative constraint* —
     don't introduce that pattern in the rewrite — but otherwise
     proceed with the rewrite the user actually wanted.
   - `explanation`: one or two sentences on what changed and why.
   - `user_text`: empty (the user fills this when refining).

4. **Build the RevisionSuggestionCard** (`RevisionSuggestionCard`,
   `src/lib/types.ts`):
   ```json
   { "kind": "suggestion",
     "id": "<new-uuid>",
     "createdAt": "<ISO now>",
     "author": "ai",
     "original_text": "<verbatim>",
     "suggested_text": "<your draft>",
     "explanation": "<rationale>",
     "user_text": "",
     "instructions": "<the request's `text` field>",
     "status": "pending",
     "selectedText": "<from request, if Mode B>",
     "links": [{
        "id": "<new-link-uuid>",
        "kind": "anchor",
        "anchor": {
           "type": "textObject",
           "targetKind": "paragraph",
           "textObjectIds": ["<the anchored paragraph uuid>"]
        },
        "target": { "type": "card", "ref": { "kind": "suggestion", "id": "<new-uuid>" } },
        "createdAt": "<ISO now>"
     }],
     "aiOriginRequestId": "<requestId, if not virtual:-prefixed>"
   }
   ```
   The anchor is the **canonical on-disk `LinkAnchor`** shape —
   `type: "textObject"` + `textObjectIds` (SSOT
   `src/links/_shared/types.ts`, [anchoring.md](../../docs/workspace/anchoring.md))
   — *not* the retired `type: "anchor"`/`paragraphIds` form. Set
   `textObjectIds` to the request's anchored paragraph uuid
   (`paragraphIds[0]`) and `target.ref.id` to this card's own id (self-target,
   how the editor matches the card to its anchor). The anchor carries NO
   `margin` — the side a card's chrome sits on follows its panel's dock and is
   resolved live by the app (`src/lib/margin-side.ts`).

   `aiOriginRequestId` is **load-bearing**: `/editor/accept-suggestion` reads
   it to complete the originating Task when the user accepts. Emit it for a
   real `ai-requests.json` id; omit it for a `virtual:`-prefixed one (there's
   no Task to point back at).

5. **Land the proposal** via the contract's **L3 propose** path. A suggestion
   is a *proposal*, not an applied edit — `complete-task --propose` lands the
   card and leaves the Task **awaiting review** (`status: in-progress`), the
   `.tex` untouched until the user accepts. (Legacy default-apply marked the
   Task `complete` at once and gave the proposal no L3 lifecycle; the propose
   path is what makes it consumable by `/editor/accept-suggestion`.)
   ```bash
   python3 editor/scripts/apply_response.py <docPath> complete-task --propose '<op-json>'
   ```
   ```json
   { "requestId": "<requestId>",
     "panel": "revisions",
     "card": { ...the suggestion... },
     "summary": "Drafted a suggestion: <first 60 chars of explanation>",
     "clearSourceFlag": false
   }
   ```
   The op shape is identical to a direct create — only the subcommand differs.
   The contract appends the card, points the Task's `resultId` at it, and
   leaves the Task `in-progress`; it splices **nothing** into the `.tex`.

6. **Reply.**
   ```
   Done: drafted suggestion <newId> for request <requestId> — awaiting review (accept/reject in the editor). Output: revisions.json (+ ai-requests.json status=in-progress, notifications, version).
   ```

## Safety

- `original_text` MUST match the .tex byte-for-byte — it is the **stale-guard
  search key** at accept time. `/editor/accept-suggestion` splices
  `original_text` → `suggested_text` only if `original_text` still appears
  verbatim in the anchored paragraph; a drifted span is refused, never blindly
  overwritten. Copy it from the live `.tex` (excluding the `%!v:` marker).
- Don't propose `suggested_text` that's just a paraphrase of the
  request — the user wrote the request to ask for change, not to read
  it back.
- This skill **never** edits the `.tex`. The proposal lands awaiting review;
  the document changes only when the user accepts (`/editor/accept-suggestion`)
  — or is dismissed by `/editor/reject-suggestion`.
