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
  | "archive"
  | "quote"
  | "todo"
  | "cut"
  | "revision"
  | "example";

/** Base hex used to seed each panel's palette by default. */
export const DEFAULT_PANEL_COLORS: Record<PanelThemeKey, string> = {
  citation: "#d4a843",
  bib:      "#b8a968",
  footnote: "#b45757",
  note:     "#15803d",
  archive:  "#7191b0",
  quote:    "#a16207",
  todo:     "#44403c",
  cut:      "#b45757",
  revision: "#9333ea",
  example:  "#0d9488",
};

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

/** Parse a `#rrggbb` hex to `[r, g, b]` in 0..255. Returns [0,0,0] on error. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const k = (n: number) => {
    const t = (h / 60 + n + 6) % 6;
    if (t < 1) return p + (q - p) * t;
    if (t < 3) return q;
    if (t < 4) return p + (q - p) * (4 - t);
    return p;
  };
  return [k(2) * 255, k(0) * 255, k(4) * 255];
}

/** Mix `hex` with white by `amount` (0..1 = full white). Returns `#rrggbb`. */
function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
  );
}

/** Return `hex` as an `rgba(...)` string with the given alpha (0..1). */
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Return a version of `hex` adjusted toward a target lightness. */
function atLightness(hex: string, targetL: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  const [r2, g2, b2] = hslToRgb(h, s, targetL);
  return rgbToHex(r2, g2, b2);
}

/** Derive a text color from a base that has enough contrast on white. */
function readableOnWhite(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  // Ensure minimum darkness for legibility against near-white backgrounds.
  if (l < 0.45) return hex;
  const [r2, g2, b2] = hslToRgb(h, Math.max(0.3, s), 0.35);
  return rgbToHex(r2, g2, b2);
}

/* ── Derived palettes ────────────────────────────────────────────── */

export interface DerivedCardPalette {
  /** Always-on header tint (inline style). */
  headerBg: string;
  /** Intensified header tint when card selected. */
  headerBgSelected: string;
  /** Separator color (border) when card selected. */
  separatorColor: string;
  /** Card wrapper border color when selected. */
  selectedBorder: string;
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

/** Derive the full card palette from a base hex. */
export function deriveCardPalette(baseHex: string): DerivedCardPalette {
  const badgeBg = tint(baseHex, 0.88);
  const badgeBorder = tint(baseHex, 0.35);
  const badgeColor = readableOnWhite(baseHex);
  return {
    headerBg: rgba(tint(baseHex, 0.85), 0.35),
    headerBgSelected: rgba(tint(baseHex, 0.82), 0.7),
    separatorColor: tint(baseHex, 0.55),
    selectedBorder: atLightness(baseHex, 0.62),
    badgeBg,
    badgeColor,
    badgeBorder,
    titleColor: badgeColor,
  };
}

/** Derive the marginalia marker palette from a base hex. */
export function deriveMarkerPalette(baseHex: string): DerivedMarkerPalette {
  return {
    color: readableOnWhite(baseHex),
    bg: tint(baseHex, 0.92),
    selectedBg: tint(baseHex, 0.6),
    border: tint(baseHex, 0.45),
  };
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

/** Load overrides from localStorage. Safe to call multiple times. */
export function loadPanelColors(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      overrides = {};
      for (const k of Object.keys(parsed) as PanelThemeKey[]) {
        const v = parsed[k];
        if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) {
          overrides[k] = v;
        }
      }
      if (Object.keys(overrides).length > 0) notify();
    }
  } catch { /* ignore */ }
}

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
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  overrides[key] = hex.toLowerCase();
  persist();
  notify();
}

/** Clear an override (falls back to default) and persist. */
export function clearPanelColor(key: PanelThemeKey): void {
  delete overrides[key];
  persist();
  notify();
}
