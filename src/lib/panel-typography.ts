/**
 * Panel body-text typography registry.
 *
 * Parallel to `panel-theme.ts` (colors) but for the BODY TEXT rendered
 * inside each panel's cards — font family, size, and color.
 *
 * Registered panels: footnote, note, archive, cut, revision, citation,
 * bib, todo, example. Some flow through RichTextField; others
 * apply the override inline on a bespoke body element.
 *
 * The default rows are DERIVED from `CardMeta.bodyClass` (A9 §C2) — see
 * `DEFAULT_PANEL_TYPOGRAPHY` below. The registry import is a runtime LEAF
 * (card-registry imports only types), so no cycle.
 */
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";

export type PanelBodyKey =
  | "footnote"
  | "note"
  | "archive"
  | "cut"
  | "revision"
  | "citation"
  | "bib"
  | "todo"
  | "report"
  | "example";

export interface PanelTypography {
  fontFamily: string;
  fontSize: number;  // px
  color: string;     // hex
}

/** The two visual tiers (A9 §N2 / C2). The default rows of
 *  `DEFAULT_PANEL_TYPOGRAPHY` are now DERIVED from each panel's primary card
 *  kind's `CardMeta.bodyClass`, not hand-kept — so the declared appearance
 *  class and the rendered default can never drift.
 *  - `"borrowed"` → 15px Source Serif 4: the apparatus kinds that quote
 *    document prose (footnotes, archive, examples). Same family as main text
 *    (17px) but one size down for visual hierarchy.
 *  - `"sans"` → 12px Inter (compact): everyone else (notes, todos, revisions,
 *    cuts, citations, bib, reports). Modeled on Cut Comments. */
export const BODY_CLASS_TYPOGRAPHY: Record<"borrowed" | "sans", PanelTypography> = {
  borrowed: { fontFamily: "Source Serif 4", fontSize: 15, color: "#44403c" },
  sans:     { fontFamily: "Inter",          fontSize: 12, color: "#44403c" },
};

/** Real, loaded font stacks for the family names this registry (and the
 *  per-panel font picker) traffics in.
 *
 *  Bare family names must NEVER ship as inline `font-family`: next/font loads
 *  the actual faces only behind CSS variables (`--font-sans` / `--font-serif`
 *  / `--font-mono`, plus the user-pref `--font-*-override` vars), so a bare
 *  name like `Inter` or `Source Serif 4` matches no installed face and the
 *  browser silently falls back to the UA default (Times New Roman).
 *
 *  Two entry shapes:
 *  - The registry defaults (`Inter`, `Source Serif 4`) resolve VAR-FIRST so
 *    they track the document's effective sans/serif faces (including user
 *    override prefs).
 *  - Explicit picker picks of Google-pool-loaded fonts put the quoted literal
 *    FIRST so an explicit choice is honored, not hijacked by override vars,
 *    with a real generic fallback after.
 */
export const FONT_STACKS: Record<string, string> = {
  // Registry defaults — var-first (track the doc's effective faces).
  "Inter":           "var(--font-sans-override, var(--font-sans)), Inter, system-ui, sans-serif",
  "Source Serif 4":  'var(--font-serif-override, var(--font-serif)), "Source Serif 4", Georgia, serif',
  // Not in the Google-fonts pool <link> — route to something real.
  "Playfair Display": '"Playfair Display", var(--font-serif-override, var(--font-serif)), Georgia, serif',
  // Loaded by the Google-fonts pool — literal first, generic fallback after.
  "Libre Baskerville": '"Libre Baskerville", Georgia, serif',
  "Lora":              "Lora, Georgia, serif",
  "Merriweather":      "Merriweather, Georgia, serif",
  "EB Garamond":       '"EB Garamond", Georgia, serif',
  "Crimson Text":      '"Crimson Text", Georgia, serif',
  "Open Sans":         '"Open Sans", system-ui, sans-serif',
  "Lato":              "Lato, system-ui, sans-serif",
  "Roboto":            "Roboto, system-ui, sans-serif",
  "IBM Plex Sans":     '"IBM Plex Sans", system-ui, sans-serif',
  "Source Sans 3":     '"Source Sans 3", system-ui, sans-serif',
  // Locally available faces — quoted literal + generic fallback.
  "Georgia":           "Georgia, serif",
  "system-ui":         "system-ui, sans-serif",
  "Helvetica Neue":    '"Helvetica Neue", system-ui, sans-serif',
};

/** Quote space-containing family names (browsers drop unquoted multi-word
 *  values set programmatically via inline style). */
function quoteFamily(name: string): string {
  return /\s/.test(name) && !/^["']/.test(name) ? `"${name}"` : name;
}

/** Total resolver: family name → a real font stack. Known names get their
 *  curated `FONT_STACKS` entry; unknown names get the quoted literal plus a
 *  heuristic generic fallback so nothing ever dead-ends in the UA default. */
export function resolveFontStack(name: string): string {
  const known = FONT_STACKS[name];
  if (known) return known;
  const lower = name.toLowerCase();
  let generic = "sans-serif";
  if (/serif|garamond|playfair|lora|crimson/.test(lower)) generic = "serif";
  if (/mono|code/.test(lower)) generic = "monospace";
  return `${quoteFamily(name)}, ${generic}`;
}

/** The card kind whose `bodyClass` defines each panel-body row. The single
 *  representative kind per panel (the panel's primary content kind); morph
 *  pairs share a `bodyClass`, so either sibling would yield the same row. A
 *  dev assertion (`assertPanelTypographyCoverage`, card-registry-side) checks
 *  every kind sharing a panel agrees on its class. */
const PANEL_BODY_PRIMARY_KIND: Record<PanelBodyKey, CardKind> = {
  footnote: "footnote",
  note:     "note",
  archive:  "archive",
  cut:      "cutter-comment",
  revision: "revision-comment",
  citation: "citation",
  bib:      "bib",
  todo:     "todo",
  report:   "report",
  example:  "example",
};

/** Defaults are the source of truth for each panel's body typography.
 *  `usePanelBodyStyle` returns the effective (default ⊕ override) value,
 *  which RichTextField and the bespoke card textareas write inline onto
 *  their root elements. That inline style overrides the generic
 *  `.tiptap p { font-size: 1.05rem }` rule in globals.css whenever a
 *  panelKey is set, so the rendered size matches the registry value
 *  step-for-step and the per-panel size stepper stays monotonic.
 *
 *  DERIVED from `CardMeta.bodyClass` (A9 C2): a panel's default row is the
 *  typography for its primary kind's class. This fixes the example row
 *  (12 → 15px serif: it's a `"borrowed"` kind) and pins report to sans. */
export const DEFAULT_PANEL_TYPOGRAPHY: Record<PanelBodyKey, PanelTypography> =
  Object.fromEntries(
    (Object.keys(PANEL_BODY_PRIMARY_KIND) as PanelBodyKey[]).map((key) => [
      key,
      BODY_CLASS_TYPOGRAPHY[CARD_REGISTRY[PANEL_BODY_PRIMARY_KIND[key]].bodyClass],
    ]),
  ) as Record<PanelBodyKey, PanelTypography>;

/** User-facing labels for the smart-preferences grid. */
export const PANEL_BODY_LABELS: Record<PanelBodyKey, string> = {
  footnote: "Footnotes",
  note:     "Margin notes",
  archive:  "Archive",
  cut:      "Cutter cards",
  revision: "Revisions",
  citation: "Citations",
  bib:      "Bibliography",
  todo:     "To-dos",
  report:   "Reports",
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
