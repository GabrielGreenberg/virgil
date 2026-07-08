// A module-level SSOT flag + begin/end pub-sub for "a Library L/R panel-resize
// gutter is currently being dragged". Published imperatively by LibraryView's
// column resizers (`makeResizeHandler`, which backs BOTH the LEFT nav|middle
// and RIGHT middle|reader gutters) on pointerdown/pointerup.
//
// Why this exists (task 090). The column resizers already keep the drag off the
// React render path — they write `gridTemplateColumns` straight to the grid node
// per `pointermove` and commit to the store only once on `pointerup`. But that
// per-frame width change wakes downstream ResizeObserver → setState → SVG-repaint
// cascades in the tab chrome (`PanelFolderTab` tab-width RO, `TabbedLibraryPanel`
// body-frame RO, `PanelTabStrip` flush-right RO). Sub-pixel `Math.ceil`/`round`
// flips the folder-silhouette `d` string frame-to-frame ("random redraw") and the
// N synchronous RO callbacks/frame drop frames ("choppy").
//
// The fix mirrors the keystroke-sanctity / scroll-anchor discipline: PARK the
// reactive observers for the duration of the gesture (they stash a dirty bit and
// early-return instead of measuring/repainting), then reconcile final geometry
// exactly ONCE on the drag-clear edge. The grid keeps updating imperatively
// throughout — only this boolean + a begin/end signal cross the module boundary,
// never per-frame React state.

type Listener = (active: boolean) => void;

let dragging = false;
const listeners = new Set<Listener>();

/** True while a Library L/R gutter drag is in flight. Read from an RO callback
 *  to decide whether to park (stash dirty + return) instead of measuring. */
export function isGutterDragging(): boolean {
  return dragging;
}

/** Mark a gutter drag as started. Idempotent — notifies listeners only on the
 *  false→true edge. */
export function beginGutterDrag(): void {
  if (dragging) return;
  dragging = true;
  for (const l of listeners) l(true);
}

/** Mark a gutter drag as ended. Idempotent — notifies listeners only on the
 *  true→false edge, which is the cue for parked observers to reconcile once. */
export function endGutterDrag(): void {
  if (!dragging) return;
  dragging = false;
  for (const l of listeners) l(false);
}

/** Subscribe to gutter-drag begin(true)/end(false) edges. Returns an
 *  unsubscribe fn. Listeners fire only on an actual edge, never per frame. */
export function onGutterDragChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
