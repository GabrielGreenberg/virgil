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

## Navigation Controls

### Prev/Next Chevrons
When a counter (e.g. "3 of 12") has up/down navigation arrows, the two
chevrons are **stacked vertically** beside the number — not laid out
horizontally. Use a `flex flex-col` wrapper with `-space-y-0.5` to keep
them compact.

```tsx
<div className="flex items-center gap-1">
  <span className="text-xs tabular-nums">{counterText}</span>
  <div className="flex flex-col -space-y-0.5">
    <button>▲</button>
    <button>▼</button>
  </div>
</div>
```

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

---

## Panel Cards

- Cards use the shared `panelCard()` helper for consistent
  selected/hover states.
- Header rows should be **single-row** layouts (e.g. footnote cards:
  number badge + toolbar + menu all in one row, not stacked).

---

## Colors & Tokens

| Token | Usage |
|-------|-------|
| `var(--accent)` | Primary accent (default: warm brown `#b45757`) |
| `var(--accent-light)` | Light accent background |
| `var(--muted)` | De-emphasized text |
| `var(--border)` | Standard borders |
| `var(--border-light)` | Subtle/inner borders |
| `var(--background)` | Panel/card backgrounds |
