// Public surface of the pane-resize primitive. `beginPaneDrag`/`endPaneDrag`
// and the drag shield are engine-internal by design — consumers get the hook,
// the read-only side of the bus (so no caller can fake a gesture edge), and
// the two drag-time follower utilities built on those edges: the PaneFreeze
// content wrapper and the park/settle helper for geometry observers.

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
export { PaneFreeze, type PaneFreezeProps } from "./PaneFreeze";
export { parkDuringPaneDrag, type PaneDragPark } from "./pane-drag-park";
