<!-- last-verified: 3de2062 2026-04-23 -->

# Virgil Overview

**Current version:** 0.1.22 (mirrors `package.json`; bumped by `/cleanup-virgil`)


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

- `src/app/` — Next.js app router root, global styles (`globals.css`), manifest, layout
- `src/components/` — React components. Biggest files: `EditorLayout.tsx` (5129 lines, orchestrator), `Editor.tsx` (2806 lines, TipTap wrapper), `panel-primitives.tsx` (1505 lines, card/panel design system), `MenuBar.tsx` (1424 lines, floating toolbar)
- `src/hooks/` — React hooks for state management (42 files)
- `src/lib/` — Core business logic: LaTeX parse/serialize, TipTap extensions, storage, types (39 files)
- `src/links/` — Unified link architecture (link registry, resolvers, types) for cross-references between editor and panel cards
- `src/panels/` — Sidebar panel implementations, one folder per panel + `_shared/` + `panel-registry.ts`
- `src/types/` — Shared type definitions
- `src/STYLE_GUIDE.md` — Design tokens, panel architecture, UI conventions

## Core user-facing concepts

- **Main text editor** — central prose area with visual rendering of LaTeX commands
- **Paragraph UUIDs** — every editable block (paragraph, heading, list, etc.) carries a `uuid` attr so margins and panels can anchor to specific locations
- **Marginalia gutter** — left/right strips of icon markers anchored to paragraphs, representing linked cards (notes, quotations, todos, cuts, archives, revisions)
- **Side panels** — configurable stack per side: notes, footnotes, citations, bibliography, quotations, todo, archive, revisions, cutter, outline, search, wordcount, errors, suggestions, omni
- **Cards** — every panel displays items as themed cards; cards can be popped out as floating windows
- **Links** — unified model connecting editor content to panel cards (three kinds: footnote, citation, anchor)
- **AI exchange** — sidecar JSON files (`suggestions.json`, `revisions.json`, `ai-requests.json`, `bib-review-requests.json`) in `virgil/` folder drive structured UI affordances
- **Citations & bibliography** — natbib + biblatex command families; formatted via citation-js

## Where to look next

- UI vocabulary / user terms → `glossary.md`
- Panels, strips, toolbars → `ui-chrome.md`
- Editor content model, links, marginalia → `main-text.md`
- Registries, hooks, storage, sidecars → `architecture.md`
