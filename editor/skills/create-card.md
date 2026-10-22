---
description: |
  Mechanically create a card of a given kind at an anchor, through the
  apply_response writeback contract. Triggers as the mechanical insertion step
  behind a card-producing Task (footnote, citation, note, todo, report,
  report-request — not a Task flagged ON an existing footnote/citation, which
  is a revise and is refused) or an example block, or when you've composed a body/key and
  need to land it (`create-card --kind=<kind> …`). This skill does NOT compose
  content — the body/key is supplied by you (chat) or the calling skill; per
  kind it builds the sidecar entry + any LaTeX atom marker and routes the write
  through `apply_response.py` (atomic, pen-protected, status/result set per the
  Task's safety level). Does NOT trigger for composing prose (that's chat's job),
  or for system/derived kinds (ai / error / archive / bib / highlight). The
  responder outputs (a suggestion proposal, a Revisions sibling comment) land
  through the SAME script (`--kind=suggestion|comment`), but are invoked by
  the answer-* / draft-suggestion skills that decide on them, not routed here. Args: <docPath> [<requestId>] --kind=<kind> [--body <text>]
  [--citekey <k>] [--anchor <uuid>] [--safety-level 1|2|3] [per-kind flags].
---

# /editor/create-card $ARGUMENTS

The mechanical **create** primitive (EDITOR_SKILLS_V1 §10). One skill, many
`--kind` values — same commandments across kinds, only the card shape differs.
It is purely mechanical: it inserts a card you (or a calling skill) hand it.
**Composition is chat's job, not this skill's.**

Every write goes through the single sanctioned writeback,
[`apply_response.py`](../scripts/apply_response.py): the card, any `.tex` atom
marker, the Task's `status`/`result`, the notification, and the version bump land
**atomically**, under the **editing pen** — never as separate edits. The contract
is **kind-agnostic** (chip 3); each kind is a small, uniform payload on top of it
(no contract changes). The card shapes come from the operational manifest —
[cards.md](../../docs/workspace/cards.md) (which kind, which sidecar, which
discriminator, which linkage), [sidecars.md](../../docs/workspace/sidecars.md)
(field schemas), [anchoring.md](../../docs/workspace/anchoring.md) (anchor vs
atom-link), [identity.md](../../docs/workspace/identity.md) (the `\v*id` markers).

## Kinds

The create-able `CardKind` set (from [cards.md](../../docs/workspace/cards.md)'s
createable-kind taxonomy), grouped by linkage class:

| `--kind` | Class | Lands in | `.tex` marker | Required body |
|---|---|---|---|---|
| `footnote` | atom-bearing | `footnotes.json` | `\vfid{}\footnote{}` | `--body` |
| `citation` | atom-bearing | `citations.json` | `\vcid{}\<cmd>{key}` | `--citekey` |
| `note` | anchored, sidecar-only | `notes.json` · `cards` | — | `--body` |
| `todo` | anchored, sidecar-only | `todos.json` · `items` | — | `--body` |
| `report` | anchored, sidecar-only (poly `kind:"report"`) | `reports.json` · `cards` | — | `--body` |
| `report-request` | anchored, sidecar-only (poly `kind:"report-request"`) | `reports.json` · `cards` | — | `--body` |
| `example` | **tex-only** (no sidecar) | the `.tex` (`\vexid{}\ex…\xe`) | `\vexid` (+ `\vxid` rows) | `--body` or `--item` |

**The proposal family — same script, responder-owned** (task 1044):
`--kind=suggestion` builds a `revision-suggestion` / `cutter-suggestion` (the
PANEL is derived from the Task: a Cutter thread → `cutter.json`, else
`revisions.json`) and lands it as an L3 **proposal**; `--kind=comment` builds a
Revisions thread's sibling reply (`revision-comment`, a direct create). The
door copies the source card's anchor, mints ids / timestamps / the self-link,
stamps `instructions` + `aiOriginRequestId`, and refuses before any write if
`original_text` is not verbatim in the anchored paragraph or a revision's
replacement is empty. These are the answer-* / `draft-suggestion` skills'
outputs — they decide WHETHER to propose; this script only builds.

**Not create-card kinds** (don't route them here): `cutter-comment` (the
user's own Cutter thread); and the system/derived kinds `ai` (the Task itself), `error` (lint-derived, unpersisted),
`archive` (user-cut text), `bib` (the `.bib` file), and `highlight` (a Mode-B
range marker with no body). See [cards.md](../../docs/workspace/cards.md) for the
full reasoning.

> **Allowable-LaTeX doctrine.** Any LaTeX in a `--body`/`--citekey` you land
> must stick to the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

## Args

- `<docPath>` — the paper folder.
- `<requestId>` — the Task id (Workflow A). Omit it for a chat-initiated create
  (Workflow B), and pass `--anchor` instead. A `virtual:<panel>:<cardId>` id (a
  pre-bridge card flag with no Task row) is also accepted — pass `--anchor`; no
  Task is read, and the source card's `aiRequest` flag is cleared.
- `--kind=<kind>` — one of the rows above.
- `--anchor <uuid>` — the paragraph `%!v:` UUID to anchor at (required for the
  chat path; for a Task it's read from `paragraphIds`).
- `--range "@<file>"` — **pin the card to a span of text** in that paragraph
  instead of the whole paragraph (a Mode-B text-range anchor — what the user
  makes by selecting words and adding a card). The file holds the words
  **verbatim from the `.tex`** paragraph (any LaTeX inside included, never the
  `%!v:` marker). `note` / `todo` / `report` / `report-request` and the
  responder `suggestion` / `comment` take it; `footnote` / `citation` /
  `example` refuse it. The script wraps exactly that span in a `\vlid…\vlidend`
  pair (the id is allocated — never write one yourself) and writes the
  `linkedRange` link, in one commit — at every safety level, since the pair is
  the card's anchor, not a proposed edit. It REFUSES (nothing written) a span
  that is absent, repeats (add `--range-occurrence N`, or lengthen it), cuts a
  command or sits inside a `{…}` argument or `$…$` math, or overlaps another
  anchored range — pick whole words of plain prose, or a whole construct.
  For a `suggestion`, the range must contain `--original`.
- `--range-occurrence N` — which occurrence (1-based) of a repeated `--range`.
- `--safety-level 1|2|3` — overrides the Task's `safetyLevel` for this run
  (carded kinds only; see Safety). Omit for a direct create.
- `--accept-task-kind <kind>` — extra Task kind(s) a Workflow-A create may drain
  (a **cross-kind answer** — e.g. a `note` answering a `todo` Task, as
  `/editor/answer-todo-request` does). Repeatable. Without it, the Task's kind
  must match the card kind.
- `--synthesize` — force Task synthesis **even when a `<requestId>` is
  present**. You almost never need it: with no requestId the chat path
  synthesizes automatically (`create_card.py`'s `_resolve_context` — no
  request ⇒ synthesize), which is why the Workflow-B command below carries no
  such flag. It is the one way to synthesize a fresh Task over a
  `virtual:<panel>:<cardId>` id rather than treating it as a card-flag reply,
  and it requires `--anchor` like any synthesized create. The fresh Task is
  LINKED to that card (its flag is lowered, the card points back at the new
  row), and the revise-not-create refusal still applies — a footnote/citation
  flag is revised, never answered with a second atom. `--synthesize` with a
  REAL Task id is refused (that Task already has a row).
- **Re-running is safe.** A Task that is already terminal, or an L3 proposal
  whose card already landed (`in-progress` + `resultId`), returns
  `{"noop": true, "cardId": …}` naming the existing answer — never a second card.
> **Free-text flags take `@<file>`.** `--task-text`, `--body`, `--title`,
> `--notes`, `--item`, `--original`, `--suggested` and `--explanation` carry prose, so each goes through a quoted-heredoc
> scratch file and is passed as `--body "@$t/body"` — never as a quoted argv,
> where bash silently eats ``` ``quotes'' ``` and `$math$`. See
> [`_op-json.md`](_op-json.md) ("Free-text FLAGS") for the rule and the block.

- `--task-text "@<file>"` — the user's ask, recorded on the **synthesized**
  Task (Workflow B). Inert on Workflow A, where the Task already carries the
  user's text.
- `--body "@<file>"` — the card body, **already composed** by you/chat.
- `--title "@<file>"` — title for `note` / `report`.
- `--notes "@<file>"` — secondary notes field for `todo`.
- `--author human|ai` — `report` byline (default `ai`).
- `--ai-request` — set a `report-request`'s `aiRequest` flag (default off).
- `--citekey "k1[,k2…]"` — bib key(s) for `citation` (must already be in
  `references.bib`).
- `--cite-command <name>` — cite command for `citation`, e.g. `citet` / `citep`.
  **Omit it and the default comes from the DOCUMENT's bib family**
  (`bib_family.py`: stored `bibPackage` > live preamble load > live cite usage
  > natbib) — `citet` under natbib, `textcite` under biblatex. An explicit
  value still wins; one that is family-incompatible lands with a `warnings`
  entry on the result json rather than being rewritten (the app's locked
  "warn, never rewrite" decision for this question).
- `--original "@<file>"` / `--suggested "@<file>"` / `--explanation "@<file>"` —
  the three texts of a `--kind=suggestion` proposal: the span to replace,
  VERBATIM from the anchored paragraph (never the `%!v:` marker); the
  replacement (empty only for a Cutter cut); one or two sentences of why.
  (`--kind=comment` takes its reply as `--body`.)
- `--label <l>` / `--item "@<file>"` — `\label{}` / a `\pex` row for `example`
  (`--item` is repeatable → a `\pex`/`\a` list; otherwise `--body` → a single `\ex`).
- `--margin left|right` — **deprecated, ignored** (accepted so a stale bundle
  doesn't crash). A card's margin side follows its PANEL's dock and is
  resolved live by the app (`src/lib/margin-side.ts`); it is not storable.

## Procedure

The mechanics live in [`create_card.py`](../scripts/create_card.py); this skill
just decides the inputs and invokes it.

1. **Compose upstream.** Before calling this skill, the body/key must be ready
   (by you, in chat, from the Task text + paragraph context). If you need the
   surrounding prose or the existing apparatus, read it first:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=1
   python3 editor/scripts/cards_for_paragraph.py <docPath> <uuid>
   ```

2. **Pick the safety level.** Carded kinds are **direct-create** by default: if
   the Task carries no `safetyLevel`, the card simply lands (the user opted in by
   asking). If the Task carries `safetyLevel: 1|2|3`, respect it; in Workflow B,
   ask the user when they haven't standardized one — *no implicit default beyond
   the direct-create case* (spec §8). `create_card.py` maps the level to the
   subcommand: 1 → `write-silent`, 2 → `write-with-comment` (a sibling note rides
   along), 3 → `complete-task --propose` (drafted, `.tex` untouched, awaiting
   review); none → `complete-task` (direct-created). **`example` is the exception**
   — it is a direct tex-only create with no Task and no safety levels (see below).

3. **Run the create.**

   Workflow A — a Task already exists (anchor + level read from the request):
   ```bash
   t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-txt.XXXXXX")
   cat > "$t/body" <<'TXT'
   <composed body>
   TXT
   python3 editor/scripts/create_card.py <docPath> <requestId> --kind=<kind> --body "@$t/body"; rc=$?
   rm -rf "$t"
   exit "$rc"
   ```

   Workflow B — chat-initiated, no pre-existing Task (synthesizes one):
   ```bash
   t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-txt.XXXXXX")
   cat > "$t/body" <<'TXT'
   <composed body>
   TXT
   cat > "$t/ask" <<'TXT'
   <the user's ask>
   TXT
   python3 editor/scripts/create_card.py <docPath> --kind=<kind> \
       --body "@$t/body" --anchor <uuid> [--safety-level N] \
       --task-text "@$t/ask"; rc=$?
   rm -rf "$t"
   exit "$rc"
   ```

   Per-kind examples (`$t` is a `mktemp -d` scratch dir whose files you wrote
   through `<<'TXT'` heredocs exactly as above):
   ```bash
   # citation — \vcid{}\citep{key}; key must be in references.bib already
   create_card.py <doc> <reqId> --kind=citation --citekey smith2020 --cite-command citep
   # note / todo — anchored sidecar cards
   create_card.py <doc> --kind=note --body "@$t/body" --title "@$t/title" --anchor 4402
   create_card.py <doc> --kind=todo --body "@$t/body" --notes "@$t/notes" --anchor 4402
   # …pinned to a phrase rather than the paragraph ($t/span = the verbatim words)
   create_card.py <doc> --kind=note --body "@$t/body" --anchor 4402 --range "@$t/span"
   # report / report-request — same reports.json, different on-disk kind
   create_card.py <doc> --kind=report --body "@$t/body" --title "@$t/title" --anchor 1101
   create_card.py <doc> --kind=report-request --body "@$t/body" --anchor 2201
   # example — a single \ex, or a \pex list of rows
   create_card.py <doc> --kind=example --body "@$t/body" --label ex:foo --anchor 2207
   create_card.py <doc> --kind=example --item "@$t/item1" --item "@$t/item2" --anchor 2208
   ```

   `create_card.py` validates the anchor exists in the `.tex`, allocates a
   collision-free `\v*id{}` short id (atom/example kinds), builds the sidecar
   entry (or, for `example`, only the `.tex` block), splices any marker, and
   commits through the contract. It prints a JSON result (`{ok, version,
   requestId, status, result, cardId, <kindId>, subcommand}`). It is idempotent —
   re-running on a terminal Task is a no-op.

4. **Reply.** One line, e.g.:
   ```
   Done: create-card <kind> <cardId> for <requestId> (<subcommand>). Output: <sidecar>.json + document.tex (+ ai-requests.json, notifications, version).
   ```
   For a Level-3 proposal, say the card is *drafted and awaiting review* — it's in
   the panel but the `.tex` anchor isn't placed yet.

## Per-kind notes

- **Phrase or paragraph?** If the card is about **specific wording** — a phrase,
  a term, one sentence — pin it to that text with `--range`; the user sees the
  words tinted and the card points at them. If it is about the paragraph's
  argument **as a whole**, keep the paragraph anchor (no `--range`). A Task the
  user filed on a selection already carries its span: answering it copies that
  anchor automatically, so pass `--range` only to pin somewhere else. That holds
  for EVERY kind here (note / todo / report / report-request as much as a
  suggestion or comment): a Task linked to a card — or a `virtual:` id at that
  card's own paragraph — inherits the card's live anchor, span and all, with no
  new `\vlid` pair in the `.tex` (task 1230). An `--anchor` at a different
  paragraph lands Mode A there; a kind that cannot hold a span falls back to
  the paragraph.

- **`aiOriginRequestId`** — a sidecar-only carded card (`note` / `todo` /
  `report` / `report-request`) created from a **real** Task is stamped with an
  `aiOriginRequestId` back-pointer to that Task (the editor's Accept / Reject /
  Redo affordance). The atom-bearing kinds (`footnote` / `citation`) carry no
  such field (they're id-equality atoms with no `links` array), and a `virtual:`
  card-flag id isn't stamped either (no Task to point at). You never hand-set it.
- **`citation`** is mechanical: it splices `\vcid{}\<cmd>{key}` and writes the
  `CitationRef`, but it does **not** add the bib entry. The citekey(s) must
  already be in `references.bib` — `create_card.py` refuses otherwise. Adding a
  source by description is [`find-citation`](find-citation.md)'s job.
- **`report` vs `report-request`** share one file (`reports.json` · `cards`),
  told apart only by the on-disk `kind` discriminator (the two-taxonomy rule,
  [cards.md](../../docs/workspace/cards.md)). A `report` is authored content
  (`author: "ai"` by default); a `report-request` is an *ask*. Answer a request
  by drafting a **new** `report`, never by overwriting the request.
- **`example`** is **tex-only**: the example *is* a TextObject in the `.tex`
  (`\vexid{}\ex…\xe`, or `\pex` with `\vxid{}\a` rows) and exists ONLY there —
  there is no example sidecar (`examples.json` is retired, task 726: the app
  neither reads nor writes it). So the skill writes only the `.tex` — no sidecar
  append, no Task (its lifecycle is "none"). It is a direct create; `--safety-level` and `<requestId>` don't apply.

## Safety

- Don't hand-edit `document.tex` or the sidecars — route every write through
  `create_card.py` → `apply_response.py` so the pen + atomic transaction +
  status/result stay centralized. (This supersedes the older "skills do .tex
  edits with the Edit tool" rule; the pen now makes a direct atomic `.tex`
  write safe.)
- `\v*id{}` markers and the sidecar `id` must match — `create_card.py`
  guarantees this; don't construct them by hand
  ([identity.md](../../docs/workspace/identity.md)).
- If the anchor paragraph UUID isn't in the `.tex`, `create_card.py` refuses
  rather than guess — resolve the anchor first.
- **A Task flagged ON an existing footnote/citation is a revise, not a create.**
  `create_card.py` refuses `--kind=footnote` when the Task's `linkedTo.panel` is
  `footnotes` (or the id is `virtual:footnotes:…`), and likewise `citation` on
  `citations` (`REVISE_NOT_CREATE`) — a create there would splice a duplicate
  atom. Route those through `/editor/draft-footnote` (branch E) /
  `/editor/find-citation`. Notes, todos and reports are not excluded: a new card
  answering a flagged one is their responders' legitimate output.
