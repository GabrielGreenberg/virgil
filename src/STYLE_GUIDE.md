# Virgil Style Guide

App-wide UI conventions and component patterns. Check this before building
new UI and update it whenever a decision feels generalizable.

---

## Icons

### AI Star
The AI/request icon is an **8-ray sun-star** (four cardinal lines + four
diagonal lines, rotated 15 degrees). Never use a traditional 5-point star
for AI-related actions.

```tsx
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
  <g transform="rotate(15 12 12)">
    <line x1="12" y1="2" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
  </g>
</svg>
```

---

## Panel Architecture

### Container Pattern
Every panel renders inside a flex column that fills its allocated space:
```tsx
<div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
  <PanelHeader ... />
  <div className={PANEL.list}> ... </div>
</div>
```
Always use `bg-transparent` on the outer wrapper — the pod/canvas system
controls panel background. Never set `bg-[var(--background)]` on a panel
container (it bleeds through on split views).

### Shared Primitives (`panel-primitives.tsx`)
All panels import from this file. It exports:
- `panelCard(selected, extra?)` — card className builder
- `PANEL` — class-string tokens (`.list`, `.cardInner`, `.subpod`, etc.)
- `PanelHeader` — standard header bar
- `ItemMenu` + `MenuDelete` — three-dot context menu
- `TargetIcon` — jump-to-text bullseye
- `Chevron` — expand/collapse arrow
- `PrevNextCounter` + `useCycle` — prev/next navigation
- `AiRequestCard` + `AiRequestsSectionHeader` — AI request integration
- `HSplit` — horizontal draggable split divider

---

## EditableCard

`EditableCard` is the canonical card component for all panels with editable
rich-text content (footnotes, notes, archive). All formatting is centralized
here — panels pass content-specific data, not styling.

### Layout
```
[grab handle] [badge] [title input] ... [x delete] [target icon]
──────────────── separator ────────────────────────────────────
[RichTextField body]                                    
[optional footer]
```

### Opt-in features (props)
| Prop | Effect |
|------|--------|
| `grabHandle` | 6-dot grip as first header element; only the grip is draggable |
| `hideToolbar` | Suppresses the inline B/I/U toolbar (keyboard shortcuts still work) |
| `inlineDelete` | [x] button in header instead of three-dot menu |
| `orphaned` | Adds `border-dashed` to card wrapper for unanchored items |
| `onEditorFocus` | Routes the focused Tiptap editor to MenuBar for toolbar integration |

### Selection states
- **Every card has a persistent header strip** with its theme's default tint (`theme.headerDefault`) — it is always visible, whether or not the card is selected. This is a stylistic rule: selection intensifies the header, it does not introduce it.
- **Selected**: colored border around whole card, intensified header (`theme.headerSelected`), white body.
- **Default**: `bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/50`, plus the always-on `theme.headerDefault` tint on the header row.
- Separator: `border-stone-200`, darkens to `border-stone-300` on hover; selected cards use `theme.separatorSelected`.
- Clicking anywhere in the card (header, title, body) auto-selects via `onFocusCapture`.
- Clicking empty panel space deselects (panels add `onClick={() => onSelect(null)}` to list container).

### Shared sub-components (`panel-primitives.tsx`)
| Component | Usage |
|-----------|-------|
| `BadgeLabel` | Anchored badge with label (number/letter), themed colors |
| `BadgeOrphaned` | Unanchored badge: local-color square with corner-to-corner cross, 60% opacity |
| `CardTitleInput` | Par-title styled input (`--par-title-color`, `0.78rem`, weight 500, sans-serif) |
| `CardTargetIcon` | Page-with-arrow icon: full opacity when selected, 60% when unselected, 30% when disabled |

### Unanchored (orphaned) cards
When an item has no paragraph anchor (`paragraphIds` is empty), use this
three-part pattern — all centralized via EditableCard and shared primitives:
1. **`orphaned` prop on EditableCard** — adds `border-dashed` to the wrapper
2. **`BadgeOrphaned` as the badge** — the panel passes this instead of `BadgeLabel`
3. **`CardTargetIcon` with `disabled`** — greyed-out, non-clickable jump icon

Panels detect orphaned state from their data (`paragraphIds.length === 0`)
and pass the appropriate props. TodoRow (which doesn't use EditableCard)
applies `border-dashed` directly and swaps `BadgeLabel`/`BadgeOrphaned`.

### Card themes (`CARD_THEMES`)
Each theme provides: `cardClass`, `headerDefault`, `headerSelected`,
`separatorSelected`, `badgeBg`, `badgeColor`, `badgeBorder`, `titleColor`.
Panels reference themes, never hardcode colors.

Available themes:
- `footnote` — reddish
- `note` — emerald
- `archive` — amber/blue-grey
- `todo` — stone/grey
- `bib` — warm tan (bibliography entries)
- `citation` — warmer yellow (in-text citations)
- `comment` — neutral stone (revisions/comments)
- `aiRequest` — sky (AI request drafts)

`headerDefault` is roughly half the opacity of `headerSelected` so that
selection intensifies the header rather than introducing it.

### Delete behavior
- [x] button and Delete/Backspace key both go through `tryDelete()`
- If the card body has text content → shows `ConfirmDialog`
- If empty → deletes immediately
- The `ConfirmDialog` positions near the card (via `anchorRef`), not dead-center screen

### Drag behavior
- **Card handle** (6-dot grip in header): Drags the card entity (footnote atom, margin note anchor, etc.). Uses the whole card as the drag ghost (`setDragImage`), offset below cursor.
- **Text handle** (3-line icon in body gutter): Drags only the text content for inline insertion — no anchoring, no entity identity. Uses a neutral ghost (white bg, gray border). Appears on hover (`opacity-0 group-hover:opacity-60`).
- Both handles are disabled while RichTextField is focused
- Handle darkens on card hover (`group-hover:text-stone-500`)

### Sub-pods
Expandable sections within cards use sub-pod containers:
- **Muted bg** (notes, textareas): `PANEL.subpod` — `rounded-md border border-stone-200 bg-stone-50/70 p-3`
- **White bg** (rich text editors): `PANEL.subpodWhite` — `rounded-md border border-stone-200 bg-white`

---

## Panel Headers

All panels use `PanelHeader` for their title bar. The header has a fixed
height (`--header-h: 34px`) and background (`--header-bg: #e8e5de`).

```tsx
<PanelHeader title="Footnotes" count={3} onAdd={handleAdd} onAiRequest={handleAi}>
  <PrevNextCounter current={idx} total={total} label="" />
  <ViewToggle mode={viewMode} onChange={setViewMode} />
</PanelHeader>
```

Children (counters, toggles, extra buttons) are right-aligned via flex spacer.

---

## Top Bar

The top bar uses `--topbar-bg` (`#e5e4e1`), a warm-neutral shade close to
panel headers (`#e8e5de`) but slightly cooler (red-blue spread 4 vs 10).

### Background & Border
- Container: `bg-[var(--topbar-bg)]`
- Bottom border: hardcoded `#d5d3ce` in `.top-bar-border::after`

### Default Icon/Text
All non-logo elements use `text-stone-500` (not `var(--muted)`) for
sufficient contrast on the darker background.

### Hover Convention
Buttons **lighten** on hover (opposite of white-background panels):
- Generic buttons: `hover:bg-white/30 hover:text-[var(--accent)]`
- AI button: `hover:bg-sky-50/50 hover:text-sky-600`
- Never use `hover:bg-stone-100` (darkening) on the top bar

### Active Tab
Active tabs retain `bg-[var(--background)]` — the lighter surface pops
against the darker bar.

---

## Navigation Controls

### Prev/Next Chevrons
When a counter (e.g. "3 of 12") has up/down navigation arrows, the two
chevrons are **stacked vertically** beside the number — not laid out
horizontally. Use a `flex flex-col` wrapper with `-space-y-0.5` to keep
them compact.

### PrevNextCounter + useCycle
Most panels with ordered items use `useCycle` for keyboard ↑/↓ navigation
and `PrevNextCounter` in the header to show position. The counter shows:
- `"0 items"` when empty
- `"N items"` when nothing is focused
- `"i+1 of N"` when navigating

---

## Confirmation Dialogs

`ConfirmDialog` positions near the element being acted on, not dead-center
screen. Pass `anchorRef` to position the dialog just below the triggering
element. Without `anchorRef`, it falls back to centered (legacy behavior).

```tsx
<ConfirmDialog
  open={confirmOpen}
  message="This item has text. Delete it?"
  confirmLabel="Delete"
  tone="danger"
  anchorRef={cardRef}    // positions near the card
  onConfirm={...}
  onCancel={...}
/>
```

---

## Target Icon (Jump to Text)

The target icon is a small page with an arrow pointing into it (18x18).
Always visible on cards at varying opacity:
- **Selected**: full opacity
- **Unselected**: 60% opacity
- **Disabled** (unanchored): 30% opacity

Use `CardTargetIcon` from panel-primitives for consistent behavior.
Placement: rightmost element in the card header row.

---

## View Modes (List / In-Text)

Panels with anchored items support two view modes via `ViewToggle`:
- **List**: Standard `PANEL.list` scrollable stack with `space-y-2` gaps.
- **In-text**: Cards absolutely positioned to align with editor scroll height.
  Uses `useInTextPositions` hook and `in-text-connector` CSS classes.

Toggle button: pill with two icons, active button gets `bg-white shadow-sm`.

---

## Buttons

### Primary Action
Accent-colored background for main submit/add actions:
```
bg-[var(--accent)] text-white hover:opacity-90
```

### Secondary Action
Neutral stone for less prominent actions (Insert, Copy, Archive):
```
text-stone-500 bg-stone-100 hover:bg-stone-200 hover:text-stone-700 border border-stone-200
```

### Warm Accent Action
For actions that are prominent but not primary (Restore, etc.):
```
text-[var(--accent)] bg-[var(--accent-light)] hover:brightness-95 border border-stone-200
```
Never use `bg-blue-50` or other cool tones for action buttons — the app's
palette is warm (browns, ambers, stones).

### Danger Action
Delete/destructive actions in menus:
```
text-red-500 hover:bg-red-50
```

### Resolve/Confirm
Positive confirmation actions:
```
text-emerald-600 hover:text-emerald-700 font-medium
```

---

## Section Labels

Thin uppercase labels that divide card groups within a panel list:
```
text-[10px] font-medium text-stone-500 uppercase tracking-wide px-2 mb-1.5
```
With a top border when separating sections:
```
mt-2 pt-2 border-t border-stone-200
```

---

## Empty States

Use `PANEL.empty` for consistent empty-state messaging:
```
p-6 text-center text-sm text-[var(--muted)]
```

---

## AI Request Integration

Panels that support AI-assisted content creation include:
- `AiRequestsSectionHeader` — thin uppercase label with count
- `AiRequestCard` — sky-blue-tinted draggable card with star icon

AI request cards appear at the top of the list, before the panel's own items.

---

## Drag & Drop

Draggable items use custom ghost images matching their category color:
- **Footnotes**: `#fef2f2` bg, `#b45757` border (red)
- **Notes**: emerald tones
- **Citations**: amber/yellow tones
- **Archive**: `#f5f5f4` bg, `#d6d3d1` border (stone)
- **AI requests**: `#e0f2fe` bg, `#7dd3fc` border (sky blue)

Ghost elements are appended to body, positioned offscreen, and removed
after `requestAnimationFrame`.

---

## Colors & Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `var(--accent)` | `#7c5e3c` | Primary accent (warm brown) |
| `var(--accent-light)` | `#f5f0ea` | Light accent background |
| `var(--muted)` | `#8a8580` | De-emphasized text |
| `var(--muted-light)` | `#b5b0aa` | Very subtle text (timestamps, hints) |
| `var(--border)` | `#e5e2dd` | Standard borders |
| `var(--border-light)` | `#efecea` | Subtle/inner borders |
| `var(--background)` | `#faf9f7` | Canvas background |
| `var(--header-bg)` | `#e8e5de` | Panel header background |
| `var(--topbar-bg)` | `#e5e4e1` | Top bar background (cooler than header) |
| `var(--header-h)` | `34px` | Panel header height |

### Category Colors (badges, markers)
| Category | Primary | Background | Border |
|----------|---------|------------|--------|
| Footnotes | `#b45757` | `#fef2f2` | `#b45757` |
| Notes | `#15803d` | `#f0fdf4` | `#86efac` |
| Citations | `#6b6245` | `#fdf8e1` | `#e0d5a8` |
| LaTeX comments | `#7191b0` | `#f0f5fa` | `#a8c4de` |
| Archive | `#7191b0` | `#f0f5fa` | `#a8c1d8` |

### Selection
Selected cards have a colored border + shadow with tinted header, white body:
- **Footnotes**: `border-red-300`, header `bg-red-50/60`
- **Notes**: `border-emerald-300`, header `bg-emerald-50/60`
- **Archive**: `border-amber-300`, header `bg-amber-50/60`
Body text always stays full dark (`#44403c`), never white-on-colored.

---

## Margin Elements (Marginalia)

- **Grid**: 2 columns per gutter side (`MARGINALIA_COLS = 2`).
- **Icon size**: 22px squares with 2px row gap.
- Markers are **draggable** (cursor: grab) and support keyboard delete.
- Quotes and notes support **multi-anchor** (same item linked to
  multiple paragraphs).
- Drag indicator: **vertical line** on the gutter side spanning the
  full paragraph height. Horizontal ProseMirror drop cursor is hidden
  during paragraph-linking drags.
