"use client";

import {
  forwardRef,
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ACTIVE_MIN_CONTENT,
  buildActiveTabStrokePath,
  buildTabFillPath,
  deriveTabWidthFromWrapper,
  tabSvgGeometry,
} from "./folder-path";

// R=10: top-corner radius of the manila-folder tab. DELIBERATELY distinct
// from the global --pod-radius (8) — the Library tab strip keeps its own
// slightly rounder manila aesthetic on purpose. It also matches the
// unifying folder-frame radius in TabbedLibraryPanel so the active tab's
// corners line up with the panel frame. Do NOT "fix" this to 8 to unify.
const R = 10;
const S = 12;
const TAB_H = 32;
const STROKE = "var(--topbar-border, #cbc3b8)";


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
};

export const PanelFolderTab = forwardRef<HTMLDivElement, Props>(
  function PanelFolderTab(
    { active, fill, onClick, title, children, wrapperProps, dataTabId },
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
    //   (2) contentRef → the label/icons' INTRINSIC width (scrollWidth, valid
    //       even though the overlay is position:absolute). It sets the flex
    //       preferred size, so the tab requests its natural width and shrinks
    //       only under pressure.
    // The <svg> and the content overlay are both absolutely-positioned (+
    // pointer-events:none on the svg), so neither participates in flex layout —
    // writing `tabW`/`naturalTabW` to state can't change what the observers
    // measure on the next frame once the fixpoint (svgW === laidOut) is reached.
    useLayoutEffect(() => {
      const wrap = wrapperRef.current;
      const content = contentRef.current;
      if (!wrap) return;
      const update = () => {
        setTabW(
          deriveTabWidthFromWrapper({
            laidOutWidth: wrap.getBoundingClientRect().width,
            minTabW: ACTIVE_MIN_CONTENT,
            S,
          }),
        );
        if (content) {
          // scrollWidth is the un-clipped intrinsic width (ignores the
          // overflow:hidden ellipsis clamp). tabW that this content wants =
          // its width minus the left padding already baked into `left:S`.
          setNaturalTabW(Math.max(ACTIVE_MIN_CONTENT, Math.ceil(content.scrollWidth)));
        }
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(wrap);
      if (content) ro.observe(content);
      return () => ro.disconnect();
    }, []);

    const { svgW, svgH, inset } = tabSvgGeometry({ tabW, tabH: TAB_H, S });
    // Natural (uncompressed) canvas width — the flex preferred + max size.
    const naturalSvgW = tabSvgGeometry({ tabW: naturalTabW, tabH: TAB_H, S }).svgW;
    const fillPath = buildTabFillPath({ tabW, tabH: TAB_H, R, S });
    const strokePath = active
      ? buildActiveTabStrokePath({ tabW, tabH: TAB_H, R, S })
      : null;

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
          // F#15: the active tab resists the squeeze (last to shrink) but is
          // NOT flexShrink:0 — the strip shares width Chrome-style. It floors
          // at its reserved min-width (2*S swoops + ACTIVE_MIN_CONTENT body +
          // 1px gutter); past the floor the strip scrolls, never ellipsizing
          // the active tab's name.
          flex: "0 1 auto",
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
          // fill bridge (svgH = TAB_H + 1) paints over that border segment —
          // the tab merges seamlessly into the page while the body's top
          // border continues, uncovered, under the inactive tabs to either
          // side. Active only; inactive tabs sit flush on the strip baseline.
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
          <g transform={`translate(${inset}, ${inset})`}>
            <path d={fillPath} fill={fill} stroke="none" />
          </g>
          <rect x="0" y={TAB_H} width={svgW} height="1" fill={fill} />
          <g transform={`translate(${inset}, ${inset})`}>
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
            top: 0,
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
