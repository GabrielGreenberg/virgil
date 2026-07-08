"use client";

import {
  forwardRef,
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isGutterDragging, onGutterDragChange } from "@library/lib/gutter-drag";
import {
  ACTIVE_MIN_CONTENT,
  buildActiveTabStrokePath,
  buildTabFillPath,
  deriveTabWidthFromWrapper,
  MANILA_RADIUS,
  recoverNaturalContentWidth,
  TAB_TOP_GUTTER,
  tabSvgGeometry,
} from "./folder-path";

// The active tab's title span is tagged with this attribute (see
// PanelTabStrip) so the natural-width measurement below can read the label's
// UN-CLIPPED intrinsic width off the one flexible child, instead of the
// width-clamped overlay's latched scrollWidth (task 088).
const TITLE_MEASURE_ATTR = "data-tab-title";

// Top-corner radius of the manila-folder tab, from the single geometry SSOT
// (folder-path.ts). It is the numeric twin of the CSS token
// `--library-manila-radius` (consumed by the panel-body frame in
// TabbedLibraryPanel, NavPod, and the list/project headers) — sourcing the tab
// OUTLINE and the panel FRAME from the same value is what keeps them tangent at
// the corner instead of drifting into a hairline overshoot. Deliberately
// rounder than the global --pod-radius (8); do NOT "fix" it to 8 to unify.
const R = MANILA_RADIUS;
const S = 12;
const TAB_H = 32;
// The tab silhouette's outline. Uses --library-edge (a darker tint of
// --library-bg, defined in globals.css) so the manila edges harmonize with the
// library field instead of the old --topbar-border warm taupe, which clashed
// warm-on-cool over the promoted cool --library-bg (task 048). The fallback is
// a cool blue-gray tint of the same family, never the retired warm token.
const STROKE = "var(--library-edge, #b3c0c4)";


type WrapperProps = {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLElement>) => void;
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  style?: CSSProperties;
} & Pick<HTMLAttributes<HTMLDivElement>, "onMouseEnter" | "onMouseLeave">;

type Props = {
  active: boolean;
  fill: string;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
  wrapperProps?: WrapperProps;
  /** Renders as data-tab-id on the outer wrapper so DOM-traversal-based
   * drop resolution can identify which tab a target belongs to. */
  dataTabId?: string;
  /** Task 053 — tuck the LEFT/RIGHT swoop foot onto the body's rounded top
   *  corner so the outer swoop of an edge tab flows into the page frame instead
   *  of poking past it and notching. Set by the strip for the first tab (left)
   *  and a flush-right last tab (right); interior feet stay untucked. */
  tuckLeftFoot?: boolean;
  tuckRightFoot?: boolean;
};

export const PanelFolderTab = forwardRef<HTMLDivElement, Props>(
  function PanelFolderTab(
    {
      active,
      fill,
      onClick,
      title,
      children,
      wrapperProps,
      dataTabId,
      tuckLeftFoot,
      tuckRightFoot,
    },
    forwardedRef,
  ) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    // The flex-assigned wrapper width, mapped to the inner body width `tabW`
    // the path is drawn at (F#15). Floors at ACTIVE_MIN_CONTENT.
    const [tabW, setTabW] = useState(ACTIVE_MIN_CONTENT);
    // The content's intrinsic width — the tab's *natural* (uncompressed) body
    // width. Drives the flex preferred-size + max-width so the tab grows to fit
    // its name when there's room and shrinks (Chrome-style) when there isn't.
    const [naturalTabW, setNaturalTabW] = useState(ACTIVE_MIN_CONTENT);

    // F#15 SVG-flex inversion. TWO independent reads, neither a feedback loop:
    //   (1) wrapperRef → the width the strip's flex layout ASSIGNED us. We map
    //       it to `tabW` and repaint the folder path at exactly that size, so
    //       svgW(tabW) === laidOut and the shape never under/overflows its box.
    //   (2) contentRef → the label/icons' INTRINSIC width. It sets the flex
    //       preferred size, so the tab requests its natural width and grows to
    //       fit its name when there's room.
    // The <svg> and the content overlay are both absolutely-positioned (+
    // pointer-events:none on the svg), so neither participates in flex layout —
    // writing `tabW`/`naturalTabW` to state can't change what the observers
    // measure on the next frame once the fixpoint (svgW === laidOut) is reached.
    // Set while a Library L/R gutter drag parked a would-be measure, so the
    // one post-drag settle knows to reconcile the final geometry (task 090).
    const dirtyRef = useRef(false);
    const measure = useCallback(() => {
      const wrap = wrapperRef.current;
      const content = contentRef.current;
      if (!wrap) return;
      const nextTabW = deriveTabWidthFromWrapper({
        laidOutWidth: wrap.getBoundingClientRect().width,
        minTabW: ACTIVE_MIN_CONTENT,
        S,
      });
      // Equality gate (matches frameBox / activeFlushRight): an RO fire that
      // resolves to the SAME integer width must NOT setState — otherwise a
      // continuous gutter drag re-renders + rebuilds the folder `d` string
      // every frame (the "random redraw"), even sub-pixel-identical frames.
      setTabW((prev) => (prev === nextTabW ? prev : nextTabW));
      if (content) {
        // The overlay is width-CLAMPED to the assigned tabW (svgW − 2*S − 1)
        // with overflow:hidden, so its OWN scrollWidth latches at ≈ tabW and
        // can NOT report the tab's natural (uncompressed) width — the old
        // `content.scrollWidth` read pinned naturalTabW to the current width, so
        // a long-named active tab never grew past its floor and rendered "C…"
        // (task 088). Recover the intrinsic width from the ONE shrinking child,
        // the title span (tagged data-tab-title): its scrollWidth is the
        // un-clipped text width even while it renders ellipsized. While the tab
        // is being renamed the title is an <input> (no tagged span) → fall back
        // to the raw scrollWidth.
        const titleEl = content.querySelector<HTMLElement>(
          `[${TITLE_MEASURE_ATTR}]`,
        );
        const naturalContent = titleEl
          ? recoverNaturalContentWidth({
              overlayClientWidth: content.clientWidth,
              titleClientWidth: titleEl.clientWidth,
              titleScrollWidth: titleEl.scrollWidth,
            })
          : content.scrollWidth;
        const nextNatural = Math.max(
          ACTIVE_MIN_CONTENT,
          Math.ceil(naturalContent),
        );
        setNaturalTabW((prev) => (prev === nextNatural ? prev : nextNatural));
      }
    }, []);

    useLayoutEffect(() => {
      const wrap = wrapperRef.current;
      const content = contentRef.current;
      if (!wrap) return;
      measure();
      // Park while a Library L/R gutter is being dragged: the strip re-assigns
      // this wrapper's width every pointermove frame, but re-measuring +
      // repainting the folder silhouette per frame is exactly the "random
      // redraw" + choppiness. Stash a dirty bit and reconcile once on release.
      const onResize = () => {
        if (isGutterDragging()) {
          dirtyRef.current = true;
          return;
        }
        measure();
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(wrap);
      if (content) ro.observe(content);
      const unsub = onGutterDragChange((active) => {
        if (!active && dirtyRef.current) {
          dirtyRef.current = false;
          measure();
        }
      });
      return () => {
        ro.disconnect();
        unsub();
      };
    }, [measure]);

    // The overlay's box is pinned to the assigned width, so the ResizeObserver
    // above never fires on a pure title-text change (rename). Re-measure when
    // the title prop changes so the active tab regrows/shrinks to the new name.
    useLayoutEffect(() => {
      measure();
    }, [title, measure]);

    const { svgW, svgH, inset, insetY } = tabSvgGeometry({ tabW, tabH: TAB_H, S });
    // Natural (uncompressed) canvas width — the flex preferred + max size.
    const naturalSvgW = tabSvgGeometry({ tabW: naturalTabW, tabH: TAB_H, S }).svgW;
    // Memoize the folder-path `d` strings on their geometry inputs (R/S/TAB_H
    // are module constants). Without this the SVG path was rebuilt on EVERY
    // render, so any unrelated re-render during a drag re-serialized the
    // silhouette — part of the per-frame thrash (task 090). Now the `d` string
    // is a stable reference unless the width/tuck actually changes.
    const fillPath = useMemo(
      () =>
        buildTabFillPath({
          tabW,
          tabH: TAB_H,
          R,
          S,
          tuckLeft: tuckLeftFoot,
          tuckRight: tuckRightFoot,
        }),
      [tabW, tuckLeftFoot, tuckRightFoot],
    );
    const strokePath = useMemo(
      () =>
        active
          ? buildActiveTabStrokePath({
              tabW,
              tabH: TAB_H,
              R,
              S,
              tuckLeft: tuckLeftFoot,
              tuckRight: tuckRightFoot,
            })
          : null,
      [active, tabW, tuckLeftFoot, tuckRightFoot],
    );
    // The 1px seam bridge covers ONLY the tab's FLAT-BODY span, so the tab merges
    // into the page there — but the swoop-foot VALLEYS (where each foot dips down)
    // are left UNBRIDGED, so the body's top-edge frame stroke shows under them and
    // each foot visibly lands on the page edge instead of floating (task 053).
    // A TUCKED foot lands on a body CORNER: keep the bridge starting at that
    // corner's tangent (R + inset) so the corner arc stays exposed, exactly as
    // before. An UNTUCKED foot dips into a valley: stop the bridge at the flat
    // body's vertical side (x = S on the left, x = S + tabW on the right) so the
    // valley beyond it shows the page edge.
    const bridgeLeft = tuckLeftFoot ? R + inset : S;
    const bridgeRight = tuckRightFoot ? 2 * S + tabW - R + inset : S + tabW;

    const { style: extraStyle, ...restWrapperProps } = wrapperProps ?? {};

    const setWrapper = (el: HTMLDivElement | null) => {
      wrapperRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    return (
      <div
        ref={setWrapper}
        {...restWrapperProps}
        data-tab-id={dataTabId}
        style={{
          position: "relative",
          // F#15 (task 088): the active tab RESISTS the squeeze — flex-shrink:0
          // so it holds its natural width (its full title) while the background
          // tabs (flex:"1 1 auto") absorb the squeeze and ellipsize first. Once
          // the backgrounds hit their floor and the strip still overflows, the
          // F#15 scroll-active-into-view effect keeps the active tab visible —
          // the strip scrolls rather than ever ellipsizing the active name.
          // (Equal flex-shrink previously made the LARGER-basis active tab
          // absorb MORE of the shrink, so it starved to "C…" first — the exact
          // inversion of the intended "active resists, inactive yield" doctrine.)
          // The min-width floor is retained as the reserved-width contract.
          flex: "0 0 auto",
          minWidth: 2 * S + ACTIVE_MIN_CONTENT + 1,
          // Preferred + max width = the tab's natural (uncompressed) extent, so
          // it grows to fit its name when there's room and shrinks toward the
          // floor (min-width) when the strip is crowded. The SVG below repaints
          // at the *assigned* width (svgW), so the shape always fills the box.
          width: naturalSvgW,
          maxWidth: naturalSvgW,
          cursor: "default",
          alignSelf: "flex-end",
          height: svgH,
          zIndex: active ? 10 : 1,
          // The active tab overlaps the body's top border by 1px so its 1px
          // fill bridge (the bottom-most SVG row, y = svgH − 1) paints over that
          // border segment — the tab merges seamlessly into the page while the
          // body's top border continues, uncovered, under the inactive tabs to
          // either side. Active only; inactive tabs sit flush on the strip
          // baseline. (The tab's own top gutter — TAB_TOP_GUTTER — grows svgH at
          // the TOP, so this bottom overlap is unaffected.)
          marginBottom: active ? -1 : 0,
          ...extraStyle,
        }}
        onClick={onClick}
        title={title}
      >
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
          }}
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          shapeRendering="geometricPrecision"
          aria-hidden
        >
          <g transform={`translate(${inset}, ${insetY})`}>
            <path d={fillPath} fill={fill} stroke="none" />
          </g>
          <rect
            x={bridgeLeft}
            // The seam bridge sits on the bottom-most SVG pixel row (below the
            // shifted fill's bottom edge at TAB_H + insetY), overlapping the
            // body's top border. Expressed as svgH − 1 so it tracks the top
            // gutter (which grows svgH) without a separate offset.
            y={svgH - 1}
            width={Math.max(0, bridgeRight - bridgeLeft)}
            height="1"
            fill={fill}
          />
          <g transform={`translate(${inset}, ${insetY})`}>
            {strokePath ? (
              <path
                d={strokePath}
                fill="none"
                stroke={STROKE}
                strokeWidth="1"
              />
            ) : (
              <path d={fillPath} fill="none" stroke={STROKE} strokeWidth="1" />
            )}
          </g>
        </svg>
        <div
          ref={contentRef}
          style={{
            position: "absolute",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 8px 0 14px",
            left: S,
            // Follow the tab body down by the top gutter so the label stays
            // vertically centred in the manila shape (the fill/stroke shifted
            // down by TAB_TOP_GUTTER; without this the label would ride 1px high).
            top: TAB_TOP_GUTTER,
            // Span the tab body's flat top [S, S + tabW] exactly (width tabW).
            // svgW carries the F#8 +1px horizontal stroke gutter, so the content
            // width is svgW − 2*S − 1 (=== tabW) — subtracting the gutter here
            // decouples it from the content layout box, which would otherwise be
            // 1px wider than the geometric flat-top span. overflow:hidden lets
            // the label inside ellipsize (F#15) when the active tab is compressed
            // toward its floor; min-w-0 semantics come from the explicit right
            // edge. The label span itself carries text-overflow:ellipsis (see
            // PanelTabStrip).
            width: svgW - 2 * S - 1,
            height: TAB_H,
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    );
  },
);
