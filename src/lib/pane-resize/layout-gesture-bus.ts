// The app-wide LAYOUT-GESTURE bus — ONE "a continuous layout gesture is in
// flight" signal for both silos and BOTH gesture families.
//
// History. This started as the PaneDragBus, which replaced the two disjoint
// park buses that let observers park on the wrong bus across silos: the
// Library's module flag (library/lib/gutter-drag.ts, consumed only by the
// tab-chrome observers) and the editor's `virgil:drag-gap-start/end` window
// CustomEvents (dispatched by the deleted useDragGap hook, consumed by
// EditorScrollbar). Both are gone; every consumer subscribes here.
//
// Task 317 widened it. The parking doctrine was STRUCTURALLY UNREACHABLE for
// the OS window-resize gesture: `activeDrag` was set from exactly one call
// site repo-wide — the old `beginPaneDrag(info)` inside the engine's
// `onPointerDown` — and **an OS window drag delivers no pointer events to the
// page at all**. So
// every park took its immediate-`run()` branch, PaneFreeze never locked, and
// all 18 `addEventListener("resize")` sites plus ~17 ResizeObservers re-solved
// geometry every frame of a live window drag (the PWA window-resize flicker,
// worst on the left edge, where a late frame displaces the whole window's
// contents rather than a stale edge strip).
//
// Perf Wave 2 widened it again: CONTENT drags (drop-mode sessions — block /
// text-object / inline-atom / card-anchor / stack-pull) publish as a third
// kind, so the geometry followers park during them too and the drag pays
// O(1) settles instead of per-frame re-measures.
//
// ONE bus, three PUBLISHERS. The consumer set is identical, and the second
// subscription is exactly the one that gets forgotten — this bug's own
// signature was `RightDetail.tsx` parking its ResizeObserver on the pane bus
// while registering a raw window `resize` listener to the same scheduler 38
// lines away. The publishers stay separate because the DETECTORS genuinely
// differ (pointer edges vs a resize burst with no `resizestart` event vs the
// drop-mode session lifecycle), and they are colocated here because
// `beginLayoutGesture`/`endLayoutGesture` are
// engine-internal: they are deliberately NOT exported from the `pane-resize`
// barrel, so no consumer can fake a gesture edge. Colocation is the strongest
// form of that guarantee.
//
// Discipline: EDGES ONLY, never per-frame. Listeners fire exactly once on the
// begin edge and once on the end edge of a gesture; the per-frame geometry
// stream stays inside the engine's RAF-coalesced `apply()` (pane) or is simply
// dropped (window) and never crosses this boundary. Gestures may OVERLAP (an
// external-display / Stage-Manager reflow while a divider drag is live), so
// the bus tracks a SET and publishes only the 0→1 and 1→0 transitions — a
// consumer must never see an end edge while another gesture is still moving
// its geometry.

import {
  recordLayoutGestureEdge,
  recordLayoutGestureFrame,
} from "../layout-gesture-probe";

export type LayoutGestureKind = "pane" | "window" | "content";

export interface LayoutGestureInfo {
  /** Which family produced this gesture. Consumers that care about the
   *  MOVING edge (PaneFreeze, whose anchor must be the *stationary* side)
   *  filter on it; the parking majority does not. */
  kind: LayoutGestureKind;
  /** The dragging handle's stable spec id, or `"window"` for the OS gesture
   *  (probes/consumers key off it). */
  id: string;
  /** The axis the gesture moves. A window resize can move both. */
  axis: "x" | "y" | "both";
}

type LayoutGestureListener = (
  active: boolean,
  info: LayoutGestureInfo,
) => void;

// Keyed by `kind:id`. A single slot was the pre-317 SSOT and is no longer
// sufficient: pane and window gestures can be live simultaneously, and an end
// edge published while another gesture still moves geometry would un-park
// every follower mid-flight.
const activeGestures = new Map<string, LayoutGestureInfo>();
const listeners = new Set<LayoutGestureListener>();

const keyOf = (info: LayoutGestureInfo): string => `${info.kind}:${info.id}`;

/** True while ANY continuous layout gesture is in flight — a pane-divider
 *  drag in either silo, an OS window resize, or a content drag (a block /
 *  text-object / card-anchor drop-mode session). Read from an observer
 *  callback to decide whether to park (stash dirty + return). */
export function isLayoutGestureActive(): boolean {
  ensureWindowGesturePublisher();
  return activeGestures.size > 0;
}

/** Kind-filtered variant: true while a gesture of one of the given KINDS is
 *  in flight. This — not an `info.kind` check inside an edge listener — is
 *  how a kind-sensitive consumer must filter, because the main channel
 *  publishes only the OUTERMOST edges: when gestures overlap, the begin
 *  edge carries the first-begun gesture's info and the end edge the
 *  last-ended one's, which can be DIFFERENT kinds — an `info.kind` filter
 *  there skips the unfreeze/restore half and wedges the consumer. Subscribe
 *  to `onLayoutGestureSetChange` and re-evaluate this predicate per change. */
export function hasActiveLayoutGesture(kinds: readonly LayoutGestureKind[]): boolean {
  ensureWindowGesturePublisher();
  for (const info of activeGestures.values()) {
    if (kinds.includes(info.kind)) return true;
  }
  return false;
}

/** Subscribe to gesture begin(true)/end(false) edges. Returns an unsubscribe
 *  fn. Listeners fire only on an actual edge, never per frame — and only on
 *  the OUTERMOST edge when gestures overlap. */
export function onLayoutGestureChange(fn: LayoutGestureListener): () => void {
  ensureWindowGesturePublisher();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A single gesture entering (`began: true`) or leaving (`began: false`) the
 *  active set — `info` is always THAT gesture's own info, unlike the main
 *  channel's outermost-edge info. Still edge-only (≤2 fires per gesture,
 *  never per frame). */
export type LayoutGestureSetListener = (
  began: boolean,
  info: LayoutGestureInfo,
) => void;

const setListeners = new Set<LayoutGestureSetListener>();

/** Subscribe to every MEMBERSHIP change of the active-gesture set. This is
 *  the channel for consumers that filter by `kind` or `id`: under overlap
 *  the main channel can deliver a begin and end of DIFFERENT gestures (or
 *  swallow an inner gesture's edges entirely), so an id/kind filter there
 *  strands the consumer's restore half. Here every gesture's own begin AND
 *  end always arrive, so `began`+`info` filtering is sound; kind-sensitive
 *  state should be recomputed via `hasActiveLayoutGesture(kinds)` per fire
 *  (idempotent under any interleaving). */
export function onLayoutGestureSetChange(fn: LayoutGestureSetListener): () => void {
  ensureWindowGesturePublisher();
  setListeners.add(fn);
  return () => {
    setListeners.delete(fn);
  };
}

/** @internal Publisher-only (the engine's `usePaneResizeHandle`, and the
 *  window publisher below). Idempotent: a begin for an already-active gesture
 *  is swallowed, and a begin while a DIFFERENT gesture is live joins the set
 *  without re-publishing the begin edge. */
export function beginLayoutGesture(info: LayoutGestureInfo): void {
  const key = keyOf(info);
  if (activeGestures.has(key)) return;
  const wasIdle = activeGestures.size === 0;
  activeGestures.set(key, info);
  for (const l of setListeners) l(true, info);
  if (!wasIdle) return;
  recordLayoutGestureEdge(true);
  for (const l of listeners) l(true, info);
}

/** @internal Publisher-only. Ends one gesture; an absent gesture is a no-op so
 *  a stray end can't fire an edge, and the end EDGE publishes only when the
 *  last live gesture leaves. */
export function endLayoutGesture(info: LayoutGestureInfo): void {
  const key = keyOf(info);
  if (!activeGestures.delete(key)) return;
  for (const l of setListeners) l(false, info);
  if (activeGestures.size > 0) return;
  recordLayoutGestureEdge(false);
  for (const l of listeners) l(false, info);
}

// ── Publisher 2: the OS window resize ───────────────────────────────────────
// There is no `resizestart`/`resizeend`, and (unlike a pane divider) no
// pointer stream to derive one from — an OS window drag delivers no pointer
// events to the page. So the edges are inferred from the resize BURST:
//
//   BEGIN — on the SECOND resize event inside one frame budget. A one-shot
//     resize (maximize, zoom, keyboard, DPR change, a rotation) fires a single
//     event and therefore never parks anything: it settles immediately, and
//     nothing is left stale for the debounce window.
//   END   — a trailing idle debounce. A FALSE end (the user holds the mouse
//     still mid-drag) is benign by construction: every follower settles once
//     at the held position and re-parks on the next event.
//
// Cost of the detector itself: one timestamp compare + one timer reset per
// resize event. Nothing measures, nothing renders.

const WINDOW_GESTURE: LayoutGestureInfo = {
  kind: "window",
  id: "window",
  axis: "both",
};

/** Two resize events this close together mean a continuous drag, not two
 *  independent one-shots. Generous vs a 60 Hz frame (16.7 ms) so a hitchy
 *  first frame still registers. */
const RESIZE_BURST_MS = 100;
/** No resize event for this long ⇒ the gesture ended. */
const RESIZE_IDLE_MS = 150;

let lastResizeAt = 0;
let windowGestureLive = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let publisherInstalled = false;

/** Kill switch for the WINDOW publisher only (pane parking is untouched):
 *  `localStorage['virgil:layout-gesture'] = 'off'`, then reload. Read once at
 *  install so the hot path stays a boolean. */
function windowPublisherDisabled(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("virgil:layout-gesture") === "off"
    );
  } catch {
    return false;
  }
}

function endWindowGesture(): void {
  idleTimer = null;
  lastResizeAt = 0;
  if (!windowGestureLive) return;
  windowGestureLive = false;
  endLayoutGesture(WINDOW_GESTURE);
}

function onWindowResizeEvent(): void {
  const now = Date.now();
  const prev = lastResizeAt;
  lastResizeAt = now;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(endWindowGesture, RESIZE_IDLE_MS);
  if (windowGestureLive) {
    recordLayoutGestureFrame();
    return;
  }
  // `prev === 0` is the first event of a burst — one event is a one-shot
  // until a second proves otherwise.
  if (prev === 0 || now - prev > RESIZE_BURST_MS) return;
  windowGestureLive = true;
  beginLayoutGesture(WINDOW_GESTURE);
  // The two events that established the burst are frames too.
  recordLayoutGestureFrame();
  recordLayoutGestureFrame();
}

// ── Publisher 3: content drags (perf Wave 2) ────────────────────────────────
// A drop-mode session — a block / text-object / inline-atom / card-anchor /
// stack-pull drag — is a continuous layout gesture too: the pointer stream
// drives a per-move hit-test and overlay while every geometry follower's
// input (block rects, marginalia metrics, in-text positions) is either
// irrelevant or about to be invalidated once by the drop. Publishing it here
// gives all of them the same O(1)-settles discipline with zero code change.
//
// The DETECTOR is the drop-mode controller (`beginDropSession` /
// `commitDropSession` / `endDropSession` — the single chokepoint every
// pointer-driven content drag already routes through), but the PUBLISHER
// lives colocated like its two siblings, exposing only a begin/end pair that
// pins `kind: "content"` — so no caller can fake a pane or window edge, and
// the controller cannot mismatch begin/end keys (the live id is tracked
// here). Not exported from the barrel; the controller is the one legitimate
// importer (pinned by the content-drag guardrail).
//
// Edge shape: begin on session start, end on POINTER release (commit entry)
// or cancel — both idempotent, so the cancel funnel double-firing is a no-op.
// Ending at commit entry rather than after the async apply matters twice
// over: a confirm dialog must not hold every park hostage while the user
// reads it, and the commit's own structural burst then settles through the
// normal live paths (one coalesced pass each).

let liveContentGestureId: string | null = null;

/** @internal Publisher-only (the drop-mode controller). No-op if a content
 *  gesture is already live — sessions are single-flight by construction
 *  ("first gesture wins"), so a second begin is a programming error upstream
 *  and must not double-enter the set. */
export function beginContentGesture(id: string): void {
  if (liveContentGestureId !== null) return;
  liveContentGestureId = id;
  beginLayoutGesture({ kind: "content", id, axis: "both" });
}

/** @internal Publisher-only. Ends the live content gesture, whatever its id —
 *  tracked here so a begin/end pair can never mismatch keys. No-op if none. */
export function endContentGesture(): void {
  if (liveContentGestureId === null) return;
  const id = liveContentGestureId;
  liveContentGestureId = null;
  endLayoutGesture({ kind: "content", id, axis: "both" });
}

/** Idempotent. Installed eagerly at module load in a browser (the earliest
 *  possible registration, so the detector sees a drag's first events before
 *  the component-level handlers registered later in mount order) and re-armed
 *  by the bus accessors for tests that reset the module state. */
export function ensureWindowGesturePublisher(): void {
  if (publisherInstalled || typeof window === "undefined") return;
  publisherInstalled = true;
  if (windowPublisherDisabled()) return;
  window.addEventListener("resize", onWindowResizeEvent);
}

ensureWindowGesturePublisher();

/** @internal Test hygiene only — clears the singleton between cases (both the
 *  gesture set and the window publisher's burst state). */
export function __resetLayoutGestureBusForTest(): void {
  activeGestures.clear();
  listeners.clear();
  setListeners.clear();
  liveContentGestureId = null;
  windowGestureLive = false;
  lastResizeAt = 0;
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** @internal Test hygiene only — the live listener count ACROSS BOTH
 *  channels (outermost-edge + set-change), so suites can pin that
 *  unmount/dispose paths really unsubscribe. (Node-state assertions can't:
 *  React nulls a consumer's ref before a leaked listener could run, so a
 *  discarded node stays inert whether or not the subscription leaked.) */
export function __layoutGestureListenerCountForTest(): number {
  return listeners.size + setListeners.size;
}

/** @internal Test-only — drive the WINDOW publisher's detector directly, so
 *  the suite exercises the production state machine rather than a re-model.
 *  (jsdom fires no real resize events.) */
export function __emitWindowResizeForTest(): void {
  onWindowResizeEvent();
}
