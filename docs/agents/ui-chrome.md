<!-- last-verified: 3de2062 2026-04-23 -->

# UI Chrome

Structural map of everything surrounding the main text editor: strips, panels, toolbars, and the orchestrator that wires them together.

See `glossary.md` for user-term ↔ code-name mapping.

## The orchestrator

**[src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx)** (5129 lines) is THE orchestrator. It:

- Renders the left strip, right strip, left panel column, editor column, right panel column
- Mounts the `MenuBar` and each `DetachedActionsToolbar` via portals to `document.body`
- Manages panel state: `activeLeft`, `activeRight`, `prefs.activeLeftTop/Bottom`, `prefs.activeRightTop/Bottom` (default to `"omni"`, not null/"blank")
- Manages layout state: `prefs.pageWidth`, panel-width map, `prefs.placements` (which panels live on which side)
- Manages floating state: `prefs.poppedOutPanels`, `prefs.poppedOutCards`, `prefs.menuLocation` (`{kind:"home"}` or `{kind:"free", left, top}`), `menuOrientation`, `dragFreePos` (transient during drag), `detachedActions[]` (array of `{id, pos}` — multi-copy after successive tear-offs)
- Handles all drag/drop, split/unsplit, collapse/expand logic

When anything touches UI layout, chrome, or panel placement, EditorLayout is almost certainly where it happens.

## Hierarchy

```
EditorLayout
├─ Left icon strip (data-strip-side="left")           — EditorLayout.tsx:4478
│   ├─ View control pod: collapse, omni-view, split
│   └─ StripButton × N (per left-sidebar panel, drag-to-reorder)
├─ PanelColumn side="left"                            — ~line 4470
│   └─ Active panel(s) — supports top/bottom split; optional MarginActionToolbar overlay
├─ Editor column
│   ├─ MenuBar (portal) — home-docked or free-floating — ~line 4561
│   ├─ DetachedActionsToolbar (portal × N)            — ~line 4613
│   ├─ VirgilEditor (the editor itself)
│   ├─ Marginalia gutters (left + right of text)
│   ├─ FloatingPanel portals (popped-out panels)
│   └─ FloatCard portals (popped-out cards)
├─ PanelColumn side="right"                           — ~line 4724
│   └─ Active panel(s)
└─ Right icon strip (data-strip-side="right")         — EditorLayout.tsx:4797
    ├─ View control pod: collapse, omni-view, split
    └─ StripButton × N
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

`StripButton` lives in [src/components/editor-layout/drag-drop.tsx](../../src/components/editor-layout/drag-drop.tsx).

Panel-side assignment is stored in `prefs.placements` and defaults come from `defaultStripSide` in `PANEL_REGISTRY`.

## Panel column

[src/components/editor-layout/panel-column.tsx](../../src/components/editor-layout/panel-column.tsx) — `PanelColumn`

Props: `side` ("left"|"right"), `pageWidth`, `onPageWidthChange`, `panelPref`, `onPanelPrefChange`, `split` (bool), `collapsed`, `blank`, optional `topOverlay` (per-column action toolbar).

Behavior:
- Wraps a single panel, or a split: `{ top, bottom, ratio, onRatioChange }`
- Inner-edge drag adjusts the **page** and this column's **panel preferred size** in lockstep, keeping the dragged edge glued to the cursor (the opposite column is unaffected). Min via `--panel-min`.
- Flex `1 100 ${panelPref}px` — the column absorbs leftover window space when resized.
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

See `glossary.md` for the full table. Quick reference: 11 card panels (`notes`, `footnotes`, `citations`, `bibliography`, `quotations`, `examples`, `todo`, `archive`, `revisions`, `cutter`, `errors`) and 5 non-card panels (`outline`, `search`, `wordcount`, `suggestions`, `omni`).

Omni-eligible panels (shown in Omni view): notes, footnotes, citations, quotations, examples, todo, archive.

## MenuBar (the "Virgil bar")

[src/components/MenuBar.tsx](../../src/components/MenuBar.tsx) — default export `MenuBar`.

Mounted via portal to `document.body`. Two-mode position model:

- **Home** (default): docked inside the Virgil top bar, centered between the tabs (left) and Zen/Prefs/Version cluster (right). Orientation is locked horizontal; rotation knob and tab silhouette are hidden; the pod shares the top-bar chrome (no drop shadow).
- **Free**: dragged out of the top bar. Free-floating at a viewport coordinate. Rotation knob + tab silhouette visible; pod carries its own drop shadow. A dock-up button (chevron-up) in this mode re-pins to home.

Position state in EditorLayout: `prefs.menuLocation` ({kind:"home"} | {kind:"free", left, top}), `menuOrientation`, transient `dragFreePos` during drag. Drop zone for home-snap is computed from `topbarGaps` (derived from `topbarLeftRef`/`topbarRightRef` via ResizeObserver). Zen mode force-pins to home regardless of persisted state.

### Contents in order (horizontal)

1. **View menu** (three vertical dots) — `ViewMenu` at `MenuBar.tsx:735`. Dropdown with toolbar orientation, display toggles (paragraph titles, % comments, current section, marginalia, dividers), preferences link.
2. **Format popup** (A-glyph anchor) — `AttachedPopover` at `MenuBar.tsx:1058`. Contents: Bold, Italic, `BlockTypeDropdown` (body/chapter/section/subsection/subsubsection at `MenuBar.tsx:176`), bullet list, ordered list, blockquote, inline math, display math.
3. **Actions popup** (8-ray star anchor) — `AttachedPopover` at `MenuBar.tsx:1155` wrapping `ActionButtonsRow` (at `MenuBar.tsx:484`). Has a grab bar on its right edge — each drag tears off a **new** `DetachedActionsToolbar` copy (the anchor button stays a plain popover toggle; nothing special happens when detached copies exist).
4. **Paragraph nav** (back/forward chevrons, stacked vertically) — `MenuBar.tsx:1205`. Disabled at history bounds.
5. **Split editor toggle**.
6. **Close all panels** (X).
7. **Grab handle** (`PodGrabHandle` at `MenuBar.tsx:371`) — drag to reposition the whole pod (home → free, or move free-float position).
8. **Rotation knob** — click to toggle horizontal ↔ vertical. Hidden when at home.

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

[src/components/editor-layout/panel-icons.tsx](../../src/components/editor-layout/panel-icons.tsx) — `IconNotes`, `IconRevisions`, `IconArchive`, `IconFootnote`, `IconCitation`, `IconBibliography`, `IconTodo`, `IconCutter`, `IconQuotations`, `IconOutline`, `IconSearch`, `IconWordCount`, `IconOmni`, `IconErrors`, `IconSplit`, `IconFolder`, `IconPlus`, `IconX`, `IconSuggestions`, `IconLibrary`. All use `currentColor`.

## Floating panels & cards

- [src/components/FloatingPanel.tsx](../../src/components/FloatingPanel.tsx) — `FloatingPanel` low-level draggable + resizable window via portal. Min 240×200, max 900×window-40. Drag on header, resize via bottom-right grip.
- [src/components/FloatingCards.tsx](../../src/components/FloatingCards.tsx) — `FloatCard` wraps a card in a `FloatingPanel` and reads saved position from `cardFloatPositions` pref.
- Popped-out card state centralized in `usePoppedCards()` hook reading `prefs.poppedOutCards`. EditorLayout iterates and renders each.

## Buttons convention

See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) for canonical button styles. Key rules:

- **Top-bar buttons** (on a colored Virgil-bar background) **lighten on hover** — never `hover:bg-stone-100`.
- **Panel / card buttons** (on white panel background) **darken on hover** (`hover:bg-surface-muted-strong`).
- Popout button class is reusable as `POPOUT_BUTTON_CLASS` from `panel-primitives.tsx`.
- AI-request icon is the **8-ray sun-star** — never a 5-point star.
