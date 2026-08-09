/**
 * Panel color-theme registry.
 *
 * Each themable panel has a base hex color. The default values reproduce the
 * hand-tuned look of the original Tailwind-based `CARD_THEMES` / `MARKER_META`.
 * When the user overrides a panel's color via the header menu color-picker,
 * the override is stored here and a full palette is derived from the base hex
 * for badges, card headers, marginalia icons, and linked-anchor highlights.
 *
 * Rendering sites subscribe to changes via `usePanelThemeVersion` so that a
 * color change triggers re-renders of every consuming component.
 */

export type PanelThemeKey =
  | "citation"
  | "bib"
  | "footnote"
  | "note"
  | "highlight"
  | "archive"
  | "todo"
  | "cut"
  | "revision"
  | "report"
  | "example"
  // System sub-namespace — non-overridable (see SYSTEM_THEME_KEYS). Folded into
  // the same DEFAULT_PANEL_COLORS path so ai/error accents derive from one
  // source like every other kind, instead of string-literal hexes.
  | "aiRequest"
  | "error";

// Shipped defaults are loaded from a JSON sidecar so the personal-prefs
// promotion pipeline can rewrite them without touching TS source.
import defaultPanelColorsJson from "./panel-theme.defaults.json";
import { subscribeToStorageKey } from "./cross-window-storage";
import {
  hexToRgb,
  rgbToHex,
  inkOn,
  atContrastAgainst,
} from "./color-math";

/** Base hex used to seed each panel's palette by default. */
export const DEFAULT_PANEL_COLORS: Record<PanelThemeKey, string> =
  defaultPanelColorsJson as Record<PanelThemeKey, string>;

/** System accents that are NOT user-customizable. They live in
 *  DEFAULT_PANEL_COLORS so they ride the one accent→palette path like every
 *  other kind, but the color picker skips them and `setPanelColor`/
 *  `loadPanelColors` refuse them — so a user override on another panel can
 *  never re-tint error / AI-request cards (the invariant that used to be
 *  protected by escaping the path with hardcoded literals). */
export const SYSTEM_THEME_KEYS: ReadonlySet<PanelThemeKey> =
  new Set<PanelThemeKey>(["aiRequest", "error"]);

/** Curated palette for the color picker. */
export const PRESET_COLORS: { name: string; hex: string }[] = [
  { name: "Amber",    hex: "#d4a843" },
  { name: "Rust",     hex: "#b45757" },
  { name: "Khaki",    hex: "#b8a968" },
  { name: "Olive",    hex: "#65a30d" },
  { name: "Green",    hex: "#15803d" },
  { name: "Teal",     hex: "#14b8a6" },
  { name: "Sky",      hex: "#0ea5e9" },
  { name: "Blue",     hex: "#3b82f6" },
  { name: "Steel",    hex: "#7191b0" },
  { name: "Indigo",   hex: "#6366f1" },
  { name: "Purple",   hex: "#9333ea" },
  { name: "Pink",     hex: "#ec4899" },
  { name: "Brown",    hex: "#8b6f47" },
  { name: "Stone",    hex: "#78716c" },
];

/* ── Color utilities ─────────────────────────────────────────────── */

/** Mix `hex` with white by `amount` (0..1 = full white). Returns `#rrggbb`. */
function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
  );
}

/* ── The contrast contract (task 176) ────────────────────────────────
 *
 * Everything a theme paints derives from ONE accent hex — the good part of
 * this design, and the reason a single color picker can retint a whole kind.
 * But two of the transforms used to reason in **HSL lightness as a stand-in
 * for perceived contrast**, which is hue-blind: `readableOnWhite` passed any
 * accent under `l < 0.45` through undarkened (teal `#14b8a6` shipped as body
 * text at **2.22:1**) and `borderSelected` sat at the absolute coordinate
 * `atLightness(accent, 0.62)`, so the strength of the same "this card is
 * selected" cue varied from 1.36:1 to 5.62:1 depending only on which hue the
 * picker happened to offer.
 *
 * Both are now **contrast targets measured against the surface the value
 * actually lands on** (`inkOn` / `atContrastAgainst` in `color-math.ts`), which
 * is what the old comments already claimed to do. Hue and saturation are still
 * carried through untouched — the ink is the accent, moved along its own
 * lightness axis only as far as legibility requires.
 *
 * There are deliberately **no per-kind exceptions**. A hand-tuned escape in
 * this file is exactly the thing that drifts silently (the palette is what a
 * user retints, so an exception is only ever right for the shipped hex).
 * `highlight` was the one candidate — its badge ink darkens from `#af7f03` to
 * a deeper amber — and it does not need one: a highlight's *in-text* identity
 * is the band, which paints from the live accent var (task 174), not from this
 * ink. The amber survives where it carries meaning.
 *
 * Pinned by `__tests__/panel-theme-contrast.test.ts` over BOTH color tables,
 * so the next preset cannot be added by eye.
 */

/** WCAG AA for normal-size text. Not a large-text surface: badges are 10px
 *  (`panel-primitives.tsx` BADGE_BASE) and card titles ~12.5px/500
 *  (`TITLE_STYLE`), both under every large-text exemption. */
export const TEXT_CONTRAST_MIN = 4.5;

/** WCAG's non-text floor, used as the selected-card border's TARGET: every
 *  kind's selection cue meets it and exceeds it by as little as the 8-bit
 *  quantization allows, so they all read with the same strength. A floor first
 *  and a target second — `atContrastAgainst` will not round below it. */
export const AFFORDANCE_CONTRAST_TARGET = 3;

/** The page surface a card and its border sit on (`--surface`, globals.css). */
const SURFACE = "#ffffff";

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
  /** Margin-icon stroke color. */
  color: string;
  /** Margin-icon background. The icon's fill is constant across
   *  resting/hover/selected — interaction states are conveyed entirely
   *  by the ring (boxShadow) using `border`. */
  bg: string;
  /** Margin-icon border + interaction-ring color. */
  border: string;
}

/** Compose a tinted hex over white at a given alpha — produces a solid hex. */
function blendOverWhite(tintHex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(tintHex);
  const W = 255;
  const mix = (c: number) => Math.round(c * alpha + W * (1 - alpha));
  return rgbToHex(mix(r), mix(g), mix(b));
}

/** Every field an accent paints that themed TEXT can land on, stated ONCE.
 *
 *  The palette fills read from here and so does the ink's contrast search, so
 *  the two can never name different numbers — re-tuning a tint moves the fill
 *  and the legibility target together, and a field ADDED here automatically
 *  enters the search rather than waiting to be remembered. (Which matters more
 *  than it looks: the whole bug class this file just retired was one quantity
 *  described in two places.) */
function inkSurfaces(baseHex: string) {
  return {
    badgeBg:        tint(baseHex, 0.88),
    headerDefault:  blendOverWhite(tint(baseHex, 0.85), 0.35),
    headerSelected: blendOverWhite(tint(baseHex, 0.82), 0.7),
    markerBg:       tint(baseHex, 0.92),
  };
}

/** THE ink for an accent — one value for badge text, card titles and the
 *  marginalia glyph alike.
 *
 *  One ink rather than three per-surface inks: they are the same identity seen
 *  in three places, and a per-surface search would make the marker glyph read
 *  measurably brighter than the badge text beside it for no reason a user could
 *  name. So the search targets the darkest surface in the set and every lighter
 *  one clears by construction. `SURFACE` joins the list because a themed title
 *  can also sit on the plain white card body. */
export function accentInk(baseHex: string): string {
  return inkOn(
    baseHex,
    [...Object.values(inkSurfaces(baseHex)), SURFACE],
    TEXT_CONTRAST_MIN,
  );
}

/* ── Derivation memo ─────────────────────────────────────────────────
 *
 * A palette is a pure function of one hex, and `useCardTheme` re-derives on
 * every render of every card — so the derivation is memoized by accent. That
 * was merely tidy while the transforms were a dozen arithmetic ops; with a
 * contrast search behind them it is what keeps the search off the render path,
 * and it hands every consumer a STABLE object identity for free (the old
 * fresh-object-per-render defeated any downstream memo comparing by reference).
 *
 * Keys are accent hexes, so the map is naturally small — but a color picker
 * dragged through a gradient can mint hundreds, hence the cap. Values are
 * frozen because they are now shared: a palette is a value, not a scratch
 * object. */
const PALETTE_CACHE_LIMIT = 512;

function memoByAccent<T>(cache: Map<string, T>, accent: string, make: () => T): T {
  const hit = cache.get(accent);
  if (hit !== undefined) return hit;
  if (cache.size >= PALETTE_CACHE_LIMIT) cache.clear();
  const made = make();
  cache.set(accent, made);
  return made;
}

const cardPaletteCache = new Map<string, DerivedCardPalette>();
const markerPaletteCache = new Map<string, DerivedMarkerPalette>();
const themeCache = new Map<string, CardTheme>();

/** Derive the full card palette from a base hex.
 *  Header tints are pre-mixed with white into solid hexes (no rgba),
 *  so they apply cleanly via inline style without compositing surprises
 *  on tinted parents. */
export function deriveCardPalette(baseHex: string): DerivedCardPalette {
  return memoByAccent(cardPaletteCache, baseHex, () =>
    Object.freeze(computeCardPalette(baseHex)));
}

function computeCardPalette(baseHex: string): DerivedCardPalette {
  const { badgeBg, headerDefault, headerSelected } = inkSurfaces(baseHex);
  const badgeBorder = tint(baseHex, 0.35);
  const badgeColor = accentInk(baseHex);
  return {
    headerDefault,
    headerSelected,
    separatorSelected: tint(baseHex, 0.55),
    // A contrast TARGET against the surface the border sits on, not an
    // absolute lightness coordinate — so the selected state reads with the
    // same strength for a near-black accent and a neon one alike.
    borderSelected:   atContrastAgainst(baseHex, SURFACE, AFFORDANCE_CONTRAST_TARGET),
    badgeBg,
    badgeColor,
    badgeBorder,
    titleColor: badgeColor,
  };
}

/** Derive the marginalia marker palette from a base hex. */
export function deriveMarkerPalette(baseHex: string): DerivedMarkerPalette {
  return memoByAccent(markerPaletteCache, baseHex, () => Object.freeze({
    color: accentInk(baseHex),
    bg: inkSurfaces(baseHex).markerBg,
    border: tint(baseHex, 0.45),
  }));
}

/** Alias for `deriveMarkerPalette` to read fluently at MARKER_META call sites. */
export const markerPaletteFromAccent = deriveMarkerPalette;

/** A complete CardTheme — derived from one accent color. */
export interface CardTheme extends DerivedCardPalette {
  /** Original accent (the only token a theme needs to author). */
  accent: string;
}

/** Build a complete CardTheme from one accent hex. */
export function themeFromAccent(accent: string): CardTheme {
  return memoByAccent(themeCache, accent, () =>
    Object.freeze({ accent, ...deriveCardPalette(accent) }));
}

/* ── Mutable override registry + subscriptions ───────────────────── */

const STORAGE_KEY = "virgil-panel-colors";

let overrides: Partial<Record<PanelThemeKey, string>> = {};
let loaded = false;
const listeners = new Set<() => void>();
let version = 0;

/** Snapshot counter — bumps when overrides change; used by useSyncExternalStore. */
export function getPanelColorVersion(): number {
  return version;
}

export function subscribePanelColors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  version++;
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); }
  catch { /* ignore */ }
}

/** Parse + validate the persisted blob into a fresh overrides object.
 *  The ONE validation path: used by the initial hydrate AND by the
 *  cross-window re-hydrate below, so a peer's blob is filtered exactly like a
 *  local one (system accents skipped, non-hex values dropped) rather than
 *  through a second, drifting copy of the rules. Returns `{}` for a missing,
 *  unparseable, or non-object blob. */
function readOverridesFromStorage(): Partial<Record<PanelThemeKey, string>> {
  const next: Partial<Record<PanelThemeKey, string>> = {};
  if (typeof window === "undefined") return next;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return next;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return next;
    for (const k of Object.keys(parsed) as PanelThemeKey[]) {
      if (SYSTEM_THEME_KEYS.has(k)) continue; // never honor a persisted system-accent override
      const v = parsed[k];
      if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) {
        next[k] = v;
      }
    }
  } catch { /* ignore */ }
  return next;
}

/** Load overrides from localStorage. Safe to call multiple times. */
export function loadPanelColors(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  overrides = readOverridesFromStorage();
  if (Object.keys(overrides).length > 0) notify();
}

// Cross-window re-sync (task 177). Without this, a second window's snapshot
// goes permanently stale — `loaded` is a one-shot latch, so it could never
// re-hydrate — and its next full-blob `persist()` silently drops the peer's
// color changes. The `storage` event never fires in the writing window, so
// this is the peer channel only. Unconditional re-read + `notify()`: a peer
// CLEARING an override must propagate too, and every card re-tints for free
// because they all read through `useCardTheme` → `subscribePanelColors`.
subscribeToStorageKey(STORAGE_KEY, () => {
  overrides = readOverridesFromStorage();
  notify();
});

/** Current base hex for a panel (override or default). */
export function getPanelColor(key: PanelThemeKey): string {
  return overrides[key] ?? DEFAULT_PANEL_COLORS[key];
}

/** Whether this panel has a user override (vs. the built-in default). */
export function isPanelColorOverridden(key: PanelThemeKey): boolean {
  return overrides[key] != null && overrides[key] !== DEFAULT_PANEL_COLORS[key];
}

/** Set an override and persist. */
export function setPanelColor(key: PanelThemeKey, hex: string): void {
  if (SYSTEM_THEME_KEYS.has(key)) return; // system accents are non-overridable
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  overrides[key] = hex.toLowerCase();
  persist();
  notify();
}

/** Clear an override (falls back to default) and persist. */
export function clearPanelColor(key: PanelThemeKey): void {
  if (SYSTEM_THEME_KEYS.has(key)) return; // system accents have no override to clear (chokepoint-trio uniform)
  delete overrides[key];
  persist();
  notify();
}
