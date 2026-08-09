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
2. **Card-level `aiRequest: boolean` flags** on notes, highlights, todos,
   cutter-comments, revision-comments, report-requests, and footnotes
   (footnote joined in BUG #55 — its flag lives in `footnotes.json` via
   `FootnoteRef.aiRequest`, and bridges a `kind: "footnote"` entry that
   `/editor/draft-footnote` drains). Bridged into the unified queue on toggle
   (see *Bridge* below).
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
- `/editor/answer-cutter-comment`, `/editor/answer-revision-request`,
  `/editor/draft-suggestion` — responder-kind emitters (comment / the
  suggestion family). On the contract as of **chip 14**: a suggestion proposal
  drafts via `apply_response.py complete-task --propose` (the card lands, the
  Task is left awaiting review, the `.tex` untouched) — directly consumable by
  chip 13's `accept`; `answer-revision-request`'s path-(b) sibling request is a
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
│   ├── answer-revision-request.md
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
│   ├── reflect.md              dev-loop capture (chip 17, DEV mode only): write
│   │                           a tiered memo after a skill → reflect.py
│   └── dream.md                dev-loop night (chip 18, DEV mode only): read the
│                               memos since the last dream → route → digest →
│                               reflect on itself; dream.py + dream_land.py
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
│   ├── reflect.py              dev-loop memo writer (chip 17): gated on
│   │                           VIRGIL_DEV; reads the Task result, derives the
│   │                           tier, writes editor/dev/memos/ (no paper write)
│   ├── dream.py                dev-loop night engine (chip 18): gated on
│   │                           VIRGIL_DEV; select (memos since last dream, via
│   │                           reflect._parse_memo) + digest (→ dream-digests/)
│   ├── dream_land.py           landing-mode classifier + the 3-boundary guard
│   │                           (chip 18): acts / proposes / refused. Pure,
│   │                           importable — shared by dream + iterate (chip 19)
│   └── dev_loop.py             the shared dev-loop engine (chip 19): composes
│                               reflect._parse_memo (reader) + dream_land
│                               (guard) into the read→derive→route spine.
│                               write_iteration_memo (iterate's unified-shape
│                               writer → editor/dev/iterations/) + route_edits
│                               (iterate's boundary-guard adoption). NOT a second
│                               parser/guard — the named door onto the shared ones
├── build/
│   ├── build-editor-bundle.mjs  emits the paper bundle + mirrors skills/ →
│   │                            .claude/commands/editor/ (see below)
│   └── __tests__/               guardrail for the paper-path rewrite
└── AGENTS.md                   ← this file
```

The build script runs via `npm run build:editor-bundle` (and on
predev/prebuild alongside the library bundle). It emits **two** outputs:

1. **`public/skill-bundle/editor/`** — the shipped paper bundle
   (`claude-commands/*.md` + `scripts/*`), stitched into the meta-manifest
   by `scripts/build-meta-bundle.mjs` and synced into each Virgil paper folder
   by [skill-sync.ts](../library/lib/skill-sync.ts) (`diskPathFor` maps
   `claude-commands/X.md → .claude/commands/editor/X.md` and
   `scripts/X.py → .virgil/scripts/editor/X.py`).
2. **`.claude/commands/editor/*.md`** — the repo dev mirror, surfacing the
   slash commands in a session opened in this repo.

**Paper-path rewrite (the one build-time transform).** Skill sources invoke
helpers repo-relative — `python3 editor/scripts/X.py` — which is correct for
the **dev mirror** (cwd = repo root). But a **synced paper folder** inverts the
nesting: helpers land at `.virgil/scripts/editor/X.py` with the paper root as
cwd. Rather than thread a dual-path resolver through every skill, the build
rewrites `editor/scripts/` → `.virgil/scripts/editor/` **once, at the bundle
boundary**, for the paper bundle's command markdowns only (the dev mirror is
written from unrewritten source). So skills stay natural — write the
repo-relative form and it is paper-correct for free (`rewriteScriptPathsForPaper`
in the builder; idempotent; pinned by `build/__tests__/`). A skill that already
carries its own dual-path resolver (`answer-bib-review`, `sync-bib-to-library`)
still works: the rewrite touches only the `editor/scripts/` path prefix, leaving
the no-slash `editor/scripts` fallback candidate in those loops intact.

**Underscore includes.** A leading-underscore skill file (e.g.
`_find-or-surface.md`) is a shared *include* other skills reference via
markdown links — it ships in the bundle but is **not** mirrored as a
slash command (same convention as the library builder). `_find-or-surface.md`
is the cross-silo "find-or-surface, never fabricate, Library-first"
doctrine; its canonical copy lives in `library/skills/` and a
byte-identical copy sits here so the editor bundle carries it. A
drift-guard test (`library/lib/__tests__/find-or-surface-doctrine.test.ts`)
keeps the two copies identical — edit **both**.

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
  ◄ reloads sidecars on version bump
```

The frontend never invokes Claude directly. It writes intent files;
Claude drains; the frontend reloads sidecars on a version bump.
(Completion entries are still appended to `notifications.json`, but the
client-side toaster hook that would surface them was never wired and has
been removed — task 033.)

## Bridge: card flags → ai-requests.json

When a user toggles `aiRequest: true` on a note/highlight/todo/cutter-comment/
revision-comment/report-request/footnote, the React hook calls
[bridgeCardAiRequestFlag()](../src/lib/ai-request-bridge.ts) which
adds an entry to `ai-requests.json` with `linkedTo: { panel, cardId }`.
Toggling off removes the entry; toggling back on re-adds it (with
fresh paragraph context). This collapses three discovery paths into
two so `/editor/review` only needs to walk two files. The `kind`/`linkPanel`
of the bridged entry are registry-declared (`CARD_REGISTRY[kind].aiRequest`,
R29) and pinned byte-for-byte by `ai-request-routing-contract.test.ts`.

For papers created before the bridge landed, card-level flags exist
without matching `ai-requests.json` entries.
[list_requests.py](scripts/list_requests.py) handles those by emitting
a virtual id `virtual:<panel>:<cardId>` so the umbrella can still
process them. `apply_response.py` recognizes the virtual prefix and
clears the source flag without touching `ai-requests.json`.

Footnotes (#55b) are protected by the SAME fallback as the other flag-bearing
kinds, with a footnote-specific twist. Their flag lives in `footnotes.json` (not
a panel card list) and their body is rich JSONContent, so `list_requests.py`'s
`PANEL_FILES` carries a `"footnotes"` row that flattens the body to a plain-text
summary. A footnote AI request is ALWAYS bridged into `ai-requests.json` on
toggle **with its anchoring `paragraphIds`** (resolved from the live `\footnote`
atom position by `EditorPane`'s `resolveFootnoteAnchor`, threaded through
`useFootnotes`), so the primary drain path is the unified queue
(`kind: "footnote"`). The `PANEL_FILES` fallback exists only for the best-effort
bridge-write-failure case — the bridge swallows I/O errors, so without the
fallback a failed write would silently drop the request. (Note: a footnote has
no `links` array, so the virtual fallback row's `paragraphIds` will be empty in
that degraded case — the skill then re-derives / asks for an anchor rather than
losing the request.)

**A footnote AI request acts on the EXISTING footnote, not a new one.** A bridged
`kind: "footnote"` request carrying `linkedTo.panel == "footnotes"` points at an
existing footnote card the user flagged for revision/expansion. `/editor/draft-footnote`
detects this `linkedTo` and routes to `/editor/edit-card --body` (which rewrites
both `footnotes.json` `content` and the `.tex` `\footnote{}` atomically), rather
than direct-creating a duplicate. A `kind: "footnote"` request with NO `linkedTo`
stays a direct create at the anchor (the AIWindow-composed "add a footnote here"
path). This mirrors `answer-note-request`'s linked-vs-standalone split.

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
- **Reflection (DEV mode) — the one shared seam.** When `VIRGIL_DEV=1`, a
  tiered dev-dream memo is written for **every** skill (the "day" capture layer
  of the self-improvement loop — EDITOR_SKILLS_V1 §14; subsystem SSOT
  [editor/dev/README.md](dev/README.md)). The **floor is automatic and needs no
  agent action**: `apply_response` (the one writeback chokepoint) fires
  `reflect.py` best-effort after every commit, so a correctly-classified memo
  lands even for a directly-invoked skill in a paper-cowork session. On top of
  that floor you *enrich*: invoke `/editor/reflect <docPath> <skill> <taskId>
  --memo-json …` (same `<skill>` the writeback used, so it merges) to add the
  four qualitative buckets; the umbrella [`/editor/review`](skills/review.md)
  does this for each subskill it dispatches. This is **one seam, not a per-skill
  step** — do not copy a "now write a memo" step into individual skill files.
  Reflection consumes the Task's already-stamped two-field `result` (it does not
  re-derive the outcome), is read-only on the paper, and writes only to the
  machine-global dev sink (`~/.virgil-dev/memos`, `VIRGIL_DEV_MEMOS_DIR`
  overrides). Outside DEV mode it is a no-op (both the tail-trigger and the
  script gate on `_common.dev_mode_enabled`), so it never runs — and cannot be
  turned on — in an end-user session, even though the scripts ship to every
  paper folder. This is **distinct** from the per-paper "Memo discipline" below:
  that channel is cowork memos *about a paper*; this one is memos *about the
  skill set itself*.
- Memo discipline (the **cowork-memo / paper-note** channel): notes *about a
  paper* go under `<docPath>/.virgil/memos/<YYYY-MM-DD>-<slug>.md`,
  paper-specific reports under `<docPath>/notes/<slug>.md`. Only
  write a cowork memo when something flagged a real ambiguity worth surfacing.
  This channel is **not** a dev-loop reflection — do not call it a "dev memo"
  (that label is retired; it is what caused reflections to misroute here). For a
  self-improvement note *about Virgil's skill set*, say "reflect" / use
  [`/editor/reflect`](skills/reflect.md) (→ `editor/dev/memos/`).
- **Memo routing rule (one decision, both channels point here).** Improving
  Virgil's *skills* → a **reflection** → `/editor/reflect` → `editor/dev/memos/`.
  A note about *this paper's* content → a **cowork memo** →
  `<docPath>/.virgil/memos/`. The words *reflect/reflection* **always** mean the
  former; never file a reflection under `.virgil/memos/`. (This rule is stated
  identically in [skills/reflect.md](skills/reflect.md) so it disambiguates the
  same way whichever file the agent reads.)

## Plumbing in `src/`

Three modifications + two new files in the main app:

| File | Change |
|---|---|
| [src/lib/types.ts](../src/lib/types.ts) | Extended `AiRequest` with `paragraphIds`, `selectedText`, `linkedTo`. Added `DocNotification`, `DocNotificationsInbox`. |
| [src/lib/ai-request-bridge.ts](../src/lib/ai-request-bridge.ts) | New. `bridgeCardAiRequestFlag()` keeps `ai-requests.json` in sync with card-level flags. |
| [src/hooks/useNotes.ts](../src/hooks/useNotes.ts), [useTodos.ts](../src/hooks/useTodos.ts), [useCutter.ts](../src/hooks/useCutter.ts), [useRevisions.ts](../src/hooks/useRevisions.ts) | Each `setXAiRequest` callback now invokes the bridge. |
| ~~`src/hooks/useDocNotificationStream.ts`~~ | Was a 6-second poll of `<docPath>/virgil/notifications.json` that emitted items for a consumer to toast. Never wired to a UI host; **removed (task 033)**. `notifications.json` is still appended on every completion (see `DocNotification` in [src/lib/types.ts](../src/lib/types.ts)); surfacing it is future work. |

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

> **An invocation you write is an invocation an agent runs.** A skill is a
> prompt, so a documented flag the script never declared is a live defect, not
> a typo — and argv doesn't complain. `bib_auth.py` had no argparse at all
> while `find-citation` and `answer-bib-review` invoked it with
> `--query`/`--citekey`/`--title`/`--author`/`--type`; every one landed as a
> positional (`title="--query"`), so the lookup returned *garbage rather than
> an error* and the skills' only fallback trigger was `ModuleNotFoundError`
> (task 158). CI:
> [library/lib/\_\_tests\_\_/skill-script-cli-guardrail.test.ts](../library/lib/__tests__/skill-script-cli-guardrail.test.ts)
> reads every `<script>.py …` invocation in BOTH silos' skills — with or
> without a `python3` token, since `create-card.md` elides the interpreter and
> `setup.md` keeps it in a shell variable — and fails any `--flag` that
> appears nowhere in that script's source. Its allowlists are empty and should
> stay so: an entry there is a skill telling an agent to run something that
> can't work. The check is deliberately parse-agnostic (a third of the
> pipeline hand-rolls its argv walk), and a *commented* line is not an
> invocation. Paths get the same treatment from the other end — the paper
> bundle rewrites `editor/scripts/` **and** `library/scripts/` to their
> `.virgil/scripts/<silo>/` locations, so write the repo-relative form.

## Future work (intentionally deferred)

- **End-user folder sync — landed.** The build now emits
  `public/skill-bundle/editor/`, `scripts/build-meta-bundle.mjs` folds it into
  the meta-manifest, and [skill-sync.ts](../library/lib/skill-sync.ts) copies it
  into each paper folder's `.claude/commands/editor/` + `.virgil/scripts/editor/`
  (`diskPathFor`). The paper/repo path mismatch this created — helpers land at
  `.virgil/scripts/editor/` in a paper but `editor/scripts/` in the repo — is
  resolved by the build-time paper-path rewrite (see *Folder layout* above), so
  every skill's helper invocations resolve in a synced paper without per-skill
  boilerplate.
- **Notification toaster UI.** `notifications.json` is appended on every
  completion but nothing surfaces it (the never-wired
  `useDocNotificationStream` poller was removed — task 033). A future
  toaster host should be per-doc (Editor.tsx or EditorPane.tsx); see how
  `LibraryView.tsx` consumes the library version for the precedent.
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
  `answer-cutter-comment`, `answer-revision-request` path (a), and
  `answer-note-request` / `answer-todo-request`'s doc-edit branch) drafting via
  `complete-task --propose` so a proposal lands *awaiting review*, consumable by
  chip 13's `accept` (chip 14; `answer-revision-request`'s path-(b) sibling
  request lands as a terminal `complete-task` create). Chip 14 also fixed the
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
the target skill against the sandbox, reads the runner's critique
memo from `editor/dev/iterations/` (written by `dev_loop.py` in the
**unified memo shape**, chip 19), **routes each proposed skill edit
through the boundary guard** (`dev_loop.py route-edits` →
`dream_land.classify_change`), edits the skill markdown inline, and
re-runs the same test case until the memo is no longer `flagged`. It
stays synchronous + inline (no commit, no worktree). Both dev dirs are
gitignored. See [skills/iterate-virgil-editor.md](skills/iterate-virgil-editor.md).

The **dev-dream self-improvement loop** generalizes this from synthesized
single-skill stress-tests to ambient capture over *real* invocations. Its **day
half** (chip 17) is the capture layer: in DEV mode (`VIRGIL_DEV=1`) every skill
reflects via [`/editor/reflect`](skills/reflect.md) (the one convention above),
writing tiered memos to `editor/dev/memos/` (gitignored, the sibling of
`iterations/`). The **night half** — [`/editor/dream`](skills/dream.md), chip 18
— reads those memos and ripples improvements back into the skill set: it routes
each change by scope (single-skill-prompt polish lands directly; cross-skill /
script / manifest / contract changes propose via a worktree) through the
`dream_land.py` landing-mode helper, which **is** the three-boundary guard (the
dream cannot edit the Don't-rules below, change the `apply_response.py` contract
shape, or disable DEV mode), and writes a morning digest to
`editor/dev/dream-digests/`. **Chip 19 put `iterate` and `dream` on one engine**
— one critique-memo shape, one reader (`reflect._parse_memo`), one boundary
guard (`dream_land`), composed by [`dev_loop.py`](scripts/dev_loop.py). `iterate`
adopts `dream_land` as a **boundary guard only**: it honors `refused`, surfaces
`proposes` for scrutiny, and lands non-refused edits **inline** — it does NOT
take on `dream`'s propose-via-worktree autonomy (that stays `dream`-specific).
`iterations/` and `memos/` are two labeled streams of the **one** shape. The
subsystem's single source of truth, including the memo schema, the dream's
landing modes + boundaries, and the unified engine, is
**[editor/dev/README.md](dev/README.md)**.

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
