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
  `create_card.py` → `apply_response.py` too (chip 11), so no skill hand-builds
  card JSON for these. Their propose-flow branches (a suggestion / doc-edit)
  stay on the legacy default-apply for now (chip 13).
- `/editor/find-citation` — adds a `.bib` entry + a citation card as **one
  atomic op** through the contract (chip 12): the card rides `panel`/`card` and
  the `references.bib` append rides `bibEdit`, so a crash can't orphan one
  against the other.
- `/editor/answer-cutter-comment`, `/editor/answer-revision-comment`,
  `/editor/draft-suggestion` — responder-kind emitters (comment / the
  suggestion family); still legacy default-apply, migrate with the L3 propose
  flow (chip 13).
- `/editor/answer-bib-review` — verifies/fills bibliography fields
  (`bibEdit` set-fields/replace), drafts annotations (`annotationEdit`), or
  (via `--library-sync`) swaps a single entry in from the Virgil Library
  (`bibEdit` replace, writes-only). All through the contract (chip 12) —
  the bib-review row flip rides the same atomic commit.
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
│   ├── answer-bib-review.md
│   ├── style-merge.md
│   ├── create-card.md          mechanical create primitive (chip 8)
│   ├── edit-card.md            ┐ the five existing-card mutation ops (chip 9):
│   ├── archive-card.md         │ resolve via card_by_id, then route
│   ├── restore-card.md         │ update/archive/restore/move/link through
│   ├── move-card.md            │ apply_response (atomic, pen-wrapped)
│   └── link-cards.md           ┘
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
│   │                           existing-card mutation ops + the chip-12 paper-
│   │                           file edits (bibEdit/settingsEdit/annotationEdit,
│   │                           texEdit region-replace)
│   ├── create_card.py          mechanical create-card (all createable kinds); → contract
│   ├── bib_resolve.py          parse + surgically edit references.bib entries
│   │                           (append/set-fields/replace) + annotation
│   ├── bib_match_library.py    classify paper bib entries vs the library
│   └── rename_citekey.py       rewrite \cite*{} in tex + citations.json
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
- **Finish migrating the card-create writeback.** The terminal-complete branches
  of the card-create responders (`answer-note-request` / `answer-report-request`
  / `answer-todo-request`) now route through `create_card.py` →
  `apply_response.py` (chip 11), alongside `draft-footnote` / `create-card` — no
  skill hand-builds card JSON for them. The **`.bib` / preamble** skills
  (`find-citation`, `answer-bib-review`, `style-merge`) are now on the contract
  too (chip 12 — the `bibEdit` / `settingsEdit` / `annotationEdit` capabilities
  and `texEdit` `region-replace`). What remains: the **propose-flow** branches
  still on legacy default-apply (`answer-note-request` path (a),
  `answer-todo-request`'s doc-edit branch, and `draft-suggestion` /
  `answer-cutter-comment` / `answer-revision-comment`), which migrate with the L3
  accept→splice flow (chip 13); and **`sync-bib-to-library`**, whose cross-library
  `master.bib` orchestration + citekey-rename across the `.tex` + `citations.json`
  is a third write shape — its paper-side writes should route through the contract
  in a follow-up (the `rename_citekey.py` step still writes `document.tex` +
  `citations.json` directly).
- **Migrate sidecar hand-edits onto the `update` op.** The `apply_response.py`
  `update` op exists (chip 9 — alongside `archive` / `restore` / `move` / `link`,
  surfaced as `/editor/edit-card` + the four sibling card-ops). The remaining
  follow-up is the responders that still hand-edit a sidecar to *mutate* an
  existing card — notably `/editor/answer-revision-comment` (appends a turn) and
  `answer-todo-request`'s `done: true` flip — calling `/editor/edit-card` (the
  `update` op) so every mutation stays centralized.

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

## Don't

- Don't hand-edit a **paper file** — `document.tex`, `references.bib`,
  `virgil/document-settings.json`, `virgil/annotations.json`,
  `virgil/bib-review-requests.json`, or any sidecar — from a skill or a Python
  helper. The `apply_response.py` contract is the **only** writeback path, and
  as of chip 12 it owns every paper-file write, each riding the op-json in the
  *same* pen-protected atomic transaction:
  - `texEdit` — a `.tex` splice (the footnote `\vfid{}\footnote{}`) or, in
    `region-replace` mode, a whole-preamble rewrite (style-merge).
  - `bibEdit` — append / set-fields / replace in `references.bib`
    (find-citation, answer-bib-review, library-sync).
  - `settingsEdit` / `annotationEdit` — the two non-panel JSON sidecars
    (style-merge's styleId flip; answer-bib-review's annotation).
  A `requestId` that names a `bib-review-requests.json` bibKey completes that
  row in the same commit; a writes-only op (a `*Edit` with no `requestId`)
  lands a paper edit + audit with no Task flip (library-sync's `.bib` swap).
  The older rule ("skills do .tex edits with the Edit tool so they share the
  user's write-queue surface") was a stopgap for when there was no editing
  lock; the pen (`EDITOR_SKILLS_V1` §9 / `_common.acquire_pen`) makes a direct
  atomic write safe. If the op shape isn't a perfect fit, **extend the
  contract** (a new generic capability mirroring `texEdit`) — never add a
  parallel write path. It centralizes the notification/version-bump path.
- Don't add a backend. The cowork pattern is load-bearing, just like
  in the library.
