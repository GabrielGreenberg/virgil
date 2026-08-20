/**
 * glyph-anchor.ts — which block kinds can declare a `[data-glyph-anchor]`
 * VISUAL TOP, and the O(1) resolve that asks.
 *
 * A NodeView marks the element that is the block's real visual top when its
 * wrapper carries label chrome ABOVE the thing the reader sees: the titled
 * SOURCE POD (worn by `texBlock` and `forestBlock`), and the expex `(n)`
 * number. `measureBlock` honours that override when anchoring marginalia
 * markers.
 *
 * The probe used to be an unconditional `dom.querySelector("[data-glyph-anchor]")`
 * on every measured block, and a `querySelector` that finds NOTHING has walked
 * the WHOLE subtree to say so. On a `bulletList` — re-measured on every
 * wrap-changing keystroke, since a `<li>` and its title wrapper both resize —
 * that is a full-list scan per measure, for a match that could never exist
 * (task 336).
 *
 * Gating on the block's own kind also closes a smaller correctness hole: an
 * `exampleBlock` nested inside a `listItem` put its `(n)` number in the
 * ancestor's subtree, so the ancestor's markers anchored to the NESTED
 * example's number rather than to the ancestor's own top.
 *
 * FAILS OPEN on a block whose kind attribute is absent (a transient render
 * before the decoration lands): an unknown kind keeps the pre-336 query, so the
 * gate can only ever remove work it can prove is wasted.
 */

/**
 * The kinds whose NodeView emits `[data-glyph-anchor]`. Membership is pinned
 * against the EMITTERS by [glyph-anchor-census.test.ts] — a third NodeView that
 * declares an anchor fails CI until its kind is named here, because a kind
 * missing from this set silently loses its declared visual top (markers slide
 * to the wrapper's chrome top) with nothing to grep for.
 */
export const GLYPH_ANCHOR_KINDS: ReadonlySet<string> = new Set([
  // `SourcePodNodeView` → `<div className="source-pod" data-glyph-anchor>`.
  // ONE emitter file, TWO kinds: both source-pod wearers declare the pod as
  // their visual top, because both put the `+T` title strip above it.
  "texBlock",
  "forestBlock",
  // `expex.ts` exampleBlock NodeView → `span.expex-number[data-glyph-anchor]`
  "exampleBlock",
]);

/**
 * The block's declared visual-top element, or null when its kind cannot carry
 * one. O(1) for every kind that cannot; O(subtree-to-first-match) for the ones
 * that can.
 */
export function resolveGlyphAnchor(dom: HTMLElement): HTMLElement | null {
  const kind = dom.getAttribute("data-text-object-kind");
  if (kind !== null && !GLYPH_ANCHOR_KINDS.has(kind)) return null;
  return dom.querySelector("[data-glyph-anchor]") as HTMLElement | null;
}
