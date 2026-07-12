// Public surface of the pane-resize primitive. `beginPaneDrag`/`endPaneDrag`
// and the drag shield are engine-internal by design — consumers get the hook
// plus the read-only side of the bus, so no caller can fake a gesture edge.

export {
  usePaneResizeHandle,
  type PaneResizeSpec,
  type PaneResizeHandleProps,
} from "./use-pane-resize-handle";
export {
  isPaneDragging,
  onPaneDragChange,
  type PaneDragInfo,
} from "./pane-drag-bus";
