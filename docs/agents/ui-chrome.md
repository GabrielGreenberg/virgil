<!-- last-verified: 12f0ef5 2026-06-15 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization, docs/architecture/VIRGIL.md#card-kind-taxonomy -->
<!-- covers-code: src/panels/panel-registry.ts, src/components/MenuBar.tsx, src/components/EditorLayout.tsx, src/components/panel-primitives.tsx, src/components/editor-layout, src/floats -->

# UI Chrome

Structural map of everything surrounding the main text editor: strips, panels, toolbars, and the orchestrator that wires them together.

See `glossary.md` for user-term ↔ code-name mapping.

## The orchestrator (post Path A 7.8)

The orchestrator role is now split across two files:

- **[src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx)** (~4700 lines, shrank further when the detached-toolbar tear-off arrays were deleted — see MenuBar section below) — the **shell wrapper**. Owns tab/file management (`useFiles`), `useViewPrefs` ownership (handed to EditorPane via `viewPrefs` prop), the Virgil bar and its DocTab/LibraryTab strip, the `activePane` switch (paper / library-outer / doc routing), top-bar dialogs (Preferences, Fonts, Margins, NewDoc, TexFilePicker, DocumentClassMismatch, ManageStyles), the PDF view branch, and the Code view. Per 8b9659c, Code view is now a draggable **split-pane alongside EditorPane** ([split-with-code.tsx](../../src/components/editor-layout/split-with-code.tsx) + `CodePaneSplitContext`), not a full-screen replacement; the `CodeEditor` (CodeMirror) state still lives in EditorLayout and code↔TipTap edits sync through [code-pane-bridge.ts](../../src/lib/code-pane-bridge.ts) (TipTap stays canonical). The vestigial `detachedActions[]` / `detachedFormatting[]` / `detachedMenus[]` tear-off arrays + their body-portal renders are **deleted** in both files — the action vocabulary now lives entirely behind the registry-backed menus (see MenuBar / SelectionActionsMenu sections below).
- **[src/components/EditorPane.tsx](../../src/components/EditorPane.tsx)** (~5650 lines) — the **canonical editor surface** mounted by both the main app's doc branch (from EditorLayout) and the Library Reader (from `library/components/PaperRender.tsx`). EditorPane owns per-doc hooks (`useDocument`, `useLatexCompile`, `useNotes`, `useTodos`, `useCitations`, `useCollab`, `usePristineCardManager`, …), the docked `MenuBar` (~line 3790), the panel rail (`PaneRail` left + right), the floating-panel block, and the canonical `DockOutline` (~line 3243) / `CardLiftOutline`.

When anything touches UI layout, chrome, or panel placement: if it's a tab/dialog/Virgil-bar concern → EditorLayout; if it's a per-document chrome / panel / popout / MenuBar concern → EditorPane. The full split is documented in `architecture.md` → "EditorPane vs EditorLayout".

The two bundles flow shell→pane:
- `viewPrefs: EditorPaneViewPrefs` — dock/float-shaped state. Reader passes none → main-app rail behavior stays dormant.
- `menuBar: EditorPaneMenuBarBundle` — toggle state, para-nav, dialog openers, detached-toolbar refs. Reader passes none → docked MenuBar / detached toolbars stay dormant.

The `chrome` prop ([chrome-config.ts](../../src/components/editor-layout/chrome-config.ts)) gates feature visibility per surface: main app passes `FULL_CHROME`, Reader passes `READER_CHROME`.

## Hierarchy

```
EditorLayout (shell)
├─ Virgil bar (DocTab + LibraryTab pairs, menu pod, etc.)
├─ Top-bar dialogs (Preferences, Fonts, Margins, NewDoc, TexFilePicker, ManageStyles, …)
└─ activePane switch
    ├─ doc branch → <EditorPane> (see below)
    ├─ paper branch → <PaperRender> → <EditorPane editable={false}>
    ├─ library-outer branch → <LibraryOuterView> → <LibraryApp>
    ├─ pdf branch → <PdfView>
    └─ code split-pane → split-with-code.tsx (CodeEditor state in EditorLayout; code↔TipTap bridge)

EditorPane (canonical editor surface)
├─ PaneRail side="left" (icon strip, OmniFilterMenu)
├─ PanelColumn side="left" (active panel(s); top/bottom split)
├─ Editor column
│   ├─ MenuBar — docked inline at sticky [data-tool-strip="text"]   — EditorPane.tsx:3790
│   ├─ VirgilEditor (the TipTap editor itself)
│   ├─ SelectionActionsMenu (gutter lightning-bolt; click to expand ActionsMenuPanel)
│   ├─ Marginalia gutters (left + right of text)
│   ├─ FloatHost → FloatWindow portals (popped-out cards + TextObjects — all 16 block/selection kinds) — EditorPane.tsx:3291
│   ├─ FloatingPanel portals (popped-out panels)
│   └─ DockOutline (body-portaled drag-target outline, suppressed in zen) — EditorPane.tsx:3243
├─ PanelColumn side="right"
└─ PaneRail side="right" (icon strip, OmniFilterMenu)
```

## Tool strips (left & right)

Rendered by `PaneRail` inside `EditorPane.tsx` (~line 4812 for `data-strip-side`). Identical structure on both sides:

1. **View control pod** (grouped buttons at top):
   - Collapse/expand sidebar
   - Omni-view toggle (show all omni-eligible panels, or blank)
   - Split panel toggle (top/bottom split in the column)
2. **Panel icon buttons** — one `StripButton` per panel assigned to this side:
   - Icon color-coded to panel theme (from `PANEL_ICONS` in [src/components/editor-layout/panel-icons.tsx](../../src/components/editor-layout/panel-icons.tsx))
   - Click toggles open/closed
   - Draggable: drag to reorder, or drag across strips to move panel to the other side
   - Badge support (e.g. Revisions shows count when > 0)
3. **`OmniFilterMenu`** — horizontal kebab pinned to the bottom via `mt-auto`. Opens a dropdown that toggles which omni categories appear in this side's omni-view. Includes a "Default view" item that resets the side to its registry-default categories (`DEFAULT_OMNI_CATEGORIES[side]`). Lives in [src/panels/Omni/OmniViewPanel.tsx](../../src/panels/Omni/OmniViewPanel.tsx).

`StripButton` lives in [src/components/editor-layout/drag-drop.tsx](../../src/components/editor-layout/drag-drop.tsx).

Panel-side assignment is stored in `prefs.placements` and defaults come from `defaultStripSide` in `PANEL_REGISTRY`.

## Panel column

[src/components/editor-layout/panel-column.tsx](../../src/components/editor-layout/panel-column.tsx) — `PanelColumn`

Props: `side` ("left"|"right"), `panelPref`, `onPanelPrefChange`, `isResizing`, `onResizingChange`, `onSyncBeforeDrag`, `split` (bool), `collapsed`, `blank`, optional `topOverlay` (per-column action toolbar).

Behavior:
- Wraps a single panel, or a split: `{ top, bottom, ratio, onRatioChange }`
- Inner-edge drag only adjusts this column's **panel preferred size**; the editor column (flex-grow 1000) absorbs the change so the opposite panel stays put. Clamped by `--panel-min` and by the editor's min-width. `onSyncBeforeDrag` snaps all panel prefs to their rendered widths before the drag starts so shrunk columns don't jump when flex switches to fixed-basis.
- Flex `1 100 ${panelPref}px` normally; switches to `0 0 ${panelPref}px` while `isResizing` so the dragged edge stays glued to the cursor.
- Collapses to zero width when `collapsed`.

Panels render via `<PaneRailBody>` inside EditorPane. The same panel components are used for rail-mounted and floating variants (floating wraps in `FloatingPanel`).

## Panels

All panels share the wrapper system in [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) and [src/panels/_shared/](../../src/panels/_shared/). Two wrapper shapes:

- **`Panel`** — universal outer. Flex column with header, scroll body, absolute popout + close buttons. Used by panels with custom bodies (Outline, Search, WordCount).
- **`CardListPanel<T>`** — wraps `Panel` + iterates items as cards + adds AI-requests section. Used by card panels. (The historical list/in-text view-mode toggle and `panel-view-mode` context were removed; cards now always render in list form.)

**Header** is `PanelHeader` — fixed 34px (`--header-h`), title + count + optional `onAdd` (+ icon) and `onAiRequest` (8-ray star).

### Panel registry — SSOT

[src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) declares every panel with:
- `label` (display name)
- `folder` (path to its source)
- `card` (optional: card kind, key prefix, theme key)
- `omniEligible` + `omniSide`
- `defaultStripSide`

Helper functions: `popKey(panelKind, id)`, `cardPopKey(cardKind, id)`, `getPanelByCardKind(cardKind)`, `OMNI_PANELS` (filtered list).

### Panel list

See `glossary.md` for the full table. Quick reference: 11 card panels (`notes`, `footnotes`, `citations`, `bibliography`, `reports`, `examples`, `todo`, `archive`, `revisions`, `cutter`, `errors`) and 4 non-card panels (`outline`, `search`, `wordcount`, `omni`). **Notes, Reports, Revisions, and Cutter are polymorphic** (two card kinds each). Notes: `note` + `highlight` (registry `card: null`); Reports: `report` + `report-request` (`card: null`); Revisions: `revision-comment` + `revision-suggestion` (registry `card.kind` is `revision-comment`); Cutter: `cutter-comment` + `cutter-suggestion` (`card: null`). Panel membership for each kind derives from `CardMeta.panel` in `CARD_REGISTRY` via `cardKindsForPanel` (the hand-kept polymorphic-panel table was retired in 27458d8). The Revisions panel additionally tracks a per-document "revisions accepted" counter (`RevisionsTracker`); the Cutter panel tracks a word-count goal (`CutterGoal`).

Omni-eligible panels (shown in Omni view): notes, footnotes, citations, reports, examples, todo, archive, **revisions**, **cutter**, **errors**. Bibliography is the only card panel that's *not* omni-eligible.

Each omni-eligible panel owns its own `omni.tsx` next to the panel (e.g. [src/panels/Cutter/omni.tsx](../../src/panels/Cutter/omni.tsx), [src/panels/Errors/omni.tsx](../../src/panels/Errors/omni.tsx), [src/panels/Revisions/omni.tsx](../../src/panels/Revisions/omni.tsx)) exporting a `buildXOmniItems(args): OmniItem[]` builder. The orchestrator-side host [src/components/editor-layout/panels/omni-host.tsx](../../src/components/editor-layout/panels/omni-host.tsx) imports each builder and concatenates the results into the per-side omni columns. New omni-eligible panels add their builder there.

## MenuBar (the menu pod inside the editor column)

[src/components/MenuBar.tsx](../../src/components/MenuBar.tsx) — default export `MenuBar`.

Mounted **inline** at the top of the editor column inside `EditorPane.tsx` (~line 3790). No portal. 24px tall, right-aligned (slimmed from 32px and re-aligned in ae15791). Bare icons sit on the canvas — no enclosing pod, no grab handle, no rotation knob.

ae15791 dropped the home Format and Actions popovers from the docked bar. The actions/formatting vocabulary now lives in `SelectionActionsMenu` (gutter lightning-bolt → `ActionsMenuPanel`, see below) and `DragHandleMenu` (click-the-handle popover on the left of each paragraph), **both rendering from `VIRGIL_ACTION_REGISTRY`** (see "Action registry" below). The detached-toolbar plumbing is fully deleted: `AttachedPopover`, `DetachedMenuToolbar` / `DetachedFormattingToolbar` / `DetachedActionsToolbar`, and the `detachedMenus[]` / `detachedFormatting[]` / `detachedActions[]` EditorPane state arrays are all gone. MenuBar itself is now a thin pod (only `BlockTypeDropdown`, `ViewMenu`, para-nav, the collab pill, and the split toggle). The example-block creators that once lived here (`buildExampleTemplate` / `insertExampleAtCursor` / `handleExampleMenuPick`) were retired (CHIP 5c) — the canonical example creator is now `exampleRun` in the action registry. The `BlockTypeDropdown`'s heading items route heading levels 1–4 through the registry's `headingRun` (always SET, never toggle); levels 0/5/6 fall back to a direct `setBlockType`. Reader passes no `menuBar` bundle, so the docked MenuBar stays dormant for paper renders.

### Contents in order (horizontal, right-aligned)

Collab status pill, paragraph back/forward (stemmed arrows), Split toggle, then the View menu kebab (three-dot, at the end via `kebabAtEnd`). Close-all-panels and Fonts… moved into the View menu. (The redundant strip `ActionsStripButton` lightning-bolt that once led the para-nav group was removed as backlog #6 — the action menu is now reached only from the gutter `SelectionActionsMenu` and the `DragHandleMenu`.)

A **Style** mode toggle button sits in the right cluster of the Virgil bar (alongside the file/zen/version buttons), not inside the MenuBar pod itself. Click it to open [ManageStylesModal](../../src/components/ManageStylesModal.tsx) (the inline `DocStyleDropdown` was folded into this modal by `9744b71`) — apply a style to the active doc, edit/duplicate/delete entries, save the current preamble as a new entry, or pick the default for new docs. Drift between the picked style and the doc's preamble routes through [StyleApplyDialog](../../src/components/StyleApplyDialog.tsx). State: per-doc id in [useDocumentStyle](../../src/hooks/useDocumentStyle.ts); user style library in [useStyleLibrary](../../src/hooks/useStyleLibrary.ts); preset catalog in [document-styles.ts](../../src/lib/document-styles.ts). Mode toggle at `EditorLayout.tsx` ~line 4177; modal mount ~line 4553.

A **Print** button (printer icon) lives in the same right cluster. It opens `PrintDialog` ([src/components/PrintDialog.tsx](../../src/components/PrintDialog.tsx)) — a show/hide controls modal for marginalia, footnotes, citations, comments, paragraph titles, etc. — then triggers `window.print()`. Print orchestration + appendix collection in [src/lib/print.ts](../../src/lib/print.ts) and [src/components/PrintAppendices.tsx](../../src/components/PrintAppendices.tsx).

The **View menu** (three-dot kebab) gained a **Highlights** sub-menu of per-kind toggles. Each toggle hides linked-anchor highlights for one card kind (`note`, `todo`, `comment`, `cut`, `report`); the active set lives in `prefs.hiddenHighlightTypes` via `useViewPrefs` and is read by `useLinkHighlight`.

Paragraph back/forward chevrons (now stemmed arrows after ae15791) sit between collab status and split toggle; disabled at history bounds. The View menu's orientation toggle was dropped in c40d8d2.

## SelectionActionsMenu (the gutter lightning-bolt)

After 1bd614c the auto-popping menu is gone — selection now reveals only a small yellow lightning-bolt button in the right gutter; clicking it expands the dropdown in place. (82872e7 had also added a sibling strip-mounted lightning-bolt in the MenuBar; that redundant `ActionsStripButton` was removed as backlog #6, so the gutter button is now the sole click-trigger for the shared `ActionsMenuPanel` body, alongside the `DragHandleMenu`.)

- [src/components/SelectionActionsMenu.tsx](../../src/components/SelectionActionsMenu.tsx) — the gutter button + open-state; works in cursor-only mode too (anchors via `kind:"paragraph"`, Highlight greyed out without a live range).
- [src/components/ActionsMenuPanel.tsx](../../src/components/ActionsMenuPanel.tsx) — the shared body: inline-formatting grid (bold/italic/underline, block-type dropdown, math inserters that *wrap* the selection rather than insert placeholders, example/tex/figure/image cells, text-color swatches via `SelectionColorPopover`) + a vertical action list built from `cardActionRows`/`VIRGIL_ACTION_REGISTRY` (the deleted `MENU_ENTRIES` array is gone). Letter shortcuts only fire while the panel is open.

Card-action dispatch still goes through `useDragHandleMenu().dispatch`, the same pipeline as the left-of-paragraph click handle, so footnote / archive / note / etc. behave identically across both menus. Registry rows that would no-op (per the row's `applies()` and the collab read-only gate) render **greyed-out** rather than firing — see "Action registry" below.

## Action registry (the action SSOT)

[src/lib/actions/action-registry.ts](../../src/lib/actions/action-registry.ts) declares `VIRGIL_ACTION_REGISTRY` — the **single source of truth for every editing action** across all four action surfaces: the grab-handle menu (`DragHandleMenu`), the gutter lightning menu (`SelectionActionsMenu` → `ActionsMenuPanel`), the slash commands, and the typed-LaTeX input rules. Each `ActionSpec` carries a `run()`, an `applies()` predicate (per-kind applicability + the uniform collab read-only gate), and an applicability/mode taxonomy. The two live React menus **render from the registry** (`cardActionRows` + direct `VIRGIL_ACTION_REGISTRY[id]` lookups) — the dependency is inverted; the old `MENU_ENTRIES`/`ACTION_BUTTON_DEFS`/`ActionButtonsRow` arrays are deleted. Rows that would no-op (wrong kind, no live selection, or partner holds the pen) render **greyed-out** (visible-disabled) instead of being dropped, so the menu shape stays consistent.

The PM-plugin surfaces (slash, typed-LaTeX) can't reach React-land `cardCreation` directly, so card/atom actions route through the **PM→React bridge**: [src/lib/actions/editor-actions-bridge.ts](../../src/lib/actions/editor-actions-bridge.ts) publishes an imperative `EditorActionsHandle` into `editorActionsRef`; pure-PM actions (`\chapter`…`\subsubsection`, `\tex`, `\title`/`\author`/`\date`) take the view-only path. Block-atom inserts (math/figure/graphics) go through [src/lib/tiptap/smart-insert.ts](../../src/lib/tiptap/smart-insert.ts). Action icons live in [src/lib/actions/action-icons.tsx](../../src/lib/actions/action-icons.tsx). The deleted `src/components/editor-layout/event-bridges/command-input.ts` was folded into this bridge.

The action vocabulary (same colors, coordinated with each panel's `CARD_THEME`):

| Action | Color | Opens/creates |
|---|---|---|
| Revision | purple | Revision thread |
| Note | green | Note card |
| Highlight | amber/yellow | Highlight card (Adobe-style; requires a live text selection) |
| Todo | stone | Todo item |
| Cut | red | Cutter card |
| Archive | blue-grey | Archive card |
| Footnote | red | Footnote atom |
| Citation | amber | Citation atom |
| Bibliography | warm tan | Bibliography entry |

## Floating toolbar shell (mostly vestigial)

[src/components/editor-layout/floating-toolbar-shell.tsx](../../src/components/editor-layout/floating-toolbar-shell.tsx) still exists but `FloatingToolbarShell`, `DetachedToolbar`, and `PodGrabHandle` were retired with the card-system refactor's detached-toolbar removal — its only export now is the `ToolbarOrientation` type, consumed by `MenuBar`'s docked-bar plumbing. The tear-off detached toolbars (`DetachedActionsToolbar` / `DetachedFormattingToolbar` / `DetachedMenuToolbar`), the `AttachedPopover` primitive, and the `prefs.menuLocation` view-pref are all gone — the docked MenuBar no longer tears off.

## MarginActionToolbar (removed)

The per-column "+" action-chip row (chips above each omni gutter) was suppressed in 652572a and **deleted in bcc583a** — the file, its call sites, `PaneRailProps.topOverlay`, the `panel-column.tsx` `topOverlay` mechanism, and `ActionChipButton` are all gone. The action vocabulary now lives only in `SelectionActionsMenu` and `DragHandleMenu` (the detached toolbars were removed in the A1 gardening pass, the dead `chrome-config` action defs in A10, and the redundant strip `ActionsStripButton` in backlog #6).

## Panel icons

[src/components/editor-layout/panel-icons.tsx](../../src/components/editor-layout/panel-icons.tsx) — `IconNotes`, `IconHighlight` (highlighter-pen marker, used by the new Highlight action button — there is no Highlight panel since highlights live inside the Notes panel), `IconRevisions`, `IconArchive`, `IconFootnote`, `IconCitation`, `IconBibliography`, `IconTodo`, `IconCutter`, `IconReports`, `IconOutline`, `IconSearch`, `IconWordCount`, `IconOmni`, `IconBlank`, `IconErrors`, `IconExample`, `IconSplit`, `IconFolder`, `IconPlus`, `IconX`, `IconLibrary`, `IconDuplicate`, `IconTrash`, `IconZap`. All use `currentColor`. (`IconSuggestions` was removed when the Suggestions panel folded into Revisions; `IconQuotations` → `IconReports` in the card-system refactor.)

**Topbar icon size: 16px** (`.topbarbtn` is 24px, leaving 4px of padding). Don't ship 14px or 20px topbar icons — see `STYLE_GUIDE.md`.

## Document folder tabs

[src/components/editor-layout/DocumentFolderTab.tsx](../../src/components/editor-layout/DocumentFolderTab.tsx) renders the manila-folder-style document tabs in the topbar — each tab is one self-contained SVG path with rounded top corners and convex swoop hooks at the bottom. Path geometry in [src/components/editor-layout/folder-path.ts](../../src/components/editor-layout/folder-path.ts) (`buildActiveTabStrokePath`, `buildTabFillPath`). Active and inactive tabs share the same path; the active variant omits the bottom edge so the canvas's top border draws the seam.

## Floating panels & cards

- [src/components/FloatingPanel.tsx](../../src/components/FloatingPanel.tsx) — `FloatingPanel` low-level draggable + resizable window via portal. Min 240×200, max 900×window-40. Drag on header, resize via bottom-right grip. **A card inside a floating panel lifts the card (not the window)** — `FloatingPanel` yields to `PanelCard`'s 5px-threshold lift on any `[data-card]` surface, so header-dragging a card inside a float pops the card, leaving the panel window in place (bug #36).
- **The float spine** ([src/floats/](../../src/floats)): `FloatHost` (mounted in EditorPane ~line 3291) maps each key in `prefs.poppedOutCards` to a `Floatable` — card keys resolve through `CARD_REGISTRY[kind].toFloatable(id, ctx)` (the ctx bag is `PoppedCardDeps` in [editor-layout/floating-cards.tsx](../../src/components/editor-layout/floating-cards.tsx)), text-object keys through `textObjectFloatable` — and mounts each in a `FloatWindow` with the unified `FloatChrome` header (grip · title · trailing · jump · close). **Card floats render on a white `card` surface** (1px ambient border) **with a kind-tinted header strip** (`Floatable.headerTint` = the kind's `theme.headerDefault`, so the strip matches the docked card header); text-object floats keep the neutral `--surface-muted-strong` strip. Saved positions live in the `cardFloatPositions` pref; popped-key state is read via `usePoppedCards()`.
- **Pop-out path**: for docked cards, **header drag-lift is the only pop-out path** — pressing anywhere on the card header and dragging past the threshold lifts the card into its float (the 6-dot `CardDragHandle` just signals the affordance). The docked pop-out button is gone; `CardPopoutButton` survives only as the *popped* card's re-dock X. A header **click** (no drag) is toggle-collapse + select — the expand chevron was retired with that ratified click=toggle+select contract.
- **Pop residue**: the docked card **stays fully live in its panel for every kind (including `example`)** while its float is open — the float is a second presence, not a replacement (pinned by `ExampleCard.test.tsx`).
- **Block & selection popouts** ride the same machinery for editor TextObjects. After the lifted-overlay refactor **all 16 TextObject kinds lift** (paragraph, heading, bullet/ordered list, list item, example block + item, blockquote, code block, display math, LaTeX comment, title field, tex block, figure, graphics, and persisted `linkedRange` selections), keyed uniformly as `textobject:<kind>:<uuid>` (`textObjectPopoutKey` in [text-object-registry.ts](../../src/text-objects/text-object-registry.ts)). Each released float mounts a per-kind body from [src/text-objects/floats/](../../src/text-objects/floats/) (via `textObjectFloatable`) under the shared `FloatWindow`/`FloatChrome`; section-body extraction stays in [section-range.ts](../../src/lib/section-range.ts). The drag ghost is `LiftedTextOverlay`. See `main-text.md` → TextObjects and `architecture.md` for the registry pathway.
- **Spawn position**: a lifted card float spawns **at the docked card's own measured rect** (`liftSpawnRect` in [src/floats/float-policy.ts](../../src/floats/float-policy.ts)) so the card body doesn't visually move (pop-out continuity); a collapsed card's lift grows to its content height, capped at 55 vh (`POPOUT_MAX_VH` — the single capture-site cap every lifted kind shares). Non-lift spawns open near the trigger element via [editor-layout/spawn-position.ts](../../src/components/editor-layout/spawn-position.ts). Position is forgotten on close so the next pop-out re-spawns from the (possibly new) source.
- **No interior drag grip**: 5f2d357 dropped the 6-dot grip inside the paragraph / heading / list / selection float bodies. The float header is the only drag/redock affordance now (shift-drag → drop-mode). Companion to ec38210, which removed the analogous `onTextDragStart` grip beside each `RichTextField` in `EditableCard`. Surviving text-move paths after 2309137: drag-to-pop-out (6-dot lift in the main-editor margin via `SelectionDragHandle`) and drop-mode (shift-drag on a float header).

## Per-panel text-size stepper

Every panel-header three-dot menu auto-injects a compact text-size stepper before any panel-specific items. `PanelTextSizeRow` ([src/components/PanelTextSizeRow.tsx](../../src/components/PanelTextSizeRow.tsx)) is the widget; auto-injection happens in `panel-primitives.tsx` (~line 1875, inside `ItemMenu` at ~line 1844). Available sizes and per-panel-kind defaults live in [src/lib/panel-typography.ts](../../src/lib/panel-typography.ts); the panel kind is read from `panel-kind-context.tsx`. Persistence is via `useViewPrefs` keyed by panel kind.

**Scope (ratified 2026-06-12): per-panel typography styles card BODY CONTENT only** (`usePanelBodyStyle`) — it must never be spread over a title/header or meta line. Card titles and meta lines are design-system-fixed: titles via `cardTitleStyle` (the `.par-title-*` dialect, themed by `theme.titleColor`), meta via `CardMetaLabel` / `CardMono` — the in-card type scale is **10px meta / 12px sans content** (body defaults derive from `CardMeta.bodyClass`: 12px Inter `sans`, 15px Source Serif 4 `borrowed`).

## Fonts dialog

The View menu's "Fonts…" item opens [src/components/FontsDialog.tsx](../../src/components/FontsDialog.tsx) — a `FloatingPanel`-based per-category font + size editor. One soft-pod card per font category (body, headings, footnotes, marginalia, etc.); each card pairs a `FontPicker` (typeahead pop-down listing `MAIN_TEXT_FONTS` from [src/lib/preferences-tree.ts](../../src/lib/preferences-tree.ts)) with a `SizeStepper` (− / + numeric stepper, larger hit targets than `PanelTextSizeRow`). Reset buttons restore each category to its default. Ownership is split: top-level prefs (e.g. body font) on `EditorPreferences` via `usePreferences`; per-panel-kind typography via `usePanelTypography` writing through `setPanelTypographyField`. MenuBar plumbs the open callback as `onOpenFontsDialog`; EditorLayout (the shell) owns the `fontsOpen` state and mounts the dialog (~line 4532).

## Stack (visual clipboard)

Bottom-left floating widget mounted as a body portal anchored to
`editorPaneRootRef` ([src/components/EditorPane.tsx](../../src/components/EditorPane.tsx)
~line 3271). Two components:

- **`StackIcon`** ([src/components/stack/StackIcon.tsx](../../src/components/stack/StackIcon.tsx)) — 56px round button, three stacked pages glyph, slightly translucent (`backdrop-filter: blur(4px)`). Click to toggle the strip. Hosts an HTML5 `dragover`/`drop` listener that accepts `MIME_PAR_CAPTURE` / `MIME_TEXT_CAPTURE` / `MIME_TEXT_INSERT`. Marked with `data-stack-icon-hit="true"`.
- **`StackStrip`** ([src/components/stack/StackStrip.tsx](../../src/components/stack/StackStrip.tsx)) — horizontal scrollable bar, ~60% editor-pane width, with `StackThumbnail` cards. Translucent dark bg.

State + persistence: `useStack()` hook ([src/hooks/useStack.ts](../../src/hooks/useStack.ts)) reads/writes a versioned envelope at localStorage key `virgil-stack-v1`. Window-global / cross-document. Capped at 200 items, FIFO eviction. Cross-tab sync via the standard `storage` event.

Drop-into-stack flow (FloatingPanel drag → stack):
1. `FloatingPanel`'s `onMove` calls `isOverStackIcon(x, y)` from [src/lib/stack/stack-drop-target.ts](../../src/lib/stack/stack-drop-target.ts) — a module-level signal pattern that mirrors `dock-drag.ts`. When hit, sets `useStackDropTarget = true` and clears the dock outline.
2. `FloatingPanel`'s `onUp` fires a `virgil-stack-drop` CustomEvent on window with `{ cardKey, clientX, clientY }`.
3. `EditorPane` listens for that event, parses the `cardKey` prefix, and snapshots via the appropriate helper from [src/lib/stack/snapshot.ts](../../src/lib/stack/snapshot.ts) (`snapshotParagraph`, `snapshotHeadingSection`, or `snapshotCard`).
4. The float is closed via `viewPrefs.closeCardPopout(cardKey)`.

Pull-from-stack flow (thumbnail → editor):
1. `StackThumbnail` mousedown calls `beginDropSession({ cardKey: 'stack-pull:<stackId>' })` from the drop-mode controller.
2. The `stack-pull` `DropSpec` ([src/components/drop-mode/specs/stack-pull.ts](../../src/components/drop-mode/specs/stack-pull.ts)) is keyed by `STACK_PULL_PREFIX` in the registry.
3. On release at a valid placement, the spec dispatches by payload kind. Cards materialize via the `ctx.stack: StackPullApi` bag (see `DropCtx` in [src/components/drop-mode/types.ts](../../src/components/drop-mode/types.ts)) — each method creates a fresh entity with a new id (paste-as-new).
4. The stack item is **kept** (`postDrop: "keep"`); pulls are copy, not pop.

Snapshot stripping: `snapshotSelection` / `snapshotParagraph` / `snapshotHeadingSection` recursively strip `linkedAnchor`, `footnoteRef`, `citationRef` marks (cross-doc-bound), and replace `attrs.uuid` so a fresh uuid is regenerated on pull. Citation snapshots additionally carry sidecar bib entries (`StackCardSnapshot.bibEntries`) so the destination doc can upsert any missing keys.

Hidden in zen mode (`viewPrefs.zenMode`).

## Reading frame & margins

After d211464 + 69c050d the editor exposes a true viewport-locked **reading rectangle** rather than just left/right page padding. Four-sided margins are now full prefs (`editorLeftMargin`, `editorRightMargin`, `editorTopMargin`, `editorBottomMargin`); the column wrapper publishes them as `--editor-pl/pr/pt/pb` CSS vars. `EditorScrollbar` additionally publishes `--scroll-viewport-h` (the row's `clientHeight`, distinct from `--row-bound-h` = scrollHeight) so the side guides can size against the visible band rather than the full document.

Two persistent sticky **letterbox bands** (`var(--surface)` solid, with an 8px hard fade at the inner edge) sit above and below the reading rectangle and hide content scrolling past — that's the difference between "padding" and a "frame". Bottom band is gated on `ready` (7c45771) to avoid showing during initial load.

**Margin edit mode** ([src/hooks/useMarginEdit.ts](../../src/hooks/useMarginEdit.ts)) is the state machine for dragging the four guide lines. It's keyed on a `Margins = Record<MarginSide, number>` shape with axis-lookup tables (`MARGIN_AXIS`, `MARGIN_OPPOSITE`, `MARGIN_MIN`, `MARGIN_CSS_VAR`) so a single drag handler covers all four sides — the historical L/R-vs-T/B duplication is gone, and a fifth side would be a one-table-entry addition. The four guide lines live inside a single sticky wrapper that fills the visible reading rectangle, so they stay viewport-locked together at any scroll position. A sticky **glowing-blue X / check icon pill** (reusing the symmetry-marker vocabulary) replaces the older text Save/Cancel buttons.

## Focus view

Confines the visible band of the editor to `[startBlockIndex, endBlockIndex]`. State in [src/hooks/useFocusMode.ts](../../src/hooks/useFocusMode.ts) — now **UUID-anchored** (a band of `{startBlockUuid, endBlockUuid}`, live-derived to indices, with a migration off the legacy index-only stash); the runtime stash still carries `{active, locked, startBlockIndex, endBlockIndex}`. Mechanism (after the focus-view rework): the new **`focusViewPlugin`** ([src/lib/focus-view.ts](../../src/lib/focus-view.ts)) hides outside-band blocks via a ProseMirror node decoration (`DecorationSet` in editor state) fed from EditorLayout's meta dispatch — the old injected `<style>` nth-child stylesheet + top-level child-count tracker are deleted. The doc-structure diff gained `blockOrderChanged` + `changedBlocks` to keep the band live across reorders. The omni-host's pass-2 no longer DROPS outside-band cards; it **stamps `outsideFocus: true`** on the `OmniItem`, and `OmniViewPanel` routes stamped cards into a collapsed **"N outside focus" bin** (so user-created cards aren't silently hidden). The Outline panel uses the same band logic. The Active/Locked distinction collapses for the editor — active === hide outside; lock is now mostly a guard against accidentally exiting via caret motion. (CHIP 6 also fixed card bodies blanking under focus by stripping `linkedAnchor` on the float copy.)

Earlier iterations: 1d9ed09 made it presentation-only (dimming, no hide), 2dc963d kept that frame, 91ce009 reverted to band-confined hide via injected CSS; the current rework replaced that CSS with `focusViewPlugin` and UUID anchoring.

## Dock-target outline

[src/components/editor-layout/DockOutline.tsx](../../src/components/editor-layout/DockOutline.tsx) renders a body-portaled clear-blue outline at fixed viewport coordinates to mark the active dock target during a panel drag. The signal driving it lives in [src/components/editor-layout/dock-drag.ts](../../src/components/editor-layout/dock-drag.ts) — a module-level `{slotKey, rect}` store with `setDockDragTarget` / `getDockDragTarget` / `useDockDragTarget`. Two flows write to it: undock (rect captured at mousedown so the outline survives the panel undocking and the slot DOM reshaping) and redock (mousemove hit-test against gutter columns; release reads the target and decides whether to redock). The store is module-level (not React Context) because producer (panel shell) and consumer (the body-portaled `DockOutline` plus EditorPane's mouseup handler) sit in different parts of the React tree. WAAPI-driven crossfade (not React state + CSS transitions) avoids races with React's batched commits and Strict Mode's effect double-invoke. Mounted from `EditorPane.tsx` ~line 3243, suppressed in zen mode.

## Gutter chrome geometry (block-frame)

[src/text-objects/block-frame.ts](../../src/text-objects/block-frame.ts) is the **one canonical per-block geometry source** for every gutter affordance. `resolveBlockFrame(el, editor, cache?)` returns a `BlockFrame` (viewport coords): `opticalCenterY` (cap-band center of the first visual text line — the vertical anchor), the horizontal `contentLeft` / `contentWidth` / `contentRight` content edges, a MEASURED `markerLeft` (the block's leftmost marker glyph — bullet band / `(n)` / `a.` / plain text), and an em `gapPx` resolved against the block's font. `resolveContentEdges(el)` is the lean horizontal-only primitive that `resolveBlockFrame` composes, so a full frame and a direct edges call can never diverge. Resolution is pure DOM + ancestry — O(1)/O(depth), never a doc walk (keystroke sanctity), safe on the hover/scroll/RAF placement and throttled-mousemove drop paths.

Three affordances now read these canonical edges, so they align **by construction** rather than by coincidence:
- **Grab handle** — [src/text-objects/TextObjectGrabHandle.tsx](../../src/text-objects/TextObjectGrabHandle.tsx) resolves one frame per block and hugs `markerLeft − gapPx − HANDLE_WIDTH`; the slimmed [handle-layout.ts](../../src/text-objects/handle-layout.ts) is now just that arithmetic (`computeHandleLeft`) over the frame's `markerLeft` / `gapPx`.
- **Drop indicator** — [src/components/drop-mode/hit-test.ts](../../src/components/drop-mode/hit-test.ts) takes the between-blocks + expex drop bars' x/width from `resolveContentEdges`, the same content extent the grab handles get.
- **Figure chrome** — [src/components/FigureBlockNodeView.tsx](../../src/components/FigureBlockNodeView.tsx) anchors its "beside" control row at the frame's `contentRight` (resolved on the inner `.figure-block` hug box, whose right edge is the rendered image).

## Hint system (tooltips + Helper mode)

Virgil has **one** app-wide hover/focus-hint primitive: [src/components/HintLayer.tsx](../../src/components/HintLayer.tsx) — the single delegated controller + portal bubble, mounted once near the root in [src/app/page.tsx](../../src/app/page.tsx). It is the production replacement for native `title=""` tooltips and the engine behind Helper mode. One set of capture-phase `document` listeners resolves the hinted element under the pointer/focus via `closest('[data-hint],[data-hint-keys],[data-helper]')` (O(ancestor-depth), never doc-size, not an `editor.on` subscriber), positions a single `.hint-bubble` portal via `useFloatingMenuPosition`, and dismisses on Escape / scroll / pointer-down / pointer-leave / focus-out.

Authoring is via [src/components/Hint.tsx](../../src/components/Hint.tsx): `useHint({ label, keys, pos })` returns spreadable `data-hint*` attributes, or `<Hint label keys pos>` wraps a child element. The attribute protocol: `data-hint` (text, optional), `data-hint-keys` (a portable shortcut string), `data-hint-pos` (`above|below|left|right` nudge; defaults below, flipping to a `[data-strip-side]` ancestor's side). A **shortcut-only** hint omits the label so the bubble shows just the keycap. Legacy `data-helper` / `data-helper-pos` are read as aliases for incremental migration off `title=`; the old CSS `::after` callout is gone (the bubble is JS).

[src/components/Kbd.tsx](../../src/components/Kbd.tsx) renders a portable shortcut string (`"Mod+/"`, `"Mod+Shift+N"`, …) as a platform-aware keycap chip in system sans — `Mod` → ⌘ on Mac, `Ctrl` elsewhere — via `isMac()` in [src/lib/platform.ts](../../src/lib/platform.ts) (the single Mac probe; SSR-safe `useIsMac()` external-store read). It's the only way to render a shortcut — no hardcoded `⌘…` strings.

**Cmd+/ (`Mod+/`)** toggles the actions menu: a window-level keydown handler in [SelectionActionsMenu.tsx](../../src/components/SelectionActionsMenu.tsx) (~line 313) opens the `ActionsMenuPanel` at the live cursor/selection (the keyboard twin of clicking the gutter ⚡), and toggles it closed if already open. The gutter `SelectionActionsMenu` button carries a shortcut-only `useHint({ keys: "Mod+/" })` hint (the ⚡ glyph + ⌘/ keycap).

**Helper mode** is just the instant, always-on rendering of the same hints: toggled from the "?" button on the Virgil bar (circle-question-mark icon, next to the info "i" button); when active `document.body` gets `data-helper-mode="on"`, `HintLayer` drops the hover delay to 0, and a "Helper mode" indicator appears in the Virgil bar (styled like the Focus View indicator — click to deactivate). State: `useHelperMode()` in [src/hooks/useHelperMode.ts](../../src/hooks/useHelperMode.ts) — module-scoped `useSyncExternalStore` (same as `usePreferenceMode`), exports `{ on, toggle, set }`, persists to localStorage key `virgil-helper-mode`.

See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) → "Hints, tooltips & keyboard shortcuts" for authoring guidelines (label length, positioning zones, accessibility).

## Collaborator mode UI

**CollabStatusPill** ([src/components/CollabStatusPill.tsx](../../src/components/CollabStatusPill.tsx)) renders in two variants, both in the topbar:

- `variant="icon"` — always-visible two-person silhouette button in the menu-icon cluster. Click toggles collab on/off (via menu when on).
- `variant="badge"` — pen-state pill (dot + label) and next-natural action (Take / Pass / Request / Take over) in the modes/views section. Hidden when collab is off.

Supporting UI:
- **CollabPresenceDots** ([src/components/CollabPresenceDots.tsx](../../src/components/CollabPresenceDots.tsx)) — partner's cursor-paragraph dot shown in the margin.
- **CollabClaimPill** ([src/components/CollabClaimPill.tsx](../../src/components/CollabClaimPill.tsx)) — per-card focus-claim indicator.
- **CollaboratorIdentityDialog** ([src/components/CollaboratorIdentityDialog.tsx](../../src/components/CollaboratorIdentityDialog.tsx)) — prompts for display name + color on first enable.
- Editor read-only gating: when the partner holds the pen, the TipTap editor is set non-editable.

State: `useCollab()` in [src/hooks/useCollab.ts](../../src/hooks/useCollab.ts). Types/constants in [src/lib/collab.ts](../../src/lib/collab.ts). Sidecar: `collab.json`.

## Buttons convention

See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) for canonical button styles. Key rules:

- **Top-bar buttons** (on a colored Virgil-bar background) **lighten on hover** — never `hover:bg-stone-100`.
- **Panel / card buttons** (on white panel background) **darken on hover** (`hover:bg-surface-muted-strong`).
- Popout button class is reusable as `POPOUT_BUTTON_CLASS` from `panel-primitives.tsx`.
- AI-request icon is the **8-ray sun-star** — never a 5-point star.
