import { useCallback, useRef } from "react";
import { useDragGap } from "@/hooks/useDragGap";
import {
  PanelId,
  Side,
  MIN_BAND_PX,
  bandSlotKey,
} from "@/hooks/useViewPrefs";
import { BandDivider } from "../panel-primitives";

export function PlaceholderPanel({ title }: { title: string }) {
  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <div className="px-4 h-[var(--header-h)] shrink-0 flex items-center justify-between bg-[var(--pod-panel)]">
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

/** One docked band in a column's stack: a panel id plus an optional
 *  resized height (px). Absent height ⇒ content-sized (flex auto). */
export type BandSpec = { id: PanelId; height?: number };

/**
 * Read the free vertical space (px) below the docked stack on `side` —
 * the "omni gap" a newly-opened panel can grow into before it has to
 * displace the least-recently-used band. One-shot synchronous read; no
 * observers. Returns the full sticky-frame height when no bands are
 * docked. 0 when the side column isn't mounted.
 *
 * Agents E and S call this at open-time and pass the result as
 * `freeSpacePx` to the viewPrefs openers so the fit check can decide
 * append-vs-evict without re-measuring per render.
 */
export function measureOmniGap(side: Side): number {
  if (typeof document === "undefined") return 0;
  const col = document.querySelector<HTMLElement>(
    `[data-panel-column-side="${side}"]`,
  );
  if (!col) return 0;
  const frame = col.querySelector<HTMLElement>("[data-stack-frame]");
  if (!frame) return 0;
  const frameRect = frame.getBoundingClientRect();
  const bands = frame.querySelectorAll<HTMLElement>("[data-dock-slot]");
  if (bands.length === 0) return frameRect.height;
  const last = bands[bands.length - 1];
  const lastRect = last.getBoundingClientRect();
  return Math.max(0, frameRect.bottom - lastRect.bottom);
}

/** Column-edge fade — the manilla→transparent gradient strip pinned to the
 *  top or bottom of a gutter so omni cards scrolling past the scrollport edge
 *  dissolve into the background instead of clipping. Adds ZERO net flow height
 *  (a negative leading-margin equal to its height overlaps the adjacent
 *  content). z-20; docked bands lift to z-30 so they ride above it. The -4
 *  horizontal bleed cancels the column's paddingLeft/Right: 4. `top: 0` /
 *  `bottom: 0` latch to the same row scrollport (`[data-virgil-row-scroll]`,
 *  which starts just below the 32px Virgil bar), so the two edges are exact
 *  mirrors. `data-tool-strip` is read existence-only by dock-drag.ts. */
function ColumnEdgeFade({ side, edge }: {
  side: "left" | "right";
  edge: "top" | "bottom";
}) {
  const isTop = edge === "top";
  return (
    <div
      aria-hidden="true"
      data-tool-strip={`${side}-action-${edge}`}
      className="sticky z-20"
      style={{
        ...(isTop ? { top: 0 } : { bottom: 0 }),
        alignSelf: 'stretch',
        background: `linear-gradient(${isTop ? 'to bottom' : 'to top'}, var(--background) 0, var(--background) var(--pod-gap), transparent calc(var(--pod-gap) + 32px))`,
        height: 64,
        ...(isTop ? { marginBottom: -64 } : { marginTop: -64 }),
        marginLeft: -4,
        marginRight: -4,
        pointerEvents: 'none',
      }}
    />
  );
}

/** Bottom-edge resize handle for the last band in the stack. A thin
 *  pod-gap-tall strip pinned to the band's bottom edge. Dragging it
 *  grows/shrinks the bottom band, revealing or covering the omni gap
 *  below. Clamps `[MIN_BAND_PX, frameH - aboveStackPx]`. */
function BottomEdgeHandle({
  bottomId,
  frameRef,
  onResize,
  lone,
}: {
  bottomId: PanelId;
  frameRef: React.RefObject<HTMLDivElement | null>;
  onResize: (id: PanelId, px: number) => void;
  /** True when this is the only band on the side — fade the manilla
   *  backing into the omni gap below instead of a hard edge. */
  lone: boolean;
}) {
  const startY = useRef(0);
  const startH = useRef(0);
  const aboveStackPx = useRef(0);
  const frameH = useRef(0);

  const onMove = useCallback(
    (e: MouseEvent) => {
      const dy = e.clientY - startY.current;
      const max = Math.max(MIN_BAND_PX, frameH.current - aboveStackPx.current);
      const next = Math.max(MIN_BAND_PX, Math.min(startH.current + dy, max));
      onResize(bottomId, next);
    },
    [bottomId, onResize],
  );

  const { gapRef, onMouseDown: gapMouseDown } = useDragGap({
    cursor: "row-resize",
    onMove,
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const frame = frameRef.current;
      // The handle is now a sibling of the band anchor (not a descendant),
      // so resolve the band by id rather than `closest`.
      const band = frame?.querySelector<HTMLElement>(
        `[data-dock-slot][data-panel-id="${bottomId}"]`,
      ) ?? null;
      startY.current = e.clientY;
      startH.current = band?.getBoundingClientRect().height ?? MIN_BAND_PX;
      frameH.current = frame?.getBoundingClientRect().height ?? 0;
      // Space above this band inside the frame = top of this band minus
      // top of the frame (covers the prior bands + their dividers).
      const frameTop = frame?.getBoundingClientRect().top ?? 0;
      const bandTop = band?.getBoundingClientRect().top ?? frameTop;
      aboveStackPx.current = Math.max(0, bandTop - frameTop);
      gapMouseDown(e);
    },
    [frameRef, gapMouseDown, bottomId],
  );

  return (
    <div
      data-bottom-edge={bottomId}
      className="relative shrink-0 z-10"
      style={{ height: 'var(--pod-gap)', pointerEvents: 'auto' }}
    >
      {/* Wider invisible hit target (mirrors BandDivider). */}
      <div
        className="absolute inset-x-0 cursor-row-resize"
        style={{ top: -4, bottom: -4, background: 'transparent' }}
        onMouseDown={onMouseDown}
      />
      <div
        ref={gapRef}
        className="drag-gap drag-gap-h band-grip w-full h-full"
        onMouseDown={onMouseDown}
      />
      {/* Lone panel: a manilla fade past the handle into the omni gap, so the
          omni cards behind it dissolve into the desktop. Must be --background
          (the canvas/manilla), NOT --pod-panel (the warm panel fill) — same
          color as ColumnEdgeFade above. Non-interactive. */}
      {lone && (
        <div
          aria-hidden="true"
          className="absolute left-0 right-0"
          style={{
            top: '100%',
            height: 22,
            background: 'linear-gradient(to bottom, var(--background), transparent)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

/**
 * Width-resizable column wrapper for sidebar panels. The column is an
 * always-mounted omni "desktop"; up to MAX_STACK opaque content-sized
 * BANDS stack top→bottom over it.
 *
 * Three layers inside the column root:
 *   A. {omni} in normal flow — always rendered, the background.
 *   B. an absolute pass-through layer so empty gaps click through to omni.
 *   C. a sticky stack frame holding the band anchors (top→bottom) with a
 *      BandDivider between consecutive bands; the bottom band also carries
 *      a bottom-edge resize handle.
 *
 * Each band anchor is empty — `<FloatingPanel mode="docked">` portals its
 * panel content into the anchor via its `data-dock-slot` key, visually
 * covering omni (which stays mounted underneath). When `stack` is empty
 * the column is omni-only with no z-lift (the Reader's case).
 *
 * Docked bands extend up over the action-toolbar strip whenever the stack
 * is non-empty: the strip is hidden so the column's content starts at
 * row-top with `var(--pod-gap)` padding.
 */
export function PanelColumn({
  side,
  panelPref,
  onPanelPrefChange,
  isResizing,
  onResizingChange,
  onSyncBeforeDrag,
  omni,
  stack,
  onTradeHeight,
  onResizeBottomEdge,
  onFocusBand,
  collapsed,
  tail,
}: {
  side: "left" | "right";
  panelPref: number;
  onPanelPrefChange: (w: number) => void;
  isResizing?: boolean;
  onResizingChange?: (r: boolean) => void;
  onSyncBeforeDrag?: () => void;
  /** The always-mounted omni desktop for this side (Layer A background). */
  omni: React.ReactNode;
  /** Ordered docked bands, top→bottom (length ≤ MAX_STACK). */
  stack: BandSpec[];
  /** Slide the boundary between two adjacent bands (divider drag). */
  onTradeHeight: (aboveId: PanelId, aboveH: number, belowId: PanelId, belowH: number) => void;
  /** Resize the bottom band from its bottom edge (reveal/cover omni). */
  onResizeBottomEdge: (id: PanelId, px: number) => void;
  /** Mark a band most-recently-used on interaction (MRU bump). */
  onFocusBand: (id: PanelId) => void;
  collapsed?: boolean;
  /** Optional adornment rendered inside the inner flex row, adjacent
   *  to the drag-gap on the editor-facing side (between the panel
   *  content and the drag-gap). The Library Reader uses this to mount
   *  its `PageScrollStrip` so the drag-gap line sits just inboard of
   *  the page-mark navigator. */
  tail?: React.ReactNode;
}) {
  const startX = useRef(0);
  const startPanel = useRef(0);
  const frameRef = useRef<HTMLDivElement>(null);

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

  // The stack lifts over the action-toolbar strip whenever any band is
  // docked. Empty stack ⇒ omni-only column, toolbar stays, no z-lift.
  const hasStack = stack.length > 0;
  const extendsOverToolbar = hasStack;

  // The sticky stack-frame height — the visible dock window. Exposed
  // column-wide as `--dock-slot-frame-h` so docked panels (and omni cards)
  // can cap an expanded body at this bound and engage internal scrolling.
  const frameH = extendsOverToolbar
    ? 'calc(100dvh - 32px - 2 * var(--pod-gap))'
    : 'calc(100dvh - 32px - 64px - var(--pod-gap))';

  return (
    <div
      data-flex-col={side}
      data-panel-column-side={side}
      className="relative flex flex-col"
      style={{
        flex: collapsed ? '0 0 0px' : `0 0 ${panelPref}px`,
        minWidth: collapsed ? 0 : (isResizing ? 0 : 'var(--panel-min)'),
        // Cap height at the editor column's scrollHeight (set on the row
        // as `--row-bound-h` by EditorScrollbar). A tall anchored cascade
        // (or a card pinned/expanded near the doc bottom) can run the
        // column past the editor's last line; without this cap the row's
        // natural scroll bound would exceed the editor's bottom and produce
        // a visible bounce/stutter against any JS clamp. `clip` (not
        // `hidden`) avoids establishing a scroll container, so any
        // `position: sticky` descendants keep latching to the row scroll.
        maxHeight: 'var(--row-bound-h, none)',
        overflow: 'clip',
        // Expose the dock-frame max-height column-wide so any descendant
        // (omni-view cards, docked-panel cards) can cap an expanded body
        // at the visible dock height.
        ['--dock-slot-frame-h' as string]: frameH,
        // When a band is docked, give the column its top var(--pod-gap)
        // padding directly (the toolbar normally owned that space — it's
        // hidden in this state). Otherwise leave padding-top: 0 so the
        // toolbar's sticky positioning controls the top band.
        paddingTop: collapsed ? 0 : (extendsOverToolbar ? 'var(--pod-gap)' : 0),
        paddingBottom: collapsed ? 0 : 'var(--pod-gap)',
        paddingLeft: collapsed ? 0 : 4,
        paddingRight: collapsed ? 0 : 4,
      }}
    >
      <ColumnEdgeFade side={side} edge="top" />
      <div className="flex flex-1 min-h-0 w-full">
      {collapsed ? (
        <div className={`flex-1 min-w-0 ${side === "left" ? "order-1" : "order-3"}`} />
      ) : (
        <div
          className={`relative flex-1 min-w-0 panel-container ${side === "left" ? "order-1" : "order-3"}`}
          style={{
            // Always normal-flow so omni scrolls with the page, regardless
            // of whether bands are docked. The sticky stack frame (Layer C)
            // is `position: absolute` so it takes no flow space, and its
            // sticky inner stays pinned in the viewport.
            position: 'relative',
            minHeight: frameH,
          }}
        >
          {/* Layer A — omni desktop, natural flex flow. Tall content
              scrolls with the page. Bands above overlay (sticky) but never
              bound omni's height. Always rendered, never hidden. */}
          {omni}

          {/* Layer B — pass-through overlay so empty gaps between/below
              bands click straight through to omni. Each occupied band
              anchor re-enables pointer events for itself. */}
          <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
            {/* Layer C — sticky stack frame. Holds the band anchors top→
                bottom; bands are opaque (FloatingPanel paints --pod-panel)
                so omni can't bleed in. Empty frame ⇒ no z-lift. */}
            <div
              ref={frameRef}
              data-stack-frame={side}
              style={{
                position: 'sticky',
                top: hasStack ? 'var(--pod-gap)' : 64,
                height: frameH,
                // visible (not hidden) so docked pods' ambient shadow
                // (--card-shadow-ambient) isn't clipped at the frame edge — the
                // column's overflow:clip + its padding is the outer bound. Pods
                // cap their own content via internal scroll, so the frame needn't
                // clip; clipping here would flatten every docked pod.
                overflow: 'visible',
                display: 'flex',
                flexDirection: 'column',
                zIndex: hasStack ? 30 : undefined,
              }}
            >
              {stack.map((band, i) => (
                <BandFragment
                  key={band.id}
                  side={side}
                  band={band}
                  index={i}
                  prevId={i > 0 ? stack[i - 1].id : null}
                  isLast={i === stack.length - 1}
                  frameRef={frameRef}
                  onTradeHeight={onTradeHeight}
                  onResizeBottomEdge={onResizeBottomEdge}
                  onFocusBand={onFocusBand}
                />
              ))}
            </div>
          </div>
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
      <ColumnEdgeFade side={side} edge="bottom" />
    </div>
  );
}

/** One band in the stack: an optional divider above it (when it follows
 *  another band) then the band anchor itself. The anchor is an empty
 *  portal target — FloatingPanel docks its content here. */
function BandFragment({
  side,
  band,
  index,
  prevId,
  isLast,
  frameRef,
  onTradeHeight,
  onResizeBottomEdge,
  onFocusBand,
}: {
  side: "left" | "right";
  band: BandSpec;
  index: number;
  prevId: PanelId | null;
  isLast: boolean;
  frameRef: React.RefObject<HTMLDivElement | null>;
  onTradeHeight: (aboveId: PanelId, aboveH: number, belowId: PanelId, belowH: number) => void;
  onResizeBottomEdge: (id: PanelId, px: number) => void;
  onFocusBand: (id: PanelId) => void;
}) {
  return (
    <>
      {/* Divider between this band and the one above (trades heights). */}
      {prevId != null && (
        <BandDivider
          side={side}
          aboveId={prevId}
          belowId={band.id}
          onTradeHeight={onTradeHeight}
          containerRef={frameRef}
        />
      )}
      {/* Band anchor — empty; the panel content portals in via
          FloatingPanel keyed on data-dock-slot. minHeight:0 so a tall
          band flex-shrinks (its internal PANEL.list scrolls) instead of
          overflowing the frame; content-sized bands use flex auto. */}
      <div
        data-panel-side={side}
        data-panel-id={band.id}
        data-dock-slot={bandSlotKey(side, index)}
        style={{
          position: 'relative',
          pointerEvents: 'auto',
          // visible (not hidden) so the docked pod's ambient shadow renders
          // instead of being clipped at the pod edge. The pod itself
          // (FloatingPanel: overflow-hidden + internal PANEL.list scroll) caps
          // its OWN content, so this anchor doesn't need to clip.
          overflow: 'visible',
          minHeight: 0,
          // Flex column so the portaled pod (FloatingPanel, flex: 1 1 auto)
          // fills this anchor's flex-determined height exactly — content
          // basis when short (omni shows below), or the shrunk height when
          // the stack overflows — and its internal PANEL.list scrolls. A
          // tall content-driven band thus caps + scrolls instead of running
          // off the page (robust where a % max-height wouldn't resolve).
          display: 'flex',
          flexDirection: 'column',
          flex: band.height != null ? `0 0 ${band.height}px` : '0 1 auto',
          ['--dock-slot-frame-h' as string]: '100%',
        }}
        onMouseDown={() => onFocusBand(band.id)}
      />
      {/* Bottom-edge handle for the last band — a flex SIBLING (not inside
          the anchor, whose portaled FloatingPanel pod would paint over it)
          so it sits at the band's bottom edge over the omni gap and stays
          grabbable; this is also the only resize handle a lone band has. */}
      {isLast && (
        <BottomEdgeHandle
          bottomId={band.id}
          frameRef={frameRef}
          onResize={onResizeBottomEdge}
          lone={index === 0}
        />
      )}
    </>
  );
}
