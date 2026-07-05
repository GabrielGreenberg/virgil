// Scroll-anchor stability probe (task 042) — the runtime half of the
// scroll-reposition guardrail. It measures whether a `position:fixed` overlay
// that re-anchors on scroll is *stable* (recomputes its `top` at most once per
// animation frame, behind an equality bail) or *jittery* (re-solves `top`
// multiple times within a single frame).
//
// The discriminator is DISTINCT `top` VALUES COMMITTED PER FRAME:
//   - a RAF-coalesced portal commits at most once per frame ⇒ ≤1 distinct
//     top/frame, even while its content legitimately scrolls (the top changes
//     between frames, not within one);
//   - a portal that re-solves synchronously on every `scroll` event with no RAF
//     gate can commit several DIFFERENT tops inside one frame ⇒ >1 distinct
//     top/frame — the visible jitter/lag this guardrail exists to catch.
//
// Read it from the dev console during a real scroll:
//   window.__scrollRepositionStats()
//   → { "selection-actions-bolt": { total, commitsThisScroll, distinctTopsThisScroll }, … }
// A stable portal reports `distinctTopsThisScroll ≤ 1`; a jittery one reports >1.
//
// The companion CI guard is `src/lib/__tests__/scroll-reposition-guardrail.test.ts`
// (a source-grep permitted-subscriber allowlist, modelled on the keystroke-
// sanctity allowlist + `float-policy.test.ts`). The contract itself is written
// up in AGENTS.md ("Scroll-anchor stability").

/** Canonical portal ids — the fixed portals wired to record into the probe. */
export const SCROLL_PORTAL_SELECTION_BOLT = "selection-actions-bolt";
export const SCROLL_PORTAL_PENDING_PILL = "pending-change-pill";
export const SCROLL_PORTAL_SLASH_POPUP = "slash-command-popup";
export const SCROLL_PORTAL_FLOATING_MENU = "floating-menu";

/** How long after the last scroll event we consider a scroll gesture "idle". */
const SCROLL_IDLE_MS = 150;

/** Per-portal public stats shape returned by `window.__scrollRepositionStats()`. */
export interface ScrollRepositionStat {
  /** Lifetime count of committed (moved) placements. */
  total: number;
  /** Commits during the current/most-recent scroll gesture. */
  commitsThisScroll: number;
  /**
   * Max number of DISTINCT `top` values this portal committed within a single
   * frame during the current scroll gesture. ≤1 for a stable (RAF-coalesced)
   * portal; >1 signals per-frame jitter.
   */
  distinctTopsThisScroll: number;
}

interface PortalState {
  total: number;
  commitsThisScroll: number;
  maxDistinctPerFrame: number;
  /** Distinct tops committed within the CURRENT (not-yet-flushed) frame. */
  frameTops: Set<number>;
}

// Dev/test only — production pays a single boolean check per commit and nothing
// else. (Commits are already RAF-throttled to once/frame by every wired portal,
// so even the armed cost is negligible.)
const enabled =
  typeof window !== "undefined" && process.env.NODE_ENV !== "production";

const states = new Map<string, PortalState>();
let scrolling = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let frameScheduled = false;
let installed = false;

function getState(portalId: string): PortalState {
  let s = states.get(portalId);
  if (!s) {
    s = {
      total: 0,
      commitsThisScroll: 0,
      maxDistinctPerFrame: 0,
      frameTops: new Set<number>(),
    };
    states.set(portalId, s);
  }
  return s;
}

/** Fold the just-elapsed frame's distinct-top count into each portal's max. */
function flushFrame(): void {
  for (const s of states.values()) {
    if (s.frameTops.size > s.maxDistinctPerFrame) {
      s.maxDistinctPerFrame = s.frameTops.size;
    }
    s.frameTops.clear();
  }
}

function scheduleFrameFlush(): void {
  if (frameScheduled) return;
  frameScheduled = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      frameScheduled = false;
      flushFrame();
    });
  } else {
    // No RAF (SSR/non-DOM) — fold synchronously so we never leak a frame.
    frameScheduled = false;
    flushFrame();
  }
}

function beginOrContinueScroll(): void {
  scrolling = true;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(endScroll, SCROLL_IDLE_MS);
}

function endScroll(): void {
  scrolling = false;
  idleTimer = null;
  // Reset the per-scroll accumulators; `total` is lifetime and survives.
  for (const s of states.values()) {
    s.commitsThisScroll = 0;
    s.maxDistinctPerFrame = 0;
    s.frameTops.clear();
  }
}

function snapshot(): Record<string, ScrollRepositionStat> {
  const out: Record<string, ScrollRepositionStat> = {};
  for (const [id, s] of states) {
    // Include the current (not-yet-flushed) frame so a console read mid-scroll
    // reflects an in-progress jitter burst rather than lagging a frame behind.
    const distinct = Math.max(s.maxDistinctPerFrame, s.frameTops.size);
    out[id] = {
      total: s.total,
      commitsThisScroll: s.commitsThisScroll,
      distinctTopsThisScroll: distinct,
    };
  }
  return out;
}

function ensureInstalled(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Capture phase so scrolls in any nested scroll container are seen, not just
  // the window — mirrors the trackAnchor listener in useFloatingMenuPosition.
  window.addEventListener("scroll", beginOrContinueScroll, {
    capture: true,
    passive: true,
  });
  (
    window as unknown as {
      __scrollRepositionStats?: () => Record<string, ScrollRepositionStat>;
    }
  ).__scrollRepositionStats = snapshot;
}

/**
 * Record one committed placement of a fixed portal. Call this on every commit
 * where the portal's `top` may have changed (i.e. right where the portal's
 * `placementsEqual`/`prev.top === next.top` bail decides to re-render). Cheap
 * and a no-op in production.
 */
export function recordScrollPlacement(portalId: string, top: number): void {
  if (!enabled) return;
  ensureInstalled();
  const s = getState(portalId);
  s.total++;
  if (scrolling) {
    s.commitsThisScroll++;
    // Round to whole pixels — sub-pixel wobble is not the jitter we measure.
    s.frameTops.add(Math.round(top));
    scheduleFrameFlush();
  }
}

/** Read the current stats directly (used by tests and callers without `window`). */
export function readScrollRepositionStats(): Record<
  string,
  ScrollRepositionStat
> {
  return snapshot();
}

// ── Test-support hooks ─────────────────────────────────────────────────────
// The unit test drives the SAME internal state machine the real scroll/RAF
// wiring drives, so the guardrail exercises production logic (not a re-model).

/** @internal test-only — clear all probe state. */
export function __resetScrollRepositionProbeForTest(): void {
  states.clear();
  scrolling = false;
  frameScheduled = false;
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** @internal test-only — simulate a scroll gesture starting/ending. */
export function __setScrollActiveForTest(active: boolean): void {
  if (active) beginOrContinueScroll();
  else endScroll();
}

/** @internal test-only — simulate an animation-frame boundary. */
export function __flushScrollRepositionFrameForTest(): void {
  flushFrame();
}
