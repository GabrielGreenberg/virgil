import { useCallback, useRef } from "react";
import { useDragGap } from "@/hooks/useDragGap";
import { PanelId, type DockSlotKey, dockSlotKey } from "@/hooks/useViewPrefs";
import { HSplit } from "../panel-primitives";

export function PlaceholderPanel({ title }: { title: string }) {
  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <div className="px-4 border-b border-[var(--border)] h-[var(--header-h)] shrink-0 flex items-center justify-between bg-[var(--header-bg)]">
        <h3 className="text-sm font-semibold text-ink-body">{title}</h3>
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

/** Per-side dock-slot occupancy, passed in from the parent. Each entry
 *  is the panel id currently sitting in that slot (or absent if empty). */
export interface DockOccupancy {
  full?: PanelId;
  top?: PanelId;
  bottom?: PanelId;
}

/**
 * Width-resizable column wrapper for sidebar panels. Accepts either a
 * single slot (`{omni, overlay}`) or a split of two slots plus ratio.
 *
 * Omni is always mounted inside every slot; closing a specific panel
 * just drops the overlay and reveals omni instantly. When a panel is
 * *docked* into a slot, the slot's `data-dock-slot` attribute marks it
 * as a portal target — `<FloatingPanel mode="docked">` portals its
 * children into the slot, visually covering omni (which stays mounted).
 *
 * Docked panels extend up over the action-toolbar strip: when any slot
 * on this side is docked, the strip is hidden (display: none) so the
 * column's content starts at row-top with `var(--pod-gap)` padding. The
 * docked pod then occupies the equal-padding region all the way around.
 */
export function PanelColumn({
  side,
  panelPref,
  onPanelPrefChange,
  isResizing,
  onResizingChange,
  onSyncBeforeDrag,
  children,
  split,
  collapsed,
  focusedHalf,
  onFocusHalf,
  topPanelId,
  bottomPanelId,
  topOverlay,
  dockOccupancy,
}: {
  side: "left" | "right";
  panelPref: number;
  onPanelPrefChange: (w: number) => void;
  isResizing?: boolean;
  onResizingChange?: (r: boolean) => void;
  onSyncBeforeDrag?: () => void;
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
  topOverlay?: React.ReactNode;
  /** Which dock slots on this side are currently occupied. The slot's
   *  pod element gets `data-dock-slot="${side}-${half}"` so the
   *  panel-shell portal can find it. */
  dockOccupancy?: DockOccupancy;
}) {
  const startX = useRef(0);
  const startPanel = useRef(0);
  const stackRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (e: MouseEvent) => {
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      const panelMin = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--panel-min'),
      ) || 0;
      let requested = Math.max(panelMin, startPanel.current + delta);
      const col = gapRef.current?.closest<HTMLElement>('[data-flex-col]');
      const main = col?.parentElement;
      if (main) {
        const editor = main.querySelector('[data-editor-col]') as HTMLElement | null;
        const editorMin = editor ? (parseFloat(getComputedStyle(editor).minWidth) || 0) : 0;
        let reserved = editorMin;
        for (const child of Array.from(main.children)) {
          if (child !== col && child !== editor) {
            const el = child as HTMLElement;
            const basis = parseFloat(getComputedStyle(el).flexBasis);
            reserved += Number.isFinite(basis) ? basis : el.getBoundingClientRect().width;
          }
        }
        const maxPanel = Math.max(0, main.clientWidth - reserved);
        requested = Math.min(requested, maxPanel);
      }
      onPanelPrefChange(requested);
    },
    [side, onPanelPrefChange],
  );

  const { gapRef, onMouseDown: gapMouseDown } = useDragGap({
    cursor: "col-resize",
    onMove,
    deadzone: 3,
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      onSyncBeforeDrag?.();
      const col = gapRef.current?.closest<HTMLElement>('[data-flex-col]');
      const rendered = col ? col.getBoundingClientRect().width : panelPref;
      startPanel.current = rendered;
      onResizingChange?.(true);
      const onUp = () => {
        onResizingChange?.(false);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mouseup", onUp);
      gapMouseDown(e);
    },
    [panelPref, gapMouseDown, onResizingChange, onSyncBeforeDrag],
  );

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

  // Whether the column's slot extends up over the action-toolbar strip.
  // True when:
  //  - non-split + full slot has a docked panel
  //  - split + top slot has a docked panel
  // (A docked-only-bottom slot does NOT extend up; the toolbar stays.)
  const fullSlot = dockOccupancy?.full;
  const topSlot = dockOccupancy?.top;
  const bottomSlot = dockOccupancy?.bottom;
  const extendsOverToolbar = (!split && fullSlot != null) || (!!split && topSlot != null);

  // Slot keys per geometry case
  const fullKey: DockSlotKey = dockSlotKey(side, "full");
  const topKey: DockSlotKey = dockSlotKey(side, "top");
  const bottomKey: DockSlotKey = dockSlotKey(side, "bottom");

  // When `hideOmni` is true, the omni layer is suppressed for this slot —
  // used when a docked panel occupies the slot, so the docked panel's
  // natural content height drives the slot's auto-sizing instead of
  // omni's full-list height.
  const renderSlot = (slot: PanelSlot, hideOmni: boolean = false) => (
    <>
      {!hideOmni && slot.omni}
      {slot.overlay && (
        <div className="absolute inset-0" style={{ background: 'var(--pod-panel)' }}>
          {slot.overlay}
        </div>
      )}
    </>
  );

  /** Sizing style for an occupied dock slot. The slot itself doesn't
   *  need to fill the full dock frame anymore — the panel inside drives
   *  its own height (auto-fit via FloatingPanel's docked-mode style),
   *  so the slot just inherits that height. We still bound it with
   *  max-height so a tall panel can't push past the dock's window
   *  region. Same rule for every panel kind including outline —
   *  letting outline shrink to its visible-headings size keeps it
   *  consistent with the rest and avoids a stretched manilla gap.
   *
   *  Empty slot: full height for omni view (existing behavior). */
  const dockSizingStyle = (occupant: PanelId | undefined): React.CSSProperties => {
    const fullHeight = extendsOverToolbar
      ? 'calc(100dvh - 32px - 2 * var(--pod-gap))'
      : 'calc(100dvh - 32px - 64px - var(--pod-gap))';
    if (occupant) {
      // No min-height — the panel's own min handles that. The slot
      // can shrink to the panel's auto-size; no manilla bg gap below.
      return { maxHeight: fullHeight };
    }
    // Slot empty — omni view shown, full height as before.
    return { height: fullHeight };
  };

  // The dock-outline is rendered at EditorLayout root via the body-
  // portaled `<DockOutline />` (so it stays at the captured rect and
  // beats floating-panel z-index). Nothing to render here per-slot.

  return (
    <div
      data-flex-col={side}
      data-panel-column-side={side}
      className="relative flex flex-col"
      style={{
        flex: isResizing ? `0 0 ${panelPref}px` : `1 100 ${panelPref}px`,
        minWidth: isResizing ? 0 : 'var(--panel-min)',
        // When a top-region docked panel is in this column, give the column
        // its top var(--pod-gap) padding directly (the toolbar normally
        // owned that space — it's hidden in this state). Otherwise leave
        // padding-top: 0 so the toolbar's sticky positioning controls the
        // top band.
        paddingTop: extendsOverToolbar ? 'var(--pod-gap)' : 0,
        paddingBottom: 'var(--pod-gap)',
        paddingLeft: 4,
        paddingRight: 4,
      }}
    >
      {/* Sticky action-buttons slot — hidden when the column has a top-
          region docked panel that covers the toolbar area. */}
      {topOverlay && !extendsOverToolbar && (
        <div
          data-tool-strip={side === "left" ? "left-action" : "right-action"}
          className="sticky z-20 flex justify-center items-start"
          style={{
            top: 0,
            alignSelf: 'stretch',
            background:
              'linear-gradient(to bottom, var(--background) 0, var(--background) 32px, transparent 64px)',
            height: 64,
            paddingTop: 4,
            marginLeft: -4,
            marginRight: -4,
            pointerEvents: 'none',
          }}
        >
          <div className="pointer-events-auto">{topOverlay}</div>
        </div>
      )}
      <div className="flex flex-1 min-h-0 w-full">
      {collapsed ? (
        <div className={`flex-1 min-w-0 ${side === "left" ? "order-1" : "order-2"}`} />
      ) : split && isSplitChildren(children) ? (
        <div
          ref={stackRef}
          className={`flex-1 min-w-0 flex flex-col min-h-0 panel-container ${side === "left" ? "order-1" : "order-2"}`}
          style={{
            position: 'sticky',
            top: extendsOverToolbar ? 'var(--pod-gap)' : 64,
            alignSelf: 'flex-start',
            // Lift the dock above the column's bottom-fade strip (z-20)
            // so the fade doesn't darken the docked pod's bottom edge.
            // The fade should only mask scrolled omni content, not docked
            // panels — which are already visually framed by the pod.
            zIndex: (topSlot || bottomSlot) ? 30 : undefined,
            // Pod height is window-driven (NOT content-driven): the dock
// is always exactly viewport-tall minus the 32px Virgil top
// bar, the sticky top reserve (var(--pod-gap) when docked,
// 64px when omni-only), and a matching var(--pod-gap) on the
// bottom so the pod's bottom edge aligns with the editor's
// bottom-cap. Using `height` (not `maxHeight`) forces the size
// regardless of column flex / document length.
height: extendsOverToolbar
  ? 'calc(100dvh - 32px - 2 * var(--pod-gap))'
  : 'calc(100dvh - 32px - 64px - var(--pod-gap))',
          }}
        >
          <div
            className="relative min-h-0 overflow-hidden"
            style={isChromeless(topPanelId) && !topSlot
              ? { flex: `${children!.ratio} 1 0`, minHeight: 0 }
              : { flex: `${children!.ratio} 1 0`, minHeight: 0, background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
            onMouseDown={() => onFocusHalf?.("top")}
            data-panel-side={side}
            data-panel-id={topPanelId}
            data-panel-half="top"
            data-dock-slot={topSlot ? topKey : undefined}
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
            style={isChromeless(bottomPanelId) && !bottomSlot
              ? { flex: `${1 - children!.ratio} 1 0`, minHeight: 0 }
              : { flex: `${1 - children!.ratio} 1 0`, minHeight: 0, background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
            onMouseDown={() => onFocusHalf?.("bottom")}
            data-panel-side={side}
            data-panel-id={bottomPanelId}
            data-panel-half="bottom"
            data-dock-slot={bottomSlot ? bottomKey : undefined}
          >
            {renderSlot(children!.bottom)}
          </div>
        </div>
      ) : (
        <div
          className={`relative flex-1 min-w-0 panel-container ${(isChromeless(topPanelId) && !fullSlot) || fullSlot ? "" : "overflow-hidden"} ${side === "left" ? "order-1" : "order-2"}`}
          style={(() => {
            // Three cases:
            // 1. Chromeless + empty slot: no styling (canvas/strip only).
            // 2. Empty slot, non-chromeless: full-pod styling (omni view).
            // 3. Occupied slot: panel container provides its own pod
            //    styling, so the slot is just a positioning anchor —
            //    no bg/border/radius/shadow here, only sticky + sizing.
            if (isChromeless(topPanelId) && !fullSlot) return undefined;
            const occupied = !!fullSlot;
            return {
              ...(occupied
                ? {}
                : {
                    background: 'var(--pod-panel)',
                    borderRadius: podRadius,
                    border: 'var(--pod-border)',
                    boxShadow: 'var(--pod-shadow-light)',
                  }),
              position: 'sticky' as const,
              top: extendsOverToolbar ? 'var(--pod-gap)' : 64,
              alignSelf: 'flex-start' as const,
              ...dockSizingStyle(fullSlot),
              // Lift the dock above the column's bottom-fade strip
              // (z-20) so the fade doesn't darken the pod's bottom.
              zIndex: fullSlot ? 30 : undefined,
            };
          })()}
          data-panel-side={side}
          data-panel-id={topPanelId}
          data-dock-slot={fullSlot ? fullKey : undefined}
        >
          {renderSlot(children as PanelSlot, !!fullSlot)}
        </div>
      )}
      <div
        ref={gapRef}
        className={`drag-gap drag-gap-v shrink-0 ${side === "left" ? "order-2 drag-gap-toward-editor-right" : "order-1 drag-gap-toward-editor-left"}`}
        style={{ width: 'var(--pod-gap)' }}
        onMouseDown={onMouseDown}
      />
      </div>
      <div
        data-tool-strip={side === "left" ? "left-action-bottom" : "right-action-bottom"}
        className="sticky z-20"
        style={{
          bottom: 0,
          alignSelf: 'stretch',
          background:
            'linear-gradient(to top, var(--background) 0, var(--background) var(--pod-gap), transparent calc(var(--pod-gap) + 32px))',
          height: 64,
          marginTop: -64,
          marginLeft: -4,
          marginRight: -4,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
