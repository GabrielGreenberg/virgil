---
description: |
  Respond to a comment the user flagged on a cut/excerpt in Virgil's
  Cutter panel. Triggers on: "answer my cutter comment", "respond to
  the comment on this cut", "address my question about this excerpt"
  — when the user is asking Virgil to follow up on something they
  noted on a Cutter card. Drafts a suggestion card responding to the
  comment's request. Does NOT trigger for revision requests (use
  answer-revision-request) or general notes (use answer-note-request).
  Args: <docPath> <requestId>.
---

# /editor/answer-cutter-comment $ARGUMENTS

Resolve one AI request originating from a Cutter-panel comment with
`aiRequest: true`. The Cutter panel is for drafting cuts to text; the
comment usually asks "is this paragraph really pulling its weight?"
or "trim this part." Default response is a **CutterSuggestionCard**
the user can accept (which queues the textual replacement).

> **Allowable-LaTeX doctrine.** Any LaTeX you compose or edit must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — usually `virtual:cutter:<cardId>` for a card-flag
  bridge, or a real `ai-requests.json` id with `linkedTo.panel ==
  "cutter"`.

> **This skill is the OWNER of `(kind: "suggestion", panel: "cutter")`.**
> `/editor/review` routes on that pair — the wire `kind` alone is ambiguous,
> because `ai_request_routing.json` maps both `cutter-comment` and
> `revision-comment` onto `suggestion` and separates them by `linkPanel`.
> The sibling half is `/editor/answer-revision-request`
> (`panel: "revisions"`); `/editor/draft-suggestion` owns only the
> **unbridged** case, and its op writes `"panel": "revisions"`
> unconditionally — so a cutter request answered there lands in the wrong
> sidecar.

## Procedure

1. **Load.** Source comment from `cutter.json` via `linkedTo.cardId`.
   Paragraph context via `get_para_context.py` (neighbors=2).
   Adjacent cards via `cards_for_paragraph.py`.

2. **Check the ask-shape** ([_ask-shape.md](_ask-shape.md)) — the Cutter's
   default output is a cut, but the comment box accepts any ask. "Trim this",
   "is this pulling its weight" → proceed, that is this skill's job. A
   question about the world whose answer is **findings** ("is this claim
   actually sourced", "check this quote against the original") belongs in a
   report instead:
   ```bash
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=report \
       --accept-task-kind suggestion --anchor <uuid> --author ai \
       --title "<short title>" --body "<findings>"
   ```
   That call drains the Task; emit the report *instead of* a cut, and name
   both kinds in the `Done:` line. On a genuine coin-flip the panel wins.

3. **Compose.** Identify the slice of the anchored paragraph(s) you'd
   cut or rewrite. Mode B: if `selectedText` is set on the comment,
   that's already the target span. Mode A: pick a coherent subspan
   from the paragraph to address the comment.

4. **Build the CutterSuggestionCard** (`CutterSuggestionCard`,
   `src/lib/types.ts`):
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
        "anchor": { ...COPIED VERBATIM from the source comment's first-link anchor... },
        "target": {
           "type": "card",
           "ref": {"kind": "suggestion", "id": "<new-uuid>"}
        },
        "createdAt": "<ISO now>"
     }],
     "aiOriginRequestId": "<requestId, if not virtual:-prefixed>"
   }
   ```
   For the link anchor: **copy the source comment's first-link
   `anchor` object verbatim**. It is already in the canonical on-disk
   `LinkAnchor` shape — `type: "textObject"` + `textObjectIds`
   (plus `textRange` when the comment is Mode B; SSOT
   `src/links/_shared/types.ts`,
   [anchoring.md](../../docs/workspace/anchoring.md)). Copying carries the
   mode and the paragraph id(s) in one move; do **not**
   hand-rebuild it into the retired `type: "anchor"`/`paragraphIds` form.
   Then generate a fresh link `id`, set `target.ref.kind` to
   `"suggestion"`, and set `target.ref.id` to the new card's own id
   (self-target — how the editor matches the card to its anchor at
   render time).

   `aiOriginRequestId` is **load-bearing**: `/editor/accept-suggestion`
   reads it to complete the originating Task on accept. Emit it for a real
   `ai-requests.json` id; omit it for a `virtual:`-prefixed one.

   `instructions` carries the source comment's `text` (the prompt
   that generated this AI draft) — gives the user a Redo-style replay
   handle.

5. **Land the proposal** via the contract's **L3 propose** path. A cut
   suggestion is a *proposal* — `complete-task --propose` lands the card and
   leaves the Task **awaiting review** (`status: in-progress`), the `.tex`
   untouched until the user accepts via `/editor/accept-suggestion`. (Legacy
   default-apply completed the Task at once and gave the proposal no L3
   lifecycle; the propose path is what makes it accept-consumable.)
   The op carries FREE TEXT (the card — including `original_text`, a span
   lifted verbatim from the user's `.tex`), so it goes through an `@` scratch
   file — see [`_op-json.md`](_op-json.md) for the rule and why:
   ```bash
   op=$(mktemp -t virgil-op)
   cat > "$op" <<'JSON'
   { "requestId": "<requestId>",
     "panel": "cutter",
     "card": { ...the suggestion card... },
     "summary": "Drafted a cut suggestion: <first 60 chars of suggested_text>",
     "clearSourceFlag": true
   }
   JSON
   python3 editor/scripts/apply_response.py <docPath> complete-task --propose "@$op"; rc=$?
   rm -f "$op"
   exit "$rc"
   ```
   `clearSourceFlag: true` flips the source comment's `aiRequest` to `false`;
   the textual replacement rides `/editor/accept-suggestion`, not this draft.

6. **Reply.**
   ```
   Done: drafted cutter suggestion <newId> for request <requestId> — awaiting review (accept/reject in the editor). Output: cutter.json (+ ai-requests.json status=in-progress, notifications, version).
   ```

## Safety

- `original_text` must be **verbatim** from the .tex — it is the
  **stale-guard search key** at accept time (`/editor/accept-suggestion`
  splices `original_text` → `suggested_text` only if it still matches the
  anchored paragraph; a drifted span is refused, never blindly applied). Don't
  paraphrase.
- Empty `suggested_text` means "cut entirely" — fine if the comment
  asks for a cut, otherwise propose a replacement (accept deletes the span).
- Never edit the source comment in place, and never edit the `.tex` here — the
  document changes only when the user accepts the proposal.
