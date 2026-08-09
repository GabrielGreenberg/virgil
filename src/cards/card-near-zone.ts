/**
 * card-near-zone — per-card viewport proximity for the presence tiers
 * (perf Wave 3).
 *
 * ONE shared IntersectionObserver (viewport root, ±600px vertical margin)
 * observing each registered card ELEMENT. This deliberately deviates from
 * the plan's "geometry service writes the near-zone store" sketch, and the
 * deviation is the deeper unification: the service's `observed` set is
 * keyed by anchorable BLOCK uuid, but the one card kind whose tier depends
 * on nearness — the collapsed example — is ENTITY-anchored (no block uuid
 * to key on), and its DOM lives in the omni/panel column, not the document.
 * Observing the card's own element answers the actual question ("is this
 * card near the user's viewport?") with one mechanism for every surface —
 * omni-anchored cards, docked panel lists, floats (always intersecting →
 * near, correctly) — and inherits none of the service set's spurious-leave
 * semantics (the detach/heal paths recon flagged).
 *
 * Hysteresis: promotion is immediate on IO enter; demotion waits out a 2s
 * dwell after leave (re-enter cancels it), so scroll jitter at the zone
 * edge can never thrash a live editor down and up. (The plan sketched
 * asymmetric 600/1200px zones; a single zone + dwell gives the same
 * anti-thrash with one observer.)
 *
 * Cold start: an element is FAR until the observer's initial callback
 * (delivered within a frame of `observe`) proves otherwise — so a doc-open
 * paints static bodies first and promotes only what is actually near, which
 * is exactly the load direction the ramp wants.
 *
 * Environments without IntersectionObserver (jsdom, SSR) report NEAR for
 * everything — the legacy always-live behavior, the safe direction. Tests
 * mock this module.
 *
 * Keystroke sanctity: IO-paced only. No editor subscription, no polling,
 * no per-frame work; the callback flips booleans and notifies per-element
 * subscribers.
 */

const NEAR_MARGIN_PX = 600;
const DEMOTE_DWELL_MS = 2000;

interface ElementState {
  near: boolean;
  subscribers: Set<() => void>;
  demoteTimer: ReturnType<typeof setTimeout> | null;
}

const states = new Map<Element, ElementState>();
let io: IntersectionObserver | null = null;

function ensureObserver(): IntersectionObserver | null {
  if (io) return io;
  if (typeof IntersectionObserver === "undefined") return null;
  io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const st = states.get(entry.target);
        if (!st) continue;
        if (entry.isIntersecting) {
          if (st.demoteTimer !== null) {
            clearTimeout(st.demoteTimer);
            st.demoteTimer = null;
          }
          if (!st.near) {
            st.near = true;
            for (const cb of st.subscribers) cb();
          }
        } else if (st.near && st.demoteTimer === null) {
          st.demoteTimer = setTimeout(() => {
            st.demoteTimer = null;
            // Element may have unregistered during the dwell.
            const live = states.get(entry.target);
            if (!live || !live.near) return;
            live.near = false;
            for (const cb of live.subscribers) cb();
          }, DEMOTE_DWELL_MS);
        }
      }
    },
    { rootMargin: `${NEAR_MARGIN_PX}px 0px ${NEAR_MARGIN_PX}px 0px` },
  );
  return io;
}

/**
 * Observe `el` and call `cb` on every near/far flip. Returns the
 * unregister function. Multiple subscribers per element share one
 * observation.
 */
export function subscribeCardNearness(el: Element, cb: () => void): () => void {
  const observer = ensureObserver();
  let st = states.get(el);
  if (!st) {
    st = { near: false, subscribers: new Set(), demoteTimer: null };
    states.set(el, st);
    observer?.observe(el);
  }
  st.subscribers.add(cb);
  return () => {
    const cur = states.get(el);
    if (!cur) return;
    cur.subscribers.delete(cb);
    if (cur.subscribers.size === 0) {
      if (cur.demoteTimer !== null) clearTimeout(cur.demoteTimer);
      states.delete(el);
      io?.unobserve(el);
    }
  };
}

/** Current nearness for `el`. NEAR when the environment has no
 *  IntersectionObserver (legacy always-live), FAR for a registered element
 *  the observer hasn't (yet) reported intersecting. */
export function readCardNearness(el: Element | null): boolean {
  if (typeof IntersectionObserver === "undefined") return true;
  if (!el) return false;
  return states.get(el)?.near ?? false;
}
