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

/** A panel half/slot: the always-mounted omni layer plus an optional
 *  opaque overlay. When `overlay` is `null`, omni is visible; otherwise
 *  the overlay occludes omni while omni stays mounted underneath. */
export type PanelSlot = { omni: React.ReactNode; overlay: React.ReactNode | null };

/**
 * Width-resizable column wrapper for sidebar panels. Accepts either a
 * single slot (`{omni, overlay}`) or a split of two slots plus ratio.
 *
 * Omni is always mounted inside every slot; closing a specific panel
 * just drops the overlay and reveals omni instantly.
 */
export function PanelColumn({
  side,
  pageWidth,
  onPageWidthChange,
  panelPref,
  onPanelPrefChange,
  children,
  split,
  collapsed,
  focusedHalf,
  onFocusHalf,
  topPanelId,
  bottomPanelId,
  topOverlay,
}: {
  side: "left" | "right";
  /** Current preferred page width. Dragging the panel's inner edge
   *  adjusts this — toward center shrinks the page, away widens it —
   *  and the panel flexes to fill the remainder. */
  pageWidth: number;
  onPageWidthChange: (w: number) => void;
  /** This side's panel flex-basis. Dragging updates it in lockstep with
   *  pageWidth so the panel edge tracks the cursor exactly instead of
   *  splitting the delta with the opposite side. */
  panelPref: number;
  onPanelPrefChange: (w: number) => void;
  children?:
    | PanelSlot
    | {
        top: PanelSlot;
        bottom: PanelSlot;
        ratio: number;
        onRatioChange: (r: number) => void;
      };
  split?: boolean;
  collapsed?: boolean;
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
  const startPage = useRef(0);
  const startPanel = useRef(0);
  const stackRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (e: MouseEvent) => {
      // Inner-edge drag toward editor-center → panel grows, page shrinks.
      // Away from center → panel shrinks, page grows. Updating both in
      // lockstep keeps the dragged edge glued to the cursor.
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      onPageWidthChange(startPage.current - delta);
      onPanelPrefChange(Math.max(0, startPanel.current + delta));
    },
    [side, onPageWidthChange, onPanelPrefChange],
  );

  const { gapRef, onMouseDown: gapMouseDown } = useDragGap({
    cursor: "col-resize",
    onMove,
    deadzone: 3,
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      startPage.current = pageWidth;
      startPanel.current = panelPref;
      gapMouseDown(e);
    },
    [pageWidth, panelPref, gapMouseDown],
  );

  // Determine if children is a split spec or single slot
  const isSplitChildren = (
    c: typeof children,
  ): c is {
    top: PanelSlot;
    bottom: PanelSlot;
    ratio: number;
    onRatioChange: (r: number) => void;
  } =>
    !!c && typeof c === "object" && !Array.isArray(c) && "top" in (c as object) && "bottom" in (c as object);

  const podRadius = 'var(--pod-radius)';

  // Chromeless slots render on the bare canvas (no pod background/border).
  // Omni and blank are both chromeless; specific panels get a pod.
  const isChromeless = (id?: PanelId) => id === "omni" || id === "blank";

  const renderSlot = (slot: PanelSlot) => (
    <>
      {slot.omni}
      {slot.overlay && (
        // Opaque background on the overlay wrapper so the always-mounted
        // omni layer underneath never bleeds through panel content that
        // has gaps or semi-transparent regions.
        <div className="absolute inset-0" style={{ background: 'var(--pod-panel)' }}>
          {slot.overlay}
        </div>
      )}
    </>
  );

  return (
    <div className="relative flex" style={{ flex: `1 100 ${panelPref}px`, minWidth: 'var(--panel-min)', paddingTop: 'var(--pod-gap)', paddingBottom: 'var(--pod-gap)', paddingLeft: 4, paddingRight: 4 }}>
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
            className="relative min-h-0 overflow-hidden"
            style={isChromeless(topPanelId)
              ? { flex: `${children!.ratio} 1 0`, minHeight: 0 }
              : { flex: `${children!.ratio} 1 0`, minHeight: 0, background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
            onMouseDown={() => onFocusHalf?.("top")}
            data-panel-side={side}
            data-panel-id={topPanelId}
            data-panel-half="top"
          >
            {renderSlot(children!.top)}
          </div>
          <HSplit
            ratio={children!.ratio}
            onRatioChange={children!.onRatioChange}
            containerRef={stackRef}
          />
          <div
            className="relative min-h-0 overflow-hidden"
            style={isChromeless(bottomPanelId)
              ? { flex: `${1 - children!.ratio} 1 0`, minHeight: 0 }
              : { flex: `${1 - children!.ratio} 1 0`, minHeight: 0, background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
            onMouseDown={() => onFocusHalf?.("bottom")}
            data-panel-side={side}
            data-panel-id={bottomPanelId}
            data-panel-half="bottom"
          >
            {renderSlot(children!.bottom)}
          </div>
        </div>
      ) : (
        <div
          className={`relative flex-1 min-w-0 panel-container ${isChromeless(topPanelId) ? "" : "overflow-hidden"} ${side === "left" ? "order-1" : "order-2"}`}
          style={isChromeless(topPanelId) ? undefined : { background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
          data-panel-side={side}
          data-panel-id={topPanelId}
        >
          {renderSlot(children as PanelSlot)}
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
