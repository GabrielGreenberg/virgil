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
  duplicate. Does NOT trigger for adding a citation (use find-citation) or a
  margin note (use answer-note-request). Args: <docPath> <requestId>.
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
> owns is the footnote-specific **composition** (prose + citation follow-up)
> below — that is chat's job, not the mechanical skill's.

Resolve one AI request whose kind is `footnote`. There are **two shapes**, split
on whether the request points at an *existing* footnote card:

- **Direct create** (no `linkedTo`, or `linkedTo` not pointing at footnotes) —
  the AIWindow-composed "add a footnote here" path. Produces both a `FootnoteRef`
  in `footnotes.json` and an inline `\vfid{<id>}\footnote{...}` command in
  `document.tex` at the `paragraphIds` anchor.
- **Act on an existing footnote** (`linkedTo.panel == "footnotes"`, or a
  `virtual:footnotes:<cardId>` id) — the user toggled the per-card AI-request
  flag (#55b) on a footnote they already wrote and wants Claude to
  *revise / answer / expand* it. **Do NOT create a new footnote** (that would
  duplicate it) — REWRITE the existing one in place via
  [`/editor/edit-card`](edit-card.md), which updates both `footnotes.json`
  `content` and the `.tex` `\footnote{}` body atomically. This mirrors
  `answer-note-request`'s linked-vs-standalone split.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`. May be
  `virtual:footnotes:<cardId>` for a pre-bridge (or bridge-failed) card flag.

## Procedure

0. **Validate + classify.** Check the request: `kind == "footnote"` (otherwise
   refuse); the status is open (not the terminal `complete` / `failed` —
   re-running a terminal Task is a no-op). Then determine the shape:
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
   `footnotes.json`). Cite via `\citet{...}`/`\citep{...}` (natbib) or
   `\textcite{...}`/`\parencite{...}` (biblatex); prepend a fresh
   `\vcid{<uuid>}` before each cite command. Use ` `` ... '' ` for inline
   quotes. **Don't fabricate a `\citet{key}` for a bibkey not in
   `references.bib`** — draft the prose without it and file a follow-up
   (step 3). This composition is the part `draft-footnote` keeps; everything
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

   **Missing-bibkey follow-up.** If you omitted a citation in step 2, after the
   footnote lands, file a `citation` follow-up by appending to
   `ai-requests.json` (no helper script for this — edit the file), carrying the
   trail back to the footnote so the citation responder can splice the
   `\citet` deterministically:
   ```json
   { "id": "<new-uuid>", "kind": "citation",
     "text": "Add a bib entry for <author/year>; once in references.bib, splice \\citet{<bibkey>} into footnote <footnoteId> on paragraph <uuid>.",
     "createdAt": "<ISO now>", "status": "pending",
     "paragraphIds": ["<uuid>"],
     "linkedTo": { "panel": "footnotes", "cardId": "<footnoteId>" } }
   ```
   The original footnote Task still closes — the artifact landed; the citation
   hole is tracked separately. Mention the follow-up in your reply.

4. **Reply.** Per branch:
   - Direct create:
     ```
     Done: drafted footnote <footnoteId> for request <requestId>. Output: footnotes.json + document.tex (+ ai-requests.json, notifications, version).
     ```
   - Act-on-existing (branch E):
     ```
     Done: revised footnote <cardId> for request <requestId>. Output: footnotes.json + document.tex (+ ai-requests.json status/result, notifications, version).
     ```
   If a follow-up citation request was filed: `Filed follow-up citation request <newRequestId> for missing bibkey <bibkey>.`
   On halt (direct create, no `paragraphIds`): `Halted: request <requestId> has no paragraphIds; needs anchor before drafting.`
   On halt (act-on-existing, footnote gone): `Halted: footnote <cardId> for request <requestId> no longer exists.`

## Safety

- Don't hand-edit `document.tex` or `footnotes.json` — route the write through
  `create_card.py` (direct create) or `apply_response.py update` /
  `/editor/edit-card` (act-on-existing) so the `\vfid`/`footnotes.json` ids
  match, the pen is taken, and the multi-file write is atomic.
- **Act-on-existing must REWRITE, never re-create.** When the request carries
  `linkedTo.panel == "footnotes"` (or a `virtual:footnotes:` id), the user wants
  the *existing* footnote revised — direct-creating a new one would duplicate it.
  Use the `update` op (branch E), not `create_card.py`.
- Don't fabricate a `\citet{key}` for a bibkey not in `references.bib` — file a
  `citation` follow-up instead (step 3).
- If `paragraphIds` is empty (direct-create branch only), halt (don't guess an
  anchor from the text). The act-on-existing branch does NOT need `paragraphIds`
  on the request — it resolves the footnote by `cardId` and edits it in place.
