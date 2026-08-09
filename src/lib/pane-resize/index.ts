// Public surface of the pane-resize primitive. `beginLayoutGesture` /
// `endLayoutGesture` and the drag shield are engine-internal by design —
// consumers get the hook, the read-only side of the LAYOUT-GESTURE bus (so no
// caller can fake a gesture edge), and the three gesture-time follower
// utilities built on those edges: the PaneFreeze content wrapper, the
// park/settle helper for geometry followers, and the suppression hook for
// text-anchored overlays.

export {
  usePaneResizeHandle,
  type PaneResizeSpec,
  type PaneResizeHandleProps,
} from "./use-pane-resize-handle";
export {
  hasActiveLayoutGesture,
  isLayoutGestureActive,
  onLayoutGestureChange,
  onLayoutGestureSetChange,
  type LayoutGestureInfo,
  type LayoutGestureKind,
  type LayoutGestureSetListener,
} from "./layout-gesture-bus";
export { PaneFreeze, type PaneFreezeProps } from "./PaneFreeze";
export {
  parkDuringLayoutGesture,
  type LayoutGesturePark,
} from "./layout-gesture-park";
export { useLayoutGestureActive } from "./useLayoutGestureActive";
