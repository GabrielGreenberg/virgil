---
description: |
  Add a footnote to a paragraph in a Virgil document. Triggers on:
  "Virgil, add a footnote here", "draft me a footnote on X", "footnote
  this claim", "write a footnote about Y", or when there's a pending
  `kind: footnote` request in the paper's AI-request inbox. Composes the
  footnote prose, then lands it via `/editor/create-card --kind=footnote`
  (the apply_response contract). Does NOT trigger for adding a citation
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
> owns is the footnote-specific **composition** (prose + citation follow-up)
> below — that is chat's job, not the mechanical skill's.

Resolve one AI request whose kind is `footnote`. Footnote requests are
**direct creates** — they produce both a `FootnoteRef` in `footnotes.json` and
an inline `\vfid{<id>}\footnote{...}` command in `document.tex` at the anchor.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

0. **Validate.** Check the request: `kind == "footnote"` (otherwise refuse);
   the status is open (not the terminal `complete` / `failed` — re-running a
   terminal Task is a no-op); `paragraphIds` is non-empty. If `paragraphIds`
   is empty, halt — don't guess an anchor from the request text; reply with the
   halt template (step 4). (`create_card.py` re-validates the anchor against the
   `.tex` and refuses if it isn't found, so a bad anchor can't land a partial
   write.)

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

4. **Reply.** On success:
   ```
   Done: drafted footnote <footnoteId> for request <requestId>. Output: footnotes.json + document.tex (+ ai-requests.json, notifications, version).
   ```
   If a follow-up citation request was filed: `Filed follow-up citation request <newRequestId> for missing bibkey <bibkey>.`
   On halt (no `paragraphIds`): `Halted: request <requestId> has no paragraphIds; needs anchor before drafting.`

## Safety

- Don't hand-edit `document.tex` or `footnotes.json` — route the write through
  `create_card.py` so the `\vfid`/`footnotes.json` ids match, the pen is taken,
  and the multi-file write is atomic.
- Don't fabricate a `\citet{key}` for a bibkey not in `references.bib` — file a
  `citation` follow-up instead (step 3).
- If `paragraphIds` is empty, halt (don't guess an anchor from the text).
