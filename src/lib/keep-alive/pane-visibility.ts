/**
 * THE "is this pane rendered?" predicate — the VISIBLE rung of the
 * focused → visible → sole ladder (law: *Per-doc services under multi-pane
 * keep-alive*), stated once.
 *
 * Multi-doc keep-alive mounts N `EditorPane`s at once: one in a `display:flex`
 * slot, the rest in `display:none` slots (`KeepAliveSlot`, whose docblock calls
 * that CSS invariant load-bearing). An element inside a `display:none` subtree
 * reports BOTH `offsetParent === null` AND `offsetHeight === 0`, and nothing
 * else in a mounted tree reports both:
 *
 *  - `offsetParent !== null` is the primary signal;
 *  - `offsetHeight > 0` is the backstop for the one rendered shape that also
 *    reports a null `offsetParent` — a `position: fixed` element (a popped
 *    float, a body-level overlay).
 *
 * Task 874: this used to be spelled twice — `pickActiveByEditor` read
 * `offsetHeight > 0` alone while `pane-dom.ts` read the disjunction (and its
 * comment claimed the probe read `offsetParent`) — plus two `offsetParent`-only
 * card lookups that missed a fixed-position twin. Callers that test their OWN
 * element for a zero box (the `offsetHeight === 0` early-outs in measuring
 * hooks) are asking a different question and keep their own read.
 */
export function isPaneElementVisible(el: HTMLElement): boolean {
  return el.offsetParent != null || el.offsetHeight > 0;
}
