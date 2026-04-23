<!-- last-verified: 860853c 2026-04-23 -->

# UI Chrome

Structural map of everything surrounding the main text editor: strips, panels, toolbars, and the orchestrator that wires them together.

See `glossary.md` for user-term ↔ code-name mapping.

## The orchestrator

**[src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx)** (4594 lines) is THE orchestrator. It:

- Renders the left strip, right strip, left panel column, editor column, right panel column
- Mounts the `MenuBar` and `DetachedActionsToolbar` via portals to `document.body`
- Manages panel state: `activeLeft`, `activeRight`, `prefs.activeLeftTop/Bottom`, `prefs.activeRightTop/Bottom`
- Manages layout state: `prefs.leftWidth`, `prefs.rightWidth`, `prefs.placements` (which panels live on which side)
- Manages floating state: `prefs.poppedOutPanels`, `prefs.poppedOutCards`, `menuPos`/`menuOrientation`, `actionsDetached`/`actionsPos`
- Handles all drag/drop, split/unsplit, collapse/expand logic

When anything touches UI layout, chrome, or panel placement, EditorLayout is almost certainly where it happens.

## Hierarchy

```
EditorLayout
├─ Left icon strip (data-strip-side="left")           — EditorLayout.tsx:4102
│   ├─ View control pod: collapse, omni-view, split
│   └─ StripButton × N (per left-sidebar panel, drag-to-reorder)
├─ PanelColumn side="left"                            — ~line 4158
│   └─ Active panel(s) — supports top/bottom split
├─ Editor column
│   ├─ MenuBar (portal)                               — ~line 4177
│   ├─ DetachedActionsToolbar (portal, optional)      — ~line 4229
│   ├─ VirgilEditor (the editor itself)
│   ├─ Marginalia gutters (left + right of text)
│   ├─ FloatingPanel portals (popped-out panels)
│   └─ FloatCard portals (popped-out cards)
├─ PanelColumn side="right"                           — ~line 4399
│   └─ Active panel(s)
└─ Right icon strip (data-strip-side="right")         — EditorLayout.tsx:4408
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

Props: `side` ("left"|"right"), `width`, `onWidthChange`, `split` (bool), `collapsed`, `blank`.

Behavior:
- Wraps a single panel, or a split: `{ top, bottom, ratio, onRatioChange }`
- Edge-drag to resize width (min 240, max 600)
- Collapses to zero width when `collapsed`

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

See `glossary.md` for the full table. Quick reference: 10 card panels (`notes`, `footnotes`, `citations`, `bibliography`, `quotations`, `todo`, `archive`, `revisions`, `cutter`, `errors`) and 5 non-card panels (`outline`, `search`, `wordcount`, `suggestions`, `omni`).

Omni-eligible panels (shown in Omni view): notes, footnotes, citations, quotations, todo, archive.

## MenuBar (the "Virgil bar")

[src/components/MenuBar.tsx](../../src/components/MenuBar.tsx) — default export `MenuBar`.

Free-floating pod, mounted via portal to `document.body`. Draggable, snappable to editor-column edges, rotatable between horizontal and vertical.

Position state in EditorLayout: `menuPos`, `menuOrientation`.

### Contents in order (horizontal)

1. **View menu** (three vertical dots) — `ViewMenu` at `MenuBar.tsx:780`. Dropdown with toolbar orientation, display toggles (paragraph titles, % comments, current section, marginalia, dividers), preferences link.
2. **Format popup** (A-glyph anchor) — `AttachedPopover` at `MenuBar.tsx:1097`. Contents: Bold, Italic, `BlockTypeDropdown` (body/chapter/section/subsection/subsubsection at `MenuBar.tsx:172`), bullet list, ordered list, blockquote, inline math, display math.
3. **Actions popup** (8-ray star anchor) — `AttachedPopover` at `MenuBar.tsx:1196` wrapping `ActionButtonsRow` (at `MenuBar.tsx:463`). Has a grab bar on its right edge — drag to tear off into `DetachedActionsToolbar`.
4. **Paragraph nav** (back/forward chevrons, stacked vertically) — `MenuBar.tsx:1228`. Disabled at history bounds.
5. **Split editor toggle**.
6. **Close all panels** (X).
7. **Grab handle** (`PodGrabHandle` at `MenuBar.tsx:378`) — drag to reposition the whole pod.
8. **Rotation knob** — click to toggle horizontal ↔ vertical.

## Action buttons (the "action toolbar")

`ActionButtonsRow` renders 8 color-coded buttons. Each uses `ActionButton` (`MenuBar.tsx:417`) which resolves the nearest `[data-action-pod]` ancestor so its popup can be positioned below the toolbar regardless of whether it's attached or detached.

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

`DetachedActionsToolbar` at `MenuBar.tsx:592`. Free-floating pod, separate from MenuBar, appears when user tears the attached actions popover off by its grab bar.

State in EditorLayout: `actionsDetached`, `actionsPos`.

Modes:
- **Expanded**: full `ActionButtonsRow` + re-dock (X) + grab bar.
- **Collapsed**: just the star icon + grab bar.
- **Orientation**: horizontal or vertical; rotation knob on the tab sticking out from a corner. When rotated, the knob's corner stays put so the pivot is predictable.

## Formatting popup

Not a dedicated component — `AttachedPopover` anchored to the A-glyph button in `MenuBar.tsx:1097`. Flips above/left when near viewport edges. Escape or outside-click closes.

## Shared popover primitive

`AttachedPopover` at `MenuBar.tsx:258`. Props: `anchor`, `children: (close) => ReactNode`, `title`, `active`, `forceOpen`, optional `onGrabStart` (adds a grab handle on the right for tear-off).

Behavior: click anchor toggles; fixed-positioned below-right by default; flips as needed; Escape + outside-click close.

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
