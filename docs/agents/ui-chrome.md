<!-- last-verified: 562a431 2026-04-27 -->

# UI Chrome

Structural map of everything surrounding the main text editor: strips, panels, toolbars, and the orchestrator that wires them together.

See `glossary.md` for user-term ↔ code-name mapping.

## The orchestrator

**[src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx)** (~5585 lines) is THE orchestrator. It:

- Renders the left strip, right strip, left panel column, editor column, right panel column
- Mounts the home `MenuBar` **inline** at the top of the editor column (no portal — change c40d8d2). Detached `DetachedActionsToolbar` / `DetachedFormattingToolbar` / `DetachedMenuToolbar` copies still mount via portals to `document.body`
- Manages panel state: `activeLeft`, `activeRight`, `prefs.activeLeftTop/Bottom`, `prefs.activeRightTop/Bottom` (default to `"omni"`, not null/"blank")
- Manages layout state: `prefs.pageWidth`, panel-width map, `prefs.placements` (which panels live on which side)
- Manages floating state: `prefs.poppedOutPanels`, `prefs.poppedOutCards`, `prefs.menuLocation` (still `{kind:"home"}` by default; "free" mode is effectively dead since home no longer tears off), `detachedActions[]`, `detachedFormatting[]`, `detachedMenus[]` (multi-copy arrays after successive tear-offs)
- Handles all drag/drop, split/unsplit, collapse/expand logic

When anything touches UI layout, chrome, or panel placement, EditorLayout is almost certainly where it happens.

## Hierarchy

```
EditorLayout
├─ Left icon strip (data-strip-side="left")           — EditorLayout.tsx:4890
│   ├─ View control pod: collapse, omni-view, split
│   ├─ StripButton × N (per left-sidebar panel, drag-to-reorder)
│   └─ OmniFilterMenu (kebab pinned to bottom via mt-auto)
├─ PanelColumn side="left"                            — ~line 4950
│   └─ Active panel(s) — supports top/bottom split; optional MarginActionToolbar overlay
├─ Editor column
│   ├─ MenuBar — docked inline at top of editor column — ~line 5117
│   ├─ DetachedActionsToolbar (portal × N)
│   ├─ DetachedFormattingToolbar (portal × N)
│   ├─ DetachedMenuToolbar (portal × N)
│   ├─ VirgilEditor (the editor itself)
│   ├─ Marginalia gutters (left + right of text)
│   ├─ FloatingPanel portals (popped-out panels)         — ~line 5560
│   ├─ FloatCard portals (popped-out cards)
│   └─ ParagraphFloat / HeadingFloat portals (popped-out blocks)
├─ PanelColumn side="right"                           — ~line 5350
│   └─ Active panel(s)
└─ Right icon strip (data-strip-side="right")
    ├─ View control pod: collapse, omni-view, split
    ├─ StripButton × N
    └─ OmniFilterMenu (kebab pinned to bottom)
```

## Tool strips (left & right)

No dedicated component — just an inline flex column in `EditorLayout.tsx`. Identical structure on both sides:

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

Panels render via `renderPanelWithChrome(panelId, side)` inside EditorLayout. Same renderer is used for sidebar-mounted and floating variants (floating wraps in `FloatingPanel`).

## Panels

All panels share the wrapper system in [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) and [src/panels/_shared/](../../src/panels/_shared/). Two wrapper shapes:

- **`Panel`** — universal outer. Flex column with header, scroll body, absolute popout + close buttons. Used by panels with custom bodies (Outline, Search, WordCount).
- **`CardListPanel<T>`** — wraps `Panel` + iterates items as cards + adds AI-requests section + supports list/in-text view-mode toggle. Used by card panels.

**Header** is `PanelHeader` — fixed 34px (`--header-h`), title + count + optional `onAdd` (+ icon) and `onAiRequest` (8-ray star).

### Panel registry — SSOT

[src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) declares every panel with:
- `label` (display name)
- `folder` (path to its source)
- `card` (optional: card kind, key prefix, theme key)
- `defaultViewMode` (null | "list" | "in-text")
- `omniEligible` + `omniSide`
- `defaultStripSide`

Helper functions: `popKey(panelKind, id)`, `cardPopKey(cardKind, id)`, `getPanelByCardKind(cardKind)`, `OMNI_PANELS` (filtered list).

### Panel list

See `glossary.md` for the full table. Quick reference: 11 card panels (`notes`, `footnotes`, `citations`, `bibliography`, `quotations`, `examples`, `todo`, `archive`, `revisions`, `cutter`, `errors`) and 4 non-card panels (`outline`, `search`, `wordcount`, `omni`). Revisions hosts both `comment` cards (was: revisions; suggestions panel was folded into Revisions in 2073376).

Omni-eligible panels (shown in Omni view): notes, footnotes, citations, quotations, examples, todo, archive.

## MenuBar (the menu pod inside the editor column)

[src/components/MenuBar.tsx](../../src/components/MenuBar.tsx) — default export `MenuBar`.

Mounted **inline** at the top of the editor column (no portal). Renders in `atHome` mode — orientation locked horizontal; rotation knob and tab silhouette suppressed; no drop shadow; bare icons sit on the canvas. The home-bar grab handle was dropped in c40d8d2, so the home MenuBar no longer tears off.

Detached copies still spawn from the Format and Actions popovers' grab bars — those become free-floating `DetachedMenuToolbar`/`DetachedFormattingToolbar`/`DetachedActionsToolbar` instances mounted via portals to `document.body`. State arrays in EditorLayout: `detachedMenus[]`, `detachedFormatting[]`, `detachedActions[]` (each `{id, pos}`, multi-instance).

`prefs.menuLocation` still exists in `useViewPrefs` (default `{kind:"home"}`) but the "free" branch is effectively unreachable now that the home grab handle is gone.

### Contents in order (horizontal)

Format popup, Actions popup, paragraph back/forward, Split toggle, Close-all, then the View menu (three-dot kebab moved to the **end** of the row in c40d8d2 — not the start). The home-bar grab handle and its rotation knob were dropped in the same commit.

A **Document Style** dropdown (`DocStyleDropdown`, defined inline at `EditorLayout.tsx` ~line 211) sits in the right cluster of the Virgil bar (alongside the file/zen/version buttons), not inside the MenuBar pod itself. It exposes the per-document preamble preset selector — see [src/lib/document-styles.ts](../../src/lib/document-styles.ts) for the catalog and [src/hooks/useDocumentStyle.ts](../../src/hooks/useDocumentStyle.ts) for the rewrite mechanics.

The **Format popup** (A-glyph) and **Actions popup** (8-ray star) are `AttachedPopover` instances; each has a grab bar on its right edge — dragging spawns a new `DetachedFormattingToolbar` / `DetachedActionsToolbar` instance (the anchor button continues to function as a plain popover toggle). Paragraph back/forward chevrons sit between the popups and are disabled at history bounds. The View menu's orientation toggle was also dropped in c40d8d2.

## Action buttons (the "action toolbar")

`ActionButtonsRow` (at `MenuBar.tsx:484`) renders 8 color-coded buttons. Each uses `ActionButton` (`MenuBar.tsx:410`) which resolves the nearest `[data-action-pod]` ancestor so its popup can be positioned below the toolbar regardless of whether it's attached, detached, or rendered inside a `MarginActionToolbar`.

| Button | Color | Opens/creates |
|---|---|---|
| Revision | purple | Revision thread |
| Note | green | Note card |
| Todo | stone | Todo item |
| Cut | red | Cutter card |
| Archive | blue-grey | Archive card |
| Footnote | red | Footnote atom |
| Citation | amber | Citation atom |
| Quotation | orange | Quotation card |

Colors are coordinated with each panel's `CARD_THEME`.

## DetachedActionsToolbar

`DetachedActionsToolbar` at `MenuBar.tsx:538`. Free-floating pod, separate from MenuBar, appears when user tears the attached actions popover off by its grab bar. **Multi-instance**: each tear-off spawns a new copy, so many can coexist.

State in EditorLayout: `detachedActions[]` (array of `{ id, pos }`, keyed on monotonic id). The close (X) button filters the entry out of the array; dragging routes through `beginActionsDrag(id, …)` which looks up the wrapper by `data-actions-id` and runs snap-grid math ([src/components/editor-layout/snap-grid.ts](../../src/components/editor-layout/snap-grid.ts)) against editor-column and panel-column edges.

Modes (per instance):
- **Expanded**: full `ActionButtonsRow` + collapse chevron + grab bar (X re-dock lives on the tab edge).
- **Collapsed**: just the star icon + tab with re-dock X.
- **Orientation**: horizontal or vertical; rotation knob on the tab sticking out from a corner. When rotated, the knob's corner stays put so the pivot is predictable.

## Formatting popup

Not a dedicated component — `AttachedPopover` anchored to the A-glyph button in `MenuBar.tsx:1058`. Flips above/left when near viewport edges. Escape or outside-click closes.

## Shared popover primitive

`AttachedPopover` at `MenuBar.tsx:262`. Props: `anchor`, `children: (close) => ReactNode`, `title`, `active`, optional `onGrabStart` (adds a grab handle on the right for tear-off).

Behavior: click anchor toggles; fixed-positioned below-right by default; flips as needed; Escape + outside-click close.

## Shared toolbar shell

[src/components/editor-layout/floating-toolbar-shell.tsx](../../src/components/editor-layout/floating-toolbar-shell.tsx) exports `FloatingToolbarShell`, `DetachedToolbar`, and `PodGrabHandle`. All three floating toolbars (home-docked `MenuBar`, `DetachedActionsToolbar`, `DetachedFormattingToolbar`) share this shell — it draws the pod + tab + rotation knob so tear-off behavior stays consistent. `atHome` mode suppresses the tab/knob/shadow for the Virgil-bar docked case.

## MarginActionToolbar

[src/components/MarginActionToolbar.tsx](../../src/components/MarginActionToolbar.tsx) — a per-column action toolbar rendered above a PanelColumn when it is showing Omni-view. Wired into EditorLayout via the `marginToolbarActions` callback bag and passed as the column's `topOverlay` prop. Shares `ActionButton` + `ActionButtonsRow` styling with the main/detached toolbars.

## Panel icons

[src/components/editor-layout/panel-icons.tsx](../../src/components/editor-layout/panel-icons.tsx) — `IconNotes`, `IconRevisions`, `IconArchive`, `IconFootnote`, `IconCitation`, `IconBibliography`, `IconTodo`, `IconCutter`, `IconQuotations`, `IconOutline`, `IconSearch`, `IconWordCount`, `IconOmni`, `IconBlank`, `IconErrors`, `IconExample`, `IconSplit`, `IconFolder`, `IconPlus`, `IconX`, `IconLibrary`. All use `currentColor`. (`IconSuggestions` was removed when the Suggestions panel folded into Revisions.)

## Floating panels & cards

- [src/components/FloatingPanel.tsx](../../src/components/FloatingPanel.tsx) — `FloatingPanel` low-level draggable + resizable window via portal. Min 240×200, max 900×window-40. Drag on header, resize via bottom-right grip.
- [src/components/FloatingCards.tsx](../../src/components/FloatingCards.tsx) — `FloatCard` wraps a card in a `FloatingPanel` and reads saved position from `cardFloatPositions` pref.
- Popped-out card state centralized in `usePoppedCards()` hook reading `prefs.poppedOutCards`. EditorLayout iterates and renders each.
- **Block popouts** (paragraph + heading) ride the same machinery but for editor blocks instead of card kinds. Keys are `paragraph:${uuid}` and `heading:${uuid}`. `ParagraphFloat` (a single paragraph in its own editor with editable title + drag handle) and `HeadingFloat` (a heading + the section body it dominates) live in `src/components/`; the body-range extraction is in [src/lib/section-range.ts](../../src/lib/section-range.ts).
- **Spawn position**: when a card or block is popped out for the first time the floating window opens near the trigger element rather than at a fixed anchor. Logic in [src/components/editor-layout/spawn-position.ts](../../src/components/editor-layout/spawn-position.ts); position is forgotten on close so the next pop-out re-spawns near the (possibly new) trigger.

## Per-panel text-size stepper

Every panel-header three-dot menu auto-injects a compact text-size stepper before any panel-specific items. `PanelTextSizeRow` ([src/components/PanelTextSizeRow.tsx](../../src/components/PanelTextSizeRow.tsx)) is the widget; auto-injection happens in `panel-primitives.tsx` (~line 1364, inside `ItemMenu`). Available sizes and per-panel-kind defaults live in [src/lib/panel-typography.ts](../../src/lib/panel-typography.ts); the panel kind is read from `panel-kind-context.tsx`. Persistence is via `useViewPrefs` keyed by panel kind.

## Buttons convention

See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) for canonical button styles. Key rules:

- **Top-bar buttons** (on a colored Virgil-bar background) **lighten on hover** — never `hover:bg-stone-100`.
- **Panel / card buttons** (on white panel background) **darken on hover** (`hover:bg-surface-muted-strong`).
- Popout button class is reusable as `POPOUT_BUTTON_CLASS` from `panel-primitives.tsx`.
- AI-request icon is the **8-ray sun-star** — never a 5-point star.
