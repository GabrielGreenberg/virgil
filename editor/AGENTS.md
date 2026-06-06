# Agent guide to /editor/

`editor/` is the home for the **editor-side skill set** — the Claude
slash commands that act on AI requests inside a Virgil paper folder.
Self-contained: skill markdown, Python helpers, and the bundle build
all live here. Pair with [library/AGENTS.md](../library/AGENTS.md);
the Library subsystem is the older sibling and the architectural
template.

## What the editor cowork does

The editor (the main Virgil app) lets users file three kinds of "I want
Claude to do something" signals while they write:

1. **`virgil/ai-requests.json`** — unified queue. Kinds: `footnote`,
   `note`, `report`, `citation`, `todo`, `suggestion`,
   `style-merge`. Two-field vocabulary (`EDITOR_SKILLS_V1` §7): `status`
   (`pending | in-progress | complete | failed`) + `result` (outcome, set on a
   terminal status) + optional `safetyLevel` (1/2/3). Legacy
   `status: draft | submitted` still parse and read as open.
2. **Card-level `aiRequest: boolean` flags** on notes, todos,
   cutter-comments, revision-comments. Bridged into the unified queue
   on toggle (see *Bridge* below).
3. **`virgil/bib-review-requests.json`** — per-bib-key reviews
   (`type: "fields" | "notes"`). Stays separate because it's
   per-bib-key, not per-paragraph.

The skill set turns those signals into responses:

- `/editor/review [<docPath>]` — umbrella drain, dispatches per-kind
  subskills.
- `/editor/draft-footnote` — direct-create footnote; routes the writeback
  through `create_card.py` → `apply_response.py` (the v1 contract).
- `/editor/answer-note-request`, `/editor/answer-report-request`,
  `/editor/answer-todo-request` — card-create responders; their
  **terminal-complete** branches route the writeback through
  `create_card.py` → `apply_response.py` (chip 11), and their **propose-flow**
  branches (the answer-note path-(a) / answer-todo text-edit → suggestion) now
  draft via `apply_response.py complete-task --propose` (chip 14). No skill
  hand-builds card JSON for these any more.
- `/editor/find-citation` — adds a `.bib` entry + a citation card as **one
  atomic op** through the contract (chip 12): the card rides `panel`/`card` and
  the `references.bib` append rides `bibEdit`, so a crash can't orphan one
  against the other.
- `/editor/answer-cutter-comment`, `/editor/answer-revision-comment`,
  `/editor/draft-suggestion` — responder-kind emitters (comment / the
  suggestion family). On the contract as of **chip 14**: a suggestion proposal
  drafts via `apply_response.py complete-task --propose` (the card lands, the
  Task is left awaiting review, the `.tex` untouched) — directly consumable by
  chip 13's `accept`; `answer-revision-comment`'s path-(b) sibling comment is a
  terminal `complete-task` create. No more legacy default-apply.
- `/editor/accept-suggestion`, `/editor/reject-suggestion` — the **L3
  consummation** (chip 13). A drafted suggestion proposal (revision- or
  cutter-) is reviewed, then either **accepted** — spliced into the `.tex`
  (`original_text` → `suggested_text` via the generic `replace-span` texEdit,
  stale-guarded) + status→accepted + Task done — or **rejected** (status→rejected
  + Task done, `.tex` untouched). Both resolve via `card_by_id.py` and route an
  `accept` / `reject` op through `apply_response.py` (one atomic, pen-protected
  commit). This closes the L3 *apply* loop: **all three safety levels ride the
  contract — L1 silent, L2 auto+comment, L3 propose→accept→splice.** With
  **chip 14** the L3 *draft* side joins it (the propose responders above), so
  **every editor skill now writes through `apply_response.py` — the legacy
  default-apply path is fully retired and the legacy/v1 split is dissolved
  (Phase 4 complete).**
- `/editor/answer-bib-review` — verifies/fills bibliography fields
  (`bibEdit` set-fields/replace), drafts annotations (`annotationEdit`), or
  (via `--library-sync`) swaps a single entry in from the Virgil Library
  (`bibEdit` replace **+ `renameCitekey`** — the entry body, its `\cite*{}`
  commands, and its citation cards retargeted in one atomic op; chip 16),
  writes-only. All through the contract — the bib-review row flip (or, for
  library-sync, the citekey rename) rides the same atomic commit.
- `/editor/sync-bib-to-library` — tidy a paper's whole bibliography
  against the library: matched entries are swapped to the library's
  authoritative form (renaming citekeys throughout the doc); missing
  entries are added via the library's bib-only triage + authenticate
  pipeline. Pair with `--dry-run` for a first pass.
- `/editor/style-merge` — preamble-merge rewrite through the contract (chip 12):
  the whole-preamble rewrite rides `texEdit` `region-replace`, the style-id flip
  rides `settingsEdit`, and the request completes — all in one pen-wrapped commit
  (no more pen-less hand-edits of the `.tex` / `document-settings.json`).
- **Card mechanics** — `/editor/create-card` (create a card of any
  createable kind) plus the five existing-card mutation ops
  `/editor/edit-card`, `/editor/archive-card`, `/editor/restore-card`,
  `/editor/move-card`, `/editor/link-cards`. Thin wrappers: each resolves
  the card with `card_by_id.py` and routes a create / `update` / `archive` /
  `restore` / `move` / `link` op through `apply_response.py` (atomic,
  pen-protected, one audit notification + version bump per op).

## Folder layout

```
editor/
├── skills/                     markdown skill SOURCES (mirrored to
│                               .claude/commands/editor/ by build)
│   ├── review.md
│   ├── draft-footnote.md
│   ├── find-citation.md
│   ├── answer-note-request.md
│   ├── answer-todo-request.md
│   ├── answer-cutter-comment.md
│   ├── answer-revision-comment.md
│   ├── answer-report-request.md
│   ├── draft-suggestion.md
│   ├── accept-suggestion.md    ┐ L3 consummation (chip 13): accept = splice +
│   ├── reject-suggestion.md    ┘ status; reject = status only. → accept/reject ops
│   ├── answer-bib-review.md
│   ├── style-merge.md
│   ├── create-card.md          mechanical create primitive (chip 8)
│   ├── edit-card.md            ┐ the five existing-card mutation ops (chip 9):
│   ├── archive-card.md         │ resolve via card_by_id, then route
│   ├── restore-card.md         │ update/archive/restore/move/link through
│   ├── move-card.md            │ apply_response (atomic, pen-wrapped)
│   ├── link-cards.md           ┘
│   └── reflect.md              dev-loop capture (chip 17, DEV mode only): write
│                               a tiered memo after a skill → reflect.py
├── scripts/                    Python helpers (stdlib-only, py3.10+)
│   ├── _common.py              shared paths/JSON/regex/notification helpers
│   ├── library_path.py         canonical resolver for the library folder
│   ├── list_requests.py        emits unified open-request JSONL
│   ├── get_para_context.py     paragraph at %!v:<uuid> + neighbors
│   ├── cards_for_paragraph.py  every card anchored to <uuid> across panels
│   ├── card_by_id.py           fetch any card by id across panel sidecars +
│   │                           archive (the shared lookup for the §10 ops)
│   ├── apply_response.py       atomic pen-wrapped writeback (card + .tex +
│   │                           .bib + settings + annotation + ai-requests +
│   │                           notif + version); v1 write subcommands + the §10
│   │                           existing-card mutation ops (+ chip-13 accept/reject
│   │                           — the L3 consummation) + the chip-12 paper-file
│   │                           edits (bibEdit/settingsEdit/annotationEdit, texEdit
│   │                           region-replace / replace-span) + chip-16 renameCitekey
│   ├── create_card.py          mechanical create-card (all createable kinds); → contract
│   ├── bib_resolve.py          parse + surgically edit references.bib entries
│   │                           (append/set-fields/replace) + annotation
│   ├── bib_match_library.py    classify paper bib entries vs the library
│   ├── rename_citekey.py       pure citekey-rename rewriters (rewrite_tex /
│   │                           rewrite_citations_json) — shared with the
│   │                           apply_response renameCitekey op; no standalone write
│   └── reflect.py              dev-loop memo writer (chip 17): gated on
│                               VIRGIL_DEV; reads the Task result, derives the
│                               tier, writes editor/dev/memos/ (no paper write)
├── build/
│   └── build-editor-bundle.mjs mirrors skills/ → .claude/commands/editor/
└── AGENTS.md                   ← this file
```

The build script runs via `npm run build:editor-bundle` (and on
predev/prebuild alongside the library bundle). Output is just the
mirror to `.claude/commands/editor/`; we don't yet emit a
`public/skill-bundle/` for end-user folder sync (see *Future work*).

## Cowork pattern

Same broker shape as the library:

```
Editor frontend                 Claude (separate session)
  │                               │
  │ writes intent ─────►          │
  │ ai-requests.json              │
  │ bib-review-requests.json      │
  │ aiRequest flags               │
  │   ↓ (bridge)                  │
  │ ai-requests.json              │
  │                               ◄ /editor/review reads
  │                               │
  │                               ◄ Claude writes back:
  │ notes.json / footnotes.json   │  via apply_response.py:
  │ ai-requests.json (status)     │   • new card
  │ notifications.json            │   • status flip
  │ version.txt                   │   • notification
  │                               │   • version bump
  ◄ polls notifications + version
    via useDocNotificationStream
```

The frontend never invokes Claude directly. It writes intent files;
Claude drains; the frontend polls for completion notifications and
reloads sidecars.

## Bridge: card flags → ai-requests.json

When a user toggles `aiRequest: true` on a note/todo/cutter-comment/
revision-comment, the React hook calls
[bridgeCardAiRequestFlag()](../src/lib/ai-request-bridge.ts) which
adds an entry to `ai-requests.json` with `linkedTo: { panel, cardId }`.
Toggling off removes the entry; toggling back on re-adds it (with
fresh paragraph context). This collapses three discovery paths into
two so `/editor/review` only needs to walk two files.

For papers created before the bridge landed, card-level flags exist
without matching `ai-requests.json` entries.
[list_requests.py](scripts/list_requests.py) handles those by emitting
a virtual id `virtual:<panel>:<cardId>` so the umbrella can still
process them. `apply_response.py` recognizes the virtual prefix and
clears the source flag without touching `ai-requests.json`.

## Path resolution for skills

Skills take an optional `<docPath>` arg (positional). Resolution order:

1. Explicit arg.
2. `cwd` if it has a `virgil/` subdir.
3. Error.

For dev (running Claude Code in `/Users/gabriel/Programming/virgil/`),
pass the doc path explicitly:

```
/editor/review samples/annotation-history
/editor/review virgil-data/doc_devtest
```

For end users running Claude Code in their paper folder, omit the
arg and it picks up `cwd`.

The Python helpers all take `<docPath>` as `argv[1]` — relative or
absolute, both work.

## Skill conventions (mirrored from library)

- One-line `Done: <action> for <id>. Output: <files>.` reply on
  success. Library precedent: see `library/skills/index-paper.md`.
- Idempotent: re-running a skill on a `status: "complete"` request is
  a no-op.
- Suggestion-card default: ambiguous responders emit a
  `RevisionSuggestionCard` (or `CutterSuggestionCard`) with `author:
  "ai"`, `status: "pending"` instead of editing in place.
- Direct-create kinds (footnote, citation) insert without
  a suggestion wrapper — the user can delete if unwanted.
- **Reflection (DEV mode) — the one shared seam.** When `VIRGIL_DEV=1`, reflect
  after completing **any** skill: invoke `/editor/reflect <docPath> <skill>
  <taskId>` to write a tiered dev-dream memo (the "day" capture layer of the
  self-improvement loop — EDITOR_SKILLS_V1 §14; subsystem SSOT
  [editor/dev/README.md](dev/README.md)). This is **one convention, not a
  per-skill step** — every current and future skill inherits reflection from
  this single rule; do not copy a "now write a memo" step into individual skill
  files. The umbrella [`/editor/review`](skills/review.md) **enforces** it for
  each subskill it dispatches; a directly-invoked skill reflects under this
  convention. Reflection consumes the Task's already-stamped two-field `result`
  (it does not re-derive the outcome), is read-only on the paper, and writes
  only to the gitignored `editor/dev/memos/`. Outside DEV mode it is a no-op
  (the script gates on `_common.dev_mode_enabled`), so it never runs — and
  cannot be turned on — in an end-user session. This is **distinct** from the
  per-paper "Memo discipline" below: that channel is cowork memos *about a
  paper*; this one is memos *about the skill set itself*.
- Memo discipline: dev memos under `<docPath>/.virgil/memos/<YYYY-MM-DD>-<slug>.md`,
  paper-specific reports under `<docPath>/notes/<slug>.md`. Only
  write a memo when something flagged a real ambiguity worth surfacing.

## Plumbing in `src/`

Three modifications + two new files in the main app:

| File | Change |
|---|---|
| [src/lib/types.ts](../src/lib/types.ts) | Extended `AiRequest` with `paragraphIds`, `selectedText`, `linkedTo`. Added `DocNotification`, `DocNotificationsInbox`. |
| [src/lib/ai-request-bridge.ts](../src/lib/ai-request-bridge.ts) | New. `bridgeCardAiRequestFlag()` keeps `ai-requests.json` in sync with card-level flags. |
| [src/hooks/useNotes.ts](../src/hooks/useNotes.ts), [useTodos.ts](../src/hooks/useTodos.ts), [useCutter.ts](../src/hooks/useCutter.ts), [useRevisions.ts](../src/hooks/useRevisions.ts) | Each `setXAiRequest` callback now invokes the bridge. |
| [src/hooks/useDocNotificationStream.ts](../src/hooks/useDocNotificationStream.ts) | New. 6-second poll of `<docPath>/virgil/notifications.json`; emits new items for the consumer to toast. Not yet wired to a UI host — toasting is a follow-up. |

## Cross-cutting with the Library

`/editor/sync-bib-to-library` is the first editor skill that writes to
the user's Virgil Library. The architectural choice is **single-session
cross-cutting**, not a two-session handshake: the editor session reads
`master.bib` and `.virgil/catalog.json` directly, and writes through
the library's `flock`-protected Python shims
(`update_master_bib_entry.py`, `update_catalog_entry.py`,
`append_inbox_item.py`, `bump_catalog_version.py`,
`triage_apply.py`). Those locks make it safe to interleave with a
parallel library session (`/loop /library/index-pending`) — the user
doesn't have to pause anything, just runs `/editor/sync-bib-to-library`.

The library's filesystem path is *not* discoverable from the browser
(it lives in IndexedDB as an FSA handle, with no exposed path). Editor
skills resolve it via [scripts/library_path.py](scripts/library_path.py),
which walks this chain:

1. `--library <path>` flag.
2. `VIRGIL_LIBRARY_ROOT` env var (the long-standing convention used
   by `library/scripts/audit_deepindex.py`).
3. `~/.config/virgil/library-path.json` (`{"libraryRoot": "...", "version": 1}`).
4. `~/Virgil-Library/` (legacy default).

Each candidate is validated against the
`master.bib` + `.virgil/catalog.json` + `.virgil/scripts/` triple —
stale records fail loudly rather than fall through. Set the central
config once with:

```bash
python3 editor/scripts/library_path.py --set /absolute/path/to/library
```

**Don't reimplement this resolution chain in other editor skills.**
Either call the script (`python3 editor/scripts/library_path.py
--get`) or `from library_path import resolve_library` and let the same
helper handle it.

## Helper script boundary

Use a Python script when the operation:
- Touches `.tex` lines (paragraph extraction, footnote insertion).
- Walks more than one sidecar atomically.
- Requires multi-file writes that must succeed-together-or-fail-together.

Inline `jq` in the skill markdown is fine for one-field reads or
simple status filters. Don't reimplement the paragraph-UUID regex in a
skill — call `get_para_context.py`.

## Future work (intentionally deferred)

- **End-user folder sync.** Today the build only mirrors to
  `.claude/commands/editor/` in the repo. For end users running
  Claude Code in their own paper folder, we need a sync mechanism
  paralleling `library/lib/skill-sync.ts`. The build would emit a
  `public/skill-bundle/editor/` and the editor would copy it into the
  doc's `.claude/` and `.virgil/scripts/` on first open.
- **Notification toaster UI.** `useDocNotificationStream` polls and
  surfaces items but isn't wired to a host. The host should be
  per-doc (Editor.tsx or EditorPane.tsx); see how `LibraryView.tsx`
  consumes the library version for the precedent.
- **Workspace template `<docPath>/.claude/CLAUDE.md`.** Per-doc
  workspace guide so a fresh Claude Code session opened in a paper
  folder loads the right context.
- **`aiOriginRequestId` UI affordances.** `create_card.py` now stamps
  `aiOriginRequestId` on every sidecar-only carded card created from a real Task
  (chip 11), so a result card points back at the Task that spawned it. The editor
  doesn't yet *read* the field to surface Accept / Reject / Redo — that UI wiring
  remains.
- **The skill-writeback migration is complete (Phase 4 done).** Every editor
  skill now writes through `apply_response.py` — the legacy default-apply path
  is retired and the legacy/v1 split is dissolved. The path there, chip by chip:
  the card-create terminal branches via `create_card.py` → `apply_response.py`
  (chip 11, alongside `draft-footnote` / `create-card`); the **`.bib` / preamble**
  skills `find-citation` / `answer-bib-review` / `style-merge` via the `bibEdit`
  / `settingsEdit` / `annotationEdit` capabilities + `texEdit` `region-replace`
  (chip 12); the L3 *apply* side — `/editor/accept-suggestion` +
  `/editor/reject-suggestion` consummating a drafted proposal via the generic
  `replace-span` texEdit + the `accept`/`reject` ops (chip 13); and finally the
  L3 *draft* side — the **propose responders** (`draft-suggestion`,
  `answer-cutter-comment`, `answer-revision-comment` path (a), and
  `answer-note-request` / `answer-todo-request`'s doc-edit branch) drafting via
  `complete-task --propose` so a proposal lands *awaiting review*, consumable by
  chip 13's `accept` (chip 14; `answer-revision-comment`'s path-(b) sibling
  comment lands as a terminal `complete-task` create). Chip 14 also fixed the
  responder anchor-shape drift at its root — `_common.card_paragraph_ids` now
  reads the canonical `textObject`/`textObjectIds` anchor shape (it had read the
  retired `anchor`/`paragraphIds` shape, returning `[]` for every real card),
  and the skill markdown documents copying the source card's canonical anchor
  verbatim rather than hand-building the retired form. Finally, chip 16 closed the
  last paper-side bypass: `sync-bib-to-library`'s citekey rename (via
  `answer-bib-review --library-sync`) now rides the `renameCitekey` contract op
  **bundled with the `.bib` swap** (reusing `rename_citekey.py`'s pure rewriters;
  its standalone `os.replace` write path is retired), so a library-swap of an
  entry — new bib body + every retargeted `\cite*{}` + every retargeted citation
  card — is ONE atomic commit. **No editor skill hand-edits a paper file outside
  the contract any more — the endpoint is fully true.**
- **`sync-bib-to-library`'s paper-side writes are now on the contract (chip 16
  — done).** Its citekey rename across `document.tex` + `virgil/citations.json`
  rides the `renameCitekey` op, bundled with the `references.bib` swap (`bibEdit`
  `replace`) into ONE atomic, pen-protected `apply_response` commit per entry (in
  `answer-bib-review --library-sync`). `renameCitekey` reuses `rename_citekey.py`'s
  pure rewriters (`rewrite_tex` / `rewrite_citations_json`); that module's
  standalone `os.replace` write path is retired, so the contract is the only
  writer. The cross-library `master.bib` / catalog orchestration stays — **by
  design** — on the library's own `flock`-protected shims (`triage_apply.py` et
  al.): a separate protected write path, not a contract bypass (see *Cross-cutting
  with the Library*).
- **Migrate the last sidecar hand-edit onto the `update` op.** The
  `apply_response.py` `update` op exists (chip 9 — alongside `archive` /
  `restore` / `move` / `link`, surfaced as `/editor/edit-card` + the four sibling
  card-ops). The one remaining responder hand-edit is `answer-todo-request`'s
  `done: true` flip on the source todo (the contract has no `flipDone` op yet) —
  route it through `/editor/edit-card` (the `update` op) so every card mutation
  stays centralized.

## Verification path

The canonical fixture is [samples/annotation-history/](../samples/annotation-history/),
which has 3 open AI requests (footnote, note, citation), 2 bib reviews
(grafton1997 fields, vannevar1945 notes), and 1 todo with `aiRequest:
true` (the "tighten the closing paragraph" task).

```bash
# unified inbox
python3 editor/scripts/list_requests.py samples/annotation-history
# expect: 6 open

# paragraph context
python3 editor/scripts/get_para_context.py samples/annotation-history f1c5

# adjacent cards
python3 editor/scripts/cards_for_paragraph.py samples/annotation-history f1c5

# bib resolution
python3 editor/scripts/bib_resolve.py samples/annotation-history grafton1997
```

End-to-end, `/editor/review samples/annotation-history` should drain
all six (creating cards or filing follow-up requests), bumping
`samples/annotation-history/virgil/version.txt` and appending entries
to `notifications.json`. **Do not run `/editor/review` directly
against `samples/annotation-history`** — it would mutate the canonical
fixture. Use `virgil-data/doc_devtest` (or any fresh clone) for
end-to-end tries.

## Iterating the skill set

`/editor/iterate-virgil-editor [<skill-name>] [<max-attempts>]` is the
dev meta-skill for stress-testing and refining the editor skills. It
synthesizes representative AI requests, clones
`samples/annotation-history` into a per-attempt sandbox under
`editor/dev/sandboxes/`, spawns a fresh runner subagent that executes
the target skill against the sandbox, reads a structured critique
memo from `editor/dev/iterations/`, edits the skill markdown, and
re-runs the same test case until it produces zero `[block]` items.
Both dev dirs are gitignored. See
[skills/iterate-virgil-editor.md](skills/iterate-virgil-editor.md).

The **dev-dream self-improvement loop** generalizes this from synthesized
single-skill stress-tests to ambient capture over *real* invocations. Its **day
half** (chip 17) is the capture layer: in DEV mode (`VIRGIL_DEV=1`) every skill
reflects via [`/editor/reflect`](skills/reflect.md) (the one convention above),
writing tiered memos to `editor/dev/memos/` (gitignored, the sibling of
`iterations/`). The **night half** — `/editor/dream`, which reads those memos
and ripples improvements back into the skill set — is chip 18. The subsystem's
single source of truth, including the memo schema and the relationship between
`iterations/` and `memos/`, is **[editor/dev/README.md](dev/README.md)**.

## Don't

- Don't hand-edit a **paper file** — `document.tex`, `references.bib`,
  `virgil/document-settings.json`, `virgil/annotations.json`,
  `virgil/bib-review-requests.json`, or any sidecar — from a skill or a Python
  helper. The `apply_response.py` contract is the **only** writeback path, and
  as of chip 12 (closed by chip 16's `renameCitekey`) it owns **every**
  paper-file write — there is no remaining skill hand-edit of a paper file —
  each riding the op-json in the *same* pen-protected atomic transaction:
  - `texEdit` — a `.tex` splice (the footnote `\vfid{}\footnote{}`) or, in
    `region-replace` mode, a whole-preamble rewrite (style-merge), or, in
    `replace-span` mode, the L3 accept splice.
  - `bibEdit` — append / set-fields / replace in `references.bib`
    (find-citation, answer-bib-review, library-sync).
  - `renameCitekey` — rewrite a citekey across the `.tex` `\cite*{}` commands +
    `virgil/citations.json` cards (reusing `rename_citekey.py`'s pure rewriters);
    bundles with a `bibEdit` `replace` for the one-atomic-op library-sync swap.
  - `settingsEdit` / `annotationEdit` — the two non-panel JSON sidecars
    (style-merge's styleId flip; answer-bib-review's annotation).
  A `requestId` that names a `bib-review-requests.json` bibKey completes that
  row in the same commit; a writes-only op (a `*Edit` with no `requestId`)
  lands a paper edit + audit with no Task flip (library-sync's `.bib` swap +
  citekey rename).
  The older rule ("skills do .tex edits with the Edit tool so they share the
  user's write-queue surface") was a stopgap for when there was no editing
  lock; the pen (`EDITOR_SKILLS_V1` §9 / `_common.acquire_pen`) makes a direct
  atomic write safe. If the op shape isn't a perfect fit, **extend the
  contract** (a new generic capability mirroring `texEdit`) — never add a
  parallel write path. It centralizes the notification/version-bump path.
- Don't add a backend. The cowork pattern is load-bearing, just like
  in the library.
