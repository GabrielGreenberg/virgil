# patches/panel-theme.ts.patch.md

Drop-in replacement for `src/lib/panel-theme.ts`. Apply as part of
**Pass 6**.

This patch:

- Extends `DerivedCardPalette` with `headerDefault` and `headerSelected`
  as solid hexes (pre-mixed with white).
- Adds a `themeFromAccent(accent)` factory that returns a complete
  `CardTheme` from just an accent color.
- Removes the override system (user-picked color now *replaces*
  `accent` and re-derives the rest).

The color-utility helpers (`hexToRgb`, `tint`, `atLightness`, etc.)
stay exactly as they are. Only the derived-palette section changes.

---

## Replace the section starting at "Derived palettes"

```ts
/* ── Derived palettes ────────────────────────────────────────────── */

export interface DerivedCardPalette {
  /** Always-on header tint. Solid hex, pre-mixed with white. */
  headerDefault: string;
  /** Intensified header tint when card selected. Solid hex. */
  headerSelected: string;
  /** Separator color (border) when card selected. Solid hex. */
  separatorSelected: string;
  /** Card wrapper border color when selected. Solid hex. */
  borderSelected: string;
  /** Badge fill / text / border. */
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
  /** Card title text color. */
  titleColor: string;
}

export interface DerivedMarkerPalette {
  /** Gutter-icon stroke color. */
  color: string;
  /** Gutter-icon background (unselected). */
  bg: string;
  /** Gutter-icon background (selected / hover). */
  selectedBg: string;
  /** Gutter-icon border. */
  border: string;
}

/** Compose a tinted hex over white at a given alpha — produces a solid hex. */
function blendOverWhite(tintHex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(tintHex);
  const W = 255;
  const mix = (c: number) => Math.round(c * alpha + W * (1 - alpha));
  return rgbToHex(mix(r), mix(g), mix(b));
}

/** Derive the full card palette from a base hex.
 *  Replaces the old rgba-with-alpha header tints with solid hexes,
 *  composed from `tint(base, …)` over white at the matching alpha. */
export function deriveCardPalette(baseHex: string): DerivedCardPalette {
  const headerTintLight = tint(baseHex, 0.85);
  const headerTintStrong = tint(baseHex, 0.82);
  return {
    headerDefault:    blendOverWhite(headerTintLight, 0.35),
    headerSelected:   blendOverWhite(headerTintStrong, 0.7),
    separatorSelected: tint(baseHex, 0.55),
    borderSelected:   atLightness(baseHex, 0.62),
    badgeBg:          tint(baseHex, 0.88),
    badgeBorder:      tint(baseHex, 0.35),
    badgeColor:       readableOnWhite(baseHex),
    titleColor:       readableOnWhite(baseHex),
  };
}

/** Derive the marginalia marker palette from a base hex. */
export function deriveMarkerPalette(baseHex: string): DerivedMarkerPalette {
  return {
    color:      readableOnWhite(baseHex),
    bg:         tint(baseHex, 0.92),
    selectedBg: tint(baseHex, 0.6),
    border:     tint(baseHex, 0.45),
  };
}

/** A complete CardTheme derived from a single accent color. */
export interface CardTheme extends DerivedCardPalette {
  /** Original accent (the only token a theme needs to author). */
  accent: string;
}

/** Build a complete CardTheme from one accent hex. */
export function themeFromAccent(accent: string): CardTheme {
  return { accent, ...deriveCardPalette(accent) };
}

/** A complete MarkerMeta-compatible palette from one accent hex. */
export function markerPaletteFromAccent(accent: string): DerivedMarkerPalette {
  return deriveMarkerPalette(accent);
}
```

## Update consumers in `panel-primitives.tsx`

### Replace the old `CardTheme` interface and `CARD_THEMES` table

```ts
// Old: nine-field theme rows
export const CARD_THEMES = {
  footnote: { cardClass: footnoteCard, headerDefault: "bg-red-100/60", … },
  …
};

// New: import themeFromAccent, build from DEFAULT_PANEL_COLORS
import { themeFromAccent, DEFAULT_PANEL_COLORS } from "@/lib/panel-theme";

export const CARD_THEMES = {
  footnote:  themeFromAccent(DEFAULT_PANEL_COLORS.footnote),
  note:      themeFromAccent(DEFAULT_PANEL_COLORS.note),
  archive:   themeFromAccent(DEFAULT_PANEL_COLORS.archive),
  todo:      themeFromAccent(DEFAULT_PANEL_COLORS.todo),
  bib:       themeFromAccent(DEFAULT_PANEL_COLORS.bib),
  citation:  themeFromAccent(DEFAULT_PANEL_COLORS.citation),
  comment:   themeFromAccent(DEFAULT_PANEL_COLORS.revision),
  aiRequest: themeFromAccent("#0ea5e9"),
  cut:       themeFromAccent(DEFAULT_PANEL_COLORS.cut),
  error:     themeFromAccent(DEFAULT_PANEL_COLORS.footnote),  // shares rust
  example:   themeFromAccent(DEFAULT_PANEL_COLORS.example),
} satisfies Record<string, CardTheme>;
```

(Note `aiRequest` uses sky `#0ea5e9` — not in `DEFAULT_PANEL_COLORS`,
which is fine; AI is a system-level theme, not a user-customizable
panel.)

### Replace the four themed card-class helpers

```ts
// Delete: footnoteCard, noteCard, todoCard, cutCard, panelCard.
// Add a single helper:

const CARD_BASE = "rounded-lg border transition-colors overflow-hidden";

export function themedCard(
  theme: CardTheme,
  selected: boolean,
  extra?: string,
): string {
  const base = `${CARD_BASE} bg-surface ${selected ? "shadow-sm" : ""}`;
  const borderClass = selected
    ? "" // border color comes from inline style (theme.borderSelected)
    : "border-edge-hover hover:border-edge-strong hover:bg-surface-muted/50";
  return `${base} ${borderClass}${extra ? ` ${extra}` : ""}`;
}
```

The selected border is applied via inline style, since
`theme.borderSelected` is a hex from `deriveCardPalette`:

```tsx
<div
  className={themedCard(theme, selected)}
  style={selected ? { borderColor: theme.borderSelected } : undefined}
>
```

### Header tint via inline style

```tsx
// Old: theme.headerDefault was a Tailwind class like "bg-red-100/60".
<div className={`${theme.headerDefault} px-3 py-2 …`}>

// New: it's a solid hex.
<div
  className="px-3 py-2 …"
  style={{ backgroundColor: selected ? theme.headerSelected : theme.headerDefault }}
>
```

### Delete the `override` machinery

Delete:
- `theme.override` field on `CardTheme`.
- `cardOverrideStyle()` helper.
- `headerOverrideStyle()` helper.
- `separatorOverrideStyle()` helper.

User-picked colors are now applied at the registry level: when a user
picks a color for the `notes` panel, we re-derive the entire
`CARD_THEMES.note` row from that accent. The card-render path doesn't
know it's been overridden — it just reads `theme.headerDefault` etc.

This means the user-picked-color hook (`useCardTheme(panelKey)` in
`src/hooks/usePanelTheme.ts`) needs to call `themeFromAccent(userColor)`
and return that as the theme, instead of returning the static theme +
override pair. See follow-up note in `MIGRATION.md` Pass 6.

## Verify

- `pnpm typecheck` clean.
- Cards render with the same colors as before (the math is identical;
  only the storage format changed).
- User color picker still re-themes panels.
- No remaining references to `override`, `cardOverrideStyle`,
  `headerOverrideStyle`, or `separatorOverrideStyle`.
