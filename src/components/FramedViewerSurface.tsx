import type { CSSProperties, ReactNode } from "react";

/**
 * The single framed-viewer surface shared by the docs-side compiled-PDF pane
 * ([EditorLayout.tsx]) and the Library PDF pane ([library/components/RightDetail.tsx]).
 *
 * It is the **four-layer frame** both viewers were duplicating: an outer flex
 * that insets its child by 4px on three sides (creating the thin border ring),
 * wrapping an inner pod that carries the backdrop fill + `--pod-border` +
 * `--pod-radius` + `--pod-shadow`. The consumer drops the actual viewer
 * (`<iframe>` etc.) plus any absolutely-positioned overlays (stale badge) as
 * `children` — the pod is `position: relative` so overlays anchor to it.
 *
 * Parameterized only by `backdrop`, so the two viewers stay geometrically
 * symmetric forever: `dark` (#525659, seamless with pdf.js's own dark chrome)
 * for the docs compiled PDF, `manila` (`--library-bg`) for the Library viewer.
 * The bottom inset is overridable (the docs viewer tightens it to 4px in zen
 * mode; otherwise it's the `--pod-gap` that separates the pod from the chrome
 * below it).
 */
const BACKDROPS = {
  /** Docs compiled-PDF pane — matches pdf.js's own dark viewer chrome. */
  dark: "#525659",
  /** Library PDF pane — the warm "manila" library canvas. */
  manila: "var(--library-bg)",
} as const;

export type FramedViewerBackdrop = keyof typeof BACKDROPS;

interface FramedViewerSurfaceProps {
  backdrop: FramedViewerBackdrop;
  /**
   * Bottom inset. Defaults to `--pod-gap` (the pod-to-chrome separation used
   * everywhere); the docs viewer passes `4` in zen mode to tighten it.
   */
  paddingBottom?: CSSProperties["paddingBottom"];
  children: ReactNode;
}

export default function FramedViewerSurface({
  backdrop,
  paddingBottom = "var(--pod-gap)",
  children,
}: FramedViewerSurfaceProps) {
  return (
    <div
      className="flex flex-1 overflow-hidden"
      style={{
        paddingTop: 4,
        paddingBottom,
        paddingLeft: 4,
        paddingRight: 4,
      }}
    >
      <div
        className="flex-1 flex flex-col min-h-0 overflow-hidden relative"
        style={{
          background: BACKDROPS[backdrop],
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
