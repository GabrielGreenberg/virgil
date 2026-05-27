"use client";

import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDragGap } from "@/hooks/useDragGap";
import {
  CodePaneSplitProvider,
  type CodePaneSplitState,
} from "./CodePaneSplitContext";

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
 *    min and just gets clipped). The clipped distance is published as
 *    `clippedPx` so a fade gradient at the right edge can scale with
 *    overlap depth.
 *
 * Ratio: stored externally (the parent owns the value + setter); we
 * don't pull from prefs here so the primitive is reusable.
 */

/** Minimum width for the code pane (px). The right edge is allowed to
 *  shrink to this; below it the splitter snaps. */
const CODE_PANE_MIN_PX = 240;
/** Hard minimum for the editor pane WITH compressed gutters. Matches
 *  the EditorPane CSS calc post-compression (~300px prose + ~16px
 *  gutters each side + 2px border ≈ 334px). Tuned visually. */
const EDITOR_PANE_COMPRESSED_MIN_PX = 334;
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
}

export function SplitWithCode({
  open,
  ratio,
  onRatioChange,
  left,
  right,
}: SplitWithCodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
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

  // The "natural" target width given the requested ratio.
  const naturalEditorPx = Math.max(
    0,
    Math.round(ratio * Math.max(containerWidth - GAP_WIDTH_PX, 0)),
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

  const onMove = useCallback(
    (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const r = (ev.clientX - rect.left) / rect.width;
      // Clamp to [absolute min editor visible, container - code min].
      const minR = (EDITOR_MIN_VISIBLE_PX + GAP_WIDTH_PX / 2) / rect.width;
      const maxR =
        (rect.width - CODE_PANE_MIN_PX - GAP_WIDTH_PX / 2) / rect.width;
      onRatioChange(Math.max(minR, Math.min(maxR, r)));
    },
    [onRatioChange],
  );

  const { gapRef, onMouseDown } = useDragGap({
    cursor: "col-resize",
    onMove,
  });

  const splitState = useMemo<CodePaneSplitState>(
    () => ({ active: open, compressed: open && compressed, clippedPx: open ? clippedPx : 0 }),
    [open, compressed, clippedPx],
  );

  // Fade-gradient strength: 0..1 based on how far into clipping we
  // are, capped at 80px of clip depth for visual softness.
  const fadeOpacity = Math.min(1, clippedPx / 80);

  return (
    <CodePaneSplitProvider value={splitState}>
      <div
        ref={containerRef}
        className="flex flex-row min-w-0 min-h-0 flex-1 relative"
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
            open
              ? {
                  width: clipPx,
                  flex: "0 0 auto",
                  overflowX: "clip",
                  overflowY: "visible",
                }
              : {
                  flex: "1 1 auto",
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
          <>
            {/* Drag gap */}
            <div
              className="relative shrink-0 z-10"
              style={{ width: GAP_WIDTH_PX }}
            >
              <div
                ref={gapRef}
                className="drag-gap drag-gap-v w-full h-full"
                onMouseDown={onMouseDown}
              />
            </div>
            {/* Right: code pane */}
            <div
              className="flex flex-col min-w-0 min-h-0"
              style={{ flex: "1 1 auto" }}
              data-virgil-codesplit-code=""
            >
              {right}
            </div>
          </>
        )}
      </div>
    </CodePaneSplitProvider>
  );
}
