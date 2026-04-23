import { useCallback, useRef, useState } from "react";
import { useDragGap } from "@/hooks/useDragGap";
import { PanelId } from "@/hooks/useViewPrefs";
import { HSplit } from "../panel-primitives";
import ViewToggle from "../ViewToggle";

export function PlaceholderPanel({ title, hasViewToggle }: { title: string; hasViewToggle?: boolean }) {
  const [viewMode, setViewMode] = useState<import("../ViewToggle").ViewMode>("list");
  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <div className="px-4 border-b border-[var(--border)] h-[var(--header-h)] shrink-0 flex items-center justify-between bg-[var(--header-bg)]">
        <h3 className="text-sm font-semibold text-ink-body">{title}</h3>
        {hasViewToggle && <ViewToggle mode={viewMode} onChange={setViewMode} />}
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-[var(--muted)] text-center">
          {title} panel — coming soon.
        </p>
      </div>
    </div>
  );
}

/**
 * Width-resizable column wrapper for sidebar panels. Supports a single
 * panel as a child OR a split: { top, bottom, ratio, onRatioChange }.
 */
export function PanelColumn({
  side,
  width,
  onWidthChange,
  children,
  split,
  collapsed,
  blank,
  focusedHalf,
  onFocusHalf,
  topPanelId,
  bottomPanelId,
  topOverlay,
}: {
  side: "left" | "right";
  width: number;
  onWidthChange: (w: number) => void;
  children?:
    | React.ReactNode
    | {
        top: React.ReactNode;
        bottom: React.ReactNode;
        ratio: number;
        onRatioChange: (r: number) => void;
      };
  split?: boolean;
  collapsed?: boolean;
  blank?: boolean;
  focusedHalf?: "top" | "bottom";
  onFocusHalf?: (half: "top" | "bottom") => void;
  topPanelId?: PanelId;
  bottomPanelId?: PanelId;
  /** Absolutely-positioned overlay rendered at the top of the column,
   *  centered horizontally. Used for per-column action toolbars when the
   *  column is showing Omni-view. */
  topOverlay?: React.ReactNode;
}) {
  const startX = useRef(0);
  const startWidth = useRef(0);
  const stackRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (e: MouseEvent) => {
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      onWidthChange(Math.max(240, Math.min(600, startWidth.current + delta)));
    },
    [side, onWidthChange],
  );

  const { gapRef, onMouseDown: gapMouseDown } = useDragGap({
    cursor: "col-resize",
    onMove,
    deadzone: 3,
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      startWidth.current = width;
      gapMouseDown(e);
    },
    [width, gapMouseDown],
  );

  // Determine if children is a split spec or single ReactNode
  const isSplitChildren = (
    c: typeof children,
  ): c is {
    top: React.ReactNode;
    bottom: React.ReactNode;
    ratio: number;
    onRatioChange: (r: number) => void;
  } =>
    !!c && typeof c === "object" && !Array.isArray(c) && "top" in (c as object) && "bottom" in (c as object);

  const podRadius = 'var(--pod-radius)';

  return (
    <div className="relative flex shrink-0" style={{ width, paddingTop: 'var(--pod-gap)', paddingBottom: 'var(--pod-gap)', paddingLeft: 4, paddingRight: 4 }}>
      {/* Panel pod — partial rounding (flat against icon strip, rounded toward editor) */}
      {collapsed ? (
        /* Collapsed: empty placeholder preserving layout space */
        <div className={`flex-1 min-w-0 ${side === "left" ? "order-1" : "order-2"}`} />
      ) : split && isSplitChildren(children) ? (
        /* When split, each half is its own pod so the gap reveals the canvas */
        <div
          ref={stackRef}
          className={`flex-1 min-w-0 flex flex-col min-h-0 panel-container ${side === "left" ? "order-1" : "order-2"}`}
        >
          <div
            className="min-h-0 overflow-hidden"
            style={topPanelId === "omni"
              ? { flex: `${children!.ratio} 1 0`, minHeight: 0 }
              : { flex: `${children!.ratio} 1 0`, minHeight: 0, background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
            onMouseDown={() => onFocusHalf?.("top")}
            data-panel-side={side}
            data-panel-id={topPanelId}
            data-panel-half="top"
          >
            {children!.top}
          </div>
          <HSplit
            ratio={children!.ratio}
            onRatioChange={children!.onRatioChange}
            containerRef={stackRef}
          />
          <div
            className="min-h-0 overflow-hidden"
            style={bottomPanelId === "omni"
              ? { flex: `${1 - children!.ratio} 1 0`, minHeight: 0 }
              : { flex: `${1 - children!.ratio} 1 0`, minHeight: 0, background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
            onMouseDown={() => onFocusHalf?.("bottom")}
            data-panel-side={side}
            data-panel-id={bottomPanelId}
            data-panel-half="bottom"
          >
            {children!.bottom}
          </div>
        </div>
      ) : (
        <div
          className={`flex-1 min-w-0 panel-container ${blank ? "" : "overflow-hidden"} ${side === "left" ? "order-1" : "order-2"}`}
          style={blank ? undefined : { background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
          data-panel-side={side}
          data-panel-id={topPanelId}
        >
          {(children as React.ReactNode)}
        </div>
      )}
      {/* Drag gap — spans full gutter between panel pod and editor pod.
          The gap element itself is --pod-gap wide, but the wrappers on
          each side add 4px padding, so the real visual gutter is wider.
          `drag-gap-toward-editor-*` nudges the ::after highlight so it
          sits at the true center of the visible gutter. */}
      <div
        ref={gapRef}
        className={`drag-gap drag-gap-v shrink-0 ${side === "left" ? "order-2 drag-gap-toward-editor-right" : "order-1 drag-gap-toward-editor-left"}`}
        style={{ width: 'var(--pod-gap)' }}
        onMouseDown={onMouseDown}
      />
      {topOverlay && (
        <div
          className="absolute top-[14px] left-1/2 -translate-x-1/2 z-10 pointer-events-auto"
        >
          {topOverlay}
        </div>
      )}
    </div>
  );
}
