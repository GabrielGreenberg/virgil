/**
 * The icon stroke rungs — the ONE place a stroke weight for a UI glyph is a
 * number (task 2026-10-24-1276). STYLE_GUIDE → "Icons".
 *
 *  - `ICON_STROKE` (2) is the default: every outlined/framed glyph (a box with
 *    an arrow, a page, a link) at any size.
 *  - `ICON_STROKE_SMALL` (2.5) is the SMALL-GLYPH rung: a bare mark — a "+",
 *    a close "×", a chevron or caret — drawn at ≤14px, where a 2-unit stroke
 *    in a 24 viewBox renders under 1.2 CSS px and reads faint beside text.
 *    The shared chevron leaves (`Chevron`, `DropChevrons`, `JumpChevron`,
 *    `MenuCaret`) and the panel-header "+" / close "×" all wear it.
 *
 * A pure-data leaf (no imports), so vanilla-DOM builders can read it too.
 * `icon-stroke-rung-census.test.ts` fails a bare `2.5` stroke literal
 * anywhere else in `src/` — a site on the small rung imports it.
 */
export const ICON_STROKE = 2;
export const ICON_STROKE_SMALL = 2.5;
