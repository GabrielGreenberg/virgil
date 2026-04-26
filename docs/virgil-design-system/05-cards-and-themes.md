# 05 — Cards & Themes

This is the biggest single shape change. Read carefully.

## The new theme shape

A theme has **five tokens.** Not nine.

```ts
export interface CardTheme {
  /** Card border when selected. Solid hex. */
  borderSelected: string;
  /** Always-on header tint. Solid hex (pre-mixed with white). */
  headerDefault: string;
  /** Intensified header tint when card selected. Solid hex. */
  headerSelected: string;
  /** Separator border on selected cards. Solid hex. */
  separatorSelected: string;
  /** Badge + title accent color. Solid hex. */
  accent: string;
}
```

Derived values (badge bg, badge border, etc.) are computed from `accent`
in primitives, not stored per-theme. See `deriveCardPalette()` in
`src/lib/panel-theme.ts`.

## Why the change

The current shape has nine tokens including hardcoded Tailwind classes
mixed with hex literals and four selection-color constants
(`CARD_SELECTED`, `CARD_SELECTED_FOOTNOTE`, `CARD_SELECTED_NOTE`,
`CARD_SELECTED_TODO`, `CARD_SELECTED_CUT`). It can't be themed
dynamically (the user-color-picker has to special-case via inline
style); it can't be added to without editing five places.

The new shape is fully data-driven. To add a new theme, add one row.

## The eleven themes

Grouped into four families. Each family shares a *kind* of color, not a
specific hex.

### Anchored-to-text (warm)

| Theme | accent | role |
|---|---|---|
| `footnote` | `#b45757` rust | inline footnote |
| `citation` | `#d4a843` amber | in-text \cite |
| `bib` | `#b8a968` khaki | bibliography entry |
| `quote` | `#a16207` warm-yellow | quotation |

These are the "this thing lives in the document" themes. Warm,
parchment-adjacent.

### Editorial (cool)

| Theme | accent | role |
|---|---|---|
| `comment` / `revision` | `#9333ea` purple | comments, revisions |
| `aiRequest` | `#0ea5e9` sky | AI request drafts |

Cool, distinct from document-attached items. AI = sky is a brand
commitment; don't change.

### Workflow (neutral)

| Theme | accent | role |
|---|---|---|
| `note` | `#15803d` green | margin note |
| `archive` | `#7191b0` steel-blue | archived snippet |
| `todo` | `#44403c` stone | task |
| `cut` | `#b45757` rust | cutter piece |

Workflow items have lower visual urgency than editorial ones. They sit
in the gutter and wait.

### Errors

| Theme | accent | role |
|---|---|---|
| `error` | `#b45757` rust | LaTeX / parse error |
| `example` | `#0d9488` teal | placeholder docs (rare) |

Note that `cut`, `footnote`, and `error` all use `#b45757` rust as their
accent. That's fine — they're never adjacent in the same surface, and
the gutter icon distinguishes them. Don't try to give each one a unique
hex; you'll run out of warm reds.

## Pre-mix the tints

Header `headerDefault` and `headerSelected` used to be Tailwind classes
with opacity hacks (`bg-red-100/60`, `bg-[#fef3c3]/40`). They are now
**solid hex values**, pre-mixed with white at the matching opacity.

| Default opacity | Selected opacity |
|---|---|
| `tint(accent, 0.85)` mixed with white at 0.35 | `tint(accent, 0.82)` mixed with white at 0.7 |

In code, use the `deriveCardPalette(accentHex)` helper. It returns
`headerBg`, `headerBgSelected`, `separatorColor`, `selectedBorder`,
`badgeBg`, `badgeBorder`, `badgeColor`, `titleColor`. Themes store only
the `accent`; everything else is derived.

## The card frame

Every card uses `<PanelCard>` from `panel-primitives.tsx`. The frame is
identical across themes:

```
┌──────────────────────────────────────────────┐  ← border (selectedBorder when selected, else edge-hover)
│ ░░░░░ header strip (headerDefault tint) ░░░░ │  ← always present, intensifies on selection
├──────────────────────────────────────────────┤  ← separator (edge-subtle, or separatorColor when selected)
│                                              │
│   body (RichTextField or whatever)           │
│                                              │
│                              [🗑]            │  ← absolute-positioned trash, hover-reveal
└──────────────────────────────────────────────┘
```

- Border: 1px. Color = `selectedBorder` when selected, else `edge-hover`
  (resting) → `edge-strong` on hover.
- Header: ~28px tall, padded `0.5rem 0.75rem`, contains badge + title +
  optional toolbar + popout chevron.
- Body: padded `0.75rem`. The `RichTextField` mini-editor lives here.
- Trash: absolute, bottom-right, hover-reveal. `text-danger`.
- Popout chevron: absolute, top-right, *always visible*. The pop-out
  affordance must be discoverable.

## Selection

A selected card:

1. **Border** flips to `theme.borderSelected`.
2. **Header** tint flips from `headerDefault` to `headerSelected`.
3. **Separator** flips from `edge-subtle` to `theme.separatorSelected`.
4. **Adds a soft shadow:** `shadow-sm` (the only shadow change in the
   system — selection is the one place where shadow distinguishes
   state).

Selection does **not** change the body background. Body stays
`var(--surface)` always.

## Hover (not selected)

Resting → hover transitions only the border:

```css
border-edge-hover → border-edge-strong
```

The header tint does not deepen on hover. The body does not tint. Only
the border.

This is intentional: hover should be *subtle* on a panel with twenty
cards. A loud hover state on every card creates noise as the cursor
moves.

## Forbidden

- A card without a theme. Every card has a theme. Pick one.
- Tailwind opacity-hack tints (`bg-red-100/60`). Pre-mix.
- `CARD_SELECTED` as a default. Deleted.
- Hand-rolled card chrome. Use `<PanelCard>`.
- `border-amber-300` anywhere except `theme.aiRequest` (which uses sky,
  so really anywhere).

## Adding a new theme

1. Pick an `accent` hex from `PRESET_COLORS` in `panel-theme.ts`.
2. Add a row to `CARD_THEMES`:
   ```ts
   newKind: { accent: "#xxxxxx", borderSelected: …, headerDefault: …, … }
   ```
   Or just `accent`, and let `deriveCardPalette` fill the rest.
3. Add a matching `MARKER_META` row with the same `accent` color.
4. Done. No other files touched.
