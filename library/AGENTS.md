# Agent guide to /library/

`library/` is the dedicated home for the **Virgil Library** subsystem inside Virgil. Everything Library-specific — React components, hooks, utilities, TipTap extensions, CSS, skill markdown, Python pipeline, build script, and this doc — lives in this folder. A dev session can be pointed at `library/` (or this `AGENTS.md`) and have full context for any Library work without touching the broader Virgil flow.

## What the Library is

A user-picked folder (default `~/Virgil-Library/`) that holds an indexed catalog of academic source documents — PDFs and Word `.docx` files. Each source is converted into a Virgil-compatible paper folder (`papers/<citekey>/main.tex` + `papers/<citekey>/virgil/`). PDFs get `\pgmark{N}` printed-page anchors; DOCX sources have no printed-page anchors and rely on heading-level navigation. Indexed papers can be opened in Virgil's normal "Open paper" picker and read with the full editor surface.

Inside the Library tab, the UI is a 2-panel grid (left + optional right) with **inner library tabs** — Central (the full catalog) plus user-spawned curated libraries. The double-tab pattern (outer Virgil tabs → Library tab → inner library tabs) is intentional.

## Folder layout

```
library/
├── components/          React UI (LibraryApp orchestrates picker | gate | view)
│   ├── LibraryApp.tsx         entry shim — handle state machine
│   ├── LibraryView.tsx        2-panel grid + inner tab strips
│   ├── TabbedLibraryPanel.tsx
│   ├── PanelTabStrip.tsx, PanelFolderTab.tsx (tab chrome + geometry live at src/components/chrome/ — see sanctioned imports below)
│   ├── LeftList.tsx, LeftListRow.tsx, RowActionMenu.tsx
│   ├── RightDetail.tsx, PaperRender.tsx, PdfView.tsx
│   ├── BibCard.tsx, BibEditModal.tsx, StatusPill.tsx
│   ├── TopBar.tsx, Toaster.tsx, DropZone.tsx
│   └── LibraryFolderPicker.tsx, LibraryPermissionGate.tsx
├── hooks/               React hooks (state machines + polling)
│   ├── useLibraryHandle.ts, useLibraryTabs.ts
│   ├── useCatalog.ts, useMasterBib.ts, useUnsortedPdfs.ts
│   ├── useDropPdf.ts
│   ├── useNotificationStream.ts, useRowDotState.ts
├── lib/                 Pure logic + FSA boundary
│   ├── catalog.ts, catalog-store.ts (module-level singleton for Bibliography façade)
│   ├── queue-state-store.ts (the queue's poll channel), paper-ai-requests.ts
│   ├── library-store.ts, library-folder.ts, library-storage.ts
│   ├── queue.ts, bib-edit.ts, skill-sync.ts
│   ├── bib-parser.ts, latex-parser.ts, latex-serializer.ts
│   ├── cite-commands.ts, footnote-content.ts, types.ts, uuid.ts
│   ├── dnd-types.ts, list-columns.ts, row-viewed-store.ts
├── tiptap/              17 LaTeX-specific TipTap extensions
├── styles/library.css   Library-only CSS (paper-render, pgmark chips, pill tokens)
├── skills/              Markdown skill SOURCES (mirrored to .claude/commands/library/ by build)
├── scripts/             Python extraction pipeline + skill-bundle template + concurrency helpers (`_tools.py`, `update_catalog_entry.py`, `append_inbox_item.py`, `update_master_bib_entry.py`, `bump_catalog_version.py`)
└── build/               Skill-bundle build script (mirrors skills + scripts to public/skill-bundle/ and .claude/commands/library/)
```

Imports use `@library/*` (alias to `./library/*` in `tsconfig.json` and `vitest.config.ts`).

## Cowork pattern

Same as Virgil's `ai-requests.json` / `suggestions.json` flow: the frontend writes intent files; Claude (running in a separate session, ideally `/loop /library/index-pending`) drains them and writes back. The frontend never invokes Claude directly. Three channels:

1. `catalog-version.txt` — bumped on every skill run; the frontend polls this 1-byte file every 6s (see `library/lib/catalog.ts` and `library/lib/catalog-store.ts`).
2. `notifications/inbox.json` — append-only ring buffer for toasts.
3. `queue/*.json` — the INTENT files themselves, polled by
   [library/lib/queue-state-store.ts](lib/queue-state-store.ts) (below).

### A file written by both sides needs a poll channel — and exactly one

> **Every `.virgil/` file a skill can mutate out of band has ONE shared,
> refcounted poll in the frontend, and every LOCAL writer of that file pushes
> through the same channel. A surface never reads such a file on its own
> cadence — least of all "once, on mount".**

The catalog and the inbox had channels; the queue files did not, and each
consumer improvised (task 132). `useRowDotState` polled the queue directory
every 6 s for the list's red dot. `PaperHeader` read five targeted queue files
ONCE per `(handle, citekey)` mount — and the Reader is **kept alive**
(`ReaderLRU` wraps it in a `KeepAliveSlot`: `display:none`, not a remount), so
that effect never re-ran. A background `/loop /library/index-pending` session
would drain the queue and delete the file, the 6 s catalog poll would
re-RENDER the header, and the AI-request checkboxes + the `PaperAiRequestsMenu`
count badge went on claiming "queued" for the whole life of the tab. A
re-render does not re-run a same-deps effect. A third cadence (focus-regain,
one kind, in a `useBibReviewState` hook with zero consumers) has been deleted.

The gap ran the other way too: `LibraryView`'s row actions wrote a queue file
and notified nobody, so a request filed from the list never reached that
paper's open reader header, and the dot lagged a poll behind the click.

Three rules the store earns:

- **One scan, many consumers.** `useQueueState(handle)` refcounts a single
  directory scan (`catalog-store`'s tactic), so inside the Library tab the
  header derives its five checkboxes from the scan the row dots were already
  paying for — **zero** added disk reads, however many readers are kept alive —
  and both surfaces answer from the same bytes, so they cannot disagree. (In a
  standalone outer paper tab there is no list, so the scan is that surface's
  own: one polled directory listing in place of five one-shot file reads.)
- **The kind comes from the ENTRY, not the filename.** `index` and
  `authenticate` share `queue/<citekey>.json`, so only the entry's own `kind`
  separates them; reading by filename also meant a second table to keep in
  sync with `queueFilename` (the legacy `-richindex.json` spelling normalizes
  through `normalizeQueueEntry` for free). The five kinds are declared once in
  [library/lib/paper-ai-requests.ts](lib/paper-ai-requests.ts) as a `Record`
  over the union — queue kind + enqueue/cancel + precondition together, so a
  half-wired kind is a compile error rather than a checkbox that reads one
  file and writes another.
- **A local write is a notification.** `refreshQueueState()` re-reads
  immediately and is awaited by every writer (the header's toggle, the row
  actions, the bib-edit modal) — never "trust our own write", since a
  deep-index request plants a companion `index` entry and a bib review can
  take the slot an index was holding.

Emits are equality-gated: an idle tick over an unchanged queue returns the
SAME snapshot object, so nothing re-renders (the `catalog-store` R6 rule), and
newest-scan-wins ordering keeps a scan that started before a write from
overwriting one that observed it. Contracts:
[queue-state-store.test.tsx](lib/__tests__/queue-state-store.test.tsx),
[paper-ai-requests.test.ts](lib/__tests__/paper-ai-requests.test.ts), and
[PaperHeader.queue-resync.test.tsx](components/__tests__/PaperHeader.queue-resync.test.tsx)
— which asserts the header WITHOUT unmounting it, the only shape that can
catch this class.

## How the Library tab plugs into Virgil

- `src/components/library/LibraryTabView.tsx` is a 6-line shim that renders `<LibraryApp />` from `@library/components/LibraryApp`.
- `src/hooks/useLibrary.ts` is a façade: it exports `useLibraryItems()` (consumed by Bibliography panel) by reading the catalog from `library/lib/catalog-store.ts` and mapping `CatalogEntry → LibraryIndexItem`.
- The `virgil-open-library` event bridge (`src/components/editor-layout/event-bridges/library.ts`) switches the active pane; `LibraryView` listens for the same event and sets the selected catalog row.
- Outer manila tabs in `src/components/EditorLayout.tsx` (lines ~4901–4943) and the content mount at lines ~5285–5288 are unchanged.

## Perf doctrine — keystroke sanctity, scroll anchors, pane drags

The library silo obeys the SAME performance laws as `src/` (root
[AGENTS.md](../AGENTS.md): "Keystroke sanctity", "Scroll-anchor stability",
"Pane-drag stability"), and the same CI guardrail tests enforce them here —
all three walk `library/` as well as `src/`:

- [src/lib/\_\_tests\_\_/keystroke-subscriber-guardrail.test.ts](../src/lib/__tests__/keystroke-subscriber-guardrail.test.ts)
- [src/lib/\_\_tests\_\_/scroll-reposition-guardrail.test.ts](../src/lib/__tests__/scroll-reposition-guardrail.test.ts)
- [src/lib/\_\_tests\_\_/pane-drag-guardrail.test.ts](../src/lib/__tests__/pane-drag-guardrail.test.ts)

**The allowlist convention** (identical to `src/`): the greps are heuristics,
so every legitimate site lives on a `PERMITTED_*` allowlist in the test WITH a
one-line justification of why it's O(1)/safe, and the same facts appear as a
comment at the site itself. The prose lists below and the test allowlists are
cross-references of the same reality — keep them in sync. If you cannot write
the justification, the subscriber is the bug, not the list.

### Keystroke sanctity (library edition)

The Reader renders the shared `EditorPane`, so the `src/` law applies
verbatim: no plugin, hook, or effect may do work proportional to document
size on each transaction. The library's ONE permitted
`editor.on("update"|"transaction")` subscriber:

- [library/hooks/usePgmarkPages.ts](hooks/usePgmarkPages.ts) — `\pgmark` page
  collection, docChanged-gated (the Reader is read-only, so plain transactions
  never fire it); layout re-scans go through a RAF-coalesced ResizeObserver
  that additionally PARKS during pane drags; the `pages` array is
  identity-gated (label+docY equality) so a no-op re-scan keeps consumer memos
  (`PaperRender`'s `pagePickerEl` → `EditorPane` memo) intact.

Anything new needs the O(1) justification + a matching entry in
`PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS`, or CI fails. Verify with
`window.__virgilBusStats()` in the dev preview: typing N plain characters in
an open paper must leave `emitCount` flat.

### Scroll anchors (library edition)

Same law as `src/`: an overlay anchored to content is either **layout-driven**
(lives in the scroll container, moves by layout, NO scroll listener) or a
**RAF-coalesced fixed portal** behind an equality bail. The library currently
has ZERO fixed-portal scroll repositioners — its guardrail allowlist
(`PERMITTED_LIBRARY_SCROLL_REPOSITIONERS`) is deliberately empty; the page
lozenge and header pod are host-relative, and `usePgmarkPages`' scroll
listener is a RAF-coalesced `scrollTop` read (no `position:fixed` overlay).
A new naive per-scroll-frame re-solve fails CI.

### Pane-drag doctrine

The regression class this kills: choppy/hanging gutter drags, ghost-resumed
gestures after a release over the pdf.js iframe, chrome outlines frozen
mid-drag that "snap" seconds later, and per-frame re-renders of the whole
Library tree. The rules:

- **Engine-only gestures.** Every divider in the app — the three Library
  gutters, the LeftList column-header drag, and all editor-side dividers —
  runs on the ONE gesture engine [src/lib/pane-resize/](../src/lib/pane-resize/)
  (`usePaneResizeHandle`): pointer capture on the handle, element-scoped
  move/up/cancel/lostpointercapture, `button===0` start gate, `(buttons & 1)===0`
  missed-release failsafe (the primary-button bit test — a chorded second
  button must not mask the release), Escape restore, drag shield over
  iframes. **No
  bespoke `window`/`document` `pointermove`/`mousemove` drag handler may exist
  under `library/`** — the pane-drag guardrail greps both silos and the
  library's hit set is zero; keep it that way.
- **No per-frame state, store, or localStorage.** Per-frame geometry is the
  engine's RAF-coalesced, equality-bailed `apply()` — an imperative CSS-var
  write on the layout container (grid templates own the hard clamps via
  `minmax()`/`clamp()` in
  [library/components/library-grid-template.ts](components/library-grid-template.ts)).
  Persistence is `commit()`, exactly once on release. A `setState`/store
  notify/localStorage write per pointer frame is the bug class, not a style
  choice. (The ONE sanctioned exception is editor-side and named in root
  AGENTS.md "Pane-drag stability" — `SplitWithCode`'s render-derived
  `liveRatio`; the library silo has none and should stay that way.)
- **Edge-only bus.** Gesture-time coordination rides the app-wide
  `LayoutGestureBus` (`isLayoutGestureActive`/`onLayoutGestureChange` from
  `@/lib/pane-resize`): listeners fire once on the begin edge and once on the
  end edge, NEVER per frame. The per-frame geometry stream stays inside the
  engine. Since task 317 the bus carries TWO gesture families — a pane-divider
  drag and an **OS window resize** (`kind: "pane" | "window"`) — so a follower
  wired once is covered for both. Root AGENTS.md "Layout-gesture stability".
- **Park-and-settle.** Any geometry observer that could fire mid-gesture
  routes its trigger through `parkDuringLayoutGesture` (stash latest, replay
  ONCE on the end edge) instead of hand-rolling an `isLayoutGestureActive()`
  check — current parks: `usePgmarkPages`' RO, `RightDetail`'s textPodRect RO
  **and its window `resize` listener**, `RightDetail`'s pdf-viewer page-state
  feedback, `PanelTabStrip`'s flush-right measure. That "and" is the whole
  lesson of task 317: `RightDetail` parked the RO and fed the SAME scheduler
  raw from a window listener 38 lines below, and since `PaneFreeze` cannot
  freeze an OS window resize, the unparked path was the live one for the whole
  gesture. **Every trigger into a scheduler parks, or none of them does.**
  A new `resize` listener in this silo that neither parks nor suppresses fails
  the census in `src/lib/__tests__/window-resize-guardrail.test.ts`.
- **Reader freeze.** `RightDetail` wraps both branch roots (pdf iframe /
  text reader) in `PaneFreeze`, so the heavyweight content is width-locked
  for the gesture and sees exactly ONE resize on release (pdf.js re-scale,
  O(doc) ProseMirror rewrap, downstream ROs — once, not per frame).
- **Measurement-free chrome.** Tab silhouettes, panel outlines, and seams are
  layout-driven (`FolderTabChrome` constant caps + stretchable middle; CSS
  border + `--library-manila-radius` body frame) — geometry comes from layout,
  never from a ResizeObserver → state → SVG re-path loop. Don't reintroduce
  measured chrome; if only one dimension varies, decompose into constant
  pieces + a stretchable middle.

**ResizeObserver census** (every RO under `library/` +
`src/components/library/`, each with its why-safe justification). This list
is CI-enforced: the pane-drag guardrail test greps the library silo for
`new ResizeObserver` and fails unless the hit set equals its
`PERMITTED_LIBRARY_RESIZE_OBSERVERS` allowlist — a new RO must land with an
entry there AND the justification at the site, or CI fails (same discipline
as the keystroke/scroll lists):

- [PanelTabStrip.tsx](components/panel-tabs/PanelTabStrip.tsx) flush-right
  tuck measure — the ONE surviving chrome RO (a cross-subtree relationship CSS
  can't express); RAF-coalesced, equality-bailed, parked via
  `parkDuringLayoutGesture`.
- [LeftList.tsx](components/LeftList.tsx) rows-viewport measure —
  virtualization window height; equality-bailed setState.
- [RightDetail.tsx](components/RightDetail.tsx) textPodRect — header↔pod
  pinning; RAF-coalesced, ±0.5px equality gate, parked (defense-in-depth
  behind the PaneFreeze).
- [PaperHeader.tsx](components/PaperHeader.tsx) narrow flag — boolean
  threshold from `borderBoxSize`; React bails unless the 560px line is crossed.
- [usePgmarkPages.ts](hooks/usePgmarkPages.ts) — see the keystroke entry
  above; RAF-coalesced, parked, `pages` identity-gated.

**Verify live** (dev preview, force-dev-storage): drag each library gutter —
the outline tracks the edge with no lag/snap; release over the PDF viewer —
no hang, no ghost-resume; typing leaves `__virgilBusStats().emitCount` flat;
a full drag fires exactly two `LayoutGestureBus` edges and one store commit.
Then drag the OS **window** edge with the Library tab open and read
`window.__layoutGestureStats()`: every parked site must report `settles === 0`
during the drag and exactly 1 after release.

## Projection coordinate spaces — a projection that renders is a projection that mutates

> **Where a hook exposes a DISPLAYED projection of persisted state, every
> input expressed in that projection's coordinates is translated back at the
> hook boundary — by the same module that built the projection. No mutator
> reads a raw index or a raw `activeId` while a projection exists.**

`useLibraryTabs` is the app's one live instance of this shape. It keeps two
notions of "the tab list" and "the active tab": the **raw** persisted
`PanelTabsState` (what every mutation splices) and the **displayed**
projection the strip actually renders — synthetic per-doc project tabs
spliced in after Central, `activeId` overridden to the current doc's project
tab. Everything the *user* expresses is stated in displayed coordinates,
because the displayed list is the only one they can see.

Feeding such a value to a raw-space mutator is one bug class with as many
symptoms as there are consumers (task 131). Two were live, each looking
complete on its own terms: `PanelTabStrip.computeInsertionIndex` measured the
rendered strip and `moveTab` spliced that index into raw `openIds`, so with N
project tabs a reorder landed N slots off — and a mid-list drop *silently did
nothing*, which reads as an unresponsive UI rather than a wrong one; and
`openLibrary`/`openPaper` resolved their replace target from raw `activeId`,
which with a doc open still pointed at an unpinned **Central** sitting behind
the projection, so opening a library mapped Central out of `openIds` and it
vanished though the user never closed it and it wasn't even highlighted.

The SSOT is [library/lib/panel-tab-coords.ts](lib/panel-tab-coords.ts): the
projection (`projectLeftTabs`) and both inverses
(`displayedIndexToRaw`, `resolveReplaceTargetId`) in one pure module, so they
cannot drift. Three rules it earned:

- **Translate at the boundary, once, unconditionally.** `moveTab` converts the
  incoming index against the same snapshot the user was looking at, before any
  reducer runs. A panel with no projection has displayed === raw, so the
  translation is the identity — which is why every mutator routes through it
  rather than branching on the panel. A branch is a place to forget.
- **Count membership; don't subtract a count.** The raw index is *how many raw
  ids precede that displayed point* — total by construction, needing no
  assumption about where the projection put its synthetic ids. It also gives
  the right answer where the mapping is genuinely many-to-one: a raw tab can
  never render between Central and the project tabs, so those adjacent
  displayed insertion points collapse to one raw slot.
- **A synthetic tab has no slot to give up.** When the displayed active id
  isn't in raw `openIds`, the open APPENDS. Falling back to "replace whatever
  raw `activeId` still points at" is exactly the Central-vanishing bug.

Contracts: [panel-tab-coords.test.ts](lib/__tests__/panel-tab-coords.test.ts)
(pure) and
[useLibraryTabs.coords.test.tsx](hooks/__tests__/useLibraryTabs.coords.test.tsx)
(the mutators actually route through it — both members fail on the
implementation they were written against). Residual, stated honestly: the
strip's drop caret is still drawn at the raw displayed index, so a drop
aimed between Central and the first project tab shows the caret there and the
tab settles just after the project tabs — the nearest representable slot.
Cosmetic, and it would take the strip knowing the projection to fix.

## Storage

- **IndexedDB**: shared `"virgil"` DB / `"kv"` store, key `"library-folder-handle"` (consolidated with the rest of Virgil's persistence — see `library/lib/library-folder.ts`).
- **localStorage**: `virgil-library-*` prefix (registry, panel tabs, column widths, row-viewed state). No collision with Virgil's own keys.
- **FSA disk** (`~/Virgil-Library/`):

  Visible at the library root (the only things a casual browser sees):
  - `master.bib` — canonical bibliography
  - `unsorted/<filename>` — top-level inbox for files awaiting a citekey
  - `papers/<citekey>/` — one folder per paper, containing:
    - `<citekey>.{pdf,docx}` — the source file
    - `main.tex`, `references.bib`, `virgil/{virgil,notes,footnotes}.json`
    - `variants/` — alternate sources from triage (e.g. duplicate scans)
    - `notes/` — paper-specific AI reports / analyses (memo discipline; see below)
    - `<anything else>` — user-supplied supplementary files

  Hidden under `.claude/` (auto-discovered by Claude Code):
  - `.claude/CLAUDE.md` — workspace guide for the Claude operator
  - `.claude/commands/library/*.md` — skill prompts

  Hidden under `.virgil/` (runtime/infra state):
  - `.virgil/catalog.json`, `.virgil/catalog-version.txt`
  - `.virgil/queue/<citekey>.json`, `.virgil/queue/<citekey>-bibedit.json`, `.virgil/queue/<citekey>-deepindex.json` (legacy `-richindex.json` accepted on read), `.virgil/queue/pending-reviews.json`
  - `.virgil/notifications/inbox.json`
  - `.virgil/logs/<citekey>/*.log`
  - `.virgil/memos/<YYYY-MM-DD>-<slug>.md` — library memos (see below)
  - `.virgil/scripts/*.py` — Python pipeline (after first skill-bundle sync)
  - `.virgil/.skill-bundle-version.json`
  - `.virgil/libraries/<slug>.json` — per-custom-library manifest. Slim
    JSON listing membership citekeys plus label/createdAt/updatedAt/
    pinned/sourceBibFile. Each row in the Library tab's "My libraries"
    section is one of these files. **The frontend is the sole writer**
    (creates, renames, mutates membership, deletes); skills are free
    to *read* them when a use case appears (e.g. "authenticate every
    citekey in <library>"). `master.bib` remains the canonical source
    of entry data — manifests reference citekeys, never duplicate the
    bib fields. Filename is `<slug>.json` where `<slug>` is the
    label slugified (lowercase ASCII + dashes); collisions get a
    numeric suffix. The migration sentinel `.virgil/libraries/.migrated`
    contains a one-shot dump of the legacy localStorage registry,
    written the first time a library folder is opened post-refactor
    so disk-resident manifests can be safely (re-)created from the
    pre-existing in-browser registry.

  > **Layout migration.** Earlier libraries lived under `pdfs/<citekey>.{pdf,docx}` + `pdfs/unsorted/` with `catalog.json`, `queue/`, `logs/`, etc. at the root. `ensureLibraryStructure()` runs idempotent migrations that (1) move source files into `papers/<citekey>/<citekey>.<ext>` and promote `unsorted/` to the root, and (2) tuck `catalog.json`, `catalog-version.txt`, `queue/`, `notifications/`, `logs/`, `scripts/`, and `.skill-bundle-version.json` under `.virgil/`, with `CLAUDE.md` moved to `.claude/CLAUDE.md`. Each step is wrapped in try/catch so a single failure doesn't gate library load.

  > **Disk-libraries migration (May 2026).** Custom-library membership previously lived only in `localStorage["virgil-library-registry"]`. On the first load with `useDiskLibraries`, when `.virgil/libraries/` is empty and the legacy registry has at least one `kind: "custom"` row, every custom library is written out as a manifest under `.virgil/libraries/<slug>.json`, the source registry is dumped into the sentinel `.virgil/libraries/.migrated`, and the custom rows are stripped from localStorage. The migration is idempotent (sentinel-gated). Panel-tab layout, column widths, and row-viewed state stay in localStorage — those are genuinely per-machine UI preferences, not durable membership.

## Concurrency

Library skills are safe to run **in parallel across separate Claude
Code sessions** (different citekeys, even mixing kinds: one session
running `/library/deep-index`, another `/library/index-paper`, a
third `/library/authenticate-bib`). Three shared files — `master.bib`,
`.virgil/catalog.json`, and `.virgil/notifications/inbox.json` — are
protected by POSIX `fcntl.flock` on sidecar `.lock` files
(`master.bib.lock`, `.virgil/catalog.json.lock`,
`.virgil/notifications/inbox.json.lock`). Locks auto-release on
process exit so a crashed session can't leak them.

The lock primitives live in [library/scripts/_tools.py](library/scripts/_tools.py)
as `lock_master_bib`, `lock_catalog`, `lock_inbox`. Every script that
mutates one of those files acquires the matching lock. **Skill-side
edits must go through the CLI shims**, because `flock` is advisory —
a direct `Write` from Claude bypasses the lock:

- `update_catalog_entry.py <citekey> --patch-file <path>` — deep-merges a JSON patch into the entry, bumps `catalog-version.txt`.
- `upsert_catalog_entry` (Python-only API) — for catalog writes from inside scripts that already hold the in-memory catalog.
- `bump_catalog_version.py` — version-bump only (frontend-refresh signal).
- `append_inbox_item.py --item-file <path>` — appends to the notification ring buffer (caps at 200 entries).
- `update_master_bib_entry.py <citekey> --entry-type <type> --fields-file <path> [--bib-state <state>] [--merge-existing] [--allow-field-drop]` — locked upsert into `master.bib`; updates the leading `% bib.state = …` comment when `--bib-state` is passed. **The write is a whole-block replacement, not a diff:** the brace-balanced `@<type>{<citekey>, …}` block is replaced by one emitted from exactly the fields file, so that file must be the COMPLETE field set the entry should end up with. Hand it a change-set and every unlisted field (pages, volume, publisher, doi, isbn, url, note) is destroyed. Two guards make that unloseable — the append side refuses a duplicate work (`--guard`, default on; `--no-guard` overrides), and the replace side refuses a write that would drop a currently-non-empty field. Pass `--merge-existing` when you hold a change-set rather than a complete entry (it merges yours over the entry's current fields), or `--allow-field-drop` when the removal is deliberate (a cleared field, or one that stops applying because the entry type changed).

**Rule for new code touching these files:** Python scripts import the
helpers from `_tools.py`; skill markdown shells out to the CLI shims.
Never Read/Write `master.bib`, `.virgil/catalog.json`, or
`.virgil/notifications/inbox.json` directly from a skill.

Each helper grabs only its own lock — we never compose locks across
files in a single critical section, so there is no ordering rule to
remember and no deadlock surface. The atomic write pattern (temp-file
+ fsync + `os.replace`) ensures lock-free readers always see either
the old or the new contents, never a partially-written file.

## `references.bib` is upsert-only

> **A paper's own row in `papers/<citekey>/references.bib` is written by
> exactly one function — `_tools.write_paper_bib_entry` — and it UPSERTS.
> Never `write_text` a freshly emitted entry over that file, from Python or
> from a skill.**

(Other writers of the file exist and are fine: they either append
(`populate_references_bib_from_itemize`, `synthesize_canonical_entries`) or
rewrite in place (`fuzzy_citekey_disambiguate`, `repair_etal_citekeys`), so
they derive their output from the existing text. The one sanctioned WHOLE-file
rewrite is `/library/clean-bibliography` step 3f, which is what puts the cited
works there in the first place.)

`references.bib` is a single-entry mirror of the master.bib row only until
`/library/deep-index` runs. Its step 3f (`/library/clean-bibliography`)
replaces the file with the paper's **actual cited works** — dozens of entries,
of which the paper's own row is just one — and from then on the file is
self-contained (`deep-index.md`: "Each paper's `references.bib` is
self-contained"). A writer that re-emits the whole file from that single row
therefore destroys a deep-indexed paper's whole bibliography, and the loss is
silent both ways: nothing errors, and the next `/library/merge-bibs` finds one
entry where there had been many and reports a clean run.

That was live in **four** places at once (task 168): three in Python —
`index_paper`'s index-time stamp, its `_resync_references_bib` (which
`/library/authenticate-bib` step 6 calls unconditionally), and
`triage_apply`'s bib-only folder creation — plus one in **skill prose**, where
`apply-bib-edit.md` step 3 simply told the agent to "re-emit" the file by
hand. That fourth one is the reason the fix isn't a guard per Python caller: a
skill's prose alone can reopen the hole, so the doctrine has to be stated as
well as coded, and every skill step now points at the helper.

The code half is structural: `write_paper_bib_entry` splices via the SSOT
parser's pure `_bib_parse.upsert_entry_text`, so **every other entry survives
byte-identically** and the merge semantics are a strict superset of the old
behavior for a single-entry (or absent) file. Fresh indexing is unchanged.

**When the splice can't be proved safe, it refuses** (`BibSpliceRefused`) and
leaves the file byte-for-byte untouched — never a best-guess write. The parser
is quote-unaware, so on a malformed `.bib` a single entry's computed span can
run straight *through* a real neighbour (a `{` surplus in one value pairing
with a `}` surplus in a later one), and splicing that span would delete it —
re-creating the very bug, from the fix. The three refusals: the target's
braces didn't balance; its span covers another line-anchored `@type{key,`; or
the block about to be written is itself unbalanced. Callers surface the
message (index-time it's logged and indexing continues) and a human repairs
the bib.

Unlike `master.bib`, this file takes no lock — it's per-paper, and library
skills are parallel-safe only across citekeys.

CI: [library/scripts/tests/test_references_bib_upsert.py](scripts/tests/test_references_bib_upsert.py)
pins the byte-identical-survival contract, the refusals, and a grep of
`library/scripts/` for the re-emit form. Nothing in CI runs Python directly, so
[library/lib/\_\_tests\_\_/references-bib-upsert-python.test.ts](lib/__tests__/references-bib-upsert-python.test.ts)
shells out to it — that's what puts it under the same `npx vitest run` that
gates everything else. (The suite carries its own no-pytest runner for this
reason; the other `library/scripts/tests/*` suites remain manual.)

## An acceptance bar is DERIVED from the evidence the input carries

> **A writer that puts a record into the user's files states its acceptance
> contract and IMPLEMENTS that contract — and where the input cannot supply
> what the contract asks for, the contract is renegotiated in the open rather
> than promised and skipped. A wrong entry is worse than an unresolved
> warning: it looks correct, survives every structural validator, and is only
> caught by a human who tries to follow it.**

This is the task-372 class. `synthesize_canonical_entries.py` resolves
`missing-bib-entry:` warnings by writing canonical entries into a paper's
`references.bib`. Its docstring — and its `--min-similarity 0.85` CLI surface
— promised acceptance on "title-similarity ≥ 0.85 AND author overlap ≥ 1". The
body implemented neither: `--min-similarity` was threaded from the CLI and
never read, `_title_similarity` was defined and never called, acceptance was a
substring test (`Smith` matched `Smithson`; `Kehler and Rohde` checked only
`Rohde`), the year was never checked locally, and the ranking
`score = 1.0 if not best else best[0] + 0.01` made whichever candidate the loop
saw LAST win by construction. Nothing threw, nothing logged, and the entry
looked exactly like a correct one.

The finding under the finding is why it drifted: **the input cannot supply the
promised evidence.** A `missing-bib-entry:` warning carries `<Author> <Year>`
and no title (`clean-bibliography.md`, "Missing-bib-entry lookup spec"), so
there is nothing to compute title similarity against — and the code's own
comment said so while the docstring said otherwise. A contract that cannot be
met is not met quietly; it is restated. Four rules it earned:

- **Spend the metric on the question it CAN answer.** With no target title,
  the title bar becomes an UNAMBIGUITY requirement: survivors are clustered
  into distinct works (`--min-similarity` on `work_identity.title_jaccard`, or
  a shared DOI) and more than one distinct work REFUSES. The knob is monotone
  in the safe direction — raising it splits candidates and refuses more.
- **Library first is where a target title exists at all** (see
  [_find-or-surface.md](skills/_find-or-surface.md) rule 2, which this script
  had never honoured): a `master.bib` entry whose year and authors cover the
  mention wins outright and is copied verbatim. It is the user's own
  authenticated metadata and citekey convention, not a guess.
- **One symmetric key across every source.** A prose mention (`Barbara
  Grosz`), a Crossref `family` (`van Fraassen`) and a bib `author` token
  (`Grosz, Barbara`) must reduce the same way, or the comparison is a
  coin-flip. Normalization comes from `work_identity` — the library's stated
  SSOT for bibliographic identity — never a private fork, which is what the
  two forks this file used to carry were.
- **A refusal is a VALUE, reported.** Every declined target comes back in
  `result["refusals"]` and is printed, including the cases the pre-372 loop
  dropped in silence. A surfaced gap is the success mode.

The residual is stated at the site rather than promised away: with no target
title, a target with exactly one author-and-year-plausible candidate is
accepted on author+year evidence alone — from EITHER source, since a lone
`master.bib` row for `Smith 1998` is authenticated metadata about *a* Smith
1998, not proof it is the one this paper cites. That is what the per-entry
provenance tags exist to say. A second bound belongs in the same paragraph
rather than being discoverable from a default argument: the unambiguity test
can only see the candidates Crossref returned, so a further work by the same
author in the same year that falls outside the query window is invisible to
it and a genuinely ambiguous target can present as one survivor. Closing
either means the warning grammar carrying more than `<Author> <Year>`.

CI: [library/scripts/tests/test_synthesize_canonical_entries.py](scripts/tests/test_synthesize_canonical_entries.py),
behind [library/lib/\_\_tests\_\_/synthesize-canonical-entries-python.test.ts](lib/__tests__/synthesize-canonical-entries-python.test.ts)
since nothing in CI runs Python directly. Measured against the pre-372 tree,
20 of its 28 legs fail; the other 8 are controls that pass on both trees —
without them every refusal leg would be satisfied by a script that refuses
everything, which is the shape a "safety" fix is most likely to take. Each of
the ten mechanisms the fix installs was also neutered in turn on a scratch
copy and fails at least one leg on its own; the one exception is the
pre-clustering sort, whose leg says at the site that it pins the PROPERTY
(order-invariance) rather than the mechanism.

## A citekey lookup is NFC-insensitive — and it is CENSUSED

> **Every comparison of one citekey against another goes through the ONE
> predicate `_tools.citekey_matches` (backed by `normalize_citekey` — compare
> under NFC). Nothing in `library/scripts/` compares citekeys raw.**

Catalog rows, `master.bib` keys, alias records and paper FOLDER names all
carry Latin-1 Supplement codepoints in whichever normalization form the source
data happened to use — pre-composed (NFC) from a JSON writer, decomposed (NFD)
from macOS's filesystem or a PDF extractor. `Tichý` is `Tich` + `ý` or `Tich` +
`y` + `U+0301`, and the two are byte-unequal and semantically identical. So a
raw `e.get("citekey") == citekey` is a lookup that misses on exactly the papers
whose citekeys carry diacritics, and it is silent in **three** directions:

- a **reader** returns `None` and its consumer degrades as if the paper had no
  row at all (task 323's three readers; `fuse_alternate._read_catalog_entry`);
- a **guard** inverts — `citekey in read_master_bib(...)` reports a real entry
  as missing, so triage appends a SECOND entry for the same work, and a dedup
  match whose key differs from ours only by form is read as a *different work*
  and flagged as a duplicate;
- a **writer** raises. `fuse_alternate.update_catalog_for_fusion` is the loud
  member and the worst-placed one: it runs AFTER `main.tex` has already been
  rewritten by the fusion, so its `KeyError` leaves the paper fused and its row
  stale, mid-gesture, with nothing to retry against.

Task 323 fixed three readers by hand. Two months later **fifteen** raw
comparisons (plus one raw membership test) were still live across ten files,
alongside a local `_ck_eq` wrapper in
`triage_apply.py` that forked the predicate (its `except` fell back to a
whitespace-strip compare) and which three of that same file's own lookups
didn't call. That is what a hand-drained class looks like with no guard under
it — the predicate was never the part that could misbehave; a call site that
never asks it is, and `e.get("citekey") == citekey` type-checks perfectly.

Three rules it earned (task 371):

- **A rename planner asks it too.** `fuzzy_citekey_disambiguate` compares a
  freshly built candidate against the STORED key. Raw, a candidate that
  differs only by form reads as new, and the planner schedules a rename that
  renormalizes the `.bib` while leaving the catalog on the old spelling —
  *manufacturing* the drift the predicate defangs.
- **A paper FOLDER name is a citekey.** macOS hands back decomposed directory
  names from `iterdir()`, so `repair_etal_citekeys` failed to recognise the
  buggy paper's own folder and rewrote its cites along with everyone else's.
- **Keep the raw hit as a fast path where the collection is large.**
  `_master_has_citekey` tries the O(1) dict hit first (right whenever the
  spellings agree, which is every ASCII citekey) and only pays the scan over a
  34k-entry `master.bib` on a miss.

CI: the census lives in
[library/scripts/tests/test_warning_recompute_merge.py](scripts/tests/test_warning_recompute_merge.py)
section C2 — 323's suite is the natural home, since its section C is this same
class — and rides the `warning-recompute-merge-python.test.ts` shell that puts
it under `npx vitest run`. It scans every non-`test_` `library/scripts/*.py`
for an `==`/`!=` whose **immediately adjacent** operand names a citekey
(adjacent, not a window: `if not citekey or state == "none"` names one on the
line and compares something else), over source with `#` comments and
docstrings blanked and ordinary literals KEPT — the drift lives in
`get("citekey")`. A second leg pins the membership shape. The allowlist holds
exactly one line, `citekey_matches`'s own definition, and can only shrink: a
hit is CONVERT-it. Both legs carry a canary on a SYNTHETIC fixture, never on a
live line.

**Two residuals, stated.** The alias map (`dedup_index.resolve_alias`) still
does raw dict-KEY lookups (`cur in aliases`) against keys `_record_alias`
stored in whatever form its caller held — self-consistent within one session,
driftable across them, and closing it properly is a normalize-on-write plus a
migration rather than a predicate swap. And the census's name list treats
`old` / `new_key` / `candidate_key` as citekey spellings, which is right in
this silo today and would false-positive on an unrelated `old`; that fails
LOUD in the safe direction, and the fix is a rename or an allowlist entry with
a stated reason.

## Memo discipline

Skills that write markdown memos as part of their work follow a fixed convention.
This is the **library-memo** stream of Virgil's three-stream memo model — the
one the operational manifest states canonically at
[docs/workspace/memos.md](../docs/workspace/memos.md) (shipped to every folder at
`.claude/virgil/memos.md`):

- **Library memos** (notes about this pipeline — extraction retros, indexing-flow
  ideas, what went wrong this run) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`. These
  are *about the library pipeline*, not about a paper.
- **Paper-specific reports / analyses** → `papers/<citekey>/notes/<slug>.md`.
  Co-located with the paper so the user finds them when browsing.
- A **reflection** — a note about *Virgil's skill set itself* — is a dev-loop
  note, **not** a library memo. It belongs to the DEV-only `/editor:reflect`
  stream (sink outside any paper/library folder), and must never be filed under
  `.virgil/memos/`.
- The retired term "dev memo" once overloaded the library-memo and reflection
  streams and misrouted reflections — don't reintroduce it as a routing label.
- Never drop a markdown file at the library root or directly inside
  `papers/<citekey>/` (that level is reserved for source + extracted artifacts).

Skills that explicitly carry this reminder in their prompts: `/library/index-paper`, `/library/deep-index`, `/library/triage-pdf`, `/library/triage-pending`, `/library/ai-requests`, `/library/fuse-alternate`. The convention also lives in the workspace `CLAUDE.md` template at [library/scripts/skill-bundle-template/CLAUDE.md](library/scripts/skill-bundle-template/CLAUDE.md).

Skill-development memos (the per-citekey critique memos written by `/library/iterate-skill` subagents) are a separate channel and do **not** go to `~/Virgil-Library/.virgil/memos/`. They land under `library/dev/iterations/<YYYY-MM-DD>-<skill>/<citekey>.md` in the repo (gitignored). Those memos are about the skill markdown, not about the library; keeping them in the repo lets `iterate-skill` correlate them with skill versions via git history.

## Skills

Markdown skills are mirrored at build time from `library/skills/*.md`
to `.claude/commands/library/*.md`. Files starting with `_` (e.g.
`_doctrine.md`) are *includes* shared across skills — they are NOT
registered as slash commands. Invoke as `/library/<name>` from any
session opened in this repo:

**Entry points (callable as slash commands):**

- `/library/index-pending` — drain the queue in one pass (use `/loop /library/index-pending` for steady-state polling)
- `/library/index-paper <citekey>` — index a single source
- `/library/triage-pdf <filename>` — triage one unsorted file
- `/library/triage-pending [auto]` — batch triage `unsorted/`
- `/library/authenticate-bib <citekey>` — auth via Crossref / OpenAlex / Semantic Scholar / arXiv
- `/library/apply-bib-edit <citekey>` — apply a queued manual bib edit
- `/library/deep-index <citekey>` — orchestrates the deep-index subskill family (deterministic preprocess + AI pass)
- `/library/ai-requests` — drain user-authored AI review requests
- `/library/iterate-skill <skill-name> <citekey...>` — closed-loop iteration

**Deep-index subskills.** `/library/deep-index` dispatches all six, in
this order — the preflight at its Step 0, the rest at its Step 3. Each is
also callable standalone (`/library/clean-bibliography <citekey>` to
re-itemize References without re-running the pass):

- `/library/di-preflight <citekey>` — Step 0.0 – 0.6: empty-body / OCR-recovery gate, lending-slip, JSTOR boilerplate, metadata mismatch, multi-article, Caesar/running-header, genre routing, pgmark coverage.
- `/library/di-clean-prose <citekey>` — Step 3a / 3b / 3c: title, headers, heading hierarchy, drop caps, pgmark alignment.
- `/library/recover-footnotes <citekey>` — Step 3d full tier ladder.
- `/library/clean-bibliography <citekey>` — Step 3e / 3f / 3g: References itemization, references.bib emission, citation rewriting.
- `/library/di-examples <citekey>` — Step 3.h₁ / 3.h₂: numbered examples, formal-semantics math, user-note processing.
- `/library/di-validate <citekey>` — Step 3i + Step 9.5: pgmark validator, audit punch-list, outstanding-work classification.

**Shared doctrine includes** (not slash commands):

- `library/skills/_doctrine.md` — §Scope doctrine + §Persistence convergence + §9 outstanding-work categories + anti-patterns + self-check. Subskill stubs point readers here for the load-bearing rules.
- `library/skills/_find-or-surface.md` — the **cross-silo** "find-or-surface, never fabricate, Library-first" doctrine for every citation/bib skill (`authenticate-bib`, `find-citation`, `answer-bib-review`, `draft-footnote`, …). Authored once here; a byte-identical copy lives at `editor/skills/_find-or-surface.md` so the editor bundle ships it too (the two silos land in separate on-disk folders). The copies are kept identical by `library/lib/__tests__/find-or-surface-doctrine.test.ts` — edit **both**.

Edit the source under `library/skills/`; rerun `npm run build:library-bundle` (or `npm run dev` / `npm run build`, which auto-run via `predev` / `prebuild` hooks) to regenerate `.claude/commands/library/` and `public/skill-bundle/`.

### A declared subskill is a dispatched subskill

> **A skill whose frontmatter says "Subskill of /X" must appear in X's
> dispatch sequence as `Run \`/<silo>/<name>\``. Membership is DERIVED from
> that self-declaration, not from a list someone maintains — and a
> cross-reference is not a dispatch.**

`/library/deep-index` declared six subskills and dispatched five (task
2026-07-18-163). The missing one was `di-preflight`, so on every deep-index
pass the JSTOR cover-page strip, the interlibrary lending-slip strip, the
content↔metadata mismatch policy (and its `bib.state = needs-reauth` flip)
and the pgmark-coverage reconciliation simply never ran — unless an
operator happened to invoke it by hand, which nothing told them to do and
no queue kind scheduled. `di-clean-prose.md` opened by saying it "operates
on `main.tex` after `/library/di-preflight`", and was wrong every time.

Nothing could have caught it. The subskill existed, was reachable as a
slash command, was documented in this file, was exercised by nine
`test-corpus.json` rows, and had four Python helpers written for it. Every
one of those facts is about the *subskill*; none is about the *caller* —
the same lesson `createsAtom ⇒ requiresCardApi` earned in `src/` (root
AGENTS.md, task 233): **"registered and reachable" proves nothing about
whether anything invokes it.**

Three rules it earned:

- **A partial inline copy is worse than no copy.** deep-index carried its
  own "Genre detection (preflight)" section — the one Step-0 job it *did*
  do — and the two had drifted: the local copy knew five genre labels,
  di-preflight six, and the missing `article-vancouver` is precisely the
  label that decides whether `rewrite_citations --style=bracket-numeric`
  runs. A duplicate that looks like coverage is what kept the gap
  invisible. The orchestrator now states the *dispatch* and each subskill
  documents its own branches.
- **The dispatch form is the contract, not the mention.** di-preflight was
  named by four sibling skills and dispatched by none, so the guard
  requires the imperative `Run \`/library/<name>\`` the orchestrator
  actually uses. Matching a bare mention would have reported green.
- **Name the fourth exit.** deep-index's §0 promised "exactly three"
  permitted exits while §Prerequisites hard-stopped a fourth way
  (`extraction-empty-body`) that no banner covered. That gate now belongs
  to di-preflight §0.0 — which *determines* the cause
  (`recover_ocr_pipeline.py --check-only`: no text layer vs. a failed
  extraction over one) instead of guessing "scanned PDF", and routes back
  as `PREFLIGHT_BLOCKED` → the STALLED banner. It never repairs: OCR +
  re-extraction is `/library/index-paper`'s job, exactly as deep-index's
  own §"What this command does NOT do" says, and `--force-install` is
  never passed (ocrmypdf is a `/library/setup` dep, not a 200 MB surprise
  mid-pass).

CI:
[library/lib/\_\_tests\_\_/subskill-dispatch-guardrail.test.ts](lib/__tests__/subskill-dispatch-guardrail.test.ts)
walks both silos: every declared subskill must be dispatched by the
umbrella it names, that umbrella must exist, and every `/library/…` /
`/editor/…` slash command any skill points an agent at must resolve to a
real skill file (the rename half of the same class —
`/editor/answer-revision-comment` outlived its file once already). Its
allowlist is EMPTY and belongs that way: wire the dispatch or drop the
claim. The editor silo has no declarations today, so its hit set is empty
by fact rather than by exemption; a `/editor/review` subskill that starts
declaring itself is covered the day it does.

Two things the guard is deliberately honest about. It reads a *self*-
declaration, so a subskill that never claims membership is invisible to it
— which is why the claim belongs in frontmatter, the routing copy an agent
reads first. And its own first draft matched `Subskill of` with a literal
space, which a wrapped YAML description does not contain: it read the
corpus as five subskills and reported green on the very file it exists to
catch. The sentinel leg pins all six by name for that reason.

### A documented invocation is an executed invocation

> **Every `--flag` a skill prints in a `python3 …/<script>.py` line must exist
> in that script. A skill is a prompt: an agent runs the line verbatim, and
> argv does not complain.**

`bib_auth.py` had no argparse at all — one positional entry,
`<title> [<author>…]` — while `/editor/find-citation` invoked it with
`--query --type` and `/editor/answer-bib-review` with
`--citekey --title --author --type` (task 158). Each flag landed as a
positional (`title="--query"`, everything after it an "author"), so the helper
came back with a *plausible wrong answer* instead of an error, and the skills'
only fallback trigger was `ModuleNotFoundError`. Nothing could have caught it:
types don't cross the markdown↔Python boundary and neither bundle build reads
the invocations it ships.

CI:
[library/lib/\_\_tests\_\_/skill-script-cli-guardrail.test.ts](lib/__tests__/skill-script-cli-guardrail.test.ts)
scans both silos' skill markdown and fails any flag absent from the invoked
script's source, or any script that doesn't exist. Both allowlists are EMPTY
and belong that way — an entry is a skill telling an agent to run something
that can't work, so build the flag or fix the doc. Three rules it earned:

- **Literal presence, not `add_argument`.** Roughly a third of this pipeline
  hand-rolls its argv walk (`repair_pgmarks.py`, `audit_deepindex.py`,
  `format_references_section.py`) and those flags are real; demanding argparse
  would flag four healthy call sites and teach the next person to silence the
  guard. Honest residual: the loose rule can be immunised by the script's own
  help text (`bib_auth.py`'s epilog prints its flags), which is why that
  script additionally has a suite driving the real parser.
- **An interpreter token is not what makes it an invocation.** The first
  version anchored on `python3`, and an adversarial pass immediately found the
  hole it left: `_find-or-surface.md` — the cross-silo SSOT for *how to call
  `bib_auth.py`* — writes its forms bare, so the guard read nothing there
  while the file asserted right below them that CI checked those flags. Same
  for `create-card.md`'s eleven per-kind examples and `setup.md`'s
  `"$PY" …/setup.py --force`. The bare form is scoped harder (the basename
  must resolve to a known script, and a `--flag` must follow) and added 25
  invocations, including `--limit`, which no other call site reached.
- **A commented line is documentation, not an invocation** — which is how
  `di-clean-prose.md`'s explicit "script doesn't exist yet" placeholder stays
  legal without an allowlist entry.

The sentinel test pins bib_auth's whole flag set by name, so removing the last
call site that documents a flag goes red rather than quietly un-covering it.

`bib_auth.py`'s own CLI now states the fork its two callers always had:
`--query` is DISCOVERY (ranked candidates from every source — running an
authenticator against a free-text description is meaningless, since the seed
title can't match and the verdict is `failed` even on a perfect hit), and
`--citekey`/`--title` is VERIFICATION (the `AuthResult`). `--citekey` reads the
entry out of `master.bib` verbatim and threads the library root through for
the recovery chain, which retired `authenticate-bib.md`'s hand-marshalled
`python3 -c` snippet — a shape that couldn't survive an apostrophe in a title.
Contract: [library/scripts/tests/test_bib_auth_cli.py](scripts/tests/test_bib_auth_cli.py),
run under `npx vitest` via
[bib-auth-cli-python.test.ts](lib/__tests__/bib-auth-cli-python.test.ts).

## One-off-script promotion rule

Any one-off Python script written under `/tmp/<paper>/` or inline
during a deep-index pass is moved into `library/scripts/` before the
pass closes. Per-paper specifics get factored as flags
(`--diagram-tokens`, `--max-page`, `--style=...`); paper-specific
fixture data goes into `library/dev/fixtures/<citekey>/`. The aim:
every recurring "I had to write a one-off Python script" memo
becomes a permanent library script after the first occurrence.

## Test corpus

`library/dev/test-corpus.json` maps citekey → genre → subskills
exercised → regression guards. The 20 papers listed there are the
canonical regression set drawn from the May 2026 streamlining
memos. When modifying a script or skill, run
`/library/iterate-skill <skill> <citekey>` against the corpus
entries flagged for that subskill.

## Required deps for the Python pipeline

Run `/library/setup` once per library to install everything below in one shot.
The skill also pre-downloads marker's ~1 GB of ML weights into
`<library>/.virgil/models/huggingface/` so they're cached library-locally
(not in the user's global `~/.cache/huggingface/`) and shared across
index-paper + deep-index PDF re-reads.

- Python 3.10+
- Poppler (`brew install poppler`) — provides `pdfinfo`, `pdftotext`, `pdffonts`
- `PyMuPDF` — printed-page-number detection + the explicit `--extractor pymupdf` debug path
- `marker-pdf` — **default** PDF extractor (layout-aware, equation-aware, footnote-zone-aware)
- `ocrmypdf` — required for scanned-PDF input (the pipeline now fails loudly if a scanned PDF arrives and ocrmypdf is missing, instead of silently emitting a near-empty extraction)
- `tesseract` (`brew install tesseract` / `apt install tesseract-ocr`) — ocrmypdf's backend; system binary, not pip-installable. `/library/setup` checks it's present and prints the install hint when missing.

> The previous "optional, degrades gracefully" stance was costing the
> deep-index pipeline a substantial amount of recovery work — pymupdf
> alone drops equations, footnote zones, drop caps, and most layout
> information, and downstream recovery scripts exist to compensate.
> The new policy: eager install at setup, fail loudly on missing tools,
> share the model cache across the indexing and deep-indexing PDF
> re-read paths.

## Deep indexing

Two tiers exist in the status model:
- **`indexed`** — standard extraction (text + `\pgmark{}` anchors + bib). Single checkmark (`✓ idx`).
- **`deepIndexed`** — structural cleanup applied. Double checkmark (`✓✓ idx`). Produced by `/library/deep-index <citekey>`.

Pipeline:
1. **Deterministic preprocessing** (`library/scripts/deep_preprocess.py`): strips repeating running headers/footers, removes leaked page numbers, rejoins hyphenated lines, joins broken paragraphs, unwraps hard-wrapped column text.
2. **AI-driven structural improvements** (`/library/deep-index` skill): fixes `\maketitle` fields, corrects heading hierarchy, aligns `\pgmark{}` positions, reattaches orphan footnotes, processes user notes.

Queue kind: `"deepIndex"`. Queue file: `queue/<citekey>-deepindex.json`.

> **Rename note (one release).** This subsystem was previously called
> *rich indexing*. Read paths still accept `richIndexed` catalog rows,
> `richIndex` queue kind, and `<citekey>-richindex.json` queue
> filenames; new writes use the `deep-` vocabulary throughout.

## Bib states

Every catalog entry's `bib.state` is one of six values, set by the auth pipeline and consumed by the frontend's status pill:

- **`authenticated`** — DOI verified against Crossref *or* ≥2 sources agreed with score ≥0.92, *or* (for books) Google Books + OpenLibrary both score ≥0.85. Terminal state.
- **`unverified`** — single source matched at the lower threshold. Fields are best-effort. **Action needed.**
- **`failed`** — no source produced a match above threshold. **Action needed.** Try `/library/authenticate-bib` again or fill by hand.
- **`needs-reauth`** — set by `apply_metadata_mismatch_policy.py` when a metadata-mismatch policy is applied to an entry: the entry was authenticated/known but its on-file metadata diverged from the authoritative source, so it is flagged to be re-authenticated. **Action needed** (re-run `/library/authenticate-bib`). (F#4) Now a canonical state shared by the Python writer and the TS reader; previously it was non-standard and the bib-index reader silently dropped it to `"none"`.
- **`manuscript`** — explicitly unpublished or forthcoming (`@unpublished`). Terminal state. **No action needed.**
- **`canonical`** — pre-digital **descriptor**, no longer a terminal give-up (F#3). For a failed pre-digital work (book/incollection/inbook, `0 < year < 1980`, no DOI/ISBN) the auth pipeline first runs the **pre-digital route** — multi-source agreement across book catalogs (OpenLibrary, Internet Archive, Google Books) + scholarly indexes (OpenAlex, Crossref), corroborated by the bib's publisher. On agreement the entry becomes a real **`authenticated`** (carrying a `predigital(...)` source + provenance note). `canonical` is set ONLY when that route also finds no authoritative agreement — a "pre-digital classic; no agreement found" descriptor, re-runnable as catalogs improve. **No action needed.** (Year gate is `<1980`, the code's actual cutoff — older docs said ~1950.)

The `manuscript` and `canonical` states distinguish properly-terminal/no-action entries from `failed` lookups that genuinely *should* be in Crossref but aren't. Don't conflate them in summaries.

### The auth-state HOME is master.bib, and every reader asks ONE door

> **A fileless reference's `bib.state` lives in master.bib's `% bib.state`
> comment (F#4). Every reader asks [`_tools.resolve_bib_state`](scripts/_tools.py)
> — master's comment FIRST, a legacy catalog row as the FALLBACK — and no
> reader reads `bib.state` off a catalog row itself.**

Phase F#4 (`485be521`) moved WHERE that state lives: catalog.json carries only
HOLDINGS rows (`pdf.present=true`), so a reference-only entry — cited but not
held — gets no catalog row at all and its state is a comment on its master.bib
block, projected into `bib-index.json` by `build_bib_index`. The migration
reached the two WRITERS (`merge_paper_references._upsert_catalog_row`,
`triage_apply._upsert_catalog_row_bib_only`, both gating on
`paper_has_holdings`) and the TypeScript reader (`LibraryView`, whose comment
names this exact hazard). **It reached none of the FOUR Python readers**, each
of which kept asking the catalog — which for a fileless entry can only answer
*nothing*, i.e. `"none"` (task 442).

Measured on the reporting library, 2026-08-24: 19 910 of 24 082 master entries
carry a state comment, 19 785 of those are terminal, and **16 747 (84.6%) have
no catalog row** — so for 85% of the corpus every Python reader answered
`"none"`. Nothing threw; each reader failed differently:

- **`/library/merge-bibs` + `/library/import-bib`.** The skill's headline rule
  — *"duplicate of an already-authenticated master entry → defer to master"* —
  could not fire, so every run took the `_process_dup_unauth` branch instead:
  a live network authentication per entry, then a whole-block `_write_master`
  REPLACEMENT of the already-authenticated entry (possibly under a different
  `@type`, possibly downgrading `authenticated` → `canonical`). Recurs per
  PAPER, not once per entry.
- **`/library/triage-pdf` (a `.bib` drop).** The `existing_state in
  ("authenticated", "manuscript")` guard that protects a settled entry was
  UNREACHABLE for a fileless one, so the drop took the merge branch —
  *incoming wins on conflict* — and wrote `bib_state="unverified"` over it.
  **The user's authenticated fields overwritten and the state downgraded,
  silently.** This is why the task was `high`.
- **The triage REVIEW** (`triage_batch.triage_bib`) built `existing_keys` from
  catalog rows only, so the row carried no `citekey-exists` flag and no
  `existing entry: bib.state=…` note — the two things `/library/triage-pending`
  tells the user to review on. No warning at review, silent damage at apply.
- **`dedup_index.load_library_records`** (found by the census, not the report)
  fed `bib_state: None` into `work_identity._bib_state_rank`, so the dedup
  survivor vote scored every authenticated reference-only entry at ZERO.

Five rules it earned:

- **Read order is the OPPOSITE of the pre-442 code, and the fallback stays.**
  A pre-F#4 library still carries holdings rows whose `bib.state` may be the
  only copy, so the catalog is a fallback rather than dropped — but a
  `% bib.state` comment is written by every current writer and is what the
  frontend already trusts, so master WINS a disagreement.
- **The door takes a PREBUILT map for a loop.** `master.bib` is ~10 MB / 24 k
  entries in the reporting library, so `resolve_bib_state(..., master_states=…)`
  over one `master_bib_state_map(text)` sweep is the hot-loop form; a
  per-citekey re-read would be the fix's own regression. `read_master_bib` now
  takes `text=` so a caller needing both the entries and their comments pays
  ONE read.
- **The TERMINAL set is spelled once.** `_tools.TERMINAL_BIB_STATES`
  (authenticated / manuscript / canonical) — because the two gates that read it
  were two hand lists that DISAGREED: the drop guard was missing `canonical`,
  so a drop replaced a canonical entry's fields wholesale and stamped it
  `unverified`. `needs-reauth` is deliberately NOT terminal.
- **The merge branch is UNCONDITIONAL now, not gated on a state list.** The
  pre-442 field merge ran only for `unverified`/`failed`/`none`, so any state
  the list forgot (`needs-reauth`) dropped the existing fields wholesale.
  Everything that reaches that point is non-terminal, so it always merges.
- **`_write_master` never downgrades a settled entry** — belt and braces beside
  the read fix, for the case where that path is reached legitimately (a
  parallel run settled the entry between the read and the write). The FIELDS
  still land; only the state holds.

CI: [library/scripts/tests/test_bib_state_read_door.py](scripts/tests/test_bib_state_read_door.py),
driven under `npx vitest run` by
[bib-state-read-door-python.test.ts](lib/__tests__/bib-state-read-door-python.test.ts)
(nothing in CI runs Python directly — the `references.bib` upsert shape). Its
fixture is the one no pre-442 suite had: a master entry carrying
`% bib.state = authenticated` and **no catalog row**, which is why the
divergence was unrepresentable in all of them. Every fileless leg carries a
HELD control (catalog row present) through the identical harness, so no leg can
pass by making everything defer. The leg with teeth is the CENSUS — the door
was never the part that could misbehave, a call site that reads the row is, and
`(e.get("bib") or {}).get("state")` runs perfectly while answering `"none"`.
It matches BOTH spellings the readers used (a single expression, and a bound
local read one to eight lines later — three of the four offenders took the
second form, invisible to a line-scoped regex), and its allowlist is `_tools.py`
ALONE: the two scripts that legitimately read a row (`prune_catalog_present_false`,
the F#4 catalog→master migration, and `backfill_auth`, the same repair
direction) call the shared `catalog_row_bib_state` helper rather than spelling
it. Measured on the pre-442 tree the census names all four offenders, and 10 of
the suite's 25 legs fail.

**Owed, not claimed:** a real-library eyeball. After this, a `--dry-run`
`/library/merge-bibs` filtered to one paper should report its duplicates as
`deferred_dup` rather than `would-collective-auth`.

## Reader inheritance from the main editor

> **Debugging a Reader regression?** Read [READER_INHERITANCE.md](READER_INHERITANCE.md) first. It defines the architectural pattern, the three legitimate fix locations (shared component / `READER_CHROME` / the named `READER_NOOP_HANDLERS` + view-derivations in `reader-view-prefs.ts`), the triage flow, and the vocabulary the user expects you to use. **Do not write Reader-specific render code under `library/components/`** — channel the fix through the shared layer or its declarative knobs. The user typically reports Reader bugs by pointing at that doc; treat it as a hard constraint, not a suggestion.

Library papers render through the **canonical `<EditorPane>`** (`@/components/EditorPane`) — the same component the main app's doc branch mounts. The entry point is `library/components/PaperRender.tsx`, which mounts `<EditorPane editable={false} chrome={READER_CHROME} viewPrefs={readerViewPrefs} />`. Every UX change to EditorPane — new TipTap extensions, paragraph/heading floats, popouts, marginalia, the panel rail — automatically flows through. Reader-specific suppressions live in `READER_CHROME` at `src/components/editor-layout/chrome-config.ts` (currently: `showFormattingToolbar=false`, `showMenuBarEditItems=false`, `visiblePanelKinds=[outline, footnotes, examples, citations, bibliography, notes]`, `editableCardKinds=["note"]`).

The previously parallel `library/tiptap/` extension set has been deleted. `PgMarkChip` (the only Library-only extension) lives at `src/lib/tiptap/pgmark.ts` and is part of the unified extension set; it's harmless on docs without `\pgmark{N}`.

**Panel + view-state inheritance.** The Reader runs the SAME `useViewPrefs` engine the main app does — via `useReaderViewPrefs()` ([src/components/editor-layout/reader-view-prefs.ts](src/components/editor-layout/reader-view-prefs.ts)), which drives the real engine in a new `"ephemeral"` (session-only, non-persisted) mode and assembles its bundle through the SAME `buildEditorPaneViewPrefs(...)` builder ([src/components/editor-layout/build-editor-pane-view-prefs.ts](src/components/editor-layout/build-editor-pane-view-prefs.ts)) the main app uses. So `viewPrefs` IS passed: the panel rail, strip buttons, the panel↔text divider, dock stacking, card popouts, omni toggles, margins, and Outline click-to-scroll are all LIVE in the Reader (session-only — they don't persist across reloads). The ONLY editor-mutation delta is a single NAMED, type-checked `EditorMutationHandlers` set (`READER_NOOP_HANDLERS`): most are no-ops because the doc is read-only (no reorder/rename/orphan-edit/focus), but `onScrollToHeading` is REAL. Because the type is satisfied in full, a missing handler is a compile error, not a silent dead control. The Reader passes NO `menuBar` bundle, so **only** the docked MenuBar + detached toolbars stay dormant. The main app additionally exposes 15 panel kinds (vs. the Reader's 6 whitelisted) and the persisted view-prefs layer.

**Popout inheritance.** Per-doc card popouts (paragraph / heading / example floats and individual card popouts for notes, footnotes, citations, etc.) also mount inside `EditorPane`, gated on `viewPrefs && !viewPrefs.zenMode`. The Reader now passes ephemeral `viewPrefs`, so this machinery is LIVE — popouts work in the Reader (session-only).

### Verifying the Reader live in the dev preview

The Reader can be driven live in the dev preview even though the FSA picker doesn't work inside the preview iframe. Run `npm run dev:preview`, then in the preview set `localStorage["virgil:force-dev-storage"]="1"` and reload, open the **Library** tab, and open an indexed paper from the on-disk `library-data/` fixture (`genette1997` is indexed; `bringhurst1992` is deep-indexed). This exercises the real Reader directly — strip clicks, the panel↔text divider, Outline click-to-scroll, and card popouts all run on the ephemeral `useViewPrefs` engine.

## Don't

- Don't add a backend. The cowork pattern is load-bearing.
- Don't write to `master.bib` or `catalog.json` from the frontend — those are skill outputs.
- The Library may import from `@/lib/tiptap-extensions`, `@/components/Editor`, `@/components/editor-layout/chrome-*` (sanctioned cross-silo bridges for Reader inheritance), `@/lib/bib-searcher` (the shared fuzzy bib searcher — Library catalog search unifies onto it via `library/lib/catalog-search.ts` rather than duplicating the matcher; it's a leaf-pure `fuse.js`-only module), `@/lib/font-stacks` (the three chrome font CHAINS — `FONT_SANS`/`FONT_SERIF`/`FONT_MONO`; a zero-import leaf. This silo was written against a `--mono`/`--serif`/`--sans` vocabulary Virgil never defined, so 44 `font-family` declarations here (of 48 app-wide) were silent no-ops that inherited the ambient sans — task 170. Never re-spell a chain, and never a bare `var(--font-mono)`: that skips the user's override rung), `@/lib/pane-resize` (the ONE app-wide divider gesture engine + layout-gesture bus — every Library resizer runs on it, and the strip's flush-right tuck observer parks on its `isLayoutGestureActive`/`onLayoutGestureChange` edges; it replaced `library/lib/gutter-drag.ts`. The reader drag-freeze is part of the same sanctioned bridge: `PaneFreeze` wraps both of `RightDetail`'s pdf/text branch roots so a gutter gesture resizes the reader content exactly once, and the `parkDuringLayoutGesture` parks in `library/hooks/usePgmarkPages.ts` + `RightDetail` stash their geometry/viewer feedback behind the same bus edges — which since task 317 also fire for an OS window resize, a gesture `PaneFreeze` structurally cannot freeze. These are generic shared-layer utilities keyed on the bus — NOT Reader-specific render forks; see the shared-layer note in READER_INHERITANCE.md), and `@/components/chrome/FolderTabChrome` + `@/components/chrome/folder-tab-geometry` (the ONE folder-tab chrome + geometry SSOT shared by the outer Virgil-bar tabs and the inner library tabs — a layout-driven three-piece silhouette with zero ResizeObservers; it replaced the forked `library/components/panel-tabs/folder-path.ts` / `src/components/editor-layout/folder-path.ts` measured path builders). Avoid reaching into other Virgil internals (`@/components/EditorLayout`, panel hooks, etc.) without a similar architectural justification.
