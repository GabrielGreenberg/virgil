// The app-wide pane-drag bus — ONE "a pane-resize gesture is in flight"
// signal for both silos. Replaced the two disjoint park buses that let
// observers park on the wrong bus across silos: the Library's module flag
// (library/lib/gutter-drag.ts, consumed only by the tab-chrome observers) and
// the editor's `virgil:drag-gap-start/end` window CustomEvents (dispatched by
// the deleted useDragGap hook, consumed by EditorScrollbar). Both are gone;
// every consumer subscribes here.
//
// Discipline: EDGES ONLY, never per-frame. Listeners fire exactly once on the
// begin edge and once on the end edge of a gesture; the per-frame geometry
// stream stays inside the engine's RAF-coalesced `apply()` and never crosses
// this boundary. `beginPaneDrag`/`endPaneDrag` are engine-internal — only
// `usePaneResizeHandle` may call them (they are deliberately NOT exported from
// the `pane-resize` barrel).

export interface PaneDragInfo {
  /** The dragging handle's stable spec id (probes/consumers key off it). */
  id: string;
  axis: "x" | "y";
}

type PaneDragListener = (active: boolean, info: PaneDragInfo) => void;

// At most one pane gesture exists at a time (the engine refuses a pointerdown
// while another drag is in flight), so a single slot — not a set — is the SSOT.
let activeDrag: PaneDragInfo | null = null;
const listeners = new Set<PaneDragListener>();

/** True while any pane-resize gesture is in flight, either silo. Read from an
 *  observer callback to decide whether to park (stash dirty + return). */
export function isPaneDragging(): boolean {
  return activeDrag !== null;
}

/** Subscribe to drag begin(true)/end(false) edges. Returns an unsubscribe fn.
 *  Listeners fire only on an actual edge, never per frame. */
export function onPaneDragChange(fn: PaneDragListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** @internal Engine-only (usePaneResizeHandle). Idempotent: a begin while a
 *  drag is already active is swallowed — the engine's own pointerdown gate
 *  makes that unreachable, but the bus must never double-fire an edge. */
export function beginPaneDrag(info: PaneDragInfo): void {
  if (activeDrag !== null) return;
  activeDrag = info;
  for (const l of listeners) l(true, info);
}

/** @internal Engine-only (usePaneResizeHandle). Ends the active drag; a
 *  mismatched or absent drag is a no-op so a stray end can't fire an edge. */
export function endPaneDrag(info: PaneDragInfo): void {
  if (activeDrag === null || activeDrag.id !== info.id) return;
  activeDrag = null;
  for (const l of listeners) l(false, info);
}

/** @internal Test hygiene only — clears the singleton between cases. */
export function __resetPaneDragBusForTest(): void {
  activeDrag = null;
  listeners.clear();
}

/** @internal Test hygiene only — the live listener count, so suites can pin
 *  that unmount/dispose paths really unsubscribe. (Node-state assertions
 *  can't: React nulls a consumer's ref before a leaked listener could run,
 *  so a discarded node stays inert whether or not the subscription leaked.) */
export function __paneDragListenerCountForTest(): number {
  return listeners.size;
}
