/**
 * The ONE font vocabulary (task 901).
 *
 * Every font picker — the Preferences tree's font rows, the Smart grid's
 * per-panel family `<Select>`, and the Fonts… dialog's grouped `FontPicker` —
 * draws its offer from `FONT_CATALOGUE`. Per-role lists are SUBSETS of it,
 * derived here by `pick`, never re-spelled at a call site. Before this module
 * the vocabulary was four hand lists: Fonts… wrote `fontSerif` from a 35-font
 * pool while the Preferences row for the same key offered 8, so a font picked
 * in Fonts… displayed as the first option there and any touch overwrote it.
 *
 * And because a stored value can always lie outside an offer (an older
 * version's list, a hand-edited prefs file), a picker never maps an unlisted
 * value onto its first option: `withCurrent` keeps it on offer.
 */

export interface FontGroup {
  group: string;
  fonts: string[];
}

/** Grouped catalogue, in display order. The first three groups are the
 *  main-text pool (`MAIN_TEXT_FONTS`); Monospace is offered only to the
 *  monospace role. */
export const FONT_CATALOGUE: readonly FontGroup[] = Object.freeze([
  { group: "Serif", fonts: ["Source Serif 4", "Georgia", "Libre Baskerville", "Libre Caslon Text", "Lora", "Lusitana", "Merriweather", "EB Garamond", "Crimson Text", "Cardo", "Spectral", "PT Serif", "Old Standard TT", "Vollkorn", "Gentium Plus"] },
  { group: "Sans-serif", fonts: ["Inter", "system-ui", "Helvetica Neue", "Open Sans", "Lato", "Roboto", "IBM Plex Sans", "Source Sans 3", "Work Sans", "DM Sans", "Manrope", "Public Sans", "Atkinson Hyperlegible"] },
  { group: "Display", fonts: ["Playfair Display", "Cinzel", "Cormorant Garamond", "Cormorant SC", "IM Fell English", "Marcellus", "Bodoni Moda"] },
  { group: "Monospace", fonts: ["Geist Mono", "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "monospace"] },
]);

/** Every catalogued family name, flat. */
export const ALL_CATALOGUE_FONTS: readonly string[] = FONT_CATALOGUE.flatMap((g) => g.fonts);

const CATALOGUE_SET = new Set(ALL_CATALOGUE_FONTS);

/** A role's subset, in the order given. A name absent from the catalogue is
 *  a vocabulary fork: `font-vocabulary.test.ts` fails on it, and the
 *  `(uncatalogued)` check keeps it visible in dev rather than silently dropped. */
function pick(...names: string[]): string[] {
  if (process.env.NODE_ENV !== "production") {
    const stray = names.filter((n) => !CATALOGUE_SET.has(n));
    if (stray.length) console.warn("[font-catalogue] uncatalogued role font(s):", stray);
  }
  return names;
}

/** The main-text pool, grouped (Fonts… dialog; the Preferences body/UI rows,
 *  which write the same keys). */
export const MAIN_TEXT_FONTS: FontGroup[] = FONT_CATALOGUE
  .filter((g) => g.group !== "Monospace")
  .map((g) => ({ group: g.group, fonts: [...g.fonts] }));

export const ALL_MAIN_TEXT_FONTS: string[] = MAIN_TEXT_FONTS.flatMap((g) => g.fonts);

/** The curated cores: faces with a hand-tuned stack in `FONT_STACKS`
 *  (src/lib/panel-typography.ts). The Smart grid's compact per-panel
 *  `<Select>` offers these. */
export const SERIF_CORE_FONTS = pick("Source Serif 4", "Georgia", "Playfair Display", "Libre Baskerville", "Lora", "Merriweather", "EB Garamond", "Crimson Text");
export const SANS_CORE_FONTS = pick("Inter", "system-ui", "Helvetica Neue", "Open Sans", "Lato", "Roboto", "IBM Plex Sans", "Source Sans 3");
export const PANEL_BODY_FONTS: string[] = [...SERIF_CORE_FONTS, ...SANS_CORE_FONTS];

export const DISPLAY_FONTS = pick("Playfair Display", "Cinzel", "Cormorant Garamond", "Libre Baskerville", "EB Garamond");
export const LOGO_FONTS = pick("Cinzel", "Playfair Display", "Cormorant Garamond", "Libre Baskerville");
export const MONO_FONTS: string[] = [...(FONT_CATALOGUE.find((g) => g.group === "Monospace")?.fonts ?? [])];

/** Normalize a role's offer to groups (a flat list is one unlabeled group). */
export function asFontGroups(options: readonly string[] | readonly FontGroup[]): FontGroup[] {
  if (options.length === 0) return [];
  return typeof options[0] === "string"
    ? [{ group: "", fonts: [...(options as readonly string[])] }]
    : (options as readonly FontGroup[]).map((g) => ({ group: g.group, fonts: [...g.fonts] }));
}

/** The offer a picker renders for `value`: the role's groups, plus a leading
 *  "Current" group holding `value` when the role does not list it — so a
 *  controlled `<select>` shows the stored font instead of silently displaying
 *  (and on the next change, overwriting with) its first option. */
export function withCurrent(options: readonly string[] | readonly FontGroup[], value: string | null | undefined): FontGroup[] {
  const groups = asFontGroups(options);
  if (!value || groups.some((g) => g.fonts.includes(value))) return groups;
  return [{ group: "Current", fonts: [value] }, ...groups];
}
