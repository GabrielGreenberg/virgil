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
├── scripts/             Python extraction pipeline + skill-bundle template
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
  - `catalog.json`, `catalog-version.txt`, `master.bib`
  - `pdfs/<citekey>.{pdf,docx}`, `pdfs/unsorted/`
  - `papers/<citekey>/main.tex`, `references.bib`, `virgil/{virgil,notes,footnotes}.json`
  - `queue/<citekey>.json`, `queue/<citekey>-bibedit.json`, `queue/<citekey>-deepindex.json` (legacy `-richindex.json` accepted on read), `queue/pending-reviews.json`
  - `logs/<citekey>/*.log`, `notifications/inbox.json`
  - After first skill-bundle sync: `.claude/commands/*.md`, `scripts/*.py`, `CLAUDE.md`

## Skills

Eight markdown skills, mirrored at build time from `library/skills/*.md` to `.claude/commands/library/*.md`. Invoked as `/library/<name>` from any session opened in this repo:

- `/library/index-pending` — drain the queue in one pass (use `/loop /library/index-pending` for steady-state polling)
- `/library/index-paper <citekey>` — index a single source
- `/library/triage-pdf <filename>` — triage one unsorted file
- `/library/triage-pending [auto]` — batch triage `pdfs/unsorted/`
- `/library/authenticate-bib <citekey>` — auth via Crossref / OpenAlex / Semantic Scholar / arXiv
- `/library/apply-bib-edit <citekey>` — apply a queued manual bib edit
- `/library/deep-index <citekey>` — structural cleanup (deterministic preprocess + AI pass)
- `/library/ai-requests` — drain user-authored AI review requests

Edit the source under `library/skills/`; rerun `npm run build:library-bundle` (or `npm run dev` / `npm run build`, which auto-run via `predev` / `prebuild` hooks) to regenerate `.claude/commands/library/` and `public/skill-bundle/`.

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

Every catalog entry's `bib.state` is one of four values, set by the auth pipeline and consumed by the frontend's status pill:

- **`authenticated`** — DOI verified against Crossref *or* ≥2 sources agreed with score ≥0.92. Terminal state.
- **`unverified`** — single source matched at the lower threshold. Fields are best-effort. **Action needed.**
- **`failed`** — no source produced a match above threshold. **Action needed.** Try `/library/authenticate-bib` again or fill by hand.
- **`manuscript`** — explicitly unpublished or forthcoming (`@unpublished`). Terminal state. **No action needed.**

The `manuscript` state distinguishes a properly-marked preprint from a `failed` lookup of a paper that genuinely should be in Crossref but isn't. Don't conflate them in summaries.

## Reader inheritance from the main editor

Library papers render through the **canonical `<EditorPane>`** (`@/components/EditorPane`) — the same component the main app's doc branch mounts. The entry point is `library/components/PaperRender.tsx`, which mounts `<EditorPane editable={false} chrome={READER_CHROME} />`. Every UX change to EditorPane — new TipTap extensions, paragraph/heading floats, popouts, marginalia, the panel rail — automatically flows through. Reader-specific suppressions live in `READER_CHROME` at `src/components/editor-layout/chrome-config.ts` (currently: `actionToolbarKinds=["note"]`, `showFormattingToolbar=false`, `showMenuBarEditItems=false`, `visiblePanelKinds=[outline, footnotes, examples, citations, bibliography, notes]`, `editableCardKinds=["note"]`).

The previously parallel `library/tiptap/` extension set has been deleted. `PgMarkChip` (the only Library-only extension) lives at `src/lib/tiptap/pgmark.ts` and is part of the unified extension set; it's harmless on docs without `\pgmark{N}`.

**Panel inheritance.** Path A 7.8 landed: the Reader inherits the panel rail (notes, footnotes, citations, bibliography, outline, examples) directly from `EditorPane`. Reader passes neither `viewPrefs` nor `menuBar` so the dock/float machinery and the docked MenuBar stay dormant — the rail surfaces only the icon strip + auto-active panel content for the 6 whitelisted kinds. The main app passes both bundles and gets the full chrome (15 panel kinds, detached toolbars, docked MenuBar, floating panels).

**Popout inheritance.** Per-doc card popouts (paragraph / heading / example floats and individual card popouts for notes, footnotes, citations, etc.) also mount inside `EditorPane`, gated on `viewPrefs && !viewPrefs.zenMode`. Reader passes no `viewPrefs` → the mount is dormant. If/when the Reader needs popouts later, it's a single chrome flag flip away.

## Don't

- Don't add a backend. The cowork pattern is load-bearing.
- Don't write to `master.bib` or `catalog.json` from the frontend — those are skill outputs.
- The Library may import from `@/lib/tiptap-extensions`, `@/components/Editor`, and `@/components/editor-layout/chrome-*` — those are sanctioned cross-silo bridges for Reader inheritance. Avoid reaching into other Virgil internals (`@/components/EditorLayout`, panel hooks, etc.) without a similar architectural justification.
