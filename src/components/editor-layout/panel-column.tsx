import { useEffect, useId, useRef, useState } from "react";
import { OmniBinSlotContext, DATA_OMNI_BIN_SLOT } from "./omni-bin-slot";
import { usePaneResizeHandle, onLayoutGestureSetChange } from "@/lib/pane-resize";
import {
  PanelId,
  Side,
  MIN_BAND_PX,
  bandSlotKey,
} from "@/hooks/useViewPrefs";
import { BandDivider } from "../panel-primitives";
import { paneColumn } from "./pane-dom";

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
 *
 * Resolved through `paneColumn` (task 438): a bare document-global lookup
 * answers with the first column in DOM order, which under multi-pane
 * keep-alive is a `display:none` doc pane whenever the Library Reader is the
 * visible one — every rect zero, so BOTH branches below return 0, so
 * `placeInStack`'s `fits = freeSpacePx >= MIN_BAND_PX` is false for every
 * Reader strip-open and the second panel you open evicts the first.
 */
export function measureOmniGap(side: Side): number {
  if (typeof document === "undefined") return 0;
  const col = paneColumn(side);
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
 *  mirrors. `data-tool-strip` is read existence-only by dock-drag.ts.
 *
 *  Task 329 — the SOLID run is a pod SEAM (canvas painted over the card lane
 *  at a raised edge) and reads `--pod-seam`; the RAMP past it is the scroll
 *  dissolve, this element's own affordance, and stays a stated constant. They
 *  were one hand-tuned 10+14 pair, which is how this fade could SUM with the
 *  band-bottom seam below a docked pod into ~44px of field. */
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
        // Solid for one seam (`--pod-seam`, the SSOT for canvas-over-lane),
        // then a 10px ramp to transparent — 16px of visible field, down from
        // the hand-tuned 10+14 = 24px. The box stays 34 tall (and its negative
        // margin in lockstep, zero net flow height): the surplus past the
        // gradient is fully transparent, so the box height is a bound, not a
        // second spelling of the band.
        background: `linear-gradient(${isTop ? 'to bottom' : 'to top'}, var(--background) 0, var(--background) var(--pod-seam), transparent calc(var(--pod-seam) + 10px))`,
        height: 34,
        ...(isTop ? { marginBottom: -34 } : { marginTop: -34 }),
        marginLeft: -4,
        marginRight: -4,
        pointerEvents: 'none',
      }}
    />
  );
}

/** Bottom-edge resize handle for the last band in the stack — and the SEAM
 *  between the docked pod above it and the omni card lane behind/below.
 *  One `--pod-seam`-tall strip of canvas pinned to the band's bottom edge:
 *  wide enough to hold the pod's own shadow (that is how the token is
 *  derived) and no wider, so the pod reads as paper lifted off the lane
 *  rather than as a sheet marooned across a field. Dragging it grows/shrinks
 *  the bottom band, revealing or covering the omni gap below. Clamps
 *  `[MIN_BAND_PX, frameH - aboveStackPx]`.
 *
 *  The strip is also the lone band's ONLY resize handle, so thinning the
 *  PAINT must not thin the GRAB: the invisible hit extension below widens in
 *  lockstep (±6 around a 6px strip = the same 18px target the 10px strip had
 *  at ±4). Hit area ≠ painted band. */
function BottomEdgeHandle({
  bottomId,
  frameRef,
  onResize,
}: {
  bottomId: PanelId;
  frameRef: React.RefObject<HTMLDivElement | null>;
  onResize: (id: PanelId, px: number) => void;
}) {
  // Per-gesture snapshots, taken in getValue() — the engine's documented
  // single start-edge read point. `flex` records the band anchor's inline
  // flex string as React last rendered it, so cancel / zero-move end paths
  // can put the DOM back EXACTLY (a content-sized band renders `0 1 auto` —
  // there is no pixel value in state to re-derive it from).
  const bandRef = useRef<HTMLElement | null>(null);
  const startRef = useRef({ h: 0, max: 0, flex: "" });

  const restoreStartFlex = () => {
    const band = bandRef.current;
    if (band) band.style.flex = startRef.current.flex;
  };

  const handle = usePaneResizeHandle({
    id: `panel-bottom-edge-${bottomId}`,
    axis: "y",
    getValue: () => {
      const frame = frameRef.current;
      // The handle is a sibling of the band anchor (not a descendant),
      // so resolve the band by id rather than `closest`.
      const band = frame?.querySelector<HTMLElement>(
        `[data-dock-slot][data-panel-id="${bottomId}"]`,
      ) ?? null;
      bandRef.current = band;
      const frameH = frame?.getBoundingClientRect().height ?? 0;
      // Space above this band inside the frame = top of this band minus
      // top of the frame (covers the prior bands + their dividers).
      const frameTop = frame?.getBoundingClientRect().top ?? 0;
      const bandTop = band?.getBoundingClientRect().top ?? frameTop;
      const aboveStackPx = Math.max(0, bandTop - frameTop);
      const h = band?.getBoundingClientRect().height ?? MIN_BAND_PX;
      startRef.current = {
        h,
        max: Math.max(MIN_BAND_PX, frameH - aboveStackPx),
        flex: band?.style.flex ?? "",
      };
      return h;
    },
    clamp: (px) =>
      Math.max(MIN_BAND_PX, Math.min(px, startRef.current.max)),
    // Live geometry is an imperative flex write on the band anchor — one
    // RAF-coalesced style write per frame, zero React state until release.
    apply: (px) => {
      const band = bandRef.current;
      if (band) band.style.flex = `0 0 ${px}px`;
    },
    commit: (px) => {
      // Zero-move end (a plain click, or a drag returned to its start):
      // don't pin a content-sized band to a pixel height — restore the
      // rendered flex string instead of persisting.
      if (px === startRef.current.h) {
        restoreStartFlex();
        return;
      }
      onResize(bottomId, px);
    },
    restore: restoreStartFlex,
  });

  return (
    <div
      data-bottom-edge={bottomId}
      className="relative shrink-0 z-10"
      style={{ height: 'var(--pod-seam)', pointerEvents: 'auto' }}
    >
      <div
        className="drag-gap drag-gap-h band-grip band-grip-occlude w-full h-full"
        {...handle}
      >
        {/* Wider invisible hit target — a CHILD of the handle so a grab here
            bubbles to the captured element and the `.dragging` grip chrome
            lands on the visible gap. Thinning the paint must never thin the
            grab, and the extension is ASYMMETRIC because only one half of it
            is reachable: the docked pod sits at z-1001 directly above, so it
            eats the upward extension entirely (measured — a probe one pixel
            above the band's bottom edge hits the panel card list, not this).
            What the user can actually grab is `seam + bottom`, so the bottom
            carries the whole compensation: 6 + 8 = the 14px the pre-329 strip
            offered at 10 + 4. The top stays at the symmetric −6 for the case
            the occluder is absent. */}
        <div
          className="absolute inset-x-0 cursor-row-resize"
          style={{ top: -6, bottom: -8, background: 'transparent' }}
        />
      </div>
      {/* No fade below the seam. A card in the omni gap under a docked pod is
          not being clipped by anything — it sits in open canvas — so a second
          field-colored veil over its top edge separated nothing and only
          widened the moat (it was the third, hard-coded, spelling of this
          band). The pod's own `--card-shadow-ambient`, falling inside the
          seam, is what makes the card read as the layer beneath. Task 329. */}
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
  omniHasCards,
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
  /** True when this side's omni-view is currently showing ≥1 card (no docked
   *  band needed). Combined with `stack.length > 0` into the `data-has-content`
   *  signal so the Reader's narrow-pane collapse rule keeps a column open
   *  whenever it has visible content — docked OR omni — and collapses it only
   *  when the side is genuinely empty (gives the page room). */
  omniHasCards?: boolean;
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
  const frameRef = useRef<HTMLDivElement>(null);
  // The omni BIN SLOT (task 421) — the last flex child of the sticky band
  // frame, published to the omni view through context so its bins portal in
  // and stack BELOW the docked bands by flex order. State (not a ref) so the
  // provider re-renders once when the element mounts/unmounts; the callback
  // ref is stable, so React never detaches and re-attaches it per render.
  const [binSlot, setBinSlot] = useState<HTMLElement | null>(null);
  const colRef = useRef<HTMLDivElement>(null);
  // Instance-unique gesture id: keep-alive doc panes AND the Library Reader
  // each mount a PanelColumn per side, so a bare `editor-panel-${side}` would
  // make every same-side instance's bus-edge listener (below) fire on a
  // foreign gesture — running the MAIN app's sync/isResizing side effects on
  // a Reader drag.
  const reactId = useId();
  const gestureId = `editor-panel-${side}-${reactId}`;

  // Per-gesture pointer-UX clamp + start width, snapshotted once in
  // getValue() (the engine's documented single start-edge read point). The
  // hard layout floor stays CSS (`minWidth: var(--panel-min)` at rest); this
  // mirror only keeps the divider tracking the pointer instead of overrunning
  // the row while `isResizing` lifts that minWidth to 0.
  const clampRef = useRef({ min: 0, max: Number.POSITIVE_INFINITY });
  const startRef = useRef(0);

  // Cancel / zero-move re-sync: rewrite the flex from the SOURCE OF TRUTH
  // (the panelPref prop) rather than the measured start px. In the Reader the
  // rendered width can sit below the stored pref (no syncBeforeDrag there, so
  // CSS min-width clamps the track) — pinning the measured px imperatively
  // would diverge DOM from store until the next commit (React diffs style
  // against previous props, not the DOM).
  const restoreFlex = () => {
    const col = colRef.current;
    if (col) col.style.flex = collapsed ? "0 0 0px" : `0 0 ${panelPref}px`;
  };

  const gutterHandle = usePaneResizeHandle({
    id: gestureId,
    axis: "x",
    // The right column grows as the pointer moves LEFT (toward the origin).
    direction: side === "right" ? -1 : 1,
    // A collapsed column renders `flex: 0 0 0px` — an imperative width write
    // would silently override the collapse, so the gesture is refused.
    disabled: collapsed,
    getValue: () => {
      const col = colRef.current;
      const rendered = col?.getBoundingClientRect().width ?? panelPref;
      const panelMin = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--panel-min'),
      ) || 0;
      // Walk up to the row container that holds *all* columns (editor +
      // both panel rails). Pre-extraction this was `col.parentElement`;
      // post-extraction the panel column is wrapped by `<PaneRail>`'s
      // outer div, so we need to walk up two levels to reach the row.
      // The row carries the `editor-pane-root` class.
      let max = Number.POSITIVE_INFINITY;
      const main = col?.closest('.editor-pane-root') as HTMLElement | null;
      if (col && main) {
        const editor = main.querySelector('[data-editor-col]') as HTMLElement | null;
        const editorMin = editor ? (parseFloat(getComputedStyle(editor).minWidth) || 0) : 0;
        // Reserve everything in the row that ISN'T the panel being
        // dragged or the editor column. We sum measured widths of the
        // intermediate wrappers (PaneRail outer divs etc.) by their
        // current rendered widths minus the dragged column's
        // contribution. None of these change during the gesture (the
        // opposite rail and icon strips are untouched by this drag), so a
        // start-edge snapshot is equivalent to the old per-move re-measure.
        let reserved = editorMin;
        const dragRail = col.closest<HTMLElement>('.editor-pane-root > div') ?? col;
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
        max = Math.max(0, main.clientWidth - reserved);
      }
      clampRef.current = { min: panelMin, max };
      startRef.current = rendered;
      return rendered;
    },
    clamp: (px) =>
      Math.max(clampRef.current.min, Math.min(clampRef.current.max, px)),
    // Live geometry is an imperative flex-basis write on the column root —
    // one RAF-coalesced style write per frame. The old path routed every
    // mousemove through onPanelPrefChange → viewPrefs.setPanelWidth →
    // localStorage ×2, re-rendering the EditorPane subtree per move.
    apply: (px) => {
      const col = colRef.current;
      if (col) col.style.flex = `0 0 ${px}px`;
    },
    commit: (px) => {
      // Zero-move end (plain click / drag returned to start): keep the old
      // deadzone behavior of not writing prefs, and re-sync the DOM from
      // the store in case applies happened.
      if (px === startRef.current) {
        restoreFlex();
        return;
      }
      onPanelPrefChange(px);
    },
    restore: restoreFlex,
  });

  // Gesture-edge side effects (sync prefs to rendered widths, then lift the
  // CSS min-width via isResizing) ride the pane-drag bus filtered to THIS
  // instance's gesture — the end edge fires on every end variant, including
  // an owner unmount mid-drag, so `isResizing` can never wedge true. Latest-
  // prop refs keep the one subscription stable across renders. Declared
  // AFTER usePaneResizeHandle: unmount cleanups run in declaration order, so
  // the engine's detach end-edge fires while this listener is still
  // subscribed.
  const onResizingChangeRef = useRef(onResizingChange);
  const onSyncBeforeDragRef = useRef(onSyncBeforeDrag);
  useEffect(() => {
    // Latest-prop mirrors, refreshed post-commit (a render-time ref write
    // trips react-hooks/refs). The listener only fires from pointer events,
    // which can't interleave before this effect runs.
    onResizingChangeRef.current = onResizingChange;
    onSyncBeforeDragRef.current = onSyncBeforeDrag;
  });
  useEffect(
    () =>
      // The SET channel — an id filter on the outermost-edge channel strands
      // `isResizing` under gesture overlap (see zen-margin's twin).
      onLayoutGestureSetChange((began, info) => {
        if (info.id !== gestureId) return;
        if (began) {
          // Engine ordering: getValue() has already measured the true
          // pre-drag width; syncing prefs to rendered widths here (before
          // the `1 100`→`0 0`-style min-width lift lands) keeps shrunk
          // panels from snapping back at drag start.
          onSyncBeforeDragRef.current?.();
          onResizingChangeRef.current?.(true);
        } else {
          onResizingChangeRef.current?.(false);
        }
      }),
    [gestureId],
  );

  // The stack lifts over the action-toolbar strip whenever any band is
  // docked. Empty stack ⇒ omni-only column, toolbar stays, no z-lift.
  const hasStack = stack.length > 0;
  const extendsOverToolbar = hasStack;
  // "This side has visible content" = a docked band OR the omni-view is
  // showing ≥1 card. The Reader's narrow-pane collapse rule keys off this so
  // an omni-only column (notes/footnotes/citations cards, no docked band)
  // stays open; a truly empty side still collapses to give the page room.
  const hasContent = hasStack || !!omniHasCards;

  // The sticky stack-frame height — the visible dock window. Exposed
  // column-wide as `--dock-slot-frame-h` so docked panels (and omni cards)
  // can cap an expanded body at this bound and engage internal scrolling.
  const frameH = extendsOverToolbar
    ? 'calc(100dvh - 32px - 2 * var(--pod-gap))'
    : 'calc(100dvh - 32px - 64px - var(--pod-gap))';

  return (
    <div
      ref={colRef}
      data-flex-col={side}
      data-panel-column-side={side}
      // Reflect whether this side currently has visible content — a docked
      // band OR ≥1 omni card. The Reader's narrow-pane fit rule (library.css)
      // collapses EMPTY dock columns to give the page room, but must NOT crush
      // a populated one (docked OR omni-only) to 0 — it keys off this
      // attribute. Inert in the wide main editor (no rule targets it there).
      data-has-content={hasContent ? "true" : undefined}
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
              bound omni's height. Always rendered, never hidden. The omni
              BINS are not here: they portal into the bin slot at the bottom
              of Layer C (see omni-bin-slot.ts). */}
          <OmniBinSlotContext.Provider value={binSlot}>{omni}</OmniBinSlotContext.Provider>

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
              {/* The omni BIN SLOT — last in the frame's flex column, so the
                  bins sit directly below the docked bands (or at the frame's
                  top when nothing is docked) and ride the frame's sticky
                  pin. `pointerEvents: auto` re-enables clicks that Layer B
                  disabled; `zIndex: 20` is the bin rung of the ladder stated
                  in omni-bin-slot.ts (pinned card 10 < bins 20 < frame 30).
                  `minHeight: 0` so an expanded bin list shrinks into what
                  the bands leave rather than overflowing the frame. */}
              <div
                ref={setBinSlot}
                {...{ [DATA_OMNI_BIN_SLOT]: side }}
                style={{
                  position: 'relative',
                  zIndex: 20,
                  pointerEvents: 'auto',
                  minHeight: 0,
                  flex: '0 1 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  paddingLeft: 8,
                  paddingRight: 8,
                  marginTop: hasStack ? 'var(--pod-gap)' : 4,
                }}
              />
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
        className={`drag-gap drag-gap-v band-grip shrink-0 ${side === "left" ? "order-3 drag-gap-toward-editor-right" : "order-1 drag-gap-toward-editor-left"}`}
        {...gutterHandle}
        style={{ ...gutterHandle.style, width: 'var(--pod-gap)' }}
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
        />
      )}
    </>
  );
}
