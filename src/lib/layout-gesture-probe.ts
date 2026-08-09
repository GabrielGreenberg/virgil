// Layout-gesture stability probe (task 317) — the runtime half of the
// window-resize guardrail, and the fourth probe sibling after
// `scroll-reposition-probe` (per-frame overlay jitter),
// `keystroke-latency-probe` (keydown→paint + work attribution) and
// `__virgilBusStats` (structural-diff emit counts).
//
// What it measures: whether a geometry follower obeys the layout-gesture
// invariant — *a continuous layout gesture (pane divider drag OR OS window
// resize) costs O(1) settles, not O(frames) recomputes.* Every follower either
// PARKS (stash the call, replay exactly once on the gesture's end edge) or
// SUPPRESSES (hide for the gesture, restore on the end edge). Nothing
// re-solves per frame.
//
// Read it from the dev console while drag-resizing the window:
//
//   window.__layoutGestureStatsReset()
//   … drag the window edge for ~2s, release …
//   window.__layoutGestureStats()
//   → {
//       gesture: { gestures, framesInGesture, active },
//       sites: { "viewport-cache": { parkedFires, settles, liveRuns }, … },
//     }
//
// The assertions the task's `## Verify` names:
//   - during a continuous drag every parked site reports `settles === 0` and
//     `parkedFires ≈ framesInGesture`;
//   - after release, **exactly 1** settle per site that fired;
//   - `liveRuns > 0` only from allowlisted stay-live sites;
//   - a ONE-SHOT resize (maximize / zoom / DPR change) reports `gestures === 0`
//     — it never parks anything, so nothing is stale for the debounce window.
//
// Honest caveat, by construction: the window publisher needs TWO resize events
// to know a continuous gesture started (there is no `resizestart`), so the
// first one-or-two events of a real drag run LIVE and are counted in
// `liveRuns`. That is the detection floor, not a leak.
//
// The companion CI guard is `src/lib/__tests__/window-resize-guardrail.test.ts`
// (a source-grep census of every `addEventListener("resize"` site across both
// silos). The contract itself is written up in AGENTS.md ("Layout-gesture
// stability").

/** Canonical site ids — the geometry followers wired into the probe. */
export const LAYOUT_SITE_VIEWPORT_CACHE = "viewport-cache";
export const LAYOUT_SITE_MARGINALIA = "marginalia-registry";
export const LAYOUT_SITE_EDITOR_SCROLLBAR = "editor-scrollbar";
export const LAYOUT_SITE_SECTION_PATH = "section-path";
export const LAYOUT_SITE_SECTION_PATH_MIRROR = "section-path-mirror";
export const LAYOUT_SITE_READER_SECTION_PATH = "reader-section-path";
export const LAYOUT_SITE_IN_TEXT_POSITIONS = "in-text-positions";
export const LAYOUT_SITE_STACK_STRIP = "stack-strip";
export const LAYOUT_SITE_STACK_ICON = "stack-icon";
export const LAYOUT_SITE_BAND_MEASURE = "panel-band-measure";
export const LAYOUT_SITE_FIGURE_CHROME = "figure-chrome";
export const LAYOUT_SITE_SPLIT_WITH_CODE = "split-with-code";
export const LAYOUT_SITE_HELPER_ANCHOR = "helper-menu-anchor";
export const LAYOUT_SITE_SLASH_POPUP = "slash-command-popup";
export const LAYOUT_SITE_SELECTION_BOLT = "selection-actions-bolt";
export const LAYOUT_SITE_PENDING_PILL = "pending-change-pill";
export const LAYOUT_SITE_GRAB_HANDLE = "grab-handle";
export const LAYOUT_SITE_FLOATING_MENU = "floating-menu";

/** Per-site public stats shape. */
export interface LayoutGestureSiteStat {
  /** Calls swallowed (stashed) because a layout gesture was in flight. */
  parkedFires: number;
  /** Replays on a gesture's end edge. Exactly 1 per gesture per fired site. */
  settles: number;
  /** Calls that ran immediately (no gesture in flight). */
  liveRuns: number;
}

export interface LayoutGestureStats {
  gesture: {
    /** Completed + in-flight gestures since the last reset. */
    gestures: number;
    /** Publisher events observed during the CURRENT/most-recent gesture. */
    framesInGesture: number;
    active: boolean;
  };
  sites: Record<string, LayoutGestureSiteStat>;
}

// Dev/test only — production pays one boolean check per fire and nothing else.
const enabled =
  typeof window !== "undefined" && process.env.NODE_ENV !== "production";

const sites = new Map<string, LayoutGestureSiteStat>();
let gestures = 0;
let framesInGesture = 0;
let active = false;
let installed = false;

function getSite(siteId: string): LayoutGestureSiteStat {
  let s = sites.get(siteId);
  if (!s) {
    s = { parkedFires: 0, settles: 0, liveRuns: 0 };
    sites.set(siteId, s);
  }
  return s;
}

function snapshot(): LayoutGestureStats {
  const out: Record<string, LayoutGestureSiteStat> = {};
  for (const [id, s] of sites) out[id] = { ...s };
  return { gesture: { gestures, framesInGesture, active }, sites: out };
}

function reset(): void {
  sites.clear();
  gestures = 0;
  framesInGesture = 0;
}

function ensureInstalled(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const w = window as unknown as {
    __layoutGestureStats?: () => LayoutGestureStats;
    __layoutGestureStatsReset?: () => void;
  };
  w.__layoutGestureStats = snapshot;
  w.__layoutGestureStatsReset = reset;
}

/** @internal bus-only — a gesture begin(true)/end(false) edge was published. */
export function recordLayoutGestureEdge(isActive: boolean): void {
  if (!enabled) return;
  ensureInstalled();
  active = isActive;
  if (isActive) {
    gestures++;
    framesInGesture = 0;
  }
}

/** @internal publisher-only — one detector event (≈ one gesture frame). */
export function recordLayoutGestureFrame(): void {
  if (!enabled) return;
  ensureInstalled();
  framesInGesture++;
}

/** @internal park-only — a fire that was stashed instead of run. */
export function recordParkedFire(siteId: string): void {
  if (!enabled) return;
  ensureInstalled();
  getSite(siteId).parkedFires++;
}

/** @internal park-only — the once-per-gesture replay on the end edge. */
export function recordParkSettle(siteId: string): void {
  if (!enabled) return;
  ensureInstalled();
  getSite(siteId).settles++;
}

/** @internal park-only — a fire that ran straight through (no gesture). */
export function recordParkLiveRun(siteId: string): void {
  if (!enabled) return;
  ensureInstalled();
  getSite(siteId).liveRuns++;
}

/** Read the stats directly (tests, and callers without `window`). */
export function readLayoutGestureStats(): LayoutGestureStats {
  return snapshot();
}

/** @internal test-only — clear all probe state. */
export function __resetLayoutGestureProbeForTest(): void {
  reset();
  active = false;
}
