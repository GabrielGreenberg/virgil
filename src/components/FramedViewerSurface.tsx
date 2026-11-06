import type { CSSProperties, ReactNode } from "react";

/**
 * The single framed-viewer surface shared by the docs-side compiled-PDF pane
 * ([EditorLayout.tsx] — the right-hand pane of the text split, task 1320) and the Library PDF pane ([library/components/RightDetail.tsx]).
 *
 * It is the **four-layer frame** both viewers were duplicating: an outer flex
 * that insets its child by 4px on three sides (creating the thin border ring),
 * wrapping an inner pod that carries the backdrop fill + `--pod-border` +
 * `--pod-radius` + `--pod-shadow`. The consumer drops the actual viewer
 * (`<iframe>` etc.) plus any absolutely-positioned overlays (stale badge) as
 * `children` — the pod is `position: relative` so overlays anchor to it.
 *
 * It stands on the colour the viewer paints around its pages, so the pod and the
 * viewer read as one surface before the first page lands and behind a notice.
 * The bottom inset is overridable (the docs viewer tightens it to 4px in zen
 * mode; otherwise it's the `--pod-gap` that separates the pod from the chrome
 * below it).
 */
interface FramedViewerSurfaceProps {
  /**
   * Bottom inset. Defaults to `--pod-gap` (the pod-to-chrome separation used
   * everywhere); the docs viewer passes `4` in zen mode to tighten it.
   */
  paddingBottom?: CSSProperties["paddingBottom"];
  /**
   * Left inset. Defaults to 4px; the docs viewer passes `0` because it sits
   * right of the split divider, whose own gap already separates it from the
   * text pod (task 1320 — the same edge the code pod has).
   */
  paddingLeft?: CSSProperties["paddingLeft"];
  children: ReactNode;
}

export default function FramedViewerSurface({
  paddingBottom = "var(--pod-gap)",
  paddingLeft = 4,
  children,
}: FramedViewerSurfaceProps) {
  return (
    <div
      className="flex flex-1 overflow-hidden"
      style={{
        paddingTop: 4,
        paddingBottom,
        paddingLeft,
        paddingRight: 4,
      }}
    >
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden relative"
        style={{
          background: "var(--background)",
          borderRadius: "var(--pod-radius)",
          border: "var(--pod-border)",
          boxShadow: "var(--pod-shadow)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
