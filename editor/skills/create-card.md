---
description: |
  Mechanically create a card of a given kind at an anchor, through the
  apply_response writeback contract. Triggers as the mechanical insertion step
  behind a footnote Task, or when you've composed a footnote body and need to
  land it (`create-card --kind=footnote --body "..."`). This skill does NOT
  compose content — the body is supplied by you (chat) or the calling skill;
  it builds the sidecar entry + the LaTeX atom marker and routes the write
  through `apply_response.py` (atomic, pen-protected, status/result set per the
  Task's safety level). v1 implements `--kind=footnote` only; other kinds are
  TODO. Does NOT trigger for composing prose (that's chat's job) or for
  non-footnote kinds yet. Args: <docPath> [<requestId>] --kind=<kind>
  [--body <text>] [--anchor <uuid>] [--safety-level 1|2|3].
---

# /editor/create-card $ARGUMENTS

The v1 mechanical **create** primitive (EDITOR_SKILLS_V1 §10). One skill, many
`--kind` values — same commandments across kinds, only the body shape differs.
It is purely mechanical: it inserts a card you (or a calling skill) hand it.
**Composition is chat's job, not this skill's.**

Every write goes through the single sanctioned writeback,
[`apply_response.py`](../scripts/apply_response.py): the card, the `.tex` atom
marker, the Task's `status`/`result`, the notification, and the version bump
land **atomically**, under the **editing pen** — never as separate edits.

## Kinds

v1 implements **`footnote`** only. The dispatch is generic; the other kinds
(`note`, `todo`, `citation`, `quotation`, `example`, `annotation`) are explicit
TODOs — each is a small addition (build its sidecar entry + any `\v*id{}` atom
marker) on this same contract, not a re-think. Running `--kind=<other>` errors
with a TODO message rather than guessing.

## Args

- `<docPath>` — the paper folder.
- `<requestId>` — the Task id (Workflow A). Omit it for a chat-initiated create
  (Workflow B), and pass `--anchor` instead.
- `--kind=footnote` — the only implemented kind in v1.
- `--body "<text>"` — the footnote body, **already composed** by you/chat.
- `--anchor <uuid>` — the paragraph `%!v:` UUID to anchor at (required for the
  chat path; for a Task it's read from `paragraphIds`).
- `--safety-level 1|2|3` — overrides the Task's `safetyLevel` for this run.

## Procedure (footnote)

The mechanics live in [`create_card.py`](../scripts/create_card.py); this skill
just decides the inputs and invokes it.

1. **Compose upstream.** Before calling this skill, the footnote body must be
   written (by you, in chat, from the Task text + paragraph context). If you
   need the surrounding prose or the existing apparatus, read it first:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=1
   python3 editor/scripts/cards_for_paragraph.py <docPath> <uuid>
   ```

2. **Pick the safety level.** A footnote is a **direct-create** kind: if the
   Task carries no `safetyLevel`, the footnote simply lands (the user opted in
   by asking for it). If the Task carries `safetyLevel: 1|2|3`, respect it; in
   Workflow B, ask the user when they haven't standardized one — *no implicit
   default beyond the direct-create case* (spec §8). `create_card.py` maps the
   level to the subcommand: 1 → `write-silent`, 2 → `write-with-comment`,
   3 → `complete-task --propose`; none → `complete-task` (direct-created).

3. **Run the create.**

   Workflow A — a Task already exists (anchor + level read from the request):
   ```bash
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=footnote --body "<composed body>"
   ```

   Workflow B — chat-initiated, no pre-existing Task (synthesizes one):
   ```bash
   python3 editor/scripts/create_card.py <docPath> --kind=footnote \
       --body "<composed body>" --anchor <uuid> [--safety-level N] \
       --task-text "<the user's ask>"
   ```

   `create_card.py` validates the anchor exists in the `.tex`, allocates a fresh
   `\vfid{<4hex>}` id, builds the `footnotes.json` entry and the
   `\vfid{<id>}\footnote{<body>}` splice, and commits through the contract. It
   prints a JSON result (`{ok, version, requestId, status, result, footnoteId,
   subcommand}`). It is idempotent — re-running on a terminal Task is a no-op.

4. **Reply.** One line:
   ```
   Done: create-card footnote <footnoteId> for <requestId> (<subcommand>). Output: footnotes.json + document.tex (+ ai-requests.json, notifications, version).
   ```
   For a Level-3 proposal, say the footnote is *drafted and awaiting review* —
   it's in the Footnotes panel but the `.tex` anchor isn't placed yet.

## Safety

- Don't hand-edit `document.tex` or the sidecars — route every write through
  `create_card.py` → `apply_response.py` so the pen + atomic transaction +
  status/result stay centralized. (This supersedes the older "skills do .tex
  edits with the Edit tool" rule; the pen now makes a direct atomic `.tex`
  write safe.)
- `\vfid{}` and the `footnotes.json` id must match — `create_card.py`
  guarantees this; don't construct them by hand.
- Don't fabricate a `\citet{key}` for a bibkey not in `references.bib` — that's
  a `citation` follow-up (see `draft-footnote` for the follow-up trail).
- If the anchor paragraph UUID isn't in the `.tex`, `create_card.py` refuses
  rather than guess — resolve the anchor first.
