<!-- last-verified: 985d891 2026-06-19 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization, docs/architecture/VIRGIL.md#ontology -->
<!-- covers-code: src/app, src/components, src/hooks, src/lib, src/links, src/cards, src/floats, src/panels, src/text-objects, src/types, library, editor, package.json -->

# Virgil Overview

**Current version:** 0.1.56 (mirrors `package.json`; bumped by `/cleanup-virgil`)


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
- `src/components/` — React components. Biggest files: `EditorLayout.tsx` (~4610 lines, shrank in 2309137 when the strip-icon drops, panel-body drops, and main-editor selection HTML5 drag plumbing were all removed in favor of pop-out + drop-mode), `EditorPane.tsx` (~6450 lines, canonical editor surface used by both the main app and the Library Reader; also owns the single load-time anchor-recovery pass), `Editor.tsx` (~1760 lines, TipTap wrapper), `panel-primitives.tsx` (~3020 lines), `MenuBar.tsx` (~940 lines, docked menu pod; its `BlockTypeDropdown` + `ViewMenu` now ride the `<Menu>` primitive), `SkillSyncControls.tsx` (the loud-and-recoverable skill-bundle sync UI — failure banner with Retry/regrant + a manual Re-sync pill, symmetric in paper + library). See `architecture.md` → "EditorPane vs EditorLayout" for the split.
  - `src/components/menu/` — the unified `<Menu>` primitive (`MenuProvider`, `MenuItemsFromRegistry`, `useMenuKeyboard`/`useMenuCombobox`/`useMenuItem`/`useMenuDismiss`, `nav-core.ts`, `registry.ts`, `regions.tsx`): one keyboard/roving-highlight model behind every action menu (grab-bar menu, lightning `ActionsMenuPanel`, `SelectionColorPopover`, `LabelRefPopover`, `HeadingTypeMenu`, `TabPlusMenu`, `BibEntryPickerMenu`, MenuBar dropdowns). The slash popup is a documented exception. Design: [menu-system-design.md](menu-system-design.md).
  - `src/components/drop-mode/` — drop-mode controller + specs (block move, in-text-atom grab, text-range move, textobject re-anchor) plus `card-drop-gesture.ts`: the neutral card drop button (docked + omni + popped-out-float via `FloatChrome`) enters drop-mode to (re)anchor a card; dropping an unanchored footnote/citation creates the atom inline. Replaced the retired panel→gutter native drag (deleted `event-bridges/panel-drops.ts` + `anchor-rebind.ts`). Card `droppable`/`dropPlacement` live as `CardMeta` facets in `src/cards/`.
- `src/hooks/` — React hooks for state management (~60 files), plus `view-prefs-derived.ts` (a pure leaf module of derived `ViewPrefs` read-helpers, re-exported by `useViewPrefs` so route-derivation code can read prefs without dragging in the heavy storage chain) and `useReconcileModeAAnchors.ts` (the shared Mode-A reload reconcile factory each panel hook calls — UUID-first, paragraph-snapshot fallback, funneled through the `resolve-card-anchor.ts` SSOT), and `useOrphanedFootnotes.ts` (the live orphan-footnote list fed to the Footnotes + Search panels)
- `src/lib/` — Core business logic: LaTeX parse/serialize, TipTap extensions, storage, types (~70 files). Notable subsystems: `src/lib/actions/` (the multi-surface `VIRGIL_ACTION_REGISTRY` SSOT — one action set rendered by the grab-handle menu, gutter lightning, slash commands, and typed-LaTeX input rules; PM→React dispatch via `editor-actions-bridge.ts`, icons in `action-icons.tsx`), `src/lib/focus-view.ts` (UUID-anchored focus-mode band lib + `focusViewPlugin`), `src/lib/tiptap/` (the TipTap extension set). Code-pane support: `code-position-map.ts` (the cached UUID↔`.tex` source-position map keyed by the CodeMirror doc, SSOT for cursor/selection sync) and `code-band.ts` (the passive code-side cursor band; manual sync arrows replaced auto-align). Anchor durability: `anchor-mint-signal.ts` (tags an anchor-UUID mint tx so the autosaver flushes the doc bundle immediately, closing the card-clock vs doc-clock reload race) and `src/lib/tiptap/anchor-highlight-deco.ts` (the `AnchorHighlightDecorator` extension — paints card hover/selection on in-editor node/atom anchors via a `Decoration.node`, replacing the foreign-mutation redraw; Mode-B text-range highlight stays on raw `setAttribute`). Security: `sanitize-html.ts` (allowlist HTML sanitizer wired into the bibliography annotation editor; BIB-F5-01). Identity: `src/lib/identity/` (the identity-cascade subsystem giving footnote/citation inline atoms stable UIDs so selection/float/pin survive a markerless re-parse — `identity-cascade.ts` dispatcher, `identity-bus-consumer.ts` + `useIdentityBusConsumer.ts` the SINGLE inline-atom `DocStructureBus` consumer that lifecycle/citation-resync register on as ordered policies, `sidecar-uid-migrate.ts`, `bib-cite-rewrite.ts`, plus `src/lib/bib-uid.ts` for stable bib-UID minting; all gated behind the DEFAULT-OFF flags `virgil:identity-cascade` / `virgil:inline-atom-lifecycle` via `identity-flag.ts` / `inline-atom-lifecycle-flag.ts`)
- `src/links/` — Unified link architecture (link registry, resolvers, types) for cross-references between editor and panel cards. Anchor-recovery SSOT: `resolve-card-anchor.ts` (one pure `resolveCardAnchor` ladder — uuid → live mark → snapshot → orphan — plus `buildResolveIndex` + `reconcileCardToResolved`, the single owner every recovery path funnels through), `_shared/reapply-mode-b-anchors.ts` (the single load-time Mode-B mark re-apply WRITER, retiring the old `EditorLayout.applyLinkedAnchors`), and `_shared/normalize-text.ts` (the canonical snapshot normalize-at-capture form shared by both ends of the match). Mode-A cards carry a self-healing paragraph snapshot captured at creation and at drop re-anchor
- `src/cards/` — Card-system SSOT (27458d8): `CARD_REGISTRY` (mirrors `TEXT_OBJECT_REGISTRY`), `CardKind`/`CardMeta` types (incl. the `droppable`/`dropPlacement` drop facets that gate the card drop button, plus the declarative `content: CardContentModel | null` facet + `MorphDropField` — one descriptor that `cardHasContent` walks so panel-trash + gutter-marker delete-confirms never miss content and morph drop-fields drive the confirm copy), derived predicates, card floats + `drop-specs/`, the unified `deleteMarginItem` path (moved here from `src/lib/cards/`), and `src/cards/lifecycle/` (the card-lifecycle reconciler — `card-lifecycle-signal.ts`, `run-event.ts` executor, `useCardLifecycleReconciler.ts`)
- `src/text-objects/` — TextObject SSOT (`TEXT_OBJECT_REGISTRY`), grab handle, float chrome + per-kind bodies, drop adapters, selection-hydration, `LiftHost.tsx` (the shared grab-handle lift core extracted into a provider — drives the lifted-overlay ghost for both the grab handle and the drop button on popped-out text-object floats), `block-frame.ts` (the one canonical per-block gutter geometry — grab handle, drop indicator, and figure chrome all read it so they align by construction)
- `src/floats/` — The `Floatable` contract (the shared shape cards and TextObjects both satisfy)
- `src/panels/` — Sidebar panel implementations, one folder per panel + `_shared/` + `panel-registry.ts`. Per-card archive lives in `_shared/`: `card-archive-actions.tsx` (the archive button beside trash), `CardViewModeMenu.tsx` + `card-archive-view.tsx` (the View Active/Archives/All menu + `filterByArchiveView`); archived cards hide from active/omni/gutter (highlights are delete-only, footnote stays delete-only)
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
