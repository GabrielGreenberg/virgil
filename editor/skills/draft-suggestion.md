---
description: |
  Propose a revision to a paragraph in a Virgil paper. Triggers on:
  "Virgil, suggest a rewrite here", "propose an edit to this passage",
  "draft a revision of this paragraph", "tighten this for me", or when
  there's a pending **unbridged** `kind: suggestion` request in the
  paper's AI-request inbox (no `linkedTo`, or one bridged from a
  note / todo / report card — no comment thread). Creates a revision-suggestion card with author=ai
  for the user to accept or reject — does NOT edit the document
  directly. Does NOT trigger for a suggestion Task bridged from a
  panel comment: `linkedTo.panel == "cutter"` is answer-cutter-comment's
  and `== "revisions"` is answer-revision-request's. Use
  answer-note-request for adding a note. Args: <docPath> <requestId>.
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

> **Ask-shape doctrine.** A `suggestion` request means the user asked for a
> textual revision — it does **not** guarantee they want replacement text.
> Before composing, read
> [_ask-shape.md](_ask-shape.md) and check that a rewrite is what this ask
> actually calls for. A verification question ("can you check this quote",
> "is this right") wants **findings**, and findings do not fit in a
> suggestion's `explanation`.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

1. **Check ownership FIRST — before loading anything else.** Read the
   request's `linkedTo`. One wire `kind` (`suggestion`) has two bridged
   producers, and each has its own owner:

   | `linkedTo.panel` | owner | why |
   |---|---|---|
   | `"cutter"` | `/editor/answer-cutter-comment <docPath> <requestId>` | builds a `CutterSuggestionCard` into `"panel": "cutter"` |
   | `"revisions"` | `/editor/answer-revision-request <docPath> <requestId>` | three-way shape (suggestion / report / sibling comment) |
   | absent, or a `notes` / `todos` / `reports` card | **this skill** | a one-shot rewrite: the door anchors it to the source card and files it in `revisions.json` |

   If `linkedTo.panel` names an owner, **stop and hand off** — say so and
   invoke that skill instead. The panel is no longer the hazard it was: the
   builder derives it from the Task (task 1044), so even a direct invocation
   on a Cutter Task files its card in `cutter.json`. What the hand-off still
   protects is the *answer shape*: those owners weigh a sibling comment or a
   report against a rewrite, and read the thread they answer, which this
   skill does not. `/editor/review` routes on the pair, so a correctly
   dispatched run never reaches this gate.

2. **Load.** The request's drain row ([_request-load.md](_request-load.md) — never the raw
   `ai-requests.json` row). Paragraph context
   (neighbors=2) for whatever paragraph(s) the request anchors to. If
   `selectedText` is set on the request, that's the precise target;
   otherwise the whole anchored paragraph is the target.

3. **Check the ask-shape** ([_ask-shape.md](_ask-shape.md)) — before you
   write a word of replacement text. Read the request's `text` and ask what
   the honest answer *is*, not what it is about. A command to change the prose
   ("tighten this", "rewrite the opening") is this skill's job; proceed. A
   question about the world ("can you check this quote against the source",
   "is this attribution right", "find me the reference") wants **findings**,
   and its home is a report:
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
   That one call drains the `suggestion` Task, so do **not** also emit a
   suggestion — name both kinds in the `Done:` line so the redirect is
   visible, then **skip steps 4–6 and go straight to the report reply in
   step 7**. On a genuine coin-flip the panel wins: draft the suggestion and
   put the answer in its `explanation`.

4. **Compose.**
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

5. **Land the proposal — one call.** The card is built by the door, not by
   you: `create_card.py --kind=suggestion` mints the id, timestamps and
   self-link, derives the panel from the Task (a Cutter thread → `cutter.json`,
   anything else → `revisions.json`), copies the source card's anchor when the
   Task has one (else anchors at `paragraphIds[0]` / `--anchor`), stamps
   `instructions` (the drain row's `text`) and `aiOriginRequestId` (never for a
   `virtual:` id), and lands it through the L3 **propose** path (task 1044).
   You supply only the three texts, through `@` scratch files
   ([`_op-json.md`](_op-json.md) — `original_text` is lifted from the user's
   `.tex`, and bash eats `` ``quotes'' `` and `$math$` in a quoted argv):
   ```bash
   t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-txt.XXXXXX")
   cat > "$t/original" <<'TXT'
   <the span, verbatim from the .tex>
   TXT
   cat > "$t/suggested" <<'TXT'
   <your replacement>
   TXT
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
   suggestion is about a specific phrase or sentence rather than the paragraph as
   a whole, add `--range "@$t/span"` with those words verbatim from the `.tex` —
   the card lands on that span (Mode B), exactly as if the user had selected it. A
   Task already filed on a selection keeps its span without the flag. Rule +
   refusals: [create-card.md](create-card.md) → "Phrase or paragraph?". For a
   suggestion the span must contain `--original`: an explicit `--range` that misses it is refused; an inherited span that misses it
   degrades to the whole paragraph (result `anchorDegraded`, task 1235).

6. **What the door guarantees** (so don't restate it). The write is refused —
   nothing lands — when `original_text` is not found verbatim in the anchored
   paragraph (a paraphrase, or a span that swallowed the `%!v:` marker: the
   same locator accept's stale guard splices through), or when a revision's
   replacement is empty (task 957; only a Cutter cut may be empty). On success
   the card lands `pending`, the Task is left **awaiting review** (`status:
   in-progress`, `resultId` → the card), the `.tex` is untouched, and the
   source card's `aiRequest` flag (if any) is lowered. Re-running on a Task
   whose proposal already exists returns a `noop` naming that card — reply
   `Skipped … (already answered).` ([Idempotency](#idempotency)). The
   returned JSON's `cardId` is the `<newId>` for the reply.

7. **Reply.** On success:
   - Suggestion (awaiting review):
     ```
     Done: drafted suggestion <newId> for request <requestId> — awaiting review (accept/reject in the editor). Output: revisions.json (+ ai-requests.json status=in-progress, notifications, version).
     ```
   - Report — the step-3 re-route (created by its own `create_card.py`):
     ```
     Done: drafted report <newId> for request <requestId> (a suggestion Task answered as a report). Output: reports.json (+ ai-requests.json status/result, notifications, version).
     ```

## Idempotency

One rule for every responder: [_request-load.md](_request-load.md) →
"Idempotency". The drain decides whether `<requestId>` is still open, and a
writer's `noop: true` (or `apply_response.py`'s terminal refusal) is the belt
— never a `status` test of your own.

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
