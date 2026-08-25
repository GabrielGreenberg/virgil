---
description: |
  Add a footnote to a paragraph in a Virgil document, OR revise an existing
  footnote the user flagged for AI help. Triggers on: "Virgil, add a footnote
  here", "draft me a footnote on X", "footnote this claim", "write a footnote
  about Y", "expand this footnote", or when there's a pending `kind: footnote`
  request in the paper's AI-request inbox. With NO `linkedTo`, composes new
  footnote prose and lands it via `create_card.py` (the apply_response contract).
  With `linkedTo.panel == "footnotes"` (a per-card AI-request flag), REVISES the
  existing footnote in place via `/editor/edit-card` rather than creating a
  duplicate. That flag is a free-text comment box, so an ask on it whose honest
  answer is FINDINGS ("check this quote against the source") re-routes to a
  report instead of a rewritten footnote. Does NOT trigger for adding a citation
  (use find-citation) or a margin note (use answer-note-request). Args:
  <docPath> <requestId>.
---

# /editor/draft-footnote $ARGUMENTS

> **Alias (migrating).** As of v1, `draft-footnote` is the *composition* front
> end for **`/editor/create-card --kind=footnote`**. The mechanical insertion
> — building the `FootnoteRef`, splicing `\vfid{}\footnote{}`, flipping the
> Task, bumping the version — now flows through the
> [`apply_response.py`](../scripts/apply_response.py) contract (atomic,
> pen-protected) via [`create_card.py`](../scripts/create_card.py). This skill
> stays for one release cycle so existing paper folders and muscle memory keep
> working; new callers should prefer `create-card`. What `draft-footnote` still
> owns is the footnote-specific **composition** (prose + the missing-bibkey todo)
> below — that is chat's job, not the mechanical skill's.

Resolve one AI request whose kind is `footnote`. **First ask whether the request
wants a footnote at all** — the flagged-card shape below is a free-text comment
box, so it is heterogeneous like every other prose panel's, and an ask whose
honest answer is *findings* re-routes to a report (step 0a,
[_ask-shape.md](_ask-shape.md)). Once it really is a footnote ask, there are
**two shapes**, split on whether the request points at an *existing* footnote
card:

- **Direct create** (no `linkedTo`, or `linkedTo` not pointing at footnotes) —
  the AIWindow-composed "add a footnote here" path. Produces both a `FootnoteRef`
  in `footnotes.json` and an inline `\vfid{…}\footnote{...}` command in
  `document.tex` at the `paragraphIds` anchor.
- **Act on an existing footnote** (`linkedTo.panel == "footnotes"`, or a
  `virtual:footnotes:<cardId>` id) — the user toggled the per-card AI-request
  flag (#55b) on a footnote they already wrote and wants Claude to
  *revise / answer / expand* it. **Do NOT create a new footnote** (that would
  duplicate it) — REWRITE the existing one in place via
  [`/editor/edit-card`](edit-card.md), which updates both `footnotes.json`
  `content` and the `.tex` `\footnote{}` body atomically. This mirrors
  `answer-note-request`'s linked-vs-standalone split.

> **Allowable-LaTeX doctrine.** Any LaTeX you compose or edit must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`. May be
  `virtual:footnotes:<cardId>` for a pre-bridge (or bridge-failed) card flag.

## Procedure

0. **Validate.** Check the request: `kind == "footnote"` (otherwise refuse);
   the status is open (not the terminal `complete` / `failed` — re-running a
   terminal Task is a no-op).

0a. **Ask-shape check — what does the ask actually want?** The shared rule,
   [_ask-shape.md](_ask-shape.md), governs, and it is answered *here*, before
   you compose anything.

   A `footnote` Task looks single-shape and is not. Its second shape (below) is
   a per-card AI-request flag the user toggled on a footnote they already
   wrote — i.e. **a free-text comment box on an existing card**, structurally
   the same input the note / todo / revisions responders guard, and the
   doctrine's §1 says every such box is heterogeneous. So a user who flags a
   footnote and types *"can you check this quote against the source?"* is
   asking for **findings**, not for their footnote to be rewritten.

   Ask what the honest ANSWER is, not what the question is about:

   - Does the ask want a question about the **world** answered — "check this
     quote", "is this attribution right", "what does the source actually say",
     "did X really publish this in 1978"? → **emit a report instead**, and do
     not touch the footnote. A footnote's body is apparatus prose, not a
     verification result with page cites; compressing findings into it is the
     tell §3 names, and it costs the user twice — the findings arrive truncated
     *and* their footnote comes back edited when they never asked for that.
     ```bash
     python3 editor/scripts/create_card.py <docPath> <requestId> --kind=report \
         --accept-task-kind footnote --anchor <uuid> --author ai \
         --title "<short title>" --body "<findings>"
     ```
     `report` is a doctrine **tier 1** kind (a self-sufficient builder), and
     `--accept-task-kind footnote` is what lets it drain a `footnote` Task —
     `WORKFLOW_A_KINDS` maps `report → {report}` by default, and the flag is a
     set union over it, so without the flag the call refuses the Task outright.
     `--anchor <uuid>` is the row's `paragraphIds[0]`, and it is **not
     optional**: the act-on-existing branch is exactly where a
     `virtual:footnotes:<cardId>` id arrives, and a virtual row has no Task for
     `create_card.py` to read an anchor off. If the row carries no
     `paragraphIds` at all, halt (step 4) rather than guessing.

     That one call drains the Task, so emit the report **instead of** a
     footnote, never alongside one (§4), and name both kinds in the `Done:`
     line so the redirect is visible.
   - Does the ask want the footnote's **prose** written, revised, expanded,
     tightened, re-toned, or a cite added to it? → that is what this skill
     does; carry on to the shape branch.
   - **On a genuine coin-flip the panel wins** (§5). An ask that both raises a
     question and wants the note improved is a footnote with the answer in it —
     that is the case the default handles well. Re-route on a *clear* mismatch
     only.

0b. **Pick the shape.** Two branches, split on whether the request points at
   an *existing* footnote card:
   - If `linkedTo.panel == "footnotes"` (real request) OR the id is
     `virtual:footnotes:<cardId>` → **act-on-existing** (jump to step E1).
   - Else (direct create) → require a non-empty `paragraphIds`. If it's empty,
     halt — don't guess an anchor from the request text; reply with the halt
     template (step 4). (`create_card.py` re-validates the anchor against the
     `.tex` and refuses if it isn't found, so a bad anchor can't land a partial
     write.)

### Act-on-existing branch (E)

E1. **Resolve the footnote.** The `cardId` is `linkedTo.cardId` (real request) or
   the `<cardId>` embedded in the `virtual:footnotes:<cardId>` id:
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId>
   ```
   `{found:false}` → halt (the flagged footnote no longer exists; reply with the
   halt template). Note its current `content` and the paragraph it sits in.

E2. **Load context + compose the revision.** Read the existing footnote body, the
   request `text` (what the user wants done — expand, tighten, answer a question,
   add a cite), and the host-paragraph context:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=1
   ```
   (`<uuid>` from `paragraphIds`, or — if the fallback delivered an empty
   `paragraphIds` because the bridge write failed — from the resolved card's
   anchor / the doc.) Compose the **revised** footnote body in the same plain-LaTeX
   style as step 2 below (same citation rules apply). Build on the existing
   content; don't discard the user's text unless they asked for a rewrite.

E3. **Land it via edit-card (the `update` op), NOT create.** Rewrite the existing
   footnote in place — this updates `footnotes.json` `content` AND the `.tex`
   `\footnote{}` body in one atomic, pen-protected transaction, and never spawns
   a duplicate:
   ```bash
   python3 editor/scripts/apply_response.py <docPath> update \
     '{"cardId":"<cardId>","body":"<revised footnote body>"}'
   ```
   Then complete the originating Task + clear the source flag (so the panel
   checkbox un-toggles and the request leaves the inbox). For a **real** request
   id, route the completion through the contract:
   ```bash
   python3 editor/scripts/apply_response.py <docPath> complete-task \
     '{"requestId":"<requestId>","summary":"Revised footnote <cardId>","clearSourceFlag":true}'
   ```
   For a `virtual:footnotes:<cardId>` id (no Task row), there is nothing to
   complete in `ai-requests.json`; instead clear the footnote's `aiRequest` flag
   via the `update` op (`'{"cardId":"<cardId>","set":{"aiRequest":false}}'`) so
   the fallback stops surfacing it. Reply with the act-on-existing template
   (step 4) and skip the direct-create steps below.

### Direct-create branch

1. **Load context.** Read the request from `<docPath>/virgil/ai-requests.json`,
   then gather what you need to compose a good footnote:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=1
   python3 editor/scripts/cards_for_paragraph.py <docPath> <uuid>
   ```
   If the request mentions a citation (e.g. "with a citation to X"), resolve
   the bibkey: `python3 editor/scripts/bib_resolve.py <docPath> <bibKey>`.

2. **Compose the body.** Draft the footnote as plain LaTeX text, ~80 words or
   less, matching the doc's apparatus tone (read other entries in
   `footnotes.json`). To cite, **ask the door for the document's family** —
   never guess, and never scan the preamble yourself
   ([_latex-allowlist.md](_latex-allowlist.md) § Citations):

   ```bash
   python3 editor/scripts/bib_family.py <docPath>
   ```

   Then pick the VOICE within that family: `\citet{...}`/`\citep{...}` under
   natbib, `\textcite{...}`/`\parencite{...}` under biblatex. Getting the
   FAMILY wrong is not a style slip — the other family's commands are
   undefined, and this body is spliced straight into `document.tex` by
   `create_card.py`, so a wrong guess is a non-compiling paper with no card to
   review first. Compose the cite **bare** — no `\vcid{…}` marker.
   Marker ids are ALLOCATED, never invented
   ([_latex-allowlist.md](_latex-allowlist.md) § What NOT to emit): a bare
   cite is minted a collision-free id on the next parse, exactly as a
   hand-typed one is. Use ` `` ... '' ` for inline
   quotes. **Don't fabricate a `\citet{key}` for a bibkey not in
   `references.bib`** — draft the prose without it and file a missing-bibkey
   todo card (step 3). This composition is the part `draft-footnote` keeps; everything
   mechanical is delegated in step 3.

3. **Land it via the contract.** Hand the composed body to `create_card.py`,
   which allocates the `\vfid` id, builds the `footnotes.json` entry, splices
   the `.tex`, and commits everything atomically under the pen — choosing the
   subcommand from the Task's `safetyLevel` (none → direct create; 1 → silent;
   2 → +comment; 3 → propose):
   ```bash
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=footnote --body "<composed body>"
   ```
   This replaces the old "edit `document.tex`, then call `apply_response.py`,
   and undo the edit if the second step fails" dance — the contract makes the
   `.tex` edit and the sidecar writes one all-or-nothing transaction, so there
   is no half-state to clean up.

   **Missing-bibkey follow-up — file a TODO CARD, never a Task row.** If you
   omitted a citation in step 2, after the footnote lands, track the hole as a
   **todo** through the contract's Workflow B (no `requestId`; `--anchor`
   supplies the paragraph and the contract synthesizes + completes its own
   Task). Carry the trail back to the footnote so whoever picks it up can
   splice the `\citet` deterministically:
   ```bash
   python3 editor/scripts/create_card.py <docPath> --kind=todo \
       --anchor <uuid> \
       --body "Add a bib entry for <author/year>; once in references.bib, splice \citet{<bibkey>} into footnote <footnoteId>."
   ```
   The original footnote Task still closes — the artifact landed; the citation
   hole is tracked separately. Mention the todo in your reply.

   **Why a card and not a request.** There is no door that appends a *pending*
   `ai-requests.json` row ([_ask-shape.md](_ask-shape.md) §4):
   `apply_response.py`'s subcommand set has none, and `--synthesize-task`
   stamps the running write's own `status`, so it can only synthesize the Task
   a write is *draining*. Earlier drafts of this step told you to append the
   row by hand — a raw write to the one sidecar `apply_response.py` exists to
   own, unserialized against the app and every other skill, outside the pen,
   with no version bump and no notification. A todo card is strictly better
   besides: it is VISIBLE in the Todos panel, and flagging it for AI mints a
   real bridged `todo` Task that `/editor/review` dispatches to
   `/editor/find-citation` — which is how the loop actually closes.

4. **Reply.** Per branch:
   - Ask-shape re-route (step 0a — a report emitted instead of a footnote; name
     BOTH kinds, so the redirect is visible rather than silent):
     ```
     Done: emitted report <reportId> for request <requestId> (panel implied a footnote; the ask wanted findings). Output: reports.json (+ ai-requests.json status/result, notifications, version).
     ```
   - Direct create:
     ```
     Done: drafted footnote <footnoteId> for request <requestId>. Output: footnotes.json + document.tex (+ ai-requests.json, notifications, version).
     ```
   - Act-on-existing (branch E):
     ```
     Done: revised footnote <cardId> for request <requestId>. Output: footnotes.json + document.tex (+ ai-requests.json status/result, notifications, version).
     ```
   If a missing-bibkey todo was filed: `Filed todo <todoId> for missing bibkey <bibkey> — flag it for AI to route it to /editor/find-citation.`
   On halt (direct create, no `paragraphIds`): `Halted: request <requestId> has no paragraphIds; needs anchor before drafting.`
   On halt (act-on-existing, footnote gone): `Halted: footnote <cardId> for request <requestId> no longer exists.`

## Safety

- Don't hand-edit `document.tex` or `footnotes.json` — route the write through
  `create_card.py` (direct create) or `apply_response.py update` /
  `/editor/edit-card` (act-on-existing) so the `\vfid`/`footnotes.json` ids
  match, the pen is taken, and the multi-file write is atomic.
- **Answer the ask, not the panel** ([_ask-shape.md](_ask-shape.md)): a flagged
  footnote is a free-text comment box, so an ask whose honest answer is
  *findings* gets a **report** (step 0a) — not a footnote with the findings
  compressed into it. Emit the report *instead of* the footnote, never both.
- **Act-on-existing must REWRITE, never re-create.** When the request carries
  `linkedTo.panel == "footnotes"` (or a `virtual:footnotes:` id), the user wants
  the *existing* footnote revised — direct-creating a new one would duplicate it.
  Use the `update` op (branch E), not `create_card.py`.
- **Find-or-surface, never fabricate** ([_find-or-surface.md](_find-or-surface.md)):
  don't fabricate a `\citet{key}` for a bibkey not in `references.bib` — write
  the prose without it and file a missing-bibkey **todo card** instead
  (step 3) — never a hand-written `ai-requests.json` row.
- If `paragraphIds` is empty (direct-create branch only), halt (don't guess an
  anchor from the text). The act-on-existing branch does NOT need `paragraphIds`
  on the request — it resolves the footnote by `cardId` and edits it in place.
