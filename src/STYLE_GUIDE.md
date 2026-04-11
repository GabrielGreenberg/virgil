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

## Panel Cards

- Cards use `panelCard(isSelected)` for consistent selected/hover states.
- **Default**: `bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/50`
- **Selected**: `bg-amber-50/60 border-amber-300 shadow-sm`
- Card content goes inside `PANEL.cardInner` (`px-4 py-3 relative min-w-0`).
- Header rows should be **single-row** layouts (e.g. footnote cards:
  number badge + toolbar + menu all in one row, not stacked).
- Cards in `PANEL.list` are spaced with `space-y-2` (no `border-b` dividers).

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
- AI button: `hover:bg-amber-50/50 hover:text-amber-700`
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

## Three-Dot Menus (ItemMenu)

Every card that supports delete/actions uses `ItemMenu`:
- Button: vertical three dots, `p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100`
- Dropdown: fixed-positioned `bg-white border rounded-md shadow-lg`
- Standard delete item: `MenuDelete` (text-red-500, hover:bg-red-50)
- Menu closes on outside click

---

## Target Icon (Jump to Text)

Shown on **selected cards only** — clicking jumps the editor to the
element's document anchor. The icon is a small bullseye (two concentric
circles). It stops propagation so the parent card doesn't re-select.

Placement: top-right corner of the card, alongside the three-dot menu.

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
- `AiRequestCard` — amber-tinted draggable card with star icon

AI request cards appear at the top of the list, before the panel's own items.

---

## Drag & Drop

Draggable items use custom ghost images matching their category color:
- **Footnotes**: `#fef2f2` bg, `#b45757` border (red)
- **Notes**: emerald tones
- **Citations**: amber/yellow tones
- **Archive**: `#f5f5f4` bg, `#d6d3d1` border (stone)
- **AI requests**: `#fef3c7` bg, `#fcd34d` border (amber)

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
Selected cards across all panels use the same amber treatment:
`bg-amber-50/60 border-amber-300 shadow-sm`

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
