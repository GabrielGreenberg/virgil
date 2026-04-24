"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";

export type ToolbarOrientation = "horizontal" | "vertical";

/** Shared pod + tab + knob shell used by every floating toolbar (the
 *  main MenuBar, the detached Actions toolbar, the detached Formatting
 *  toolbar). All three share the same visual language: pod-coloured
 *  rounded lozenge body with a small rectangular tab that sticks out of
 *  one corner carrying a rotation knob (and optionally a close/dock
 *  button).
 *
 *  The shell is a thin wrapper — it renders the SVG outline filter,
 *  paints the pod background + tab background, and overlays the
 *  rotation knob (and optional end-slot) on the tab. The caller
 *  supplies the pod's content (icon row, grab bar, collapse button,
 *  etc.) via `children`. Keeping state like `collapsed` and drag
 *  position in the caller lets each toolbar make its own decisions.
 *
 *  `atHome` is the MenuBar's docked mode: no tab, no knob, no drop
 *  shadow, uniform corner radius. Only MenuBar uses this mode today. */
export function FloatingToolbarShell({
  orientation,
  atHome = false,
  onToggleOrientation,
  tabEndSlot,
  children,
  podClassName,
  podStyle,
  podDataAttrs,
}: {
  orientation: ToolbarOrientation;
  atHome?: boolean;
  /** Click handler for the rotation knob. Omit when atHome (knob is
   *  hidden). The knob exposes `data-toolbar-knob=""` on its root so
   *  callers can measure its viewport position for pivot-preserving
   *  state changes (rotate, collapse). */
  onToggleOrientation?: () => void;
  /** Optional click target rendered on the tab *before* the knob, along
   *  the tab's long axis. Used by detached toolbars for the close /
   *  re-dock button. */
  tabEndSlot?: ReactNode;
  /** Pod contents — the icon row, grab handle, anything the toolbar
   *  wants to paint on top of its pod background. The caller is
   *  responsible for laying out `flex-col-reverse` / `flex-row` per
   *  orientation, plus any orientation-specific padding. */
  children: ReactNode;
  /** Applied to the content flex container so callers can control
   *  orientation layout + padding without wrapping another div. */
  podClassName?: string;
  podStyle?: CSSProperties;
  /** Data-attribute map applied to the pod content div. Used by
   *  `ActionButton` to find the pod rect via
   *  `closest("[data-action-pod]")`. Keys are attr names (e.g.
   *  `"data-action-pod"`); values become the attribute's string value. */
  podDataAttrs?: Record<string, string>;
}) {
  // Each shell instance gets its own filter id. Sharing ids across
  // multiple instances of the filter would make later instances resolve
  // to earlier instances' filter trees, breaking the outline when one
  // unmounts.
  const filterId = useId();
  const isVert = orientation === "vertical";

  const shellFilter = atHome
    ? `url(#${filterId})`
    : `url(#${filterId}) drop-shadow(0 1px 6px rgba(0,0,0,0.12)) drop-shadow(0 0 2px rgba(0,0,0,0.06))`;

  // Tab is sized to fit the knob plus (optionally) one end button. We
  // pick 26px when a tab end-slot is present (room for X + knob) and
  // 24px otherwise — matches the historical MenuBar / Actions tabs.
  const tabMain = tabEndSlot ? 26 : 24;
  const tabStyle: CSSProperties = isVert
    ? { width: 14, height: tabMain, top: 0, right: -10, borderRadius: "0 5px 5px 0" }
    : { width: tabMain, height: 14, right: 0, bottom: -10, borderRadius: "0 0 5px 5px" };

  // At home the pod is a simple rounded lozenge; when free, the corner
  // where the tab attaches is squared off so the pod's rounded arc
  // doesn't leave a sliver of empty alpha behind the tab.
  const podBorderRadius = atHome
    ? "var(--pod-radius)"
    : isVert
      ? "var(--pod-radius) 0 var(--pod-radius) var(--pod-radius)"
      : "var(--pod-radius) var(--pod-radius) 0 var(--pod-radius)";

  return (
    <div className="relative inline-flex">
      {/* Outline filter — dilates the source by 1px, subtracts the
          original to get a 1px ring, floods it with the border color,
          then composites the original on top. Shared by pod + tab so
          the merged silhouette reads as a single lozenge. */}
      <svg aria-hidden className="absolute" width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }}>
        <defs>
          <filter id={filterId}>
            <feMorphology operator="dilate" radius="1" in="SourceGraphic" result="dilated" />
            <feComposite operator="out" in="dilated" in2="SourceGraphic" result="ring" />
            <feFlood floodColor="#c9c5c5" result="flood" />
            <feComposite operator="in" in="flood" in2="ring" result="outline" />
            <feMerge>
              <feMergeNode in="outline" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>
      {/* Shell: pod background + tab background, both painted below the
          content so the SVG outline wraps the merged silhouette. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ filter: shellFilter }}>
        <div
          className="absolute inset-0"
          style={{ background: "var(--pod-toolbar)", borderRadius: podBorderRadius }}
        />
        {!atHome && (
          <div className="absolute" style={{ ...tabStyle, background: "var(--pod-toolbar)" }} />
        )}
      </div>

      {/* Content — painted on top of the shell. */}
      <div
        className={`relative flex items-center ${podClassName ?? ""}`}
        style={podStyle}
        {...(podDataAttrs ?? {})}
      >
        {children}
      </div>

      {/* Tab affordances — transparent buttons overlaid on the tab
          background painted by the shell. Laid out along the tab's
          long axis; the knob sits at the "end" closest to the trailing
          edge of the pod so it reads as the pivot. */}
      {!atHome && (
        <div
          className={`absolute flex items-stretch ${isVert ? "flex-col-reverse" : "flex-row"}`}
          style={tabStyle}
        >
          {tabEndSlot}
          <button
            onClick={onToggleOrientation}
            title={isVert ? "Rotate toolbar to horizontal" : "Rotate toolbar to vertical"}
            data-toolbar-knob=""
            className="group/knob flex items-center justify-center"
            style={{ background: "transparent", border: "none", padding: 0, width: 14, height: 14 }}
          >
            <div
              className="rounded-full bg-[var(--muted-light)] group-hover/knob:bg-[var(--foreground)] transition-colors duration-150"
              style={{ width: 4, height: 4 }}
            />
          </button>
        </div>
      )}
    </div>
  );
}

/** Small X glyph button used as the tab end-slot on detached toolbars
 *  (close / re-dock). Takes the whole remaining tab length via
 *  `flex: 1 1 auto`. */
export function TabEndCloseButton({
  onClick,
  title,
  orientation,
}: {
  onClick: () => void;
  title: string;
  orientation: ToolbarOrientation;
}) {
  const isVert = orientation === "vertical";
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center text-[var(--muted-light)] hover:text-[var(--foreground)] transition-colors"
      style={{ background: "transparent", border: "none", padding: 0, flex: "1 1 auto", paddingLeft: isVert ? 0 : 2 }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}

/** The 3px × 18px rounded-pill grab handle. Defaults to horizontal;
 *  pass `orientation="vertical"` when the pod is rotated. */
export function PodGrabHandle({
  onMouseDown,
  title,
  orientation = "horizontal",
}: {
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  title: string;
  orientation?: ToolbarOrientation;
}) {
  const isVert = orientation === "vertical";
  return (
    <div
      onMouseDown={onMouseDown}
      title={title}
      className={`group/grab cursor-grab active:cursor-grabbing flex items-center justify-center ${
        isVert ? "-mt-0.5 px-1 pt-0 pb-0" : "-ml-0.5 py-1 pl-0 pr-1"
      }`}
      style={{ touchAction: "none", userSelect: "none" }}
    >
      <div
        className={`rounded-full bg-[var(--muted-light)] group-hover/grab:bg-[var(--foreground)] transition-colors duration-150 ${
          isVert ? "w-[18px] h-[3px]" : "w-[3px] h-[18px]"
        }`}
      />
    </div>
  );
}

/** A free-floating detached toolbar with the full interaction set:
 *  collapse ⇄ expand, rotate (horizontal ⇄ vertical), grab-to-move,
 *  close/re-dock. Used by every tear-off toolbar (Actions, Formatting,
 *  …). Caller supplies the expanded icon row via `children`, the
 *  single-glyph affordance shown when collapsed via `collapsedGlyph`,
 *  and the handlers for drag and reattach.
 *
 *  Collapse and rotate both **pivot around the knob**: on each state
 *  change we snapshot the knob's viewport center, re-render, then
 *  measure where the knob landed and shift `pos` by the delta so the
 *  knob stays put. Drag bypasses these handlers so the ref stays
 *  null during free movement and the layout effect is a no-op. */
export function DetachedToolbar({
  children,
  collapsible = true,
  collapsedGlyph,
  collapseTitle = "Collapse toolbar",
  expandTitle = "Expand toolbar",
  onReattach,
  reattachTitle,
  onGrabStart,
  pos,
  onSetPos,
  podDataAttr,
}: {
  /** Pod contents when expanded. Pass a render-prop `(ctx) => ReactNode`
   *  to read the current orientation (e.g. to stack sub-pairs differently
   *  per axis). Plain ReactNode works for orientation-agnostic rows. */
  children: ReactNode | ((ctx: { orientation: ToolbarOrientation }) => ReactNode);
  /** When false, the toolbar has no collapse affordance — it always
   *  renders its expanded contents. `collapsedGlyph` is unused in that
   *  mode and may be omitted. Defaults to true. */
  collapsible?: boolean;
  /** Single-glyph affordance shown while collapsed. Required when
   *  `collapsible` is true; ignored otherwise. */
  collapsedGlyph?: { icon: ReactNode; title: string };
  collapseTitle?: string;
  expandTitle?: string;
  onReattach: () => void;
  reattachTitle: string;
  onGrabStart: (e: ReactMouseEvent<HTMLDivElement>) => void;
  pos: { left: number; top: number };
  onSetPos: (pos: { left: number; top: number }) => void;
  /** If provided, set as a valueless data-attribute on the pod content
   *  div — used by e.g. `ActionButton` to find the surrounding pod rect
   *  via `closest("[data-action-pod]")` for popup positioning. */
  podDataAttr?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [orientation, setOrientation] = useState<ToolbarOrientation>("horizontal");
  const isVert = orientation === "vertical";

  const posRef = useRef(pos);
  posRef.current = pos;

  const wrapRef = useRef<HTMLDivElement>(null);
  const targetKnobCenterRef = useRef<{ x: number; y: number } | null>(null);
  const readKnobCenter = (): { x: number; y: number } | null => {
    const knob = wrapRef.current?.querySelector<HTMLElement>("[data-toolbar-knob]");
    if (!knob) return null;
    const r = knob.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const captureKnobCenter = () => {
    targetKnobCenterRef.current = readKnobCenter();
  };

  useLayoutEffect(() => {
    const target = targetKnobCenterRef.current;
    if (!target) return;
    const current = readKnobCenter();
    if (!current) return;
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      onSetPos({ left: posRef.current.left + dx, top: posRef.current.top + dy });
    }
    targetKnobCenterRef.current = null;
  }, [collapsed, orientation, onSetPos]);

  const toggleOrientation = () => {
    captureKnobCenter();
    setOrientation(isVert ? "horizontal" : "vertical");
  };

  const podPadding = isVert
    ? `flex-col-reverse w-[var(--header-h)] ${collapsed ? "pt-1 pb-1" : "py-1"}`
    : `h-[var(--header-h)] ${collapsed ? "pl-1 pr-0" : "pl-0.5 pr-0"}`;

  const podDataAttrs = podDataAttr ? { [podDataAttr]: "" } : undefined;

  return (
    <div ref={wrapRef} className="inline-flex">
      <FloatingToolbarShell
        orientation={orientation}
        onToggleOrientation={toggleOrientation}
        tabEndSlot={<TabEndCloseButton onClick={onReattach} title={reattachTitle} orientation={orientation} />}
        podClassName={`gap-0.5 ${podPadding}`}
        podDataAttrs={podDataAttrs}
      >
        {collapsible && collapsed && collapsedGlyph ? (
          <>
            <button
              onClick={() => { captureKnobCenter(); setCollapsed(false); }}
              title={expandTitle}
              className="p-1 rounded transition-colors text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
            >
              {collapsedGlyph.icon}
            </button>
            <PodGrabHandle onMouseDown={onGrabStart} title="Drag to move toolbar" orientation={orientation} />
          </>
        ) : (
          <>
            {typeof children === "function" ? children({ orientation }) : children}
            {collapsible && (
              <button
                onClick={() => { captureKnobCenter(); setCollapsed(true); }}
                title={collapseTitle}
                className="p-1 rounded transition-colors text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
              >
                <CollapseChevronIcon orientation={orientation} />
              </button>
            )}
            <PodGrabHandle onMouseDown={onGrabStart} title="Drag to move toolbar" orientation={orientation} />
          </>
        )}
      </FloatingToolbarShell>
    </div>
  );
}

/** Chevron icon used by the collapse button on detached toolbars.
 *  Points inward (»») when expanded, rotates when the pod is vertical. */
export function CollapseChevronIcon({ orientation }: { orientation: ToolbarOrientation }) {
  const isVert = orientation === "vertical";
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={isVert ? { transform: "rotate(-90deg)" } : undefined}
    >
      <path d="M5.5 4L9.5 8L5.5 12" />
      <path d="M9.5 4L13.5 8L9.5 12" />
    </svg>
  );
}
