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
│   ├── PanelTabStrip.tsx, PanelFolderTab.tsx, panel-tabs/folder-path.ts
│   ├── LeftList.tsx, LeftListRow.tsx, RowActionMenu.tsx
│   ├── RightDetail.tsx, PaperRender.tsx, PdfView.tsx
│   ├── BibCard.tsx, BibEditModal.tsx, StatusPill.tsx
│   ├── TopBar.tsx, Toaster.tsx, DropZone.tsx
│   └── LibraryFolderPicker.tsx, LibraryPermissionGate.tsx
├── hooks/               React hooks (state machines + polling)
│   ├── useLibraryHandle.ts, useLibraryTabs.ts
│   ├── useCatalog.ts, useMasterBib.ts, useUnsortedPdfs.ts
│   ├── useDropPdf.ts, useBibReviewState.ts
│   ├── useNotificationStream.ts, useRowDotState.ts
├── lib/                 Pure logic + FSA boundary
│   ├── catalog.ts, catalog-store.ts (module-level singleton for Bibliography façade)
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

Same as Virgil's `ai-requests.json` / `suggestions.json` flow: the frontend writes intent files; Claude (running in a separate session, ideally `/loop /library/index-pending`) drains them and writes back. The frontend never invokes Claude directly. Two channels:

1. `catalog-version.txt` — bumped on every skill run; the frontend polls this 1-byte file every 6s (see `library/lib/catalog.ts` and `library/lib/catalog-store.ts`).
2. `notifications/inbox.json` — append-only ring buffer for toasts.

## How the Library tab plugs into Virgil

- `src/components/library/LibraryTabView.tsx` is a 6-line shim that renders `<LibraryApp />` from `@library/components/LibraryApp`.
- `src/hooks/useLibrary.ts` is a façade: it exports `useLibraryItems()` (consumed by Bibliography panel) by reading the catalog from `library/lib/catalog-store.ts` and mapping `CatalogEntry → LibraryIndexItem`.
- The `virgil-open-library` event bridge (`src/components/editor-layout/event-bridges/library.ts`) switches the active pane; `LibraryView` listens for the same event and sets the selected catalog row.
- Outer manila tabs in `src/components/EditorLayout.tsx` (lines ~4901–4943) and the content mount at lines ~5285–5288 are unchanged.

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
  - `.virgil/memos/<YYYY-MM-DD>-<slug>.md` — dev memos (see below)
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
- `update_master_bib_entry.py <citekey> --entry-type <type> --fields-file <path> [--bib-state <state>]` — locked upsert into `master.bib`; updates the leading `% bib.state = …` comment when `--bib-state` is passed.

**Rule for new code touching these files:** Python scripts import the
helpers from `_tools.py`; skill markdown shells out to the CLI shims.
Never Read/Write `master.bib`, `.virgil/catalog.json`, or
`.virgil/notifications/inbox.json` directly from a skill.

Each helper grabs only its own lock — we never compose locks across
files in a single critical section, so there is no ordering rule to
remember and no deadlock surface. The atomic write pattern (temp-file
+ fsync + `os.replace`) ensures lock-free readers always see either
the old or the new contents, never a partially-written file.

## Memo discipline

Skills that write markdown memos as part of their work follow a fixed convention:

- **Dev memos** (skill retros, ideas for improving the pipeline, notes about
  what went wrong this run) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`. These
  are *about the system*, not about a paper.
- **Paper-specific reports / analyses** → `papers/<citekey>/notes/<slug>.md`.
  Co-located with the paper so the user finds them when browsing.
- Never drop a markdown file at the library root or directly inside
  `papers/<citekey>/` (that level is reserved for source + extracted artifacts).

Skills that explicitly carry this reminder in their prompts: `/library/index-paper`, `/library/deep-index`, `/library/triage-pdf`, `/library/triage-pending`, `/library/ai-requests`. The convention also lives in the workspace `CLAUDE.md` template at [library/scripts/skill-bundle-template/CLAUDE.md](library/scripts/skill-bundle-template/CLAUDE.md).

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

**Deep-index subskills** (Phase 1 stubs; content migration from the
monolithic `deep-index.md` will land iteratively):

- `/library/di-preflight <citekey>` — Step 0 / Step 0.5: metadata mismatch, lending-slip, JSTOR boilerplate, multi-article, OCR recovery dispatch, genre routing.
- `/library/di-clean-prose <citekey>` — Step 3a / 3b / 3c: title, headers, heading hierarchy, drop caps, pgmark alignment.
- `/library/recover-footnotes <citekey>` — Step 3d full tier ladder.
- `/library/clean-bibliography <citekey>` — Step 3e / 3f / 3g: References itemization, references.bib emission, citation rewriting.
- `/library/di-examples <citekey>` — Step 3.h₁ / 3.h₂: numbered examples, formal-semantics math, user-note processing.
- `/library/di-validate <citekey>` — Step 3i + Step 9.5: pgmark validator, audit punch-list, outstanding-work classification.

**Shared doctrine include** (not a slash command):

- `library/skills/_doctrine.md` — §0.5 Scope doctrine + §Persistence convergence + §9 outstanding-work categories + anti-patterns + self-check. Subskill stubs point readers here for the load-bearing rules.

Edit the source under `library/skills/`; rerun `npm run build:library-bundle` (or `npm run dev` / `npm run build`, which auto-run via `predev` / `prebuild` hooks) to regenerate `.claude/commands/library/` and `public/skill-bundle/`.

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

- Python 3.10+, `PyMuPDF` (`pip3 install --user --break-system-packages -r library/scripts/requirements.txt`)
- Poppler (`brew install poppler`) — provides `pdfinfo`, `pdftotext`, `pdffonts`

## Optional deps (the pipeline degrades gracefully if missing)

- `marker-pdf` — better layout-aware extraction for academic PDFs (~1GB model on first use)
- `ocrmypdf` + `tesseract` (`brew install tesseract`) — needed only for scanned PDFs

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

Every catalog entry's `bib.state` is one of five values, set by the auth pipeline and consumed by the frontend's status pill:

- **`authenticated`** — DOI verified against Crossref *or* ≥2 sources agreed with score ≥0.92, *or* (for books) Google Books + OpenLibrary both score ≥0.85. Terminal state.
- **`unverified`** — single source matched at the lower threshold. Fields are best-effort. **Action needed.**
- **`failed`** — no source produced a match above threshold. **Action needed.** Try `/library/authenticate-bib` again or fill by hand.
- **`manuscript`** — explicitly unpublished or forthcoming (`@unpublished`). Terminal state. **No action needed.**
- **`canonical`** — pre-digital classic (book-typed, year < 1950, no DOI/ISBN); no external authority registry will ever index it. Terminal state. **No action needed.** Set as a fallback only after the full search chain has come back empty, so modern works still get the action-needed `failed` signal.

The `manuscript` and `canonical` states distinguish properly-terminal entries from `failed` lookups that genuinely *should* be in Crossref but aren't. Don't conflate them in summaries.

## Reader inheritance from the main editor

> **Debugging a Reader regression?** Read [READER_INHERITANCE.md](READER_INHERITANCE.md) first. It defines the architectural pattern, the three legitimate fix locations (shared component / `READER_CHROME` / `useReaderViewPrefs` shim), the triage flow, and the vocabulary the user expects you to use. **Do not write Reader-specific render code under `library/components/`** — channel the fix through the shared layer or its declarative knobs. The user typically reports Reader bugs by pointing at that doc; treat it as a hard constraint, not a suggestion.

Library papers render through the **canonical `<EditorPane>`** (`@/components/EditorPane`) — the same component the main app's doc branch mounts. The entry point is `library/components/PaperRender.tsx`, which mounts `<EditorPane editable={false} chrome={READER_CHROME} />`. Every UX change to EditorPane — new TipTap extensions, paragraph/heading floats, popouts, marginalia, the panel rail — automatically flows through. Reader-specific suppressions live in `READER_CHROME` at `src/components/editor-layout/chrome-config.ts` (currently: `actionToolbarKinds=["note"]`, `showFormattingToolbar=false`, `showMenuBarEditItems=false`, `visiblePanelKinds=[outline, footnotes, examples, citations, bibliography, notes]`, `editableCardKinds=["note"]`).

The previously parallel `library/tiptap/` extension set has been deleted. `PgMarkChip` (the only Library-only extension) lives at `src/lib/tiptap/pgmark.ts` and is part of the unified extension set; it's harmless on docs without `\pgmark{N}`.

**Panel inheritance.** Path A 7.8 landed: the Reader inherits the panel rail (notes, footnotes, citations, bibliography, outline, examples) directly from `EditorPane`. Reader passes neither `viewPrefs` nor `menuBar` so the dock/float machinery and the docked MenuBar stay dormant — the rail surfaces only the icon strip + auto-active panel content for the 6 whitelisted kinds. The main app passes both bundles and gets the full chrome (15 panel kinds, detached toolbars, docked MenuBar, floating panels).

**Popout inheritance.** Per-doc card popouts (paragraph / heading / example floats and individual card popouts for notes, footnotes, citations, etc.) also mount inside `EditorPane`, gated on `viewPrefs && !viewPrefs.zenMode`. Reader passes no `viewPrefs` → the mount is dormant. If/when the Reader needs popouts later, it's a single chrome flag flip away.

## Don't

- Don't add a backend. The cowork pattern is load-bearing.
- Don't write to `master.bib` or `catalog.json` from the frontend — those are skill outputs.
- The Library may import from `@/lib/tiptap-extensions`, `@/components/Editor`, and `@/components/editor-layout/chrome-*` — those are sanctioned cross-silo bridges for Reader inheritance. Avoid reaching into other Virgil internals (`@/components/EditorLayout`, panel hooks, etc.) without a similar architectural justification.
