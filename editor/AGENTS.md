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
- `/editor/draft-footnote`, `/editor/find-citation` — direct creates.
- `/editor/answer-note-request`, `/editor/answer-todo-request`,
  `/editor/answer-cutter-comment`, `/editor/answer-revision-comment`,
  `/editor/answer-report-request`, `/editor/draft-suggestion` —
  responders that emit cards by default.
- `/editor/answer-bib-review` — verifies/fills bibliography fields,
  drafts annotations, or (via `--library-sync`) swaps a single entry
  in from the Virgil Library.
- `/editor/sync-bib-to-library` — tidy a paper's whole bibliography
  against the library: matched entries are swapped to the library's
  authoritative form (renaming citekeys throughout the doc); missing
  entries are added via the library's bib-only triage + authenticate
  pipeline. Pair with `--dry-run` for a first pass.
- `/editor/style-merge` — preamble-merge rewrite (existing behavior).

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
│   └── style-merge.md
├── scripts/                    Python helpers (stdlib-only, py3.10+)
│   ├── _common.py              shared paths/JSON/regex/notification helpers
│   ├── library_path.py         canonical resolver for the library folder
│   ├── list_requests.py        emits unified open-request JSONL
│   ├── get_para_context.py     paragraph at %!v:<uuid> + neighbors
│   ├── cards_for_paragraph.py  every card anchored to <uuid> across panels
│   ├── apply_response.py       atomic pen-wrapped writeback (card + .tex +
│   │                           ai-requests + notif + version), v1 subcommands
│   ├── create_card.py          mechanical create-card (v1: footnote); → contract
│   ├── bib_resolve.py          parse references.bib entry + annotation
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
- **Suggestion card with `aiOriginRequestId` UI affordances.** Result
  cards can carry `aiOriginRequestId` so the editor surfaces Accept /
  Reject / Redo buttons; today the field is set but the UI doesn't
  yet read it.
- **`apply_response.py` `update` op.** Skills that update an existing
  card (notably `/editor/answer-revision-comment`, which appends a
  turn) currently fall back to direct-Edit on the sidecar. Add an
  `update` op so the writeback stays centralized.

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

- Don't write to `document.tex` from a Python helper **except** through the
  `apply_response.py` contract's pen-protected atomic write — the v1 path,
  where the `.tex` edit rides in the op-json `texEdit` (e.g. the footnote
  `\vfid{}\footnote{}` splice) and lands in the *same* atomic transaction as
  the sidecars. The older rule ("skills do .tex edits with the Edit tool so
  they share the user's write-queue surface") was a stopgap for when there was
  no editing lock; the pen (`EDITOR_SKILLS_V1` §9 / `_common.acquire_pen`) now
  makes a direct atomic `.tex` write safe. Still don't hand-edit `.tex` outside
  that contract.
- Don't bypass `apply_response.py` for the writeback — even when the
  op shape isn't a perfect fit, route through it (or extend it). It
  centralizes the notification/version-bump path.
- Don't add a backend. The cowork pattern is load-bearing, just like
  in the library.
