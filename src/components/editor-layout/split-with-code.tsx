"use client";

import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePaneResizeHandle } from "@/lib/pane-resize";
import {
  CodePaneSplitProvider,
  type CodePaneSplitState,
} from "./CodePaneSplitContext";
import { iconHint } from "@/components/Hint";

/**
 * Vertical split: editor pane on the left, code pane on the right,
 * with a draggable gap between them.
 *
 * Layout mechanics:
 *  - The left wrapper has a fixed pixel width (`clipPx`) and
 *    `overflow: hidden`. The editor pane mounted *inside* it keeps its
 *    own natural width — the wrapper just clips the right edge.
 *  - The drag gap is a thin sibling between the two children.
 *  - The right pane uses `flex: 1 1 auto` and consumes whatever's left.
 *
 * Auto-shrink (Phase 4):
 *  - When the splitter would force the editor narrower than its
 *    *natural* width, we publish `compressed: true` via context. The
 *    editor pane responds by tightening its gutters down to a hard
 *    minimum (see EditorPane.tsx).
 *  - When the splitter goes narrower than the editor's *compressed*
 *    min-width, `clipPx` continues to shrink (the editor stays at its
 *    min and just gets clipped). The clipped distance stays LOCAL — it
 *    drives the fade gradient at the right edge, which scales with
 *    overlap depth. It is deliberately NOT published through context:
 *    it changes per pointer frame in the clipped band, and a per-frame
 *    context identity would re-render every consumer (EditorPane) per
 *    frame. Context carries only the open/compressed edges.
 *
 * Ratio: stored externally (the parent owns the value + setter); we
 * don't pull from prefs here so the primitive is reusable.
 */

/** Minimum width for the code pane (px). The right edge is allowed to
 *  shrink to this; below it the splitter snaps. */
const CODE_PANE_MIN_PX = 240;
/** Hard minimum for the editor pane WITH compressed gutters. Matches
 *  the EditorPane CSS calc post-compression (~300px prose + the
 *  comfortable code-view gutter — CODE_VIEW_GUTTER_PX=48 — each side +
 *  2px border ≈ 398px). Keep in sync with EditorPane's
 *  CODE_VIEW_GUTTER_PX. Tuned visually. */
const EDITOR_PANE_COMPRESSED_MIN_PX = 398;
/** How far past the compressed min the editor wrapper may shrink (px)
 *  before we just refuse — i.e. the editor will always retain at least
 *  this much visible width even at full overlay. Zero means the editor
 *  can disappear entirely. We keep a sliver so the user can grab the
 *  splitter back. */
const EDITOR_MIN_VISIBLE_PX = 24;
/** Width of the drag gap itself (px). Should match `var(--pod-gap)`. */
const GAP_WIDTH_PX = 8;

export interface SplitWithCodeProps {
  /** Whether the code pane is open. When false, the editor takes the
   *  full container and the code pane / splitter aren't rendered.
   *  Editor child stays at the same tree position so it doesn't
   *  remount across open/close. */
  open: boolean;
  ratio: number;
  onRatioChange: (r: number) => void;
  /** The editor view (TipTap pod). Always rendered. */
  left: ReactNode;
  /** The code view (CodeMirror pod). Only rendered when `open`. */
  right: ReactNode;
  /** ► : push the TEXT cursor → align the CODE pane to it. When both
   *  align handlers are provided (and `open`), the divider renders a
   *  manual "sync position" pill. */
  onMoveCodeToText?: () => void;
  /** ◄ : push the CODE cursor → align the TEXT pane to it. */
  onMoveTextToCode?: () => void;
}

export function SplitWithCode({
  open,
  ratio,
  onRatioChange,
  left,
  right,
  onMoveCodeToText,
  onMoveTextToCode,
}: SplitWithCodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  // LOAD-BEARING mid-drag React state (contract-noted exception): the split
  // ratio must stay LIVE through React during the gesture because layout
  // decisions downstream derive from it in render — `compressed` flips
  // EditorPane's gutter compression (context consumers) the moment clipPx
  // crosses the editor's natural width, and the clip fade scales with
  // clippedPx. An imperative width write couldn't drive either. The state is
  // LOCAL, set at most once per frame (the engine RAF-coalesces + equality-
  // bails apply()), and `left`/`right` arrive as ReactNode props so their
  // subtrees bail on element identity — vs. the old path, which routed every
  // mousemove through onRatioChange → viewPrefs.setCodePaneRatio →
  // localStorage ×2 and re-rendered ALL of EditorLayout per move.
  // Persistence commits exactly once, on release.
  const [liveRatio, setLiveRatio] = useState<number | null>(null);
  const effectiveRatio = liveRatio ?? ratio;
  // The editor's natural width — measured ONLY while uncompressed
  // (see ref + skip below). Used as the stable threshold for the
  // compression decision; cached so it isn't polluted by the
  // post-compression scrollWidth (which would create a feedback loop
  // in the band where compressed-scrollWidth < clipPx < uncompressed-
  // scrollWidth).
  const [editorNaturalWidth, setEditorNaturalWidth] = useState(0);
  const compressedRef = useRef(false);

  // ResizeObserver on the container so ratio math has a live width.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Observe the editor's natural (uncompressed) width — measured from
  // the inner pod whenever it changes. Used to decide when to flip
  // `compressed`. We read scrollWidth (rather than clientWidth) so the
  // measurement is independent of the clip wrapper's pixel width.
  //
  // CRITICAL: we only commit the measurement to state while the editor
  // is currently uncompressed. Compressed-mode gutters shrink the
  // editor's scrollWidth; if we let that smaller value become the new
  // threshold, the splitter's "middle band" (compressed-scrollWidth <
  // clipPx < uncompressed-scrollWidth) would oscillate every frame:
  // compress → measure smaller → un-compress → measure larger → repeat.
  // The ref is updated synchronously in render so the observer
  // callback always sees the current compression state.
  useLayoutEffect(() => {
    const wrapper = editorWrapperRef.current;
    if (!wrapper) return;
    const child = wrapper.firstElementChild as HTMLElement | null;
    if (!child) return;
    const measure = () => {
      if (compressedRef.current) return; // skip while compressed
      const sw = child.scrollWidth;
      setEditorNaturalWidth((prev) => (prev === sw ? prev : sw));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(child);
    measure();
    return () => ro.disconnect();
  }, []);

  // The "natural" target width given the requested ratio (live mid-drag).
  const naturalEditorPx = Math.max(
    0,
    Math.round(effectiveRatio * Math.max(containerWidth - GAP_WIDTH_PX, 0)),
  );

  // Effective min that we clamp the *code pane* against — so the user
  // can't shrink code below CODE_PANE_MIN_PX. Translates to a max
  // editor width.
  const editorMaxPx = Math.max(0, containerWidth - GAP_WIDTH_PX - CODE_PANE_MIN_PX);

  // Editor wrapper actual width: clamp against [EDITOR_MIN_VISIBLE_PX,
  // editorMaxPx]. We allow it to drop below the editor's natural width
  // (overlay region) but never below the minimum visible sliver.
  const clipPx = Math.max(
    EDITOR_MIN_VISIBLE_PX,
    Math.min(naturalEditorPx, editorMaxPx),
  );

  // Compression kicks in once the wrapper would be narrower than the
  // editor's measured natural width. (Naturally false until we've
  // measured.) Mirror to a ref synchronously so the ResizeObserver
  // callback above can read the current state and skip measurements
  // while compressed.
  const compressed = editorNaturalWidth > 0 && clipPx < editorNaturalWidth;
  compressedRef.current = compressed;

  // Past the compressed min, we're truly clipping. The fade gradient
  // scales with how deep we are into clipping.
  const clippedPx = Math.max(0, EDITOR_PANE_COMPRESSED_MIN_PX - clipPx);

  // Per-gesture snapshot (container width + start px), taken in
  // getValue() — the engine's single start-edge read point. The gesture's
  // value is the editor track's px share (`ratio * (width - gap)`), so the
  // divider tracks the pointer delta 1:1.
  const dragRef = useRef({ w: 0, startPx: 0 });

  const handle = usePaneResizeHandle({
    id: "code-split",
    axis: "x",
    getValue: () => {
      const w = containerRef.current?.getBoundingClientRect().width ?? 0;
      const startPx = ratio * Math.max(w - GAP_WIDTH_PX, 0);
      dragRef.current = { w, startPx };
      return startPx;
    },
    clamp: (px) => {
      const w = dragRef.current.w;
      if (w <= 0) return px;
      const track = Math.max(w - GAP_WIDTH_PX, 0);
      // Clamp to [absolute min editor visible, container - code min].
      const minR = (EDITOR_MIN_VISIBLE_PX + GAP_WIDTH_PX / 2) / w;
      const maxR = (w - CODE_PANE_MIN_PX - GAP_WIDTH_PX / 2) / w;
      return Math.max(minR * track, Math.min(maxR * track, px));
    },
    // Live path: the RAF-coalesced local liveRatio (see its declaration for
    // the load-bearing justification).
    apply: (px) => {
      const track = Math.max(dragRef.current.w - GAP_WIDTH_PX, 0);
      if (track > 0) setLiveRatio(px / track);
    },
    commit: (px) => {
      const track = Math.max(dragRef.current.w - GAP_WIDTH_PX, 0);
      // Both state writes batch into one render: the committed prefs ratio
      // arrives as the `ratio` prop in the same pass that drops liveRatio.
      setLiveRatio(null);
      // Zero-move end (plain click): keep the old no-write behavior. Exact
      // px compare against the getValue() snapshot — the engine commits the
      // untouched start value on a zero-move, whereas a ratio round-trip
      // ((r·track)/track) is not IEEE-exact for ~10% of stored (ratio, width)
      // pairs and would fire a spurious pref write per plain click.
      if (track > 0 && px !== dragRef.current.startPx) onRatioChange(px / track);
    },
    restore: () => setLiveRatio(null),
  });

  // Context identity changes ONLY on the open/compressed edges — never per
  // drag frame. clippedPx stays local (the fade below): in the clipped band
  // it changes with every RAF apply, and publishing it minted a fresh context
  // value per frame, which pierces the element-identity bailout and
  // re-rendered EditorPane — the heaviest consumer — once per pointer frame.
  const splitState = useMemo<CodePaneSplitState>(
    () => ({ active: open, compressed: open && compressed }),
    [open, compressed],
  );

  // Fade-gradient strength: 0..1 based on how far into clipping we
  // are, capped at 80px of clip depth for visual softness.
  const fadeOpacity = Math.min(1, clippedPx / 80);

  return (
    <CodePaneSplitProvider value={splitState}>
      <div
        ref={containerRef}
        className="flex flex-row min-w-0 min-h-0 flex-1 relative"
        // Span the full editor scroll height so the sticky right side
        // (gap + code pane) stays pinned across the whole document.
        // Without this, splitOuter's height defaults to its parent
        // flex container's cross-size (= scroller's clientHeight,
        // ~868px), making it the containing block for the sticky
        // child — which then falls out of the containing block after
        // ~viewport-height of scroll and starts scrolling naturally.
        // `--row-bound-h` is set on `[data-virgil-row-scroll]` by
        // EditorScrollbar (= max of editor's scrollHeight and row's
        // clientHeight). Same trick editor-pane-column uses
        // (EditorPane.tsx:3549) so its own sticky chrome works.
        style={{ minHeight: 'var(--row-bound-h, 100vh)' }}
      >
        {/* Left: editor pane. When closed, fills the container (the
            wrapper still exists so EditorPane keeps a stable parent
            chain and doesn't remount across toggles). When open, the
            wrapper has a fixed pixel width and clips the editor's
            right edge once we cross the compressed-min threshold. */}
        <div
          ref={editorWrapperRef}
          className="relative"
          // Per-axis overflow: `clip` (not `hidden`) so the wrapper
          // does NOT become a scroll container or a sticky-positioning
          // ancestor. `overflow: hidden` was breaking EditorPane two
          // ways: (a) trapping mouse-wheel scroll (the outer
          // `data-virgil-row-scroll` couldn't see the prose overflow),
          // and (b) re-anchoring EditorPane's nine sticky chrome
          // elements (pod caps, MenuBar, lozenge, etc.) to this
          // wrapper instead of the outer scroller. `clip` clips
          // without creating either context. CSS Overflow L3,
          // Chrome 90+ / Firefox 81+ / Safari 16+.
          style={
            // Wrapper is a real flex container so EditorPane's
            // `flex: 1` at `editor-pane-root` takes effect — restoring
            // the pre-split-refactor layout context. `display: block`
            // here previously neutralized EditorPane's flex, breaking
            // the cross-axis stretch chain that the pod's sticky
            // chrome (cap, mask) and editor-pane-column's
            // `minHeight: var(--row-bound-h)` assume.
            open
              ? {
                  width: clipPx,
                  flex: "0 0 auto",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "stretch",
                  minWidth: 0,
                  minHeight: 0,
                  overflowX: "clip",
                  overflowY: "visible",
                  // Thin background gutter on the LEFT of the editor pod,
                  // mirroring the code pod's `marginRight: 4` (EditorLayout)
                  // so the code-view layout reads symmetric edge-to-edge.
                  marginLeft: 4,
                }
              : {
                  flex: "1 1 auto",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "stretch",
                  minWidth: 0,
                  minHeight: 0,
                  overflowX: "clip",
                  overflowY: "visible",
                }
          }
          data-virgil-codesplit-editor=""
        >
          {left}
          {open && fadeOpacity > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 right-0 bottom-0"
              style={{
                width: 32,
                background:
                  "linear-gradient(to right, transparent, var(--background) 100%)",
                opacity: fadeOpacity,
              }}
            />
          )}
        </div>
        {open && (
          /* Sticky-pin the right side (gap + code pane) so the code
             view stays anchored to the viewport while the editor's
             outer scroller (`[data-virgil-row-scroll]`) scrolls
             vertically. `align-self: flex-start` is critical — the
             outer container defaults to `align-items: stretch`, which
             would stretch this sticky element to the scroller's
             content height (≈6000+ px) and defeat the pin. Explicit
             `height: var(--scroll-viewport-h)` (set on the row
             scroller by EditorScrollbar) keeps the right side
             viewport-sized; the 100vh fallback covers cold-render. */
          <div
            style={{
              position: "sticky",
              top: 0,
              alignSelf: "flex-start",
              height: "var(--scroll-viewport-h, 100vh)",
              display: "flex",
              flexDirection: "row",
              flex: "1 1 auto",
              minWidth: 0,
              minHeight: 0,
              // Above the editor pod's sticky chrome (frame z-31, caps z-30,
              // band z-40, z-41 element) — which lives in the outer stacking
              // context. Without this the pod's edge/background-ring shadow
              // paints over the divider + the manual-sync chevron pill.
              zIndex: 45,
            }}
          >
            {/* Drag gap */}
            <div
              className="relative shrink-0 z-10"
              style={{ width: GAP_WIDTH_PX }}
            >
              <div
                className="drag-gap drag-gap-v band-grip w-full h-full"
                {...handle}
              />
              {/* Manual "sync position" pill — pinned with the divider
                  (it lives inside the sticky container). Two stacked
                  arrows: ◄ aligns the LEFT/text pane to the code cursor,
                  ► aligns the RIGHT/code pane to the text cursor. The
                  pill is `pointer-events:auto` over the otherwise
                  drag-only gap, and each button stops mousedown
                  propagation so clicking a button never starts a drag. */}
              {onMoveCodeToText && onMoveTextToCode && (
                <div
                  className="absolute top-1/2 left-1/2 z-20 flex flex-col"
                  style={{
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "auto",
                    borderRadius: "var(--radius-md)",
                    border: "var(--pod-border, 1px solid var(--border))",
                    background: "var(--pod-editor, var(--surface))",
                    boxShadow: "var(--pod-shadow, 0 1px 2px rgba(0,0,0,0.08))",
                    overflow: "hidden",
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="flex items-center justify-center text-ink-muted hover:text-ink-body hover-on-light focus-ring"
                    style={{ width: 18, height: 18 }}
                    {...iconHint({ label: "Sync text to code position" })}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={onMoveTextToCode}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M6.5 2 3 5l3.5 3"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <div
                    aria-hidden
                    style={{ height: 1, background: "var(--border)" }}
                  />
                  <button
                    type="button"
                    className="flex items-center justify-center text-ink-muted hover:text-ink-body hover-on-light focus-ring"
                    style={{ width: 18, height: 18 }}
                    {...iconHint({ label: "Sync code to text position" })}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={onMoveCodeToText}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M3.5 2 7 5l-3.5 3"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {/* Right: code pane */}
            <div
              className="flex flex-col min-w-0 min-h-0"
              style={{ flex: "1 1 auto" }}
              data-virgil-codesplit-code=""
            >
              {right}
            </div>
          </div>
        )}
      </div>
    </CodePaneSplitProvider>
  );
}
