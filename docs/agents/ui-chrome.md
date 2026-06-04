<!-- last-verified: 694f789 2026-06-04 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization, docs/architecture/VIRGIL.md#card-kind-taxonomy -->
<!-- covers-code: src/panels/panel-registry.ts, src/components/MenuBar.tsx, src/components/EditorLayout.tsx, src/components/panel-primitives.tsx, src/components/editor-layout -->

# UI Chrome

Structural map of everything surrounding the main text editor: strips, panels, toolbars, and the orchestrator that wires them together.

See `glossary.md` for user-term ↔ code-name mapping.

## The orchestrator (post Path A 7.8)

The orchestrator role is now split across two files:

- **[src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx)** (~5080 lines, shrank in 2309137 when the strip-icon drops, panel-body drops, and main-editor selection HTML5 drag plumbing were all removed in favor of pop-out + drop-mode) — the **shell wrapper**. Owns tab/file management (`useFiles`), `useViewPrefs` ownership (handed to EditorPane via `viewPrefs` prop), the Virgil bar (~line 3818) and its DocTab/LibraryTab strip, the `activePane` switch (paper / library-outer / doc routing), top-bar dialogs (Preferences, Fonts, Margins, NewDoc, TexFilePicker, DocumentClassMismatch, ManageStyles), the PDF view branch, and the Code view. Per 8b9659c, Code view is now a draggable **split-pane alongside EditorPane** ([split-with-code.tsx](../../src/components/editor-layout/split-with-code.tsx) + `CodePaneSplitContext`), not a full-screen replacement; the `CodeEditor` (CodeMirror) state still lives in EditorLayout and code↔TipTap edits sync through [code-pane-bridge.ts](../../src/lib/code-pane-bridge.ts) (TipTap stays canonical). The vestigial `detachedActions[]` / `detachedFormatting[]` / `detachedMenus[]` tear-off arrays + their body-portal renders now live in **EditorPane**, not here (see MenuBar section below).
- **[src/components/EditorPane.tsx](../../src/components/EditorPane.tsx)** (~5510 lines) — the **canonical editor surface** mounted by both the main app's doc branch (from EditorLayout) and the Library Reader (from `library/components/PaperRender.tsx`). EditorPane owns per-doc hooks (`useDocument`, `useLatexCompile`, `useNotes`, `useTodos`, `useCitations`, `useCollab`, `usePristineCardManager`, …), the docked `MenuBar` (~line 3602), the panel rail (`PaneRail` left + right), the floating-panel block, and the canonical `DockOutline` (~line 2965) / `CardLiftOutline`.

When anything touches UI layout, chrome, or panel placement: if it's a tab/dialog/Virgil-bar concern → EditorLayout; if it's a per-document chrome / panel / popout / MenuBar concern → EditorPane. The full split is documented in `architecture.md` → "EditorPane vs EditorLayout".

The two bundles flow shell→pane:
- `viewPrefs: EditorPaneViewPrefs` — dock/float-shaped state. Reader passes none → main-app rail behavior stays dormant.
- `menuBar: EditorPaneMenuBarBundle` — toggle state, para-nav, dialog openers, detached-toolbar refs. Reader passes none → docked MenuBar / detached toolbars stay dormant.

The `chrome` prop ([chrome-config.ts](../../src/components/editor-layout/chrome-config.ts)) gates feature visibility per surface: main app passes `FULL_CHROME`, Reader passes `READER_CHROME`.

## Hierarchy

```
EditorLayout (shell)
├─ Virgil bar (DocTab + LibraryTab pairs, menu pod, etc.) — EditorLayout.tsx:3818
├─ Top-bar dialogs (Preferences, Fonts, Margins, NewDoc, TexFilePicker, ManageStyles, …)
├─ activePane switch
│   ├─ doc branch → <EditorPane> (see below)
│   ├─ paper branch → <PaperRender> → <EditorPane editable={false}>
│   ├─ library-outer branch → <LibraryOuterView> → <LibraryApp>
│   ├─ pdf branch → <PdfView>
│   └─ code split-pane → split-with-code.tsx (CodeEditor state in EditorLayout; code↔TipTap bridge)
└─ DetachedActionsToolbar / DetachedFormattingToolbar / DetachedMenuToolbar (portal × N each)

EditorPane (canonical editor surface)
├─ PaneRail side="left" (icon strip, OmniFilterMenu)
├─ PanelColumn side="left" (active panel(s); top/bottom split)
├─ Editor column
│   ├─ MenuBar — docked inline at sticky [data-tool-strip="text"]   — EditorPane.tsx:3602
│   ├─ VirgilEditor (the TipTap editor itself)
│   ├─ SelectionActionsMenu (gutter lightning-bolt; click to expand ActionsMenuPanel)
│   ├─ Marginalia gutters (left + right of text)
│   ├─ FloatCard portals (popped-out cards)
│   ├─ FloatingPanel portals (popped-out panels)
│   ├─ TextObjectFloat portals (popped-out TextObjects — all 16 block/selection kinds)
│   └─ DockOutline (body-portaled drag-target outline, suppressed in zen) — EditorPane.tsx:2965
├─ PanelColumn side="right"
└─ PaneRail side="right" (icon strip, OmniFilterMenu)
```

## Tool strips (left & right)

Rendered by `PaneRail` inside `EditorPane.tsx` (~line 4333 for `data-strip-side`). Identical structure on both sides:

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

See `glossary.md` for the full table. Quick reference: 11 card panels (`notes`, `footnotes`, `citations`, `bibliography`, `reports`, `examples`, `todo`, `archive`, `revisions`, `cutter`, `errors`) and 4 non-card panels (`outline`, `search`, `wordcount`, `omni`). **Notes, Revisions, and Cutter are all polymorphic.** Notes: `note` + `highlight` (both in `POLYMORPHIC_CARD_PANEL`; registry `card: null`); Revisions: `comment` + `revision-suggestion` (registry `card.kind` is `comment`; `revision-suggestion` in `CARD_KEY_PREFIXES`); Cutter: `cutter-comment` + `cutter-suggestion` (`card: null`; both in `POLYMORPHIC_CARD_PANEL`). The Revisions panel additionally tracks a per-document "revisions accepted" counter (`RevisionsTracker`); the Cutter panel tracks a word-count goal (`CutterGoal`).

Omni-eligible panels (shown in Omni view): notes, footnotes, citations, reports, examples, todo, archive, **revisions**, **cutter**, **errors**. Bibliography is the only card panel that's *not* omni-eligible.

Each omni-eligible panel owns its own `omni.tsx` next to the panel (e.g. [src/panels/Cutter/omni.tsx](../../src/panels/Cutter/omni.tsx), [src/panels/Errors/omni.tsx](../../src/panels/Errors/omni.tsx), [src/panels/Revisions/omni.tsx](../../src/panels/Revisions/omni.tsx)) exporting a `buildXOmniItems(args): OmniItem[]` builder. The orchestrator-side host [src/components/editor-layout/panels/omni-host.tsx](../../src/components/editor-layout/panels/omni-host.tsx) imports each builder and concatenates the results into the per-side omni columns. New omni-eligible panels add their builder there.

## MenuBar (the menu pod inside the editor column)

[src/components/MenuBar.tsx](../../src/components/MenuBar.tsx) — default export `MenuBar`.

Mounted **inline** at the top of the editor column inside `EditorPane.tsx` (~line 3602). No portal. 24px tall, right-aligned (slimmed from 32px and re-aligned in ae15791). Bare icons sit on the canvas — no enclosing pod, no grab handle, no rotation knob.

ae15791 dropped the home Format and Actions popovers from the docked bar. The actions/formatting vocabulary now lives in `SelectionActionsMenu` (auto-popping right-of-selection, see below) and `DragHandleMenu` (click-the-handle popover on the left of each paragraph). `AttachedPopover` in [MenuBar.tsx:677](../../src/components/MenuBar.tsx) is unused; `DetachedMenuToolbar` / `DetachedFormattingToolbar` / `DetachedActionsToolbar` still render via portals from the EditorPane state arrays (`detachedMenus[]`, `detachedFormatting[]`, `detachedActions[]`), but no UI path currently spawns new entries. Reader passes no `menuBar` bundle, so docked MenuBar and detached toolbars stay dormant for paper renders.

`prefs.menuLocation` still exists in `useViewPrefs` (default `{kind:"home"}`) but the "free" branch is now effectively unreachable.

### Contents in order (horizontal, right-aligned)

Collab status pill, `ActionsStripButton` (lightning-bolt — drops down the same `ActionsMenuPanel` the gutter button shows; added in 82872e7), paragraph back/forward (stemmed arrows), Split toggle, then the View menu kebab (three-dot, at the end via `kebabAtEnd`). Close-all-panels and Fonts… moved into the View menu.

A **Style** mode toggle button sits in the right cluster of the Virgil bar (alongside the file/zen/version buttons), not inside the MenuBar pod itself. Click it to open [ManageStylesModal](../../src/components/ManageStylesModal.tsx) (the inline `DocStyleDropdown` was folded into this modal by `9744b71`) — apply a style to the active doc, edit/duplicate/delete entries, save the current preamble as a new entry, or pick the default for new docs. Drift between the picked style and the doc's preamble routes through [StyleApplyDialog](../../src/components/StyleApplyDialog.tsx). State: per-doc id in [useDocumentStyle](../../src/hooks/useDocumentStyle.ts); user style library in [useStyleLibrary](../../src/hooks/useStyleLibrary.ts); preset catalog in [document-styles.ts](../../src/lib/document-styles.ts). Mount + open state at `EditorLayout.tsx` ~line 4737 / ~line 5112.

A **Print** button (printer icon) lives in the same right cluster. It opens `PrintDialog` ([src/components/PrintDialog.tsx](../../src/components/PrintDialog.tsx)) — a show/hide controls modal for marginalia, footnotes, citations, comments, paragraph titles, etc. — then triggers `window.print()`. Print orchestration + appendix collection in [src/lib/print.ts](../../src/lib/print.ts) and [src/components/PrintAppendices.tsx](../../src/components/PrintAppendices.tsx).

The **View menu** (three-dot kebab) gained a **Highlights** sub-menu of per-kind toggles. Each toggle hides linked-anchor highlights for one card kind (`note`, `todo`, `comment`, `cut`, `report`); the active set lives in `prefs.hiddenHighlightTypes` via `useViewPrefs` and is read by `useLinkHighlight`.

Paragraph back/forward chevrons (now stemmed arrows after ae15791) sit between collab status and split toggle; disabled at history bounds. The View menu's orientation toggle was dropped in c40d8d2.

## SelectionActionsMenu + ActionsStripButton (the gutter + strip lightning-bolts)

After 1bd614c the auto-popping menu is gone — selection now reveals only a small yellow lightning-bolt button in the right gutter; clicking it expands the dropdown in place. 82872e7 added a sibling strip-mounted lightning-bolt in the MenuBar (currentColor, not yellow) that drops the same dropdown anchored to the button. Both triggers render the shared `ActionsMenuPanel` body so the menus stay in lockstep.

- [src/components/SelectionActionsMenu.tsx](../../src/components/SelectionActionsMenu.tsx) — the gutter button + open-state; works in cursor-only mode too (anchors via `kind:"paragraph"`, Highlight greyed out without a live range).
- [src/components/ActionsStripButton.tsx](../../src/components/ActionsStripButton.tsx) — the stable strip trigger; disabled until the editor has been focused at least once.
- [src/components/ActionsMenuPanel.tsx](../../src/components/ActionsMenuPanel.tsx) — the ~300-line shared body: 4×3 inline-formatting grid (bold/italic/underline, block-type dropdown, math inserters that *wrap* the selection rather than insert placeholders, text-color swatches via `SelectionColorPopover`) + vertical action list reusing `MENU_ENTRIES` from `DragHandleMenu`. Letter shortcuts only fire while the panel is open.

Dispatch goes through `DragHandleMenuApi.dispatch`, the same pipeline as the left-of-paragraph click handle, so footnote / archive / note / etc. behave identically across all three entry points.

## Action buttons (the "action toolbar")

`ActionButtonsRow` (at `MenuBar.tsx:889`) renders 9 color-coded buttons. Each uses `ActionButton` which resolves the nearest `[data-action-pod]` ancestor so its popup can be positioned below the toolbar regardless of whether it's attached or detached. Buttons are declared in `ACTION_BUTTON_DEFS` (`MenuBar.tsx:864`) — add/remove/reorder there.

| Button | Color | Opens/creates |
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

Colors are coordinated with each panel's `CARD_THEME`.

## DetachedActionsToolbar

`DetachedActionsToolbar` at `MenuBar.tsx:1077`. Free-floating pod, separate from MenuBar, appears when user tears the attached actions popover off by its grab bar. **Multi-instance**: each tear-off spawns a new copy, so many can coexist.

State in the EditorLayout shell: `detachedActions[]` (array of `{ id, pos }`, keyed on monotonic id). The close (X) button filters the entry out of the array; dragging routes through `beginActionsDrag(id, …)` which looks up the wrapper by `data-actions-id` and runs snap-grid math ([src/components/editor-layout/snap-grid.ts](../../src/components/editor-layout/snap-grid.ts)) against editor-column and panel-column edges.

Modes (per instance):
- **Expanded**: full `ActionButtonsRow` + collapse chevron + grab bar (X re-dock lives on the tab edge).
- **Collapsed**: just the star icon + tab with re-dock X.
- **Orientation**: horizontal or vertical; rotation knob on the tab sticking out from a corner. When rotated, the knob's corner stays put so the pivot is predictable.

## Formatting popup

Not a dedicated component — `AttachedPopover` anchored to the A-glyph button in `MenuBar.tsx` ~line 1509 (inside `MenuBarContent`). Flips above/left when near viewport edges. Escape or outside-click closes.

## Shared popover primitive

`AttachedPopover` at `MenuBar.tsx:675`. Props: `anchor`, `children: (close) => ReactNode`, `title`, `active`, optional `onGrabStart` (adds a grab handle on the right for tear-off).

Behavior: click anchor toggles; fixed-positioned below-right by default; flips as needed; Escape + outside-click close.

## Shared toolbar shell

[src/components/editor-layout/floating-toolbar-shell.tsx](../../src/components/editor-layout/floating-toolbar-shell.tsx) exports `FloatingToolbarShell`, `DetachedToolbar`, and `PodGrabHandle`. All three floating toolbars (home-docked `MenuBar`, `DetachedActionsToolbar`, `DetachedFormattingToolbar`) share this shell — it draws the pod + tab + rotation knob so tear-off behavior stays consistent. `atHome` mode suppresses the tab/knob/shadow for the Virgil-bar docked case.

## MarginActionToolbar (removed)

The per-column "+" action-chip row (chips above each omni gutter) was suppressed in 652572a and **deleted in bcc583a** — the file, its call sites, `PaneRailProps.topOverlay`, the `panel-column.tsx` `topOverlay` mechanism, and `ActionChipButton` are all gone. The action vocabulary now lives only in `SelectionActionsMenu`, `ActionsStripButton`, `DragHandleMenu`, and the vestigial `DetachedActionsToolbar`. The `chrome.actionToolbarKinds` whitelist survives (Reader sets `["note"]`) and still filters which `ActionButtonsRow` buttons render in the paper surface.

## Panel icons

[src/components/editor-layout/panel-icons.tsx](../../src/components/editor-layout/panel-icons.tsx) — `IconNotes`, `IconHighlight` (highlighter-pen marker, used by the new Highlight action button — there is no Highlight panel since highlights live inside the Notes panel), `IconRevisions`, `IconArchive`, `IconFootnote`, `IconCitation`, `IconBibliography`, `IconTodo`, `IconCutter`, `IconReports`, `IconOutline`, `IconSearch`, `IconWordCount`, `IconOmni`, `IconBlank`, `IconErrors`, `IconExample`, `IconSplit`, `IconFolder`, `IconPlus`, `IconX`, `IconLibrary`, `IconDuplicate`, `IconTrash`, `IconZap`. All use `currentColor`. (`IconSuggestions` was removed when the Suggestions panel folded into Revisions; `IconQuotations` → `IconReports` in the card-system refactor.)

**Topbar icon size: 16px** (`.topbarbtn` is 24px, leaving 4px of padding). Don't ship 14px or 20px topbar icons — see `STYLE_GUIDE.md`.

## Document folder tabs

[src/components/editor-layout/DocumentFolderTab.tsx](../../src/components/editor-layout/DocumentFolderTab.tsx) renders the manila-folder-style document tabs in the topbar — each tab is one self-contained SVG path with rounded top corners and convex swoop hooks at the bottom. Path geometry in [src/components/editor-layout/folder-path.ts](../../src/components/editor-layout/folder-path.ts) (`buildActiveTabStrokePath`, `buildTabFillPath`). Active and inactive tabs share the same path; the active variant omits the bottom edge so the canvas's top border draws the seam.

## Floating panels & cards

- [src/components/FloatingPanel.tsx](../../src/components/FloatingPanel.tsx) — `FloatingPanel` low-level draggable + resizable window via portal. Min 240×200, max 900×window-40. Drag on header, resize via bottom-right grip.
- [src/components/FloatingCards.tsx](../../src/components/FloatingCards.tsx) — `FloatCard` wraps a card in a `FloatingPanel` and reads saved position from `cardFloatPositions` pref.
- Popped-out card state centralized in `usePoppedCards()` hook reading `prefs.poppedOutCards`. EditorLayout iterates and renders each.
- **Block & selection popouts** ride the same `FloatingPanel` machinery but for editor TextObjects instead of card kinds. After the lifted-overlay refactor **all 16 TextObject kinds lift** (paragraph, heading, bullet/ordered list, list item, example block + item, blockquote, code block, display math, LaTeX comment, title field, tex block, figure, graphics, and persisted `linkedRange` selections), keyed uniformly as `textobject:<kind>:<uuid>` (`textObjectPopoutKey` in [text-object-registry.ts](../../src/text-objects/text-object-registry.ts)). Each released float renders via [editor-layout/floating-cards.tsx](../../src/components/editor-layout/floating-cards.tsx) under the shared `TextObjectFloat` chrome, which looks up a per-kind body in [src/text-objects/floats/](../../src/text-objects/floats/); section-body extraction stays in [section-range.ts](../../src/lib/section-range.ts). The drag ghost is `LiftedTextOverlay`. See `main-text.md` → TextObjects and `architecture.md` for the registry pathway.
- **Spawn position**: when a card or block is popped out for the first time the floating window opens near the trigger element rather than at a fixed anchor. Logic in [src/components/editor-layout/spawn-position.ts](../../src/components/editor-layout/spawn-position.ts); position is forgotten on close so the next pop-out re-spawns near the (possibly new) trigger.
- **No interior drag grip**: 5f2d357 dropped the 6-dot grip inside the paragraph / heading / list / selection float bodies. The float header is the only drag/redock affordance now (shift-drag → drop-mode). Companion to ec38210, which removed the analogous `onTextDragStart` grip beside each `RichTextField` in `EditableCard`. Surviving text-move paths after 2309137: drag-to-pop-out (6-dot lift in the main-editor margin via `SelectionDragHandle`) and drop-mode (shift-drag on a float header).

## Per-panel text-size stepper

Every panel-header three-dot menu auto-injects a compact text-size stepper before any panel-specific items. `PanelTextSizeRow` ([src/components/PanelTextSizeRow.tsx](../../src/components/PanelTextSizeRow.tsx)) is the widget; auto-injection happens in `panel-primitives.tsx` (~line 1875, inside `ItemMenu` at ~line 1844). Available sizes and per-panel-kind defaults live in [src/lib/panel-typography.ts](../../src/lib/panel-typography.ts); the panel kind is read from `panel-kind-context.tsx`. Persistence is via `useViewPrefs` keyed by panel kind.

## Fonts dialog

The View menu's "Fonts…" item opens [src/components/FontsDialog.tsx](../../src/components/FontsDialog.tsx) — a `FloatingPanel`-based per-category font + size editor. One soft-pod card per font category (body, headings, footnotes, marginalia, etc.); each card pairs a `FontPicker` (typeahead pop-down listing `MAIN_TEXT_FONTS` from [src/lib/preferences-tree.ts](../../src/lib/preferences-tree.ts)) with a `SizeStepper` (− / + numeric stepper, larger hit targets than `PanelTextSizeRow`). Reset buttons restore each category to its default. Ownership is split: top-level prefs (e.g. body font) on `EditorPreferences` via `usePreferences`; per-panel-kind typography via `usePanelTypography` writing through `setPanelTypographyField`. MenuBar plumbs the open callback as `onOpenFontsDialog`; EditorLayout (the shell) owns the `fontsOpen` state and mounts the dialog (~line 5091).

## Stack (visual clipboard)

Bottom-left floating widget mounted as a body portal anchored to
`editorPaneRootRef` ([src/components/EditorPane.tsx](../../src/components/EditorPane.tsx)
~line 3060). Two components:

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

Confines the visible band of the editor to `[startBlockIndex, endBlockIndex]`. State in [src/hooks/useFocusMode.ts](../../src/hooks/useFocusMode.ts); the view-prefs stash carries `{active, locked, startBlockIndex, endBlockIndex}`. Mechanism (after 91ce009): EditorLayout injects a single `<style>` tag with `nth-child` rules — PM doesn't touch `<style>` elements so the rules survive ProseMirror's DOM reconciliation; the stylesheet is rebuilt only when the range or top-level child count changes. The omni-host's pass-2 filter drops any on-view card whose anchor falls outside the band (list-level filter, alongside the existing fold-section drop). Outline panel uses the same band logic. The Active/Locked distinction collapses for the editor — active === hide outside; lock is now mostly a guard against accidentally exiting via caret motion.

This is iteration 3 on focus mode: 1d9ed09 made it presentation-only (dimming, no hide), 2dc963d kept that frame, then 91ce009 reverted to band-confined hide because the dim-only mode left users with no clear visual signal of where the focus band ended.

## Dock-target outline

[src/components/editor-layout/DockOutline.tsx](../../src/components/editor-layout/DockOutline.tsx) renders a body-portaled clear-blue outline at fixed viewport coordinates to mark the active dock target during a panel drag. The signal driving it lives in [src/components/editor-layout/dock-drag.ts](../../src/components/editor-layout/dock-drag.ts) — a module-level `{slotKey, rect}` store with `setDockDragTarget` / `getDockDragTarget` / `useDockDragTarget`. Two flows write to it: undock (rect captured at mousedown so the outline survives the panel undocking and the slot DOM reshaping) and redock (mousemove hit-test against gutter columns; release reads the target and decides whether to redock). The store is module-level (not React Context) because producer (panel shell) and consumer (the body-portaled `DockOutline` plus EditorPane's mouseup handler) sit in different parts of the React tree. WAAPI-driven crossfade (not React state + CSS transitions) avoids races with React's batched commits and Strict Mode's effect double-invoke. Mounted from `EditorPane.tsx` ~line 2953, suppressed in zen mode.

## Helper mode overlay

Toggled from the "?" button on the Virgil bar (circle-question-mark icon, next to the info "i" button). When active, `document.body` gets `data-helper-mode="on"` and a "Helper mode" indicator appears in the Virgil bar (styled like the Focus View indicator — clicking it deactivates the mode).

Every interactive button carrying a `data-helper="Label"` attribute shows a black callout with white text **on hover** via a CSS `::after` pseudo-element reading `content: attr(data-helper)`. Only one callout is visible at a time (whichever element the cursor is over). The callout has `pointer-events: none` so it doesn't interfere with clicks.

Positioning is zone-based — below by default, right for left-strip buttons, left for right-strip buttons, above for card-level buttons (`data-helper-pos="above"`). All CSS rules are in `globals.css` under the "Helper mode" comment block.

State: `useHelperMode()` in [src/hooks/useHelperMode.ts](../../src/hooks/useHelperMode.ts) — module-scoped `useSyncExternalStore` pattern (same as `usePreferenceMode`). Exports `{ on, toggle, set }`. Persists to localStorage key `virgil-helper-mode`.

See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) for annotation guidelines (label length, positioning rules, CSS structure).

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
