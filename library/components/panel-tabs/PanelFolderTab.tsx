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
import { buildActiveTabStrokePath, buildTabFillPath } from "./folder-path";

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
    const contentRef = useRef<HTMLDivElement | null>(null);
    const [tabW, setTabW] = useState(120);

    useLayoutEffect(() => {
      const el = contentRef.current;
      if (!el) return;
      const update = () =>
        setTabW(Math.ceil(el.getBoundingClientRect().width));
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const svgW = 2 * S + tabW;
    const svgH = TAB_H + 1;
    const fillPath = buildTabFillPath({ tabW, tabH: TAB_H, R, S });
    const strokePath = active
      ? buildActiveTabStrokePath({ tabW, tabH: TAB_H, R, S })
      : null;

    const { style: extraStyle, ...restWrapperProps } = wrapperProps ?? {};

    return (
      <div
        ref={forwardedRef}
        {...restWrapperProps}
        data-tab-id={dataTabId}
        style={{
          position: "relative",
          flexShrink: 0,
          cursor: "default",
          alignSelf: "flex-end",
          width: svgW,
          height: svgH,
          zIndex: active ? 10 : 1,
          marginBottom: -1,
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
          <g transform="translate(0.5, 0.5)">
            <path d={fillPath} fill={fill} stroke="none" />
          </g>
          <rect x="0" y={TAB_H} width={svgW} height="1" fill={fill} />
          <g transform="translate(0.5, 0.5)">
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
            height: TAB_H,
            minWidth: 130,
          }}
        >
          {children}
        </div>
      </div>
    );
  },
);
