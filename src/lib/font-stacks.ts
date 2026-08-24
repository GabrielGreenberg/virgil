/**
 * FONT-STACK SSOT — the three chrome font chains, spelled once.
 *
 * A `font-family` in this app is never one token. It is a CHAIN: the user's
 * override pref, then the `next/font` variable `layout.tsx` declares, then the
 * hard fallbacks that carry the load during the font-load window. Every rung is
 * load-bearing, and every hand-spelled copy is a chance to drop one.
 *
 * That is not hypothetical — it is what this module was extracted to end
 * (task 2026-07-18-170):
 *
 *  - `--mono` and `--serif` were spelled 48 times — 44 in `library/`, 4 across
 *    three `src/` files — and **defined nowhere**. `var(--mono)` with no
 *    fallback is the guaranteed-invalid value, so `font-family` became
 *    "invalid at computed-value time" and every one of those surfaces silently
 *    inherited the surrounding sans. A monospace page-picker, monospace tab
 *    labels, serif dialog headings — none of them ever rendered.
 *  - The sans chain had three hand-spelled copies (`FloatChrome`, the
 *    now-retired text-object `FloatHeaderContent`, and `body` in
 *    `globals.css`), two of them carrying doc comments explaining that they must not drift from the third. The
 *    serif chain had two (`HighlightCard` and the editor-body rule).
 *
 * So: consume these constants from `.tsx`, and the identical chain from
 * `globals.css` / `library.css` in a stylesheet. Never re-spell a chain, and
 * never reach for a bare `var(--font-mono)` — that skips the user's override.
 *
 * The chains mirror `globals.css` verbatim (`body` ~786, the editor serif rule
 * ~805, and the ~13 mono rules), which is what makes an element styled from
 * here resolve identically to one styled by the stylesheet — the property the
 * float header needed and documented at length (there were two of them until
 * task 437 made the lift ghost mount the same one).
 *
 * Leaf-pure by design: zero imports, so `library/` may take it as a shared
 * utility (see library/AGENTS.md "Don't"), exactly like `@/lib/bib-searcher`.
 *
 * CI: [src/__tests__/phantom-css-var.test.ts](../__tests__/phantom-css-var.test.ts)
 * fails any `var(--token)` the app never defines, and pins the retired
 * `--mono`/`--serif`/`--sans` vocabulary dead.
 */

/** UI chrome sans — `body`'s stack. Labels, buttons, panel text. */
export const FONT_SANS =
  'var(--font-sans-override, var(--font-sans)), "Inter", system-ui, sans-serif';

/** Reading serif — the editor body / paper-render stack. */
export const FONT_SERIF =
  'var(--font-serif-override, var(--font-serif)), "Source Serif 4", Georgia, serif';

/** Monospace — citekeys, page numbers, code, `.tex` fragments. */
export const FONT_MONO = "var(--font-mono-override, var(--font-mono)), monospace";
