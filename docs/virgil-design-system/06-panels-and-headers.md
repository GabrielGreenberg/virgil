<!-- historical-record: docs/virgil-design-system -->
> **Historical — not the spec.** Part of the frozen April-2026 design-system
> migration record. The live style spec is
> [`src/STYLE_GUIDE.md`](../../src/STYLE_GUIDE.md); where this file and the code
> disagree, the code is right and this file is history. Start at
> [README.md](README.md).

# 06 — Panels & Headers

A *panel* is a sidebar surface that hosts a list of cards (footnotes,
notes, archive, etc.) or a dedicated tool (outline, errors, AI). Panels
share chrome.

## Anatomy

```
┌──────────────────────────────────────────────┐  ← pod (radius 8, border-light, shadow-light)
│ [≡] [swatch] Footnotes  3   [+] [★] [⋯] [⌃] │  ← header (height 34, bg --header-bg)
├──────────────────────────────────────────────┤  ← divider (edge-subtle)
│                                              │
│   ┌────────────────────────────────────┐     │
│   │  card                              │     │
│   └────────────────────────────────────┘     │
│   ┌────────────────────────────────────┐     │
│   │  card                              │     │
│   └────────────────────────────────────┘     │
│   ...                                        │
│                                              │
└──────────────────────────────────────────────┘
```

## The header is locked

`--header-h: 26px`. Don't override per-panel. Don't add a second row.
Don't expand on hover.

## Header slots

Left → right:

| Slot | Required | What goes here |
|---|---|---|
| `headerLeading` | no | three-dot menu (`ItemMenu`), or color swatch + view-toggle for themed panels |
| Title + count | yes | panel name + count badge |
| `headerTitleAfter` | no | small inline tool (e.g. search input, prev/next counter) |
| `onAdd` button | conditional | `+` icon, only if the panel is creatable |
| `onAiRequest` button | conditional | sky `★` icon, only if AI can populate this panel |
| `headerExtras` | no | other actions (e.g. the bibliography "import" button) |
| Popout chevron | yes | always last, top-right, dock/undock |

**Slot order is fixed.** If a panel has no `+`, the `★` shifts left to
fill — but the *order* of slots that exist is unchanged.

## Title + count

```
Footnotes  3
```

Title is `--ink-body`, weight 600, `--panel-header-size` (14px). Count
is muted (`text-ink-muted`), tabular-nums, weight 400, no badge box.

If count is zero, show no count (don't show "0").

## Panel header background

`--header-bg: #e8e5de`. Hover affordances inside the header use
`hover-on-dark` (the header is one of the few places where the resting
bg is darker than the page).

## Panel pod styling

```css
background: var(--pod-panel);
border: var(--pod-border);
border-radius: var(--pod-radius);
box-shadow: var(--pod-shadow-light);   /* never existed — see below */
```

> ⚠️ **Don't copy that last line.** `--pod-shadow-light` was proposed in the
> (now removed) `patches/globals.css.patch.md` and never landed, so
> `var(--pod-shadow-light)` with no fallback resolves to **nothing** — a
> silent no-op shadow. The shipped scale is `--pod-shadow` /
> `--card-shadow-ambient` / none. See `03-spacing-and-icons.md`.

Don't add a backdrop blur, glow, or gradient.

## Panel body

Direct child of the panel pod is a scrollable list. List uses
`space-y-2` between cards. No `border-b` dividers between cards — the
whitespace + card border is the divider.

Empty state lives at the top of the list area. See section "Empty
states" below.

## Panel kinds

Three flavors:

### `<CardListPanel>`
Vertical list of homogeneous cards (footnotes, notes, archive, etc.).
The default. Most panels are this.

### `<ToolPanel>`
A dedicated tool with its own internal layout (outline, errors, AI
request panel). Header is the same; body is bespoke.

### `<MarginaliaPanel>` (special)
The marginalia gutter is technically a panel, but it has no header — it
overlays the editor. See `09-editor-and-marginalia.md`.

## Floating popped-out cards

A card popped out of its panel renders through the unified `Floatable`
window stack — `FloatHost` → `FloatWindow` → `FloatChrome` → a
`FloatingPanel` portal sized from `useViewPrefs.cardFloatPositions`.
The card body is unchanged inside; the float wraps it in the shared
window chrome (kind-tinted header strip, white card surface).

Popped cards stay alive when the host panel is closed. The dispatcher
is `FloatHost`, mounted in `EditorPane`, iterating the popped keys
(`float:card:<kind>:<id>`).

## Empty states

Every panel has a designed empty state. Format:

```
┌──────────────────────────────────────────────┐
│                                              │
│              [icon, faint]                   │
│                                              │
│              Title sentence.                 │
│              One sentence describing what    │
│              goes here and how to add one.   │
│                                              │
│              [optional: example card]        │
│                                              │
└──────────────────────────────────────────────┘
```

- Icon is the panel's marginalia gutter icon, sized 32px, in
  `text-ink-faint`.
- Title sentence is `text-ink-body`, 13px, weight 500.
- Description is `text-ink-subtle`, 12px, weight 400, max-width ~30ch.
- The example card (if shown) is rendered with the panel theme but at
  60% opacity, with a real-looking-but-fake body.

The current empty state ("No items yet" or similar) is not enough. Each
panel teaches itself.

## The panel strip

The vertical column of panel toggles (left edge of the screen) is
governed by `<PanelStrip>`. Each toggle is a 32×32 icon button.

- Toggle ON: dark fill (`var(--pod-dark)` 80%), `text-ink-strong`.
- Toggle OFF: transparent, `text-ink-muted`, hover `hover-on-dark`.
- Active panel (the one currently focused by a card click): adds a
  2px-wide accent stripe (`var(--accent)`) on the leading edge.

## Forbidden in panel chrome

- Multi-row headers.
- Per-panel header backgrounds (e.g. coloring the Notes header green).
  The accent goes on the *cards*, not the panel chrome.
- `bg-blue-50` / `bg-emerald-50` etc. anywhere in panel chrome.
- Different header heights.
- Headers without a count when items exist.
