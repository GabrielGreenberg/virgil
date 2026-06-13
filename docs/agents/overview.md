<!-- last-verified: 7433bc2 2026-06-13 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization, docs/architecture/VIRGIL.md#ontology -->
<!-- covers-code: src/app, src/components, src/hooks, src/lib, src/links, src/cards, src/floats, src/panels, src/text-objects, src/types, library, editor, package.json -->

# Virgil Overview

**Current version:** 0.1.52 (mirrors `package.json`; bumped by `/cleanup-virgil`)


## What it is

Virgil is a browser-based visual LaTeX editor for academic writing, designed to be co-edited with AI agents. It runs 100% client-side: files live on the user's disk via the File System Access API, nothing goes over the network. The user's `.tex` and `.bib` files remain the source of truth; Virgil renders them meaningfully while preserving the original LaTeX.

It is **not** WYSIWYG: no compile, no PDF preview. It renders inline formatting (italics look italic, footnotes sit in margins, math has its own color) and lets the user click any rendered element to edit the raw LaTeX underneath.

## Who it's for

Academic writers working in LaTeX who want to cowork with Claude or another agent. Virgil doesn't call any model itself — instead, the agent reads the same files and drops structured JSON sidecars into a `virgil/` folder. Virgil surfaces those sidecars as UI (suggestions, revisions, AI requests, bib reviews).

## Tech stack

- **Framework**: Next.js 16 (App Router, static export) — breaking changes from training data; see `AGENTS.md`
- **Editor**: TipTap (ProseMirror-based)
- **Styling**: Tailwind CSS v4 + semantic CSS variables
- **Storage**: File System Access API (disk) + IndexedDB (prefs, tab state, folder handles)
- **Bibliography**: citation-js
- **Language**: TypeScript, React 19

## Top-level `src/` map

- `src/app/` — Next.js app router root, global styles (`globals.css`), manifest, layout, dev-only API routes
- `src/components/` — React components. Biggest files: `EditorLayout.tsx` (~5080 lines, shrank in 2309137 when the strip-icon drops, panel-body drops, and main-editor selection HTML5 drag plumbing were all removed in favor of pop-out + drop-mode), `EditorPane.tsx` (~5510 lines, canonical editor surface used by both the main app and the Library Reader), `Editor.tsx` (~2010 lines, TipTap wrapper), `panel-primitives.tsx` (~2390 lines; lost the in-card text-drag grip and `onTextDragStart` prop in ec38210), `MenuBar.tsx` (~1570 lines, docked menu pod — slimmed in ae15791 when the home Format/Actions popups were dropped). See `architecture.md` → "EditorPane vs EditorLayout" for the split.
- `src/hooks/` — React hooks for state management (~50 files)
- `src/lib/` — Core business logic: LaTeX parse/serialize, TipTap extensions, storage, types (~50 files)
- `src/links/` — Unified link architecture (link registry, resolvers, types) for cross-references between editor and panel cards
- `src/cards/` — Card-system SSOT (27458d8): `CARD_REGISTRY` (mirrors `TEXT_OBJECT_REGISTRY`), `CardKind`/`CardMeta` types, derived predicates, card floats, the unified `deleteMarginItem` path (moved here from `src/lib/cards/`)
- `src/text-objects/` — TextObject SSOT (`TEXT_OBJECT_REGISTRY`), grab handle, float chrome + per-kind bodies, drop adapters, selection-hydration, `block-frame.ts` (the one canonical per-block gutter geometry — grab handle, drop indicator, and figure chrome all read it so they align by construction)
- `src/floats/` — The `Floatable` contract (the shared shape cards and TextObjects both satisfy)
- `src/panels/` — Sidebar panel implementations, one folder per panel + `_shared/` + `panel-registry.ts`
- `src/types/` — Shared type definitions
- `src/STYLE_GUIDE.md` — Design tokens, panel architecture, UI conventions

## Sibling subsystem: `library/`

The Library tab is its own self-contained tree at the repo root, sibling to `src/`. It has its own components, hooks, lib (parser/serializer/store), Python skill scripts, and `library/styles/library.css`. Path A 7.8 deleted the parallel `library/tiptap/` extension set; the Library Reader now mounts the canonical `<EditorPane>` and shares Virgil's TipTap extensions (PgMarkChip moved to [src/lib/tiptap/pgmark.ts](../../src/lib/tiptap/pgmark.ts)). Cross-tree imports go through the `@library/*` path alias (see `tsconfig.json`, `vitest.config.ts`). Detailed map in [library/AGENTS.md](../../library/AGENTS.md). The static dev sample lives in `library-data/`.

## Sibling subsystem: `editor/`

Editor-side skill bundle (companion to `library/`): the `/editor/review` umbrella plus per-kind subskills that fulfill `ai-requests.json` entries. Self-contained under `editor/` (skills, Python helpers, build script). Wired into the Virgil app via [src/lib/ai-request-bridge.ts](../../src/lib/ai-request-bridge.ts) (collapses per-card `aiRequest:true` flags into the unified queue) and [src/hooks/useDocNotificationStream.ts](../../src/hooks/useDocNotificationStream.ts) (toasts skill completions). Built into `public/skill-bundle/` at `predev`/`prebuild` alongside the library bundle. Detailed map in [editor/AGENTS.md](../../editor/AGENTS.md).

## Core user-facing concepts

- **Main text editor** — central prose area with visual rendering of LaTeX commands
- **TextObjects** — the single canonical abstraction for every graspable text unit (paragraph, heading, list, list item, example item, atom block, linkedRange). Adding a new graspable kind = one entry in `TEXT_OBJECT_REGISTRY` + one schema-group annotation; grab handle, float chrome, drop adapter, and marginalia positioning route through that one registry. See `src/text-objects/` and [TEXT-OBJECT-REFACTOR.md](../../TEXT-OBJECT-REFACTOR.md)
- **Paragraph UUIDs** — every TextObject node carries a `uuid` attr so margins and panels can anchor to specific locations (linkedRange uses the `linkedAnchor` mark's `anchorId` instead)
- **Marginalia gutter** — left/right strips of icon markers anchored to paragraphs (or any TextObject), representing linked cards (notes, reports, todos, cuts, archives, revisions)
- **Side panels** — configurable stack per side: notes, footnotes, citations, bibliography, reports, examples, todo, archive, revisions (comments + suggestions), cutter, outline, search, wordcount, errors, omni
- **Cards** — every panel displays items as themed cards; cards can be popped out as floating windows
- **Links** — unified model connecting editor content to panel cards (three kinds: footnote, citation, anchor). The anchor side parameterizes on `targetKind: TextObjectKind`, so cards can anchor to any TextObject
- **AI exchange** — sidecar JSON files (`suggestions.json`, `revisions.json`, `ai-requests.json`, `bib-review-requests.json`) in `virgil/` folder drive structured UI affordances
- **Citations & bibliography** — natbib + biblatex command families; formatted via citation-js
- **Library tab** — sibling pane to each open document. Outer tabs (DocTab + LibraryTab pair) live in the Virgil bar; inside the library pane there's a second layer of tabs (Central catalog + curated libraries). Self-contained code under `library/`

## Where to look next

- UI vocabulary / user terms → `glossary.md`
- Panels, strips, toolbars → `ui-chrome.md`
- Editor content model, links, marginalia → `main-text.md`
- Registries, hooks, storage, sidecars → `architecture.md`
