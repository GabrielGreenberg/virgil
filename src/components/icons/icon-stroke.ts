/**
 * The stroke values a UI glyph declares on its `<svg>` (task 2026-10-24-1276).
 * STYLE_GUIDE → "Icons".
 *
 * These are not the line weight. An icon's weight on screen is set once, in
 * globals.css ("One line weight"), because a stroke of 2 on a 24 grid and 1.5 on
 * a 16 grid are different lines at the same size. These stay as the attributes a
 * glyph falls back on where that stylesheet is absent, such as a vanilla-DOM
 * builder's node in a test or a copied SVG.
 *
 *  - `ICON_STROKE` (2) is the default: every outlined/framed glyph.
 *  - `ICON_STROKE_SMALL` (2.5) is the SMALL-GLYPH rung: a bare mark — a "+",
 *    a close "×", a chevron or caret — drawn at ≤14px.
 *
 * A pure-data leaf (no imports), so vanilla-DOM builders can read it too.
 * `icon-stroke-rung-census.test.ts` fails a bare `2.5` stroke literal
 * anywhere else in `src/` — a site on the small rung imports it.
 */
export const ICON_STROKE = 2;
export const ICON_STROKE_SMALL = 2.5;
