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
  dockOccupancy,
  tail,
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
  /** Which dock slots on this side are currently occupied. The slot's
   *  pod element gets `data-dock-slot="${side}-${half}"` so the
   *  panel-shell portal can find it. */
  dockOccupancy?: DockOccupancy;
  /** Optional adornment rendered inside the inner flex row, adjacent
   *  to the drag-gap on the editor-facing side (between the panel
   *  content and the drag-gap). The Library Reader uses this to mount
   *  its `PageScrollStrip` so the drag-gap line sits just inboard of
   *  the page-mark navigator. */
  tail?: React.ReactNode;
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
      // Walk up to the row container that holds *all* columns (editor +
      // both panel rails). Pre-extraction this was `col.parentElement`;
      // post-extraction the panel column is wrapped by `<PaneRail>`'s
      // outer div, so we need to walk up two levels to reach the row.
      // The row carries the `editor-pane-root` class.
      const col = gapRef.current?.closest<HTMLElement>('[data-flex-col]');
      const main = col?.closest('.editor-pane-root') as HTMLElement | null;
      if (main) {
        const editor = main.querySelector('[data-editor-col]') as HTMLElement | null;
        const editorMin = editor ? (parseFloat(getComputedStyle(editor).minWidth) || 0) : 0;
        // Reserve everything in the row that ISN'T the panel being
        // dragged or the editor column. We sum measured widths of the
        // intermediate wrappers (PaneRail outer divs etc.) by their
        // current rendered widths minus the dragged column's
        // contribution.
        let reserved = editorMin;
        const dragRail = col?.closest<HTMLElement>('.editor-pane-root > div') ?? col;
        for (const child of Array.from(main.children)) {
          if (child === editor) continue;
          if (child === dragRail) {
            // The rail containing the panel being dragged: count only
            // its non-panel-column siblings (icon strip).
            for (const inner of Array.from((child as HTMLElement).children)) {
              if (inner === col) continue;
              reserved += (inner as HTMLElement).getBoundingClientRect().width;
            }
          } else {
            reserved += (child as HTMLElement).getBoundingClientRect().width;
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
      // Also expose the dock-frame max-height as a CSS custom property
      // so the docked FloatingPanel inside can cap itself at the same
      // bound — without that cap, every parent height stays content-
      // driven and PANEL.list's flex-1 overflow-y-auto never engages.
      return {
        maxHeight: fullHeight,
        ['--dock-slot-frame-h' as string]: fullHeight,
      };
    }
    // Slot empty — omni view shown, full height as before. Expose
    // --dock-slot-frame-h here too so omni cards inside can cap their
    // expanded bodies at the dock's visible height (same hook docked
    // panels use above).
    return {
      height: fullHeight,
      ['--dock-slot-frame-h' as string]: fullHeight,
    };
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
        flex: collapsed ? '0 0 0px' : `0 0 ${panelPref}px`,
        minWidth: collapsed ? 0 : (isResizing ? 0 : 'var(--panel-min)'),
        // Cap height at the editor column's scrollHeight (set on the row
        // as `--row-bound-h` by EditorScrollbar). Unanchored cards can
        // stack the column taller than the editor; without this cap the
        // row's natural scroll bound would exceed the editor's bottom and
        // produce a visible bounce/stutter against any JS clamp. `clip`
        // (not `hidden`) avoids establishing a scroll container, so any
        // `position: sticky` descendants keep latching to the row scroll.
        maxHeight: 'var(--row-bound-h, none)',
        overflow: 'clip',
        // Expose the dock-frame max-height column-wide so any descendant
        // (omni-view cards, docked-panel cards) can cap an expanded body
        // at the visible dock height. The slot wrapper redeclares this
        // with the same value when occupied — same number, no conflict —
        // and chromeless omni paths inherit straight from here.
        ['--dock-slot-frame-h' as string]: extendsOverToolbar
          ? 'calc(100dvh - 32px - 2 * var(--pod-gap))'
          : 'calc(100dvh - 32px - 64px - var(--pod-gap))',
        // When a top-region docked panel is in this column, give the column
        // its top var(--pod-gap) padding directly (the toolbar normally
        // owned that space — it's hidden in this state). Otherwise leave
        // padding-top: 0 so the toolbar's sticky positioning controls the
        // top band.
        paddingTop: collapsed ? 0 : (extendsOverToolbar ? 'var(--pod-gap)' : 0),
        paddingBottom: collapsed ? 0 : 'var(--pod-gap)',
        paddingLeft: collapsed ? 0 : 4,
        paddingRight: collapsed ? 0 : 4,
      }}
    >
      <div className="flex flex-1 min-h-0 w-full">
      {collapsed ? (
        <div className={`flex-1 min-w-0 ${side === "left" ? "order-1" : "order-3"}`} />
      ) : split && isSplitChildren(children) ? (
        <div
          className={`relative flex-1 min-w-0 panel-container ${side === "left" ? "order-1" : "order-3"}`}
          style={{
            // Always normal-flow so omni scrolls with the page, regardless
            // of whether a panel is docked. The sticky dock overlay below
            // is `position: absolute` so it takes no flow space, and its
            // sticky inner stays pinned in the viewport.
            position: 'relative',
            minHeight: extendsOverToolbar
              ? 'calc(100dvh - 32px - 2 * var(--pod-gap))'
              : 'calc(100dvh - 32px - 64px - var(--pod-gap))',
          }}
        >
          {/* Omni layer — natural flex flow. Tall content scrolls with
              the page exactly like non-split mode. Docked panels above
              overlay (sticky) but never bound omni's height. */}
          {children!.top.omni}

          {/* Dock overlay — absolute (zero flow), sticky inside so the
              docked half anchors stay pinned in the viewport while omni
              scrolls behind. pointer-events:none on the wrapper so empty
              regions pass clicks through to omni; each occupied anchor
              re-enables pointer events for itself. */}
          <div
            className="absolute inset-0"
            style={{ pointerEvents: 'none' }}
          >
            <div
              ref={stackRef}
              style={{
                position: 'sticky',
                top: extendsOverToolbar ? 'var(--pod-gap)' : 64,
                height: extendsOverToolbar
                  ? 'calc(100dvh - 32px - 2 * var(--pod-gap))'
                  : 'calc(100dvh - 32px - 64px - var(--pod-gap))',
                // Lift above column's bottom-fade strip (z-20) so docked
                // pods don't get darkened at the bottom.
                zIndex: (topSlot || bottomSlot) ? 30 : undefined,
              }}
            >
              {/* Top half anchor — explicit height so the docked panel
                  inside (which sets `height: 100%`) has a real value to
                  resolve against and its internal scrolling can kick in
                  for tall content. Empty halves are invisible boxes. */}
              <div
                className="absolute"
                style={{
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `calc(${children!.ratio * 100}% - var(--pod-gap) / 2)`,
                  pointerEvents: topSlot ? 'auto' : 'none',
                  overflow: 'hidden',
                }}
                onMouseDown={topSlot ? () => onFocusHalf?.("top") : undefined}
                data-panel-side={side}
                data-panel-id={topPanelId}
                data-panel-half="top"
                data-dock-slot={topSlot ? topKey : undefined}
              >
                {topSlot ? children!.top.overlay : null}
              </div>

              {/* Resize divider — always present, invisible until hover
                  (the .drag-gap underlay shows a blue hover-preview line
                  via useDragGap). */}
              <div
                className="absolute"
                style={{
                  left: 0,
                  right: 0,
                  top: `${children!.ratio * 100}%`,
                  transform: 'translateY(-50%)',
                  height: 'var(--pod-gap)',
                  pointerEvents: 'auto',
                  zIndex: 1,
                }}
              >
                <HSplit
                  ratio={children!.ratio}
                  onRatioChange={children!.onRatioChange}
                  containerRef={stackRef}
                />
              </div>

              {/* Gap-edge fades — when a panel is docked in a half, place
                  opaque-to-transparent strips just outside the panel's
                  edges so omni cards scrolling past behind don't bleed
                  visually into the panel chrome. Mirrors the existing
                  column-top/bottom fade strips. */}
              {topSlot && (
                <>
                  {/* Above the top panel — fades omni in the gap between
                      the Virgil bar and the panel's top edge. Negative
                      top extends above the sticky inner; the Virgil bar
                      hides the part outside the visible pod-gap. */}
                  <div
                    aria-hidden="true"
                    className="absolute"
                    style={{
                      left: 0,
                      right: 0,
                      top: -32,
                      height: 32,
                      background:
                        'linear-gradient(to top, var(--background) 0, transparent 100%)',
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                  />
                  {/* Below the top panel — into the gap between halves. */}
                  <div
                    aria-hidden="true"
                    className="absolute"
                    style={{
                      left: 0,
                      right: 0,
                      top: `calc(${children!.ratio * 100}% - var(--pod-gap) / 2)`,
                      height: 32,
                      background:
                        'linear-gradient(to bottom, var(--background) 0, transparent 100%)',
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                  />
                </>
              )}
              {bottomSlot && (
                <div
                  aria-hidden="true"
                  className="absolute"
                  style={{
                    left: 0,
                    right: 0,
                    top: `calc(${children!.ratio * 100}% + var(--pod-gap) / 2 - 32px)`,
                    height: 32,
                    background:
                      'linear-gradient(to top, var(--background) 0, transparent 100%)',
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                />
              )}

              {/* Bottom half anchor — explicit height (mirror of top). */}
              <div
                className="absolute"
                style={{
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: `calc(${(1 - children!.ratio) * 100}% - var(--pod-gap) / 2)`,
                  pointerEvents: bottomSlot ? 'auto' : 'none',
                  overflow: 'hidden',
                }}
                onMouseDown={bottomSlot ? () => onFocusHalf?.("bottom") : undefined}
                data-panel-side={side}
                data-panel-id={bottomPanelId}
                data-panel-half="bottom"
                data-dock-slot={bottomSlot ? bottomKey : undefined}
              >
                {bottomSlot ? children!.bottom.overlay : null}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`relative flex-1 min-w-0 panel-container ${(isChromeless(topPanelId) && !fullSlot) || fullSlot ? "" : "overflow-hidden"} ${side === "left" ? "order-1" : "order-3"}`}
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
                    border: 'var(--panel-border)',
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
      {tail && (
        <div
          className="shrink-0 order-[2]"
          style={{
            // Pull the drag-gap close to the tail content. The line
            // inside the gap renders ~8.5px from its inboard edge;
            // -7px marginRight lands the line ~1.5px past the tail's
            // right edge.
            marginRight: -7,
          }}
        >
          {tail}
        </div>
      )}
      <div
        ref={gapRef}
        className={`drag-gap drag-gap-v shrink-0 ${side === "left" ? "order-3 drag-gap-toward-editor-right" : "order-1 drag-gap-toward-editor-left"}`}
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
