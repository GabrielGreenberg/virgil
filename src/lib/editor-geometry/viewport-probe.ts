/**
 * Viewport → document-position probes. "What is at this screen Y?" answered
 * ONCE per call by ProseMirror's `posAtCoords`, in the shape all three
 * geometry consumers had independently re-derived.
 *
 * The idiom (breadcrumb C2, active-block C6, and now the in-text card lane):
 * probe at the content column's horizontal CENTER, with Y clamped into the
 * probeable window, inside a try/catch — `posAtCoords` can throw on a detached
 * view. Callers decide what a `null` means for them; the two pre-existing
 * consumers fall back to their legacy walk, the lane fails OPEN (see
 * `resolveVisiblePosBand`).
 *
 * ── The probeable window is the VIEWPORT ∩ the content box ────────────────
 *
 * Clamping into the content box alone is not enough, and the difference is a
 * cost class rather than a detail. `posAtCoords` first asks the browser
 * (`caretFromPoint` + `document.elementFromPoint`), which by spec answers
 * `null` for coordinates outside the visual viewport — and PM's fallback for
 * that case is `elementFromPoint(view.dom, coords, box)`, a wrap-around scan
 * over `view.dom.childNodes` calling `getClientRects()` per top-level block;
 * when no child rect contains the point (an inter-block margin gap does not
 * belong to either neighbour) it returns `view.dom` itself and
 * `findOffsetInNode` then sweeps every child AGAIN with no early break. So an
 * off-viewport probe is a doc-proportional forced-layout read wearing an O(1)
 * call's clothes. Clamping into the viewport keeps the browser's own hit-test
 * on the fast path, which is what makes the two probes in `measure()` honest.
 *
 * (A probe can still miss the fast path if an overlay covers the point — the
 * hit-test then returns an element outside `view.dom`. That is rare, is the
 * same exposure the two pre-existing consumers have always carried, and is
 * stated here rather than claimed away. If it ever shows in a trace, the
 * cheaper answer is the geometry service's `blocksAtY`, which reads cached
 * near-zone metrics and touches no DOM.)
 *
 * ── Why the lane needs the INVERSE map (task 327) ─────────────────────────
 *
 * The wave-2b C5 gate that decides which cards get an exact `coordsAtPos`
 * read classified each card by its own RETAINED pod-relative top: a
 * previously-measured card whose retained top fell outside the scroll band
 * was deferred to an interpolation. That is a refinement gate reading the
 * value it exists to refine, and its error mode is ABSORBING: a card whose
 * retained top is wrong by more than the band's padding is classified
 * out-of-band, re-approximated from the same knots, and classified out again
 * — forever. The exact read that would correct the retained top is exactly
 * what the wrong retained top prevents, so a cold-open measure taken against
 * un-laid-out DOM (FOUT, KaTeX/figure NodeViews, an FSA load that restores a
 * mid-doc scroll) can pin the lane at wrong Ys and placeholder heights
 * permanently.
 *
 * The fix is to move the comparison into a space where our input is ground
 * truth. A card's `pos` is maintained by the DocStructureObserver's mapping,
 * never estimated — so resolve the BAND to a position range once per pass
 * (two probes) and ask `pos ∈ [start, end]`. A wrong retained top can no
 * longer influence eligibility, which makes the fixed point structurally
 * unrepresentable rather than merely unlikely. Sibling of the project's
 * "ask the transaction where a position went; never predict it" rule: ask
 * the DOCUMENT where the anchor is; never let the prediction decide whether
 * to ask.
 */

import type { EditorView } from "@tiptap/pm/view";

/** A document-position range: the band's two edges mapped through the view. */
export interface PosBand {
  start: number;
  end: number;
}

/** The Y range a probe may legally land in: the visual viewport intersected
 *  with the editor's content box. `null` when the two don't overlap (the
 *  editor is entirely scrolled off, or has no height) — nothing is probeable
 *  and every caller treats that as "cannot answer". */
function probeBounds(
  view: EditorView,
  rect: DOMRect,
): { lo: number; hi: number } | null {
  if (rect.height <= 0) return null;
  const doc = view.dom.ownerDocument;
  const viewportH =
    doc?.defaultView?.innerHeight ||
    doc?.documentElement?.clientHeight ||
    0;
  const lo = Math.max(rect.top + 1, 1);
  const hi = Math.min(rect.bottom - 1, (viewportH > 0 ? viewportH : rect.bottom) - 1);
  return hi > lo ? { lo, hi } : null;
}

const clampTo = (y: number, b: { lo: number; hi: number }) =>
  Math.min(Math.max(y, b.lo), b.hi);

/**
 * The document position at viewport Y `y`, probed at the content column's
 * center with Y clamped into the probeable window (see the header — the
 * clamp is what keeps this on the browser's fast hit-test path). Returns null
 * when the view can't answer: nothing probeable, a hit-test miss, a detached
 * view.
 *
 * The clamp means a caller asking about an off-screen Y gets the nearest
 * on-screen answer rather than an expensive one. A caller that needs to know
 * how far it was moved should clamp itself (`resolveVisiblePosBand` does).
 *
 * `domRect` may be supplied by a caller that already read it this frame —
 * `posAtCoords` is a forced-layout read and the rect is another, so the two
 * lane probes share one.
 */
export function posAtViewportY(
  view: EditorView,
  y: number,
  domRect?: DOMRect,
): number | null {
  const rect = domRect ?? view.dom.getBoundingClientRect();
  const bounds = probeBounds(view, rect);
  if (!bounds) return null;
  const x = rect.left + rect.width / 2;
  try {
    const found = view.posAtCoords({ left: x, top: clampTo(y, bounds) });
    return found ? found.pos : null;
  } catch {
    return null;
  }
}

/**
 * Map a viewport band to the document-position range it covers, with `padPx`
 * of near-zone slack on each side.
 *
 * `visibleTopY`/`visibleBottomY` are the band's REAL edges — the scroll
 * container's rect, which is on screen — and are what gets probed. The
 * padding is then added in POSITION space, converted through the density the
 * two probes just measured (falling back to the document's average density
 * when the probes land on one position). It is deliberately not probed: a
 * padded edge is by construction ~`padPx` outside the viewport, and probing
 * there is the doc-proportional fallback the header describes. The padding is
 * a comfort margin — under-estimating it only means a card that far off-screen
 * waits for the scroll-idle refinement that already exists, while the VISIBLE
 * range, the part that must never be wrong, comes from the exact probes.
 *
 * The whole thing **fails OPEN**: anything unresolvable widens the band to the
 * document. That asymmetry is load-bearing. This band gates whether an anchor
 * gets an exact geometry read; a band that is too WIDE costs extra
 * `coordsAtPos` reads for that pass (the pre-C5 cost — correct, just slower),
 * while a band that is too NARROW silently withholds the read from something
 * the user can see, which is the defect class this module exists to close.
 *
 * A band whose padded extent already covers the content box resolves to the
 * whole document with no probe at all — both cheaper and exact.
 */
export function resolveVisiblePosBand(
  view: EditorView,
  visibleTopY: number,
  visibleBottomY: number,
  padPx: number,
  domRect?: DOMRect,
): PosBand {
  const docSize = view.state.doc.content.size;
  const whole: PosBand = { start: 0, end: docSize };
  const rect = domRect ?? view.dom.getBoundingClientRect();
  if (rect.height <= 0) return whole;

  const wantTop = visibleTopY - padPx;
  const wantBottom = visibleBottomY + padPx;
  if (wantTop <= rect.top && wantBottom >= rect.bottom) return whole;

  const bounds = probeBounds(view, rect);
  if (!bounds) return whole;
  const topY = clampTo(visibleTopY, bounds);
  const bottomY = clampTo(visibleBottomY, bounds);

  const a = posAtViewportY(view, topY, rect);
  const b = posAtViewportY(view, bottomY, rect);
  if (a === null || b === null) return whole;

  // Probes are independent, so an inverted pair (a hit-test landing in an
  // out-of-flow node) must not produce an empty band.
  let start = Math.min(a, b);
  let end = Math.max(a, b);

  const spanPx = bottomY - topY;
  const spanPos = end - start;
  // Local density where the user is looking; the document average when the
  // two probes agree (one huge block, a degenerate overlap).
  const posPerPx =
    spanPx > 0 && spanPos > 0 ? spanPos / spanPx : docSize / rect.height;
  start -= Math.max(0, topY - wantTop) * posPerPx;
  end += Math.max(0, wantBottom - bottomY) * posPerPx;

  return {
    start: Math.max(0, Math.min(start, docSize)),
    end: Math.min(docSize, Math.max(end, 0)),
  };
}
