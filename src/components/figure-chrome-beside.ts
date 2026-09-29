// The figure chrome's "beside?" fit test — whether the hover control row fits
// to the RIGHT of the image within the text column (`.figure-chrome-beside`) or
// stays in its top-right overlay. Lifted out of FigureBlockNodeView (task 837)
// so its observer and layout-gesture park are testable without an editor.
//
// Per-figure and on-demand: observes only ONE block and its containing column,
// RAF-coalesced — it never walks the doc, so keystroke-sanctity is not
// implicated. Recomputes on mount, image load and scale change (each resizes the
// block) and on column/editor resize (the parent), via one ResizeObserver on
// both. The chrome is laid out even while hover-hidden (opacity:0), so its width
// is measurable any time; being position:absolute, toggling the class never
// resizes the block or column, so there is no ResizeObserver feedback loop.
//
// Chip 4b: the block's content-right edge (the chrome's beside anchor) is read
// from the canonical content-edge primitive `resolveContentEdges` — the one
// `resolveBlockFrame` composes — so it shares ONE geometry source with the grab
// handle (which hugs the same frame on the left) without paying the frame's
// marker / optical-centre work for a field it would discard. The column edge
// stays a direct measure — it's the fit boundary, not a figure affordance.
//
// Layout-gesture stability (task 837): the observer is PARKED on the
// layout-gesture bus. During a pane-divider drag, a SplitWithCode drag or an OS
// window resize the column changes width every frame, and the chrome is
// hover-hidden for the whole gesture — so nothing needs the live answer. The
// trigger is stashed and replayed exactly once on the gesture's end edge
// (census: pane-drag-guardrail.test.ts → PERMITTED_GESTURE_RESIZE_OBSERVERS).

import { resolveContentEdges } from "@/text-objects/block-frame";
import { parkDuringLayoutGesture } from "@/lib/pane-resize/layout-gesture-park";
import { LAYOUT_SITE_FIGURE_CHROME } from "@/lib/layout-gesture-probe";

// Gap (px) between a hugged block's right edge and the chrome row when the row
// sits beside the image. MUST match `.figure-chrome-beside { left: calc(100% +
// 8px) }` in globals.css — the fit test below subtracts this same gap, so the
// row only goes beside when it provably clears the text-column right edge.
export const CHROME_BESIDE_GAP = 8;

/**
 * Watch `block` (the `.figure-block` hug box) and its column, reporting the
 * beside verdict through `onBeside`. Returns the disposer (disconnects the
 * observer, drops any parked call, cancels a queued frame).
 */
export function watchChromeBeside(
  block: HTMLElement,
  onBeside: (beside: boolean) => void,
): () => void {
  // The block's parent is the `.react-renderer` NodeView wrapper, a full-width
  // block in the doc flow — so its content-right edge IS the text-column right
  // (the same edge a sibling paragraph wraps at). That's our fit boundary.
  const column = block.parentElement;
  if (!column) return () => {};

  let raf = 0;
  const recompute = () => {
    raf = 0;
    // Only a populated chrome can go beside; the empty-state row stays put.
    const chrome = block.querySelector<HTMLElement>(
      ".figure-chrome:not(.figure-chrome-empty)",
    );
    if (!chrome) {
      onBeside(false);
      return;
    }
    const colStyle = getComputedStyle(column);
    const columnRight =
      column.getBoundingClientRect().right -
      (parseFloat(colStyle.paddingRight) || 0) -
      (parseFloat(colStyle.borderRightWidth) || 0);
    // The figure's content-right edge from the CANONICAL content edges, not an
    // independent box measure. `resolveContentEdges(block)` resolves `block`
    // (the `.figure-block` hug box) to itself, so `contentRight` IS the
    // rendered image's right edge — the same number `.figure-chrome-beside`'s
    // CSS anchor (`left: calc(100% + 8px)`) lands on, and the mirror of the
    // grab handle hugging the marker on the LEFT: one frame on both sides. We
    // pass the hug box, NOT the full-width `.react-renderer` [data-uuid] host —
    // the host resolves to the column extent (which the drop indicator
    // correctly wants), so leaving `resolveFirstLineTarget` untouched keeps
    // that bar intact.
    const blockRight = resolveContentEdges(block).contentRight;
    const chromeWidth = chrome.getBoundingClientRect().width;
    const available = columnRight - blockRight - CHROME_BESIDE_GAP;
    onBeside(chromeWidth > 0 && available >= chromeWidth);
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(recompute);
  };

  const park = parkDuringLayoutGesture(schedule, LAYOUT_SITE_FIGURE_CHROME);
  const ro = new ResizeObserver(() => park.fire());
  ro.observe(block);
  ro.observe(column);
  schedule(); // initial measure (covers mount)

  return () => {
    ro.disconnect();
    park.dispose();
    if (raf) cancelAnimationFrame(raf);
  };
}
