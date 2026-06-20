/**
 * `chromeAwareScrollMargin` — a ProseMirror `editorProps.scrollMargin` whose TOP
 * tracks the live sticky-chrome height so an *intentional* `scrollIntoView()`
 * lands its target just BELOW the chrome, not beneath it.
 *
 * # Why this exists
 *
 * The main editor scrolls inside `[data-virgil-row-scroll]`, and the top of that
 * scroll viewport is covered by sticky chrome: the docked MenuBar strip (top:
 * `var(--chrome-top)`) and the top reading-frame mask (height `var(--editor-pt)`).
 * ProseMirror's native scroll uses `scrollMargin` (default ~5px) to decide where a
 * target lands; with no chrome-aware margin it parks scrolled-to content at the very
 * top of the container — UNDER that ~64px of chrome ("just out of view at the top").
 *
 * Block inserts (`smartInsertBlock`, `\tex` / `\ex` / title runs, display math) and
 * jump-to-link all dispatch `tr.scrollIntoView()`; giving the editor this margin
 * makes every one of them land below the mask. Inline-atom inserts go the no-scroll
 * route (`insertInlineAtom`) and don't rely on this — this is the safety net for the
 * deliberate scrolls.
 *
 * # Live, not baked
 *
 * The top reading-mask height (`--editor-pt`) is user-adjustable via the margin-edit
 * guide (it mutates the CSS var live, no React render). So the margin is exposed as a
 * getter that re-reads the cascaded CSS vars off the editor DOM at *scroll time* —
 * dragging the top margin keeps the landing correct with no editor re-create.
 * ProseMirror's `getSide(scrollMargin, side)` accesses `value[side]`, which invokes
 * the getter each read.
 */

/** Read a px-valued CSS custom property off `el` (resolving the cascade). Returns
 *  `fallback` when the var is unset or — as with `--chrome-top`'s `calc(...)` — does
 *  not reduce to a parseable number. */
function readPxVar(el: Element, name: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** A per-side `scrollMargin` object. left/right stay 0; top = MenuBar strip
 *  (`--chrome-top`) + reading-mask (`--editor-pt`); bottom = bottom mask
 *  (`--editor-pb`). `getEditorDom` returns the live ProseMirror DOM (the common
 *  descendant in the cascade of both vars), or null before the editor mounts. */
export function chromeAwareScrollMargin(getEditorDom: () => HTMLElement | null) {
  // Defaults match the non-menuBar fallbacks; `--chrome-top` is a calc() that does
  // not parse, so its NaN-fallback (24) equals the menuBar strip height — correct in
  // menuBar mode, while reader mode's plain "8px" parses directly.
  const topInset = (): number => {
    const dom = getEditorDom();
    if (!dom) return 64;
    return readPxVar(dom, "--chrome-top", 24) + readPxVar(dom, "--editor-pt", 40);
  };
  const bottomInset = (): number => {
    const dom = getEditorDom();
    if (!dom) return 40;
    return readPxVar(dom, "--editor-pb", 40);
  };
  return {
    left: 0,
    right: 0,
    get top() {
      return topInset();
    },
    get bottom() {
      return bottomInset();
    },
  };
}
