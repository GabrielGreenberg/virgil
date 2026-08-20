/**
 * ONE `ResizeObserver` for every mounted forest tree — the "this host had no box
 * when I measured it" signal.
 *
 * **Why it has to exist.** A `forestBlock` inside a folded section
 * (`.section-folded { display: none }`, applied as a ProseMirror node
 * DECORATION, so the NodeView stays MOUNTED), inside a focus-hidden band, or
 * inside a hidden multi-doc keep-alive pane, runs its layout effect while it has
 * no box at all. Every `getBoundingClientRect()` reads 0×0, the measurement
 * falls to the canvas rung, and the tree is placed from ESTIMATES. Nothing in
 * the effect's dependency list ever changes when the section is unfolded — a
 * decoration is added and removed without touching `source` — so the estimates
 * would stand for the life of the document: edges converging beside their
 * labels rather than on them, a `roof` triangle spanning the wrong width, and no
 * error anywhere. Fold state is persisted per doc and restored on open, so this
 * is an ordinary starting condition, not a race.
 *
 * **Why an observer rather than a flag.** Un-hiding is not an event this
 * component can see: it is an ancestor's `display` changing, which produces no
 * transaction, no prop change and no effect re-run. The box going 0 → non-zero
 * IS the signal, and `ResizeObserver` is what reports it.
 *
 * **What it costs.** ONE observer for the whole app (the `card-near-zone`
 * shape), not one per block. The callback is a width compare plus, at most, a
 * counter bump on a host that ADMITS it was measured degraded — a tree measured
 * from real boxes ignores every fire, including the initial one every `observe`
 * delivers. Nothing here reads layout: `entry.contentRect` is delivered by the
 * observer post-layout.
 */

type Waiter = {
  /** Called when this host has a real box AND its last measure was degraded. */
  remeasure: () => void;
  /** Whether the last measure fell back to a non-DOM rung for any label. */
  degraded: () => boolean;
};

const waiters = new Map<Element, Waiter>();
let observer: ResizeObserver | null = null;

function ensureObserver(): ResizeObserver | null {
  if (observer) return observer;
  if (typeof ResizeObserver === "undefined") return null;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const waiter = waiters.get(entry.target);
      if (!waiter) continue;
      // A hidden element reports a zero box; a shown one reports the width we
      // wrote from the (possibly estimated) layout. The transition is the whole
      // signal — and a host that measured cleanly has nothing to redo.
      if (entry.contentRect.width <= 0) continue;
      if (!waiter.degraded()) continue;
      waiter.remeasure();
    }
  });
  return observer;
}

/** Watch `el` for the 0 → non-zero box transition. Returns a disposer. */
export function watchForestHost(el: Element, waiter: Waiter): () => void {
  const obs = ensureObserver();
  if (!obs) return () => {};
  waiters.set(el, waiter);
  obs.observe(el);
  return () => {
    waiters.delete(el);
    obs.unobserve(el);
  };
}

/** Test-only: how many hosts are currently watched. */
export function __forestWatchCount(): number {
  return waiters.size;
}
