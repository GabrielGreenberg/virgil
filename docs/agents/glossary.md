<!-- last-verified: 151979b 2026-05-12 -->

# Glossary

Fast lookup from the user's vocabulary → code names + file paths. When the user uses a term you can't resolve, search here first before exploring the codebase.

If a user term isn't yet in this file, add it under **Pending terminology** at the bottom with a best-guess referent and today's date. The cleanup skill consolidates these on the next merge cycle.

---

## Structural UI

| User term | Code name(s) | Where |
|---|---|---|
| **Virgil bar** / **top bar** (horizontal strip across the top, containing the VIRGIL logo, tabs, and the docked menu pod) | No dedicated component — inline `<div class="virgil-bar">` | `EditorLayout.tsx` ~line 4013; fill styled by `--topbar-bg` / `--topbar-bg-bottom` in [src/app/globals.css](../../src/app/globals.css) |
| **Upper tool strip** (the continuous opaque manilla band directly under the Virgil bar; one rectangle running edge-to-edge across the row, containing — left to right — left action buttons, text tool bar, right action buttons, plus the icon strips at the outer edges; pinned at viewport top so document content scrolls under it) | Three sticky segments that share `background: var(--background)`: `[data-tool-strip="left-action"]`, `[data-tool-strip="text"]`, `[data-tool-strip="right-action"]` | Mounted in [EditorPane.tsx](../../src/components/EditorPane.tsx) (text segment ~line 3105); left/right action segments rendered by `MarginActionToolbar` inside `PaneRail` |
| **Text tool bar** (center segment of the upper tool strip, sitting above the editor; holds File/Edit/format/split-screen/etc. action buttons) | `MenuBar` (code name refers to the pod, not the strip) | [src/components/MenuBar.tsx](../../src/components/MenuBar.tsx) (default export); mounted **inline** as the sticky `[data-tool-strip="text"]` in [src/components/EditorPane.tsx](../../src/components/EditorPane.tsx) ~line 3105. Detached copies (`DetachedMenuToolbar`, multi-instance) still spawn from popover grab bars; their state lives in `detachedMenus[]` (in EditorLayout shell). `prefs.menuLocation` is now effectively home-only |
| **Left action buttons** / **right action buttons** (per-column segments of the upper tool strip, sitting above each side panel; small icon row for "Add footnote", "Add citation", etc.) | `MarginActionToolbar` — rendered as the sticky `[data-tool-strip="left-action"]` / `[data-tool-strip="right-action"]` inside `PaneRail` | [src/components/MarginActionToolbar.tsx](../../src/components/MarginActionToolbar.tsx); mounted in `EditorPane.tsx` ~line 3010 |
| **Menu pod** / **menu bar** / **main toolbar** / **menu toolbar** / **floating toolbar** | Same as **Text tool bar** above | Same |
| **Left tool strip** / **left icon strip** / **sidebar navigation** (left) | Inline `<div data-strip-side="left">` — no dedicated component | Rendered by `PaneRail` in `EditorPane.tsx` ~line 3878 |
| **Right tool strip** / **right icon strip** / **sidebar navigation** (right) | Inline `<div data-strip-side="right">` | Same `PaneRail` (right-side instance) |
| **Filter menu** / **kebab at the bottom of the strip** (horizontal 3-dot menu pinned to the bottom of each L/R icon strip; toggles which omni categories show, plus a "Default view" reset) | `OmniFilterMenu` | [src/panels/Omni/OmniViewPanel.tsx](../../src/panels/Omni/OmniViewPanel.tsx); mounted at the bottom of each `PaneRail` strip in `EditorPane.tsx` |
| **Dock outline** / **drop outline** (thin clear-blue outline with static glow that marks the active dock target during a panel drag; persists at the originally captured rect even after the panel undocks) | `DockOutline` (body-portaled, fixed positioning) consuming the module-level `useDockDragTarget` signal in `dock-drag.ts` (`setDockDragTarget` / `getDockDragTarget`) | [src/components/editor-layout/DockOutline.tsx](../../src/components/editor-layout/DockOutline.tsx); [src/components/editor-layout/dock-drag.ts](../../src/components/editor-layout/dock-drag.ts); mounted in `EditorPane.tsx` ~line 2524 |
| **Panel button** / **strip button** (individual icon in a strip) | `StripButton` | [src/components/editor-layout/drag-drop.tsx](../../src/components/editor-layout/drag-drop.tsx) |
| **Panel column** / **sidebar column** (the resizable column on either side) | `PanelColumn` | [src/components/editor-layout/panel-column.tsx](../../src/components/editor-layout/panel-column.tsx) |
| **Current section pod** / **section lozenge** (floating section-path pill at top of editor, shows on scroll, fades after idle) | `SectionLozenge` | [src/components/editor-layout/section-lozenge.tsx](../../src/components/editor-layout/section-lozenge.tsx); `SectionPathEntry` type + main/mirror path builders in `EditorLayout.tsx` ~2086 / ~2167 |
| **Navigation strip** | No dedicated component — paragraph-nav chevrons live inside `MenuBar` | `MenuBar.tsx` around line 1431 |
| **Document folder tab** / **manila tab** (the document tabs in the topbar with rounded top + swoop hooks at the bottom) | `DocumentFolderTab` (one self-contained SVG path per tab); path geometry in `folder-path.ts` (`buildActiveTabStrokePath`, `buildTabFillPath`) | [src/components/editor-layout/DocumentFolderTab.tsx](../../src/components/editor-layout/DocumentFolderTab.tsx); [src/components/editor-layout/folder-path.ts](../../src/components/editor-layout/folder-path.ts) |

## Toolbars inside the Virgil bar

| User term | Code name(s) | Where |
|---|---|---|
| **Formatting toolbar** / **format popup** | `AttachedPopover` anchored to A-glyph (no dedicated component) | `MenuBar.tsx` ~line 1509 (inside `MenuBarContent`) |
| **Action toolbar** / **actions popup** (attached to Virgil bar) | `ActionButtonsRow` rendered inside an `AttachedPopover` anchored to 8-ray star | `ActionButtonsRow` at `MenuBar.tsx:953` |
| **Detached actions toolbar** (torn off and floating) | `DetachedActionsToolbar` — multi-instance; each tear-off spawns a new copy stored in `detachedActions[]` with its own id | `MenuBar.tsx:1077`; mounted via portal in `EditorLayout.tsx` |
| **Margin action toolbar** | Same as **Left action buttons** / **Right action buttons** above | Same |
| **View menu** / **three-dot menu** (on Virgil bar) | `ViewMenu` | `MenuBar.tsx:1140` |
| **Block-type dropdown** (body/chapter/section/subsection) | `BlockTypeDropdown` | `MenuBar.tsx` ~line 471 |
| **Style mode button** / **document style** / **Manage Styles modal** (Style mode toggle on the Virgil bar that opens a full styles-library modal — apply/edit/duplicate/delete style entries, save current preamble as a new entry, pick default for new docs; the old inline `DocStyleDropdown` was folded in by `9744b71`) | `ManageStylesModal`; per-doc state in `useDocumentStyle`; user-library state in `useStyleLibrary`; presets in `DOCUMENT_STYLES`; the on-apply diff prompt is `StyleApplyDialog` | [src/components/ManageStylesModal.tsx](../../src/components/ManageStylesModal.tsx); [src/components/StyleApplyDialog.tsx](../../src/components/StyleApplyDialog.tsx); [src/lib/document-styles.ts](../../src/lib/document-styles.ts); [src/hooks/useDocumentStyle.ts](../../src/hooks/useDocumentStyle.ts); [src/hooks/useStyleLibrary.ts](../../src/hooks/useStyleLibrary.ts); mode-toggle button + mount in `EditorLayout.tsx` ~line 4737 / ~line 5112 |
| **Print button** / **print dialog** (printer icon on the Virgil bar; opens a dialog with show/hide toggles for paragraph titles, marginalia, footnotes, citations, comments, etc., then triggers `window.print()`) | `PrintDialog` + `PrintAppendices`; print orchestration in `lib/print.ts`; pref state via `useViewPrefs` | [src/components/PrintDialog.tsx](../../src/components/PrintDialog.tsx); [src/components/PrintAppendices.tsx](../../src/components/PrintAppendices.tsx); [src/lib/print.ts](../../src/lib/print.ts) |
| **Help button** / **"?" button** (circle-question-mark icon on the Virgil bar; opens a dropdown with Helper mode toggle) | Inline in `EditorLayout.tsx`, next to the info ("i") button | `EditorLayout.tsx` |
| **Helper mode** / **helper mode indicator** (when active, hovering any button shows a black callout describing it; indicator in Virgil bar styled like Focus View) | `useHelperMode` hook; CSS pseudo-element callouts via `data-helper` attrs; body attr `data-helper-mode="on"` | [src/hooks/useHelperMode.ts](../../src/hooks/useHelperMode.ts); CSS in [src/app/globals.css](../../src/app/globals.css) |
| **Highlights menu** / **per-kind highlight toggles** (sub-menu in the View menu that hides linked-anchor highlights for individual card kinds) | `HighlightType` union (`quotation`, `note`, `todo`, `comment`, `cut`); `hiddenHighlightTypes` pref in `useViewPrefs`; toggles rendered inside `ViewMenu` | [src/hooks/useViewPrefs.ts](../../src/hooks/useViewPrefs.ts); `MenuBar.tsx` ViewMenu section |
| **Back / forward buttons** (paragraph nav) | Chevron pair, inline in MenuBar | `MenuBar.tsx`, inline in `MenuBarContent` (~line 1431) |
| **Split screen toggle** | Inline button in MenuBar | `MenuBar.tsx` |
| **Close all panels** (X button) | Inline button in MenuBar | `MenuBar.tsx` |
| **Grab handle** (pill on Virgil bar for dragging) | `PodGrabHandle` (re-exported from `floating-toolbar-shell.tsx`) | `MenuBar.tsx:23` import; usage ~line 747 |
| **Rotation knob** (toggles horizontal/vertical) | Inline SVG on the pod corner | `MenuBar.tsx` |
| **Dock-up button** (re-pins a dragged-out Virgil bar back to its home) | Inline button in MenuBar, rendered only when `!atHome` | `MenuBar.tsx` |

## Panels (what "panel" means)

All panels declared in [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) (`PANEL_REGISTRY` is SSOT). 11 card panels, 4 non-card panels.

### Card panels (have cards anchored in the document)

| Panel kind | Label | Card kind | Default strip | Theme |
|---|---|---|---|---|
| `notes` | Notes | `note` | right | emerald |
| `footnotes` | Footnotes | `footnote` | left | red |
| `citations` | Citations | `citation` | left | warm yellow |
| `bibliography` | Bibliography | `bib` | left | warm tan |
| `quotations` | Quotations | `quotation` | left | (default) |
| `examples` | Examples | `example` | left | (default) |
| `todo` | Todo List | `todo` | right | stone |
| `archive` | Archived Text | `archive` | right | amber/blue-grey |
| `revisions` | Revisions | `comment` (key prefix `revision`) + `revision-suggestion` (polymorphic — `card.kind` is `comment` in registry; `revision-suggestion` registered in `CARD_KEY_PREFIXES`) | right (omni-eligible) | stone |
| `cutter` | Cutter | `cutter-comment` + `cutter-suggestion` (polymorphic — `card: null` in registry) | right (omni-eligible) | red |
| `errors` | Errors | `error` | right (omni-eligible) | light red |

### Non-card panels

| Panel kind | Label | Default strip | Purpose |
|---|---|---|---|
| `outline` | Outline | left | Heading tree with edit/focus/lock |
| `search` | Search | left | Full-text search |
| `wordcount` | Word Count | right | Live word counts by section |
| `omni` | Omni-view | — | Two-column view aggregating all omni-eligible panels |

Each panel lives in `src/panels/<PanelFolder>/`.

## Main text elements

| User term | Code name(s) | Where |
|---|---|---|
| **Main text** | The TipTap editor document | [src/components/Editor.tsx](../../src/components/Editor.tsx) |
| **Heading** | TipTap `heading` node (levels 1–4 = Chapter/Section/Subsection/Subsubsection) | TipTap schema; block-type dropdown at `MenuBar.tsx` ~line 451 |
| **Paragraph** | TipTap `paragraph` node (carries `uuid` attr) | See `main-text.md` |
| **Paragraph title** | Stored in `virgil.json` sidecar (`ParagraphMeta.title`), **not** a Tiptap attr | Loaded in [src/hooks/useDocument.ts](../../src/hooks/useDocument.ts); shown in Omni view + search breadcrumbs |
| **Marginalia** | Gutter icons in left/right margin of main text, anchored to paragraphs | [src/components/Marginalia.tsx](../../src/components/Marginalia.tsx); metadata in [src/lib/marginalia.ts](../../src/lib/marginalia.ts); grid math in [src/lib/marginalia-grid.ts](../../src/lib/marginalia-grid.ts) |
| **Linked text** | Text carrying a `linkedAnchor` mark (Mode B) — connects to a card | [src/lib/tiptap/linked-anchor.ts](../../src/lib/tiptap/linked-anchor.ts) |
| **Footnote** (in text) | TipTap atom node `footnote` | [src/lib/tiptap/footnote.ts](../../src/lib/tiptap/footnote.ts) |
| **Citation** (in text) | TipTap atom node `citation` | [src/lib/tiptap/citation.ts](../../src/lib/tiptap/citation.ts) |
| **Inline math** | TipTap atom node `inlineMath` (`$…$`) | [src/lib/tiptap/math.ts](../../src/lib/tiptap/math.ts) |
| **Display math** | TipTap atom node `displayMath` (`$$…$$`) | Same file |
| **LaTeX comment** | TipTap node `latexComment` (`%…`) | [src/lib/tiptap/latex-comment.ts](../../src/lib/tiptap/latex-comment.ts) |
| **Label** | TipTap mark `label` (`\label{ref}`); `LabelRef` node for `\ref{}` / `\getref{}` / `\getfullref{}` with `refCommand` + `targetKind` attrs | [src/lib/tiptap/label.ts](../../src/lib/tiptap/label.ts) |
| **Title field** | TipTap node `titleField` for hoisted `\title{}`, `\author{}`, `\date{}` from preamble | [src/lib/tiptap/title.ts](../../src/lib/tiptap/title.ts) |
| **Example block** / **treatment** (expex `\ex`/`\pex`) | TipTap node `exampleBlock`; sub-items wrapped in `exampleItemList` (recursive — nested xlist tiers reuse the same wrapper for 1 → a → i → A → I marker cycle); each item is `exampleItem`; glosses nest as `exampleGloss` → `alignedGlossRow`/`proseGlossRow` → `glossCell` | [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts) |

## Cards

| User term | Code name(s) | Where |
|---|---|---|
| **Card** | `PanelCard` (universal wrapper) or `EditableCard` (rich-text variant) | [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) |
| **Card theme** | `CARD_THEMES` dict (11 themes: footnote, note, archive, todo, bib, citation, comment, aiRequest, cut, error) | Same file |
| **AI request card** | `AiRequestCard` | Same file |
| **Orphaned card** (no anchor in document) | `BadgeOrphaned` + disabled `CardTargetIcon` | Same file |
| **Popped-out card** / **floating card** | `FloatCard` wrapping `FloatingPanel` | [src/components/FloatingCards.tsx](../../src/components/FloatingCards.tsx), [src/components/FloatingPanel.tsx](../../src/components/FloatingPanel.tsx) |
| **Floating panel** | `FloatingPanel` (portal, drag + resize) | [src/components/FloatingPanel.tsx](../../src/components/FloatingPanel.tsx) |
| **Quick card** (compact bib-entry card with chip, target icon, popout button in header) | `BibEntryCard` | [src/components/BibEntryCard.tsx](../../src/components/BibEntryCard.tsx) |
| **Paragraph float** (popped-out single paragraph with editable title + drag handle) | `ParagraphFloat`; popout key `paragraph:${uuid}` in `prefs.poppedOutCards` | [src/components/ParagraphFloat.tsx](../../src/components/ParagraphFloat.tsx) |
| **Heading float** (popped-out heading + its body section) | `HeadingFloat`; popout key `heading:${uuid}` in `prefs.poppedOutCards`; section-body extraction in `section-range.ts` | [src/components/HeadingFloat.tsx](../../src/components/HeadingFloat.tsx); [src/lib/section-range.ts](../../src/lib/section-range.ts) |
| **Example float** (popped-out example block from the editor gutter) | `ExampleBlock` node-view popout button (via `ExampleBlockOptions`); popout key `example:${uuid}` in `prefs.poppedOutCards` (NOTE: this is the in-editor block popout — distinct from the Examples panel's `ExampleCard` popout, which uses the same key prefix) | [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts); render via `FloatCard` in [src/components/editor-layout/floating-cards.tsx](../../src/components/editor-layout/floating-cards.tsx) |

## General buttons

| User term | Code name(s) | Where |
|---|---|---|
| **Pop-up button** / **popout button** (toggles docked ↔ floating) | `PopoutButton` (generic), `CardPopoutButton` (card level), `PanelPopout` (panel level, context-aware) | `panel-primitives.tsx` |
| **Jump-to button** (page-with-arrow icon, jumps from card to in-text anchor) | `CardTargetIcon` / `TargetIcon` | `panel-primitives.tsx` |
| **"Can I request" button** / **request button** / **AI-request button** (8-ray star in panel headers) | `onAiRequest` callback rendered inline in `PanelHeader`; icon is the 8-ray sun-star (never a 5-point star) | `panel-primitives.tsx` (`PanelHeader`); icon spec in [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) |
| **Add button** (+ in panel header) | `onAdd` callback rendered inline in `PanelHeader` | `panel-primitives.tsx` |
| **Delete / trash button** (bottom-right of card, hover-reveal) | `CardTrashButton` | `panel-primitives.tsx` |
| **Menu delete item** (in three-dot menu) | `MenuDelete` | `panel-primitives.tsx` |
| **Three-dot menu** | `ItemMenu` (~line 1844 in `panel-primitives.tsx`). Auto-injects a text-size stepper (`PanelTextSizeRow`) at ~line 1875; size persists via `useViewPrefs` keyed by panel kind | `panel-primitives.tsx`; [src/components/PanelTextSizeRow.tsx](../../src/components/PanelTextSizeRow.tsx); sizes via [src/lib/panel-typography.ts](../../src/lib/panel-typography.ts); per-kind context [src/components/panel-kind-context.tsx](../../src/components/panel-kind-context.tsx) |
| **Grab handle** (6-dot grip on card header) | Inline SVG, appears when `grabHandle` prop is true | `panel-primitives.tsx` (`EditableCard` header) |
| **Text drag handle** (3-line icon on card body) | Inline SVG, appears when `onTextDragStart` prop is provided | `panel-primitives.tsx` |
| **Passage-action menu** / **drag-handle menu** (click the paragraph/selection/heading drag handle to pop a vertical menu of Footnote / Citation / Quotation / Note / Todo / Review / Suggest edit / Cutter / Archive, each with a single-letter keyboard hint that's active only while the menu is open) | `DragHandleMenu` (anchored popover, react-portal); opened via `DragHandleMenuApi.open(passage, anchorRect)` from `DragHandleMenuProvider`; passage drag-handle UI in `SelectionDragHandle` | [src/components/DragHandleMenu.tsx](../../src/components/DragHandleMenu.tsx); [src/components/editor-layout/card-actions/drag-handle-menu-context.tsx](../../src/components/editor-layout/card-actions/drag-handle-menu-context.tsx); [src/components/SelectionDragHandle.tsx](../../src/components/SelectionDragHandle.tsx); wired in `EditorPane.tsx` ~line 1375 |

## Link model

| User term | Code name(s) | Where |
|---|---|---|
| **Link** | `Link` type | [src/links/_shared/types.ts](../../src/links/_shared/types.ts) |
| **Link kind** | `LinkKind = "footnote" \| "citation" \| "anchor"` | Same |
| **Anchor** (the in-text side of a link) | `LinkAnchor` | Same |
| **Mode A** | Paragraph-only anchor (no text range) | `isModeB(link) === false`; see `src/links/links.ts` |
| **Mode B** | Paragraph + text-range anchor (linkedAnchor mark) | `isModeB(link) === true` |
| **DOM contract** | `data-link-id`, `data-link-kind`, `data-link-card` attrs on in-editor markers; `data-link-card` on cards | [src/links/link-registry.ts](../../src/links/link-registry.ts) |
| **Linked surfaces** / **three-surface hover** (text passage + margin icon + panel card all light up together; click-to-select propagates) | Module-level `cardStore` (selection + hover) in `anchored-card-store.ts`; per-card hook `useAnchoredCard` returns the `data-card-key`, mouse handlers and selected/hovered booleans every anchored card needs; `usePlacement` scrolls the editor when card→anchor selection changes. Consumers `useLinkHighlight`, `useCardHoverHighlight`, `useCardSelectionHighlight`; sources `useTextHoverBridge`, `usePanelCardHoverBridge`, generic margin `onHover` | [src/links/_shared/anchored-card-store.ts](../../src/links/_shared/anchored-card-store.ts); [src/links/_shared/useAnchoredCard.ts](../../src/links/_shared/useAnchoredCard.ts); [src/links/_shared/usePlacement.ts](../../src/links/_shared/usePlacement.ts); see `main-text.md` → Highlight coupling |
| **EntityKind** | Linking-vocabulary subset of `CardKind`: `note \| cut \| revision \| todo \| archive \| quotation \| footnote \| citation`. Used by hover/selection plumbing | [src/links/_shared/entity-hover.ts](../../src/links/_shared/entity-hover.ts) |
| **Label candidate list** (ref popover) | `LabelInfo { label, kind, typeLabel, title }`; `kind ∈ {heading, equation, figure, table, label, example}` | [src/lib/labels.ts](../../src/lib/labels.ts) + [src/components/LabelRefPopover.tsx](../../src/components/LabelRefPopover.tsx) |

## Library tab

Self-contained subsystem under `library/` (sibling of `src/`). See [library/AGENTS.md](../../library/AGENTS.md) for the full map.

| User term | Code name(s) | Where |
|---|---|---|
| **Library tab** / **manila tab** (the "shadow" tab paired with each DocTab in the Virgil bar, in `--library-bg` warm tan) | Rendered alongside `DocumentFolderTab` per open doc — see double-tab pattern in [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) "Library tab" section | [src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx) tab strip; library pane body in [library/components/LibraryApp.tsx](../../library/components/LibraryApp.tsx) |
| **Library pane** (body of the Library tab once activated) | `LibraryApp` → `LibraryView` | [library/components/LibraryApp.tsx](../../library/components/LibraryApp.tsx); [library/components/LibraryView.tsx](../../library/components/LibraryView.tsx) |
| **Inner library tabs** / **Central + curated libraries** (the second layer of tabs inside the library pane: Central catalog plus user-spawned curated slices) | `TabbedLibraryPanel` + `useLibraryTabs` | [library/components/TabbedLibraryPanel.tsx](../../library/components/TabbedLibraryPanel.tsx); [library/hooks/useLibraryTabs.ts](../../library/hooks/useLibraryTabs.ts). The inner strip's "+" / recent-libraries dropdown moved to the navigator pod (below); per-tab pin and close × are now uniform across Central / Project / Custom |
| **Libraries navigator** (leftmost rounded pod inside the library pane: lists Central, Project libraries, and My libraries with a "+" to spawn customs and entry-drop targets on custom rows) | `LibrariesNavigator` (~490 lines); `openLibrary` action on `useLibraryTabs` (paper-style replace-or-append for navigator clicks); `togglePinLibrary` (renamed from `togglePinPaper`) | [library/components/LibrariesNavigator.tsx](../../library/components/LibrariesNavigator.tsx); [library/hooks/useLibraryTabs.ts](../../library/hooks/useLibraryTabs.ts) |
| **My Papers pod** (pod below the navigator listing currently-open Virgil docs; "+ Add paper" trigger opens a popup mirroring the Virgil-bar `TabPlusMenu` — recent docs + Open folder + Create new) | `MyPapersPod`; rendered into the `belowNavigator` slot of `LibraryView` | [src/components/library/MyPapersPod.tsx](../../src/components/library/MyPapersPod.tsx) |
| **Nav pod** (shared shape for the stacked Libraries + My Papers pods, with a draggable horizontal resizer between them; height persisted to `virgil-library-papers-height`, both clamped to 100px floor) | `NavPod` | [library/components/NavPod.tsx](../../library/components/NavPod.tsx) |
| **Catalog** (master `catalog.json` on disk + `master.bib`) | `CatalogStore` + `useCatalog` + `useMasterBib` | [library/lib/catalog-store.ts](../../library/lib/catalog-store.ts); [library/hooks/useCatalog.ts](../../library/hooks/useCatalog.ts) |
| **Bib card** (single-entry bib display in the right detail pane) | `BibCard` | [library/components/BibCard.tsx](../../library/components/BibCard.tsx) |
| **Bib edit modal** (full-form edit dialog for a `.bib` entry) | `BibEditModal` | [library/components/BibEditModal.tsx](../../library/components/BibEditModal.tsx) |
| **Paper render** (read-only LaTeX paper view inside the library) | `PaperRender` — mounts `<EditorPane editable={false} chrome={READER_CHROME} />`, sharing Virgil's canonical TipTap extension set | [library/components/PaperRender.tsx](../../library/components/PaperRender.tsx) |
| **PDF view** (in-app PDF panel for a paper's compiled output) | `PdfView` | [library/components/PdfView.tsx](../../library/components/PdfView.tsx) |
| **Pgmark** (`\pgmark{}` LaTeX command anchoring text to a source-page number) | `pgmark` TipTap node + Python pipeline | [src/lib/tiptap/pgmark.ts](../../src/lib/tiptap/pgmark.ts) (moved from `library/tiptap/` in Path A 7.8 — now part of the unified extension set); [library/scripts/pgmark.py](../../library/scripts/pgmark.py) |
| **Skill bundle** (the agent skills synced into the user's library folder) | Built by `library/build/build-skill-bundle.mjs` from `library/skills/` + `library/scripts/`; written to `public/skill-bundle/` then copied into the user's library on demand | [library/lib/skill-sync.ts](../../library/lib/skill-sync.ts); built at `predev`/`prebuild` |
| **Drop zone** (drag-PDF-here area for triage) | `DropZone` | [library/components/DropZone.tsx](../../library/components/DropZone.tsx) |
| **Recent papers list** (recently-opened papers shown on the home view) | `RecentPapersList` | [src/components/RecentPapersList.tsx](../../src/components/RecentPapersList.tsx) |
| **Tab plus menu** ("+" menu on the Virgil bar tab strip for adding new tabs / opening papers) | `TabPlusMenu` | [src/components/TabPlusMenu.tsx](../../src/components/TabPlusMenu.tsx) |
| **Install prompt** (PWA install affordance shown when the browser exposes `beforeinstallprompt`) | `InstallPwaPrompt` | [src/components/InstallPwaPrompt.tsx](../../src/components/InstallPwaPrompt.tsx) |

## Persistence & sidecars

| User term | Code name(s) | Where |
|---|---|---|
| **Sidecar** | JSON file alongside `.tex` in `virgil/` folder | Types in [src/lib/types.ts](../../src/lib/types.ts) (`VirgilSidecar`) |
| **Suggestions** | AI line-edit proposals (review cards in the Revisions panel; progress bar in panel header) | `suggestions.json`; [src/hooks/useSuggestions.ts](../../src/hooks/useSuggestions.ts) |
| **Revisions** (comments + suggestions) | Polymorphic `RevisionCommentCard` + `RevisionSuggestionCard` cards, anchored or paper-wide. Shares the same comment/suggestion card structure as Cutter | `revisions.json`; [src/hooks/useRevisions.ts](../../src/hooks/useRevisions.ts); types `RevisionCard` in [src/lib/types.ts](../../src/lib/types.ts) |
| **Revisions tracker** | Optional per-document target for accepted revisions (analogous to CutterGoal for word count) | `RevisionsTracker` on `RevisionsState.tracker` in `revisions.json`; UI in [src/panels/Revisions/RevisionsTracker.tsx](../../src/panels/Revisions/RevisionsTracker.tsx) |
| **Cutter goal** | Per-document word-count cutting target | Stored on `CutterState.goal` in `cutter.json`; [src/hooks/useCutter.ts](../../src/hooks/useCutter.ts); UI in [src/panels/Cutter/CutterGoalStrip.tsx](../../src/panels/Cutter/CutterGoalStrip.tsx) |
| **Collab** / **collaborator mode** | Turn-taking collaboration via sidecar; no co-editing — single-pen coordination for `.tex`, per-card focus claims for sidecars | `collab.json`; [src/lib/collab.ts](../../src/lib/collab.ts); [src/hooks/useCollab.ts](../../src/hooks/useCollab.ts) |
| **AI requests** | Queued requests for an agent to resolve | `ai-requests.json` |
| **AI request bridge** (collapses per-card sticky `aiRequest:true` flags on notes/todos/cutter-comments/revision-comments into a single drainable `ai-requests.json` queue with `linkedTo`; fulfillment skill clears the flag and marks the request `complete`) | `bridgeCardFlagsToAiRequests` etc. | [src/lib/ai-request-bridge.ts](../../src/lib/ai-request-bridge.ts) |
| **Doc notifications inbox** (per-doc `notifications.json` sidecar that editor-side skills append completion entries to; the app polls and toasts unseen items, tracking last-seen per doc in localStorage) | `useDocNotificationStream`; `DocNotification`/`DocNotificationsInbox` types | [src/hooks/useDocNotificationStream.ts](../../src/hooks/useDocNotificationStream.ts); types in [src/lib/types.ts](../../src/lib/types.ts) |
| **Bib review requests** | Per-entry bibliography field/notes reviews | `bib-review-requests.json` |
| **FSA** (File System Access API) | Disk boundary — only place disk is touched | [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts) |

## System dialogs

| User term | Code name(s) | Where |
|---|---|---|
| **System dialog** (reusable modal primitive) | `SystemDialog` | [src/components/system-dialog.tsx](../../src/components/system-dialog.tsx) |
| **System dialog host** (top-level mount point) | `SystemDialogHost` | [src/components/system-dialog-host.tsx](../../src/components/system-dialog-host.tsx) |
| **Confirm dialog** | `ConfirmDialog` — thin wrapper over `SystemDialog` | [src/components/ConfirmDialog.tsx](../../src/components/ConfirmDialog.tsx) |
| **New document modal** | `NewDocumentModal` — uses `SystemDialog` | [src/components/NewDocumentModal.tsx](../../src/components/NewDocumentModal.tsx) |
| **Tex file picker** | `TexFilePickerModal` — uses `SystemDialog` | [src/components/TexFilePickerModal.tsx](../../src/components/TexFilePickerModal.tsx) |
| **Document class mismatch dialog** | `DocumentClassMismatchDialog` — uses `SystemDialog` | [src/components/DocumentClassMismatchDialog.tsx](../../src/components/DocumentClassMismatchDialog.tsx) |
| **Fonts dialog** / **font picker** (per-category font + size dialog launched from the View menu's "Fonts…" item; one card per font category — body, headings, footnotes, marginalia, etc. — each with a `FontPicker` and `SizeStepper`) | `FontsDialog` (uses `FloatingPanel`); `FontPicker` (typeahead pop-down listing `MAIN_TEXT_FONTS`); `SizeStepper` (− / + numeric stepper, larger hit targets than `PanelTextSizeRow`) | [src/components/FontsDialog.tsx](../../src/components/FontsDialog.tsx); [src/components/FontPicker.tsx](../../src/components/FontPicker.tsx); [src/components/SizeStepper.tsx](../../src/components/SizeStepper.tsx); font catalog in [src/lib/preferences-tree.ts](../../src/lib/preferences-tree.ts) (`MAIN_TEXT_FONTS`); opened from `MenuBar` ViewMenu (`onOpenFontsDialog`); mounted in `EditorLayout.tsx` ~line 7059 |

## Card creation / pristine cards

| User term | Code name(s) | Where |
|---|---|---|
| **Card-creation helpers** (unified create-from-selection flow) | `cardCreation` context with `.createNote`, `.createCut`, `.createTodo`, `.createFootnote`, `.createCitation`, `.createQuotation` | [src/components/editor-layout/contexts/card-creation.tsx](../../src/components/editor-layout/contexts/card-creation.tsx) + [src/components/editor-layout/card-actions/card-creation.ts](../../src/components/editor-layout/card-actions/card-creation.ts) |
| **Pristine card** (freshly-created, no user edits yet — auto-discarded if closed untouched) | `usePristineCardManager` + `pristine-cards` context | [src/hooks/usePristineCardManager.ts](../../src/hooks/usePristineCardManager.ts) + [src/components/editor-layout/contexts/pristine-cards.tsx](../../src/components/editor-layout/contexts/pristine-cards.tsx) |

## Name mismatches to keep in mind

- **"Virgil bar"** (user) = the whole horizontal top strip (`<div class="virgil-bar">`, inline in EditorLayout.tsx) — **not** the `MenuBar` component. The `MenuBar` is the menu pod that docks inside the Virgil bar by default. Don't confuse either with the three-dot View menu.
- **"Navigation strip"** (user) — no single component. Paragraph-nav chevrons are inline in `MenuBar`. Panel navigation (what's open) is split between left/right strips plus the Outline panel.
- **"Action toolbar"** (user) — three different shapes depending on state: attached popover (inside MenuBar), `ActionButtonsRow` (the buttons themselves), and `DetachedActionsToolbar` (when torn off — **multiple can coexist** after successive tear-offs).
- **"Formatting toolbar"** (user) — not a dedicated component, just an `AttachedPopover` with inline buttons.

## Pending terminology

_(Empty. Add entries here when the user uses a term not yet in the glossary.)_
