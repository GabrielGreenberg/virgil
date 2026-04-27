/**
 * Panel body-text typography registry.
 *
 * Parallel to `panel-theme.ts` (colors) but for the BODY TEXT rendered
 * inside each panel's cards — font family, size, and color.
 *
 * Registered panels: footnote, note, archive, cut, revision, citation,
 * bib, quote, todo, example. Some flow through RichTextField; others
 * apply the override inline on a bespoke body element.
 */

export type PanelBodyKey =
  | "footnote"
  | "note"
  | "archive"
  | "cut"
  | "revision"
  | "citation"
  | "bib"
  | "quote"
  | "todo"
  | "example";

export interface PanelTypography {
  fontFamily: string;
  fontSize: number;  // px
  color: string;     // hex
}

/** Defaults here reproduce the existing visual for each card type so the
 *  per-panel text-size stepper's "default" position (where the override is
 *  cleared) matches what the user actually sees with no override applied.
 *
 *  RichTextField-based panels (footnote, note, archive, cut, revision,
 *  quote) inherit the `.tiptap p { font-size: 1.05rem }` rule from
 *  globals.css, which renders body paragraphs at 16.8px ≈ 17px. Picking
 *  any value smaller than 17 used to look BIGGER than nearby values,
 *  because the slider would clear the override at 14 and the cards would
 *  jump back to 16.8px. Aligning the default with the actual rendered
 *  size keeps the stepper monotonic. */
export const DEFAULT_PANEL_TYPOGRAPHY: Record<PanelBodyKey, PanelTypography> = {
  footnote: { fontFamily: "Source Serif 4", fontSize: 17, color: "#44403c" },
  note:     { fontFamily: "Inter",          fontSize: 17, color: "#44403c" },
  archive:  { fontFamily: "Source Serif 4", fontSize: 17, color: "#44403c" },
  cut:      { fontFamily: "Source Serif 4", fontSize: 17, color: "#44403c" },
  revision: { fontFamily: "Inter",          fontSize: 17, color: "#44403c" },
  citation: { fontFamily: "Inter",          fontSize: 12, color: "#44403c" },
  bib:      { fontFamily: "Inter",          fontSize: 12, color: "#44403c" },
  quote:    { fontFamily: "Source Serif 4", fontSize: 17, color: "#44403c" },
  todo:     { fontFamily: "Inter",          fontSize: 14, color: "#44403c" },
  example:  { fontFamily: "Source Serif 4", fontSize: 12, color: "#44403c" },
};

/** User-facing labels for the smart-preferences grid. */
export const PANEL_BODY_LABELS: Record<PanelBodyKey, string> = {
  footnote: "Footnotes",
  note:     "Margin notes",
  archive:  "Archive",
  cut:      "Cuts",
  revision: "Revisions",
  citation: "Citations",
  bib:      "Bibliography",
  quote:    "Quotations",
  todo:     "To-dos",
  example:  "Examples",
};

/** Font choices — mix of serifs and sans, same pool as the main prefs. */
export const PANEL_BODY_FONT_OPTIONS = [
  "Source Serif 4",
  "Georgia",
  "Playfair Display",
  "Libre Baskerville",
  "Lora",
  "Merriweather",
  "EB Garamond",
  "Crimson Text",
  "Inter",
  "system-ui",
  "Helvetica Neue",
  "Open Sans",
  "Lato",
  "Roboto",
  "IBM Plex Sans",
  "Source Sans 3",
];

/* ── Mutable override registry + subscriptions ───────────────────── */

const STORAGE_KEY = "virgil-panel-typography";

type TypoOverride = Partial<PanelTypography>;
let overrides: Partial<Record<PanelBodyKey, TypoOverride>> = {};
let loaded = false;
const listeners = new Set<() => void>();
let version = 0;

export function getPanelTypographyVersion(): number {
  return version;
}

export function subscribePanelTypography(listener: () => void): () => void {
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

export function loadPanelTypography(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      overrides = {};
      for (const k of Object.keys(parsed) as PanelBodyKey[]) {
        const v = parsed[k];
        if (v && typeof v === "object") {
          const o: TypoOverride = {};
          if (typeof v.fontFamily === "string") o.fontFamily = v.fontFamily;
          if (typeof v.fontSize === "number") o.fontSize = v.fontSize;
          if (typeof v.color === "string" && /^#[0-9a-f]{6}$/i.test(v.color)) {
            o.color = v.color.toLowerCase();
          }
          if (Object.keys(o).length > 0) overrides[k] = o;
        }
      }
      if (Object.keys(overrides).length > 0) notify();
    }
  } catch { /* ignore */ }
}

/** Return the effective typography for `key` (override merged over default). */
export function getPanelTypography(key: PanelBodyKey): PanelTypography {
  const base = DEFAULT_PANEL_TYPOGRAPHY[key];
  const o = overrides[key];
  if (!o) return base;
  return {
    fontFamily: o.fontFamily ?? base.fontFamily,
    fontSize:   o.fontSize   ?? base.fontSize,
    color:      o.color      ?? base.color,
  };
}

/** Return the user-overridden fields for `key`, verbatim. Returns `{}` when
 *  the user has not set any override for this panel — that empty object is
 *  what lets `usePanelBodyStyle` skip applying inline styles and preserve
 *  the panel's default visual (theme-derived colors etc).
 *
 *  Crucially we do NOT filter out fields that happen to equal the registry
 *  default: the per-panel text-size stepper writes explicit values, and
 *  the rendered size must match the slider value step-for-step (the
 *  registry default doesn't always match the underlying CSS default — see
 *  `.tiptap p { font-size: 1.05rem }` in globals.css). */
export function getPanelTypographyOverrides(key: PanelBodyKey): Partial<PanelTypography> {
  const o = overrides[key];
  if (!o) return {};
  const out: Partial<PanelTypography> = {};
  if (o.fontFamily !== undefined) out.fontFamily = o.fontFamily;
  if (o.fontSize   !== undefined) out.fontSize   = o.fontSize;
  if (o.color      !== undefined) out.color      = o.color;
  return out;
}

export function isPanelTypographyFieldOverridden<F extends keyof PanelTypography>(
  key: PanelBodyKey,
  field: F,
): boolean {
  const o = overrides[key];
  if (!o) return false;
  return o[field] !== undefined && o[field] !== DEFAULT_PANEL_TYPOGRAPHY[key][field];
}

export function setPanelTypographyField<F extends keyof PanelTypography>(
  key: PanelBodyKey,
  field: F,
  value: PanelTypography[F],
): void {
  const o: TypoOverride = { ...(overrides[key] ?? {}) };
  o[field] = value;
  overrides[key] = o;
  persist();
  notify();
}

export function clearPanelTypographyField<F extends keyof PanelTypography>(
  key: PanelBodyKey,
  field: F,
): void {
  const o = overrides[key];
  if (!o) return;
  delete o[field];
  if (Object.keys(o).length === 0) delete overrides[key];
  persist();
  notify();
}
