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
import type { PanelKind } from "@/panels/_shared/types";

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
export const FONT_STACKS: Record<string, string> = Object.freeze({
  // Registry defaults — var-first (track the doc's effective faces).
  "Inter":           "var(--font-sans-override, var(--font-sans)), Inter, system-ui, sans-serif",
  "Source Serif 4":  'var(--font-serif-override, var(--font-serif)), "Source Serif 4", Georgia, serif',
  // Not in the Google-fonts pool <link>; next/font loads it under an
  // obfuscated name behind --font-display, so route through that var.
  "Playfair Display": '"Playfair Display", var(--font-display), var(--font-serif-override, var(--font-serif)), Georgia, serif',
  // Also next/font-only: Cinzel (the logo face) lives behind --font-logo —
  // reachable from the Fonts… dialog's MAIN_TEXT_FONTS pool.
  "Cinzel":           "Cinzel, var(--font-logo), serif",
  // Loaded by the Google-fonts pool <link> (real family names) — literal
  // first so an explicit pick is honored, generic fallback after.
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
});

/** Quote space-containing family names (browsers drop unquoted multi-word
 *  values set programmatically via inline style). */
function quoteFamily(name: string): string {
  return /\s/.test(name) && !/^["']/.test(name) ? `"${name}"` : name;
}

/** Serif-name heuristic for the total-resolver fallback. Covers every
 *  serif/display family reachable from the Fonts… dialog pool
 *  (`MAIN_TEXT_FONTS` in src/lib/preferences-tree.ts) that has no curated
 *  `FONT_STACKS` entry — Lusitana, Cardo, Spectral, Vollkorn, Gentium
 *  Plus, Old Standard TT, Libre Caslon Text, Marcellus, Bodoni Moda,
 *  Cormorant (SC), IM Fell English — plus the generic serif-ish cues. */
const SERIF_NAME_RE =
  /serif|garamond|playfair|lora|crimson|lusitana|cardo|spectral|vollkorn|gentium|old standard|caslon|marcellus|bodoni|cormorant|im fell/;

/** Total resolver: family name → a real font stack. Known names get their
 *  curated `FONT_STACKS` entry; unknown names get the quoted literal plus a
 *  heuristic generic fallback so nothing ever dead-ends in the UA default. */
export function resolveFontStack(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "sans-serif";
  // Own-key lookup: a crafted/corrupted pref like "toString" must not pull a
  // function off the prototype chain.
  if (Object.prototype.hasOwnProperty.call(FONT_STACKS, trimmed)) {
    return FONT_STACKS[trimmed];
  }
  const lower = trimmed.toLowerCase();
  let generic = "sans-serif";
  if (SERIF_NAME_RE.test(lower)) generic = "serif";
  if (/mono|code/.test(lower)) generic = "monospace";
  return `${quoteFamily(trimmed)}, ${generic}`;
}

/** Preview-only stacks for the two var-first registry defaults. Their
 *  `FONT_STACKS` entries resolve OVERRIDE-FIRST (so applied body text tracks
 *  the user's effective sans/serif face), which is wrong for a font-PICKER
 *  preview: previewing "Inter" / "Source Serif 4" should show the *named*
 *  face, not whatever override the user has chosen. Route these two through
 *  the un-overridden next/font vars with the literal name first; the loaded
 *  default IS the named face, so the preview renders it faithfully. */
const PREVIEW_FONT_STACKS: Record<string, string> = Object.freeze({
  "Inter": "Inter, var(--font-sans), system-ui, sans-serif",
  "Source Serif 4": '"Source Serif 4", var(--font-serif), Georgia, serif',
});

/** Like `resolveFontStack`, but for font-picker OPTION PREVIEWS only. Special-
 *  cases the var-first registry defaults so a preview shows the named face
 *  rather than the user's override; everything else falls through to
 *  `resolveFontStack`. NEVER use for applied body style — that stays
 *  override-first via `resolveFontStack`. */
export function resolvePreviewFontStack(name: string): string {
  const trimmed = name.trim();
  if (Object.prototype.hasOwnProperty.call(PREVIEW_FONT_STACKS, trimmed)) {
    return PREVIEW_FONT_STACKS[trimmed];
  }
  return resolveFontStack(trimmed);
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

/** `PanelKind → PanelBodyKey`, DERIVED by inverting `PANEL_BODY_PRIMARY_KIND`
 *  through each primary kind's owning panel (`CARD_REGISTRY[kind].panel`, the
 *  registry SSOT). Panels absent here have no card body text whose size can be
 *  tuned (Outline, Search, WordCount, Errors, Omni). This REPLACES the hand-kept
 *  `KIND_TO_BODY_KEY` in `panel-kind-context` — deriving from the same source as
 *  `DEFAULT_PANEL_TYPOGRAPHY`/`PANEL_BODY_TIER` means adding a body-tunable panel
 *  (a new `PANEL_BODY_PRIMARY_KIND` row) automatically produces its `PanelKind`
 *  entry, so the two can no longer drift (audit-059). The inversion is 1:1 — each
 *  primary kind owns a distinct panel — and `panel-kind-body-key.test.ts` pins
 *  the map + fails loudly if any body key's primary kind loses its owning panel. */
export const PANEL_KIND_TO_BODY_KEY: Partial<Record<PanelKind, PanelBodyKey>> =
  (() => {
    const map: Partial<Record<PanelKind, PanelBodyKey>> = {};
    for (const key of Object.keys(PANEL_BODY_PRIMARY_KIND) as PanelBodyKey[]) {
      const panel = CARD_REGISTRY[PANEL_BODY_PRIMARY_KIND[key]].panel;
      if (panel) map[panel] = key;
    }
    return map;
  })();

/** Each panel-body row's visual TIER (its primary kind's `CardMeta.bodyClass`).
 *  The tier picks which doc-relative base font size a row's *default* tracks
 *  (BUG #30): borrowed → main-text size − 2px, sans → the `panelFontSize`
 *  pref. Derived from the same `bodyClass` source as `DEFAULT_PANEL_TYPOGRAPHY`,
 *  so the two can never disagree about which tier a panel sits in. */
export const PANEL_BODY_TIER: Record<PanelBodyKey, "borrowed" | "sans"> =
  Object.fromEntries(
    (Object.keys(PANEL_BODY_PRIMARY_KIND) as PanelBodyKey[]).map((key) => [
      key,
      CARD_REGISTRY[PANEL_BODY_PRIMARY_KIND[key]].bodyClass,
    ]),
  ) as Record<PanelBodyKey, "borrowed" | "sans">;

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

/** Doc-relative DEFAULT font sizes per tier (BUG #30). EditorLayout pushes the
 *  live document/panel font-size prefs here whenever they change (O(1), only on
 *  a pref edit — never per keystroke), so an un-overridden card body tracks the
 *  main text instead of being frozen at the `BODY_CLASS_TYPOGRAPHY` literal:
 *    - `borrowed` ← round(editorFontSize_rem * 16) − 2  (one size below body)
 *    - `sans`     ← the `panelFontSize` px pref
 *  `undefined` (SSR / before EditorLayout mounts) → fall back to the static
 *  `BODY_CLASS_TYPOGRAPHY` literal. An explicit per-panel size override (a
 *  numeric `fontSize` write from the stepper) always wins over these bases. */
const tierBaseFontSize: Record<"borrowed" | "sans", number | undefined> = {
  borrowed: undefined,
  sans:     undefined,
};

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

/** Push the live doc-relative DEFAULT font sizes for the two tiers (BUG #30).
 *  Called from EditorLayout's prefs-injection effect, gated on the same
 *  `editorPrefs` change as the CSS-var push — so this runs only when a font
 *  pref actually changes, never per keystroke (keystroke sanctity). No-ops (and
 *  skips `notify()`) when neither value moved, so a structurally-null prefs
 *  re-render doesn't churn every card body. */
export function setTierBaseFontSizes(borrowed: number, sans: number): void {
  const b = Number.isFinite(borrowed) ? Math.round(borrowed) : undefined;
  const s = Number.isFinite(sans) ? Math.round(sans) : undefined;
  if (tierBaseFontSize.borrowed === b && tierBaseFontSize.sans === s) return;
  tierBaseFontSize.borrowed = b;
  tierBaseFontSize.sans = s;
  notify();
}

/** The effective DEFAULT typography for `key`: the static `bodyClass` row, but
 *  with `fontSize` swapped for the live doc-relative tier base when one has
 *  been pushed (family/color stay literal). This is what an un-overridden card
 *  body renders at and what the size stepper displays.
 *
 *  Exported so the prefs UIs (SmartPreferences / FontsDialog) compare against
 *  the SAME doc-relative default the body actually renders — so "reset" and
 *  "is at default" track the live doc size rather than the frozen literal
 *  (otherwise dialing a borrowed slider to the old 15px literal would wrongly
 *  read as default while the doc-relative base is, say, 13px). */
export function getPanelDefault(key: PanelBodyKey): PanelTypography {
  const base = DEFAULT_PANEL_TYPOGRAPHY[key];
  const tierBase = tierBaseFontSize[PANEL_BODY_TIER[key]];
  if (tierBase === undefined) return base;
  return { ...base, fontSize: tierBase };
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

/** Return the effective typography for `key` (override merged over default).
 *  The DEFAULT here is the doc-relative `effectiveDefault` (BUG #30): when the
 *  user has set no `fontSize` override, the size tracks the live tier base
 *  (main text − 2px for borrowed, the `panelFontSize` pref for sans). An
 *  explicit numeric `fontSize` override from the stepper still wins. */
export function getPanelTypography(key: PanelBodyKey): PanelTypography {
  const base = getPanelDefault(key);
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
