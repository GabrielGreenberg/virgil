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
the user can accept (accepting splices the replacement into the `.tex` at
once — see step 5).

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
   t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-txt.XXXXXX")
   cat > "$t/title" <<'TXT'
   <short title>
   TXT
   cat > "$t/body" <<'TXT'
   <findings>
   TXT
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=report \
       --accept-task-kind suggestion --anchor <uuid> --author ai \
       --title "@$t/title" --body "@$t/body"; rc=$?
   rm -rf "$t"
   exit "$rc"
   ```
   That call drains the Task; emit the report *instead of* a cut, and name
   both kinds in the `Done:` line. **Then skip steps 3–5 and go straight to
   the report reply in step 6** — the Task is already `complete`, and a cut
   proposal landed after it is refused by the contract (task 787) rather
   than written. On a genuine coin-flip the panel wins.

3. **Compose.** Identify the slice of the anchored paragraph(s) you'd
   cut or rewrite. Mode B: if `selectedText` is set on the comment,
   that's already the target span. Mode A: pick a coherent subspan
   from the paragraph to address the comment.

4. **Land the proposal — one call** (task 1044). The `CutterSuggestionCard`
   is built by the door, not by you: `create_card.py --kind=suggestion` reads
   the Task's `linkedTo.panel == "cutter"` and files the card in
   `cutter.json`, copies the source comment's first-link anchor verbatim
   (Mode A, or Mode B with its `textRange`), mints the id / timestamps /
   self-link (`cutter-suggestion`), stamps `instructions` (the drain row's
   `text`, [_request-load.md](_request-load.md)) and `aiOriginRequestId` (never for a `virtual:` id — both finishers
   complete the Task through it), carries the comment's `selectedText`, and
   lands it through the L3 **propose** path. Supply the three texts through
   `@` scratch files ([`_op-json.md`](_op-json.md)); for a pure cut leave the
   replacement empty:
   ```bash
   t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-txt.XXXXXX")
   cat > "$t/original" <<'TXT'
   <the slice, verbatim from the .tex>
   TXT
   : > "$t/suggested"            # a cut; or a heredoc with the shortened text
   cat > "$t/explanation" <<'TXT'
   <one or two sentences>
   TXT
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=suggestion --anchor <uuid> \
       --original "@$t/original" --suggested "@$t/suggested" \
       --explanation "@$t/explanation"; rc=$?
   rm -rf "$t"
   exit "$rc"
   ```

   **Pin to the words when the answer is about the words** (task 1197): if your
   cut suggestion is about a specific phrase or sentence rather than the paragraph
   as a whole, add `--range "@$t/span"` with those words verbatim from the `.tex`
   — the card lands on that span (Mode B), exactly as if the user had selected it.
   A Task already filed on a selection keeps its span without the flag. Rule +
   refusals: [create-card.md](create-card.md) → "Phrase or paragraph?". For a
   suggestion the span must contain `--original`: an explicit `--range` that
   misses it is refused; an inherited span that misses it degrades to the whole
   paragraph (result `anchorDegraded`, task 1235).

5. **What the door guarantees.** Nothing lands when `original_text` is not
   verbatim in the anchored paragraph (no paraphrase, never the `%!v:`
   marker — accept's stale guard asks the same question through the same
   locator). On success the card is `pending`, the Task **awaiting review**
   (`status: in-progress`), the `.tex` untouched until
   `/editor/accept-suggestion`, and the source comment's `aiRequest` lowered.
   A re-run on a Task whose proposal exists is a `noop` naming that card (on a
   `virtual:` id whose flag is already down, a `noop` with no `cardId` — the
   virtual proposal carries no back-pointer). The
   returned `cardId` is the `<newId>` for the reply.

6. **Reply.** On success:
   - Cut — suggestion (awaiting review):
     ```
     Done: drafted cutter suggestion <newId> for request <requestId> — awaiting review (accept/reject in the editor). Output: cutter.json (+ ai-requests.json status=in-progress, notifications, version).
     ```
   - Report — the step-2 re-route (created by its own `create_card.py`):
     ```
     Done: drafted report <newId> for cutter comment request <requestId> (a suggestion Task answered as a report). Output: reports.json (+ ai-requests.json status/result, notifications, version).
     ```

## Idempotency

One rule for every responder: [_request-load.md](_request-load.md) →
"Idempotency". The drain decides whether `<requestId>` is still open, and a
writer's `noop: true` is the belt — never a `status` test of your own.

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
