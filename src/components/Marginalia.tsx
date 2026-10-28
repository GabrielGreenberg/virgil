"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  useMarginaliaRegistry,
  useRegistryVersion,
} from "@/hooks/useMarginaliaRegistry";
import {
  MARKER_META,
  MARGINALIA_MARGIN_WIDTH_LEFT,
  MARGINALIA_MARGIN_WIDTH_RIGHT,
  MARGINALIA_ICON_SIZE,
  resolveMarkerCols,
  resolveMarginaliaHost,
  type AnchorNodeMetrics,
  type GridCell,
  type MarginaliaMarker,
  type MarkerOverflowGroup,
  type PositionedMarker,
} from "@/lib/marginalia";
import { getOrCreateGeometry } from "@/lib/editor-geometry";
import { getBus } from "@/lib/tiptap/doc-structure";
import type { EditorViewportFrame } from "@/lib/editor-geometry/viewport-frame";
import { buildFloatKey } from "@/floats/float-key";
import { beginCardDropGesture } from "@/components/drop-mode/card-drop-gesture";
import { useTrailingClickGuard } from "@/hooks/useTrailingClickGuard";
import { isPrimaryDragStart } from "@/lib/pane-resize/pointer-invariants";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import type { PanelSideMap } from "@/lib/margin-side";
import {
  DEFAULT_PANEL_COLORS,
  deriveMarkerPalette,
  getPanelColor,
  getPanelColorVersion,
  isPanelColorOverridden,
  selectionHaloRing,
  subscribePanelColors,
} from "@/lib/panel-theme";
import {
  panelThemeKeyForMarkerType,
  NON_REGISTRY_MARKER_TYPES,
} from "@/cards/marker-meta";
import {
  useHoverClaim,
  useIsHovered,
  useIsSelected,
  type AnchoredCardRef,
} from "@/links/_shared/anchored-card-store";
import { iconHint } from "@/components/Hint";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { useMenuItem } from "@/components/menu/useMenuItem";
import { menuRowRovingStyle } from "@/components/menu/row-tone";

interface MarginaliaProps {
  editor: Editor | null;
  markers: MarginaliaMarker[];
  /** Which side each panel is currently docked on (or null if collapsed). The
   *  shape has ONE name — `PanelSideMap` from the margin-side SSOT — so the
   *  grid, the rail and this component cannot describe it three ways. */
  panelSides: PanelSideMap;
}

/**
 * Subscribe to the editor's marginalia host (the white pod marked
 * `data-marginalia-host`). Under unified row scroll the editor has no
 * inner scroll, so marginalia is positioned relative to the host pod —
 * which is `position: relative` and naturally tall.
 */
function useMarginaliaHost(editor: Editor | null): HTMLElement | null {
  const subscribe = (notify: () => void) => {
    if (!editor) return () => {};
    // RAF-batch notify so a typing burst produces one notify per
    // frame, not one per keystroke. The host element's identity
    // doesn't change per character — at most it appears/disappears
    // on mount/unmount, which RAF cadence handles fine.
    let pending = 0;
    const recheck = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        notify();
      });
    };
    editor.on("create", recheck);
    editor.on("update", recheck);
    const id = requestAnimationFrame(recheck);
    return () => {
      cancelAnimationFrame(id);
      if (pending) cancelAnimationFrame(pending);
      editor.off("create", recheck);
      editor.off("update", recheck);
    };
  };
  // Only the resolution is shared (`resolveMarginaliaHost`, the same helper the
  // registry measures against); the subscription + RAF-coalesced notify plumbing
  // stays here.
  const getSnapshot = (): HTMLElement | null => resolveMarginaliaHost(editor);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

// ── Lane regime (tasks 214 / 325) ───────────────────────────────────────────
//
// The marker columns are POD-anchored at fixed lane offsets while the prose
// text edge moves with the margin, so below a certain margin the badges land
// back OVER the text — reachable with no user action beyond opening the Code
// pane, which caps the margin at the 48px comfort gutter and stops reserving
// the lane. And the tucked selection bolt lands on the lane's OUTBOARD columns,
// so how many columns survive is not a show/hide flag but the ordered lane
// RESOLUTION (`resolveMarkerCols` → `resolveRightLane`), the same one the bolt
// reads for its own x. One decision, two readers.
//
// It is fed the MEASURED pod-edge → text-edge distance, not the `--editor-pl`
// / `--editor-pr` pref: the pod is `.editor-pane-pod`, which is BOTH the
// marker container's positioning context (it carries `data-marginalia-host`)
// and what the geometry service measures as `podLeft`/`podRight`, so the
// subtraction is exactly the room the lane has — including in a code split,
// where the pod sits inside the clip and the pref would overstate it. (One
// honest limit: past the pod's min-content width the layout rect extends
// beyond the clip, so deep-clip markers that are already scrolled out of the
// visible strip fail open. They were clipped before this change too.)
//
// Keystroke sanctity: no new observer, no editor subscription — this rides the
// geometry service's existing per-editor viewport channel (one RO, equality-
// bailed, gesture-parked; already retained by `useMarginaliaRegistry` above,
// and retained again here so the hook stands on its own). The snapshot is a
// PRIMITIVE bit code, so `useSyncExternalStore` bails the re-render on every
// refresh that leaves the regime unchanged — which is every refresh a
// keystroke can cause, since a height change moves the frame's vertical
// fields and the regime reads only horizontal ones.

// The snapshot stays a PRIMITIVE (see the keystroke-sanctity note above), so the
// per-side column counts are packed into one small integer: 4 bits each, which
// is ample for a lane that will never hold 16 columns. Unmeasured resolves to
// the full lane on both sides — the fail-open the SSOT owns, mirrored here only
// because this code path never reaches the SSOT with a frame at all.
const LANE_COLS_UNMEASURED =
  (resolveMarkerCols("left", null) << 4) | resolveMarkerCols("right", null);

function laneColsCode(frame: EditorViewportFrame | null): number {
  // Unmeasured — the pre-first-refresh EMPTY frame, a keep-alive pane that
  // mounted while `display:none` (zero offsetHeight, so the service never
  // commits), a detached view. FAIL OPEN: every field of that frame is 0, so
  // reading the arithmetic instead of this sentinel would cull every marker on
  // the first commit of every pane and on every warm tab switch — a far worse
  // failure than the overlap this guards.
  if (!frame || !frame.editorEl) return LANE_COLS_UNMEASURED;
  return (
    (resolveMarkerCols("left", frame.contentLeft - frame.podLeft) << 4) |
    resolveMarkerCols("right", frame.podRight - frame.editorRight)
  );
}

/** How many marker columns each side's margin can host right now (0 = none). */
function useLaneCols(editor: Editor | null): { left: number; right: number } {
  // Retain the engine for this consumer's lifetime (refcounted — the registry
  // adapter above holds one too; this hook does not depend on that).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    return getOrCreateGeometry(editor).retain();
  }, [editor]);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!editor || editor.isDestroyed) return () => {};
      return getOrCreateGeometry(editor).subscribeViewport(cb);
    },
    [editor],
  );

  const getSnapshot = useCallback(() => {
    if (!editor || editor.isDestroyed) return LANE_COLS_UNMEASURED;
    return laneColsCode(getOrCreateGeometry(editor).getViewportFrame());
  }, [editor]);

  const code = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => LANE_COLS_UNMEASURED,
  );
  return { left: (code >> 4) & 0xf, right: code & 0xf };
}

/**
 * Which line of its node a span-anchored marker's words start on (task 1334)
 * — the `lineOf` reader `computeMarkerPositions` takes. The span's LIVE `from`
 * comes off the DocStructure snapshot (remapped per transaction, so a marker
 * built before the last keystroke still reads where its words are now), and
 * the line is the line-box distance from the node's first line, in units of
 * the node's measured line pitch. Two `coordsAtPosCached` reads per span
 * marker on a MEASURED, multi-line node (the grid asks nothing else), and only
 * when this memo re-runs — a registry measure, a marker rebuild or a lane
 * change, never a keystroke or a scroll frame. `null` ⇒ row 0.
 */
function spanLineOf(
  editor: Editor | null,
  m: MarginaliaMarker,
  node: AnchorNodeMetrics,
): number | null {
  if (!m.anchorId || node.isAtom || node.lineCount <= 1) return null;
  if (!editor || editor.isDestroyed) return null;
  const s = getBus(editor)?.structure;
  const a = s?.anchors.get(m.anchorId);
  const b = s?.blocks.get(m.textObjectId);
  if (!a || !b || a.from <= b.pos) return null;
  const geo = getOrCreateGeometry(editor);
  const first = geo.coordsAtPosCached(b.pos + 1);
  const at = geo.coordsAtPosCached(a.from);
  if (!first || !at || !(node.lineHeight > 0)) return null;
  return Math.round((at.top - first.top) / node.lineHeight);
}

/**
 * Marginalia margin — renders icon markers in a line-aligned grid on each
 * side of the editor column. Each UUID-bearing text element generates an
 * implicit 2-column grid where rows correspond to actual text lines.
 * Markers fill left-to-right, top-to-bottom.
 */
export default function Marginalia({ editor, markers, panelSides }: MarginaliaProps) {
  const registry = useMarginaliaRegistry(editor);
  // Subscribe to the registry's version so we re-render whenever any
  // observed block's metrics change (or blocks enter/leave the near-zone).
  const registryVersion = useRegistryVersion(registry);
  const scrollEl = useMarginaliaHost(editor);

  // The host pod is already `position: relative` (set on the white pod
  // wrapper in EditorLayout), so no need to mutate position here.

  // Compute line-aligned grid positions for all markers. The registry
  // returns null for off-screen blocks — those markers are skipped,
  // which is correct since their anchor isn't visible either. Overflowing
  // grids come back as overflow groups (R16) rendered as "+K" pills.
  // An unanchored marker (card resolved to `source:'orphan'`, CHIP-B) has no
  // live paragraph to line-align against, so since task 410 it is not a lane
  // occupant at all: `computeMarkerPositions` skips it and the pane's chrome
  // header surfaces it (`UnanchoredCardsChip`). It is NOT silently culled —
  // the RC2 vanish is still closed, just by a surface outside this column.
  // Lane regime (tasks 214/325) — see `useLaneCols` below.
  const { left: colsLeft, right: colsRight } = useLaneCols(editor);

  const { positioned, overflowGroups } = useMemo(
    () =>
      computeMarkerPositions(
        registry.getMetrics,
        markers,
        panelSides,
        { left: colsLeft, right: colsRight },
        (m, node) => spanLineOf(editor, m, node),
      ),
    // registryVersion is the re-render trigger; getMetrics itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, markers, panelSides, registryVersion, colsLeft, colsRight, editor],
  );

  // The margin-pin re-anchor gesture is no longer native HTML5 DnD: grabbing
  // a marker pin now starts a unified drop-mode session (see `MarkerButton`'s
  // mousedown → `beginCardDropGesture`). The controller owns the hit-test and
  // the blue paragraph-side Indicator for that gesture, so the old imperative
  // dragover/drop/indicator machinery that used to live here is gone.

  if (!scrollEl) return null;
  if (positioned.length === 0 && overflowGroups.length === 0) return null;

  const leftMarkers = positioned.filter((m) => m.side === "left");
  const rightMarkers = positioned.filter((m) => m.side === "right");
  const leftOverflow = overflowGroups.filter((g) => g.side === "left");
  const rightOverflow = overflowGroups.filter((g) => g.side === "right");

  // When the host editor is read-only (Library Reader), suppress
  // drag-to-rebind on every marker. Click + Delete still work.
  const dragEnabled = editor?.isEditable !== false;

  return createPortal(
    <>
      <MarginColumn side="left" markers={leftMarkers} overflow={leftOverflow} dragEnabled={dragEnabled} />
      <MarginColumn side="right" markers={rightMarkers} overflow={rightOverflow} dragEnabled={dragEnabled} />
    </>,
    scrollEl
  );
}

/**
 * Single margin marker. Self-subscribes to the global cardStore via
 * `useIsSelected`/`useIsHovered` keyed by the marker's anchored
 * (kind, entityId) — no prop threading from a parent decoration loop.
 * Mouse enter/leave write directly to the store; click delegates to the
 * marker's own onClick (which routes through openForCard for placement).
 *
 * Two layouts: with a `cell` the button positions absolutely in the margin
 * grid; without one it renders in normal flow (inside the overflow pill's
 * popover — R16), with identical click/delete/drag behavior.
 *
 * Declared before `MarginColumn` so Turbopack Fast Refresh always sees the
 * binding when MarginColumn re-evaluates (function-declaration hoisting works
 * but bundler module boundaries can be strict in dev).
 *
 * Exported for the pin-gesture test (mirrors `CardDropButton`): the test
 * fires a mousedown and asserts it starts a drop session with the cardKey
 * derived from `m.entityKind + m.entityId`.
 */
export function MarkerButton({
  m,
  cell,
  dragEnabled,
  onActivated,
}: {
  m: MarginaliaMarker;
  /** Grid cell for absolute placement; omit for in-flow (popover) layout. */
  cell?: GridCell;
  dragEnabled: boolean;
  /** Called after the marker's own onClick ran (popover closes itself). */
  onActivated?: () => void;
}) {
  const ref: AnchoredCardRef | null = m.entityKind
    ? { kind: m.entityKind, id: m.entityId }
    : null;
  const selected = useIsSelected(ref);
  const hovered = useIsHovered(ref);
  // The hover claim releases itself if this button unmounts under the pointer
  // (the crowd popover closing on activation; a fold into a pill) — task 1150.
  const hoverClaim = useHoverClaim(ref);
  // Armed once a re-anchor grab crosses a small movement threshold, so the
  // browser's trailing click (mousedown→drag→mouseup synthesizes one) is
  // swallowed instead of opening the panel. A plain click (no drag) leaves it
  // disarmed → onClick opens the panel as before. The guard disarms itself on
  // the gesture's end edge, so a drag released OFF the marker (no trailing
  // click here) cannot eat the next keyboard / menu-row activation (task 1152).
  // Shared with PanelCard's header lift.
  const trailingClick = useTrailingClickGuard();

  const meta = MARKER_META[m.type];
  // Registry-derived color slot (R17). Report markers honor a user report
  // color override like every other kind (the old hand-kept map omitted
  // them — a drift bug); "error" derives to the system "error" key, which
  // `isPanelColorOverridden` always reports false for (SYSTEM_THEME_KEYS),
  // so error markers stay fixed.
  //
  // `NON_REGISTRY_MARKER_TYPES` is the (currently empty) set of markers whose
  // palette is a fixed, non-overridable accent baked into `MARKER_META` rather
  // than a user-overridable panel color slot. The check is retained so a future
  // fixed-accent marker skips the override path without re-plumbing this.
  const themeKey = panelThemeKeyForMarkerType(m.type);
  const overridden =
    !NON_REGISTRY_MARKER_TYPES.has(m.type) && isPanelColorOverridden(themeKey);
  const palette = overridden
    ? deriveMarkerPalette(getPanelColor(themeKey))
    : { color: meta.color, bg: meta.bg, border: meta.border };
  // The accent the palette above derives from — the selection halo below
  // derives from the SAME accent, so the ring matches the badge border.
  const accent = overridden ? getPanelColor(themeKey) : DEFAULT_PANEL_COLORS[themeKey];

  // Hover OR selected paint the same quiet 1.5px ring — no heavy selected halo.
  // The marker's colored badge (bg + 1.5px border) carries persistent kind
  // identity; selection stays visible because the ring persists while selected.
  // Mirrors the panel-card change (selected collapsed to hover weight).
  // The ring is the ONE selection halo (`selectionHaloRing`, task 1179) — the
  // selected panel card wears the identical ring, from the same accent.
  const interactionShadow =
    selected || hovered ? selectionHaloRing(accent) : undefined;

  // Re-anchor by grab is folded onto the unified drop-mode controller (chip H).
  // A pin can re-anchor when the editor is editable AND the marker is a real
  // anchored card (`m.entityKind` — `= CardKind` — is present; the only marker
  // without it is the non-card "error" badge, which is not re-anchorable). The
  // gesture mirrors the card DROP BUTTON exactly: a primary-button mousedown
  // pends `beginCardDropGesture`, which — once the press travels past the drag
  // threshold (task 1192) — begins an `inPlace + externalCommit` drop session
  // and arms a one-shot mouseup commit. The controller owns the
  // hit-test + the blue paragraph-side Indicator; a drop in a paragraph's margin
  // band runs that kind's registered `dropSpec` (the same `links.ts`
  // add/removeTextObjectLink the panel mutates), so the re-anchor is identical
  // to the old native path — just routed through the one controller.
  const reanchorKey =
    dragEnabled && m.entityKind
      ? buildFloatKey({ domain: "card", kind: m.entityKind, id: m.entityId })
      : null;

  return (
    <button
      type="button"
      // The card-root HTML5 anchor drag / header lift must not co-fire with the
      // pin grab — swallow native drag the way `CardDropButton` does.
      draggable={false}
      data-marginalia-marker={`${m.type}:${m.id}`}
      data-card-selected={selected ? "true" : undefined}
      data-card-hovered={hovered ? "true" : undefined}
      className={`marginalia-marker pointer-events-auto flex items-center justify-center rounded focus:outline-none${cell ? " absolute" : ""}`}
      style={{
        ...(cell ? { left: cell.x, top: cell.y } : {}),
        width: MARGINALIA_ICON_SIZE,
        height: MARGINALIA_ICON_SIZE,
        color: palette.color,
        background: palette.bg,
        border: `1.5px solid ${palette.border}`,
        boxShadow: interactionShadow,
        transition: "box-shadow 120ms ease-out",
        opacity: m.muted ? 0.4 : undefined,
        cursor: reanchorKey ? "grab" : "pointer",
        padding: 0,
        lineHeight: 1,
      }}
      {...iconHint({ label: m.title || meta.label })}
      onMouseDown={reanchorKey ? (e) => {
        // Primary button only — a right/middle press passes through to native
        // behavior. The predicate is the engine's SSOT
        // (lib/pane-resize/pointer-invariants), never re-derived.
        if (!isPrimaryDragStart(e)) return;
        // Don't let the press bubble into the card-root lift / native drag.
        e.stopPropagation();
        e.preventDefault();
        // Re-open the click path for this press, then only PEND the session
        // (task 1192): a drop session makes the marker click-through for its
        // whole life (the task-351 rule), so one begun on the press turned a
        // plain click's mouseup into a hit on the editor beneath and the
        // marker's select never ran. The session — and the trailing-click
        // guard, on the SAME edge — starts only once the press travels past
        // the drag threshold; a release first leaves this a plain click.
        trailingClick.reset();
        beginCardDropGesture({
          cardKey: reanchorKey,
          origin: { x: e.clientX, y: e.clientY },
          onPromote: () => trailingClick.arm(),
        });
      } : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // A re-anchor drag just completed — swallow the synthetic trailing
        // click so it doesn't also open the panel.
        if (trailingClick.consume()) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        m.onClick?.(rect.top);
        onActivated?.();
      }}
      onMouseEnter={ref ? hoverClaim.onMouseEnter : undefined}
      onMouseLeave={ref ? hoverClaim.onMouseLeave : undefined}
      onKeyDown={(e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && m.onDelete) {
          e.preventDefault();
          e.stopPropagation();
          m.onDelete();
          (e.target as HTMLElement).blur();
        }
      }}
    >
      {meta.icon}
    </button>
  );
}

/**
 * Overflow "+K" pill (R16). Renders in the grid's reserved last cell when a
 * node's markers don't all fit; clicking it opens a small menu beside the
 * margin listing the hidden markers (click / delete / drag behave exactly like
 * in-grid markers).
 *
 * The TRIGGER's placement is pod-relative (coordinates from the marginalia
 * layout pass — the scroll-anchor law's branch (a)); the MENU is the shared
 * `AnchoredMenu` (task 997), a RAF-coalesced fixed portal that tracks the
 * trigger (branch (b)). Before that this was a hand-built `role="menu"` whose
 * children were bare `MarkerButton`s — a screen reader heard a menu with ZERO
 * items, the trigger hand-spelled `aria-haspopup="true"`, and nothing roved.
 * `UnanchoredCardsChip` had fixed that exact defect for its own marker list
 * (task 477); the two now share ONE row, `MarkerMenuRow`.
 */
function OverflowPill({
  group,
  dragEnabled,
}: {
  group: MarkerOverflowGroup;
  dragEnabled: boolean;
}) {
  const count = group.hidden.length;
  const label = `${count} hidden marker${count === 1 ? "" : "s"}`;

  return (
    // `data-marginalia-overflow` is the hook the drop-mode click-through rule
    // and the card-selection click-away both read (content-drag guardrail).
    <div className="pointer-events-none" data-marginalia-overflow={`${group.side}:${group.textObjectId}`}>
      <AnchoredMenu
        ariaLabel={label}
        align={group.side === "left" ? "start" : "end"}
        wrapperClassName="contents"
        triggerClassName="marginalia-marker pointer-events-auto absolute flex items-center justify-center rounded bg-surface text-ink-muted hover:text-ink-body"
        triggerStyle={{
          left: group.cell.x,
          top: group.cell.y,
          width: MARGINALIA_ICON_SIZE,
          height: MARGINALIA_ICON_SIZE,
          border: "1.5px solid var(--edge-strong)",
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1,
          padding: 0,
        }}
        triggerHint={label}
        menuClassName="min-w-[180px] px-1.5"
        trigger={() => <>+{count}</>}
      >
        {({ close }) => (
          <div className="flex flex-col gap-1">
            {group.hidden.map((m) => (
              <MarkerMenuRow
                key={`${m.type}:${m.id}`}
                m={m}
                dragEnabled={dragEnabled}
                onActivated={close}
              />
            ))}
          </div>
        )}
      </AnchoredMenu>
    </div>
  );
}

/**
 * ONE marker listed in a menu, registered into the enclosing `MenuProvider`
 * (task 477; shared by `UnanchoredCardsChip` and the "+K" `OverflowPill` since
 * task 997).
 *
 * The registration wraps rather than replaces the marker button, the shape
 * `BlockTypeGridCell` already uses for a compound cell: `MarkerButton` is
 * SHARED with the marginalia lane, where there is no provider at all and
 * `useMenuItem` would throw — and its own gesture surface (a click that opens
 * the card's panel, a press-drag that starts the drop-mode re-anchor) is what
 * must keep working. So the ROW carries the ARIA and the roving cursor, and its
 * `run` clicks the button the user would have clicked. A bare `MarkerButton`
 * list would leave the registry EMPTY — worse than no controller at all, since
 * the window-capture keydown still consumes Enter/Space/every arrow.
 */
export function MarkerMenuRow({
  m,
  dragEnabled,
  onActivated,
}: {
  m: MarginaliaMarker;
  dragEnabled: boolean;
  onActivated: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { active, getItemProps } = useMenuItem({
    id: `${m.type}:${m.id}`,
    region: "list",
    // Keyboard activation: click the marker's own button, so the one gesture
    // path stays the button's (panel open + `onActivated` close) rather than a
    // second copy of it here.
    run: useCallback(() => {
      wrapRef.current?.querySelector("button")?.click();
    }, []),
  });
  const itemProps = getItemProps();
  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        itemProps.ref(el);
      }}
      role={itemProps.role}
      id={itemProps.id}
      tabIndex={itemProps.tabIndex}
      data-active={itemProps["data-active"]}
      onMouseEnter={itemProps.onMouseEnter}
      onMouseMove={itemProps.onMouseMove}
      className="flex items-center gap-2 rounded px-1"
      style={menuRowRovingStyle(active, false)}
    >
      <MarkerButton m={m} dragEnabled={dragEnabled} onActivated={onActivated} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
        {m.title || MARKER_META[m.type].label}
      </span>
    </div>
  );
}

/**
 * The margin column — the ONE lane, with ONE kind of occupant.
 *
 * Task 410: the "unanchored — click to re-pin" dock used to render here as a
 * `position:absolute; top:6; zIndex:12` box, a second owner in this same
 * column that `computeMarkerPositions` could not see. It overlapped the first
 * blocks' marker cells (and, on the right, covered col1 entirely) and, being
 * `pointer-events-auto` above them, STOLE their clicks; pinned to the top of a
 * naturally tall, non-scrolling pod, it was also unreachable on any scrolled
 * document — the affordance vanished exactly when it was needed. It now lives
 * in the pane's sticky chrome header (`UnanchoredCardsChip`), so this column
 * holds marker cells and "+K" pills and nothing else. **Do not add a
 * non-marker owner here**: the packer's cross-owner walk (task 366) is a
 * complete statement about this lane only while it is the lane's sole author.
 */
export function MarginColumn({
  side,
  markers,
  overflow,
  dragEnabled,
}: {
  side: "left" | "right";
  markers: PositionedMarker[];
  overflow: MarkerOverflowGroup[];
  dragEnabled: boolean;
}) {
  // Subscribe to panel color changes so the margin re-renders when the user
  // picks a new color for a panel.
  useSyncExternalStore(subscribePanelColors, getPanelColorVersion, () => 0);
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{
        [side]: 0,
        width: side === "left" ? MARGINALIA_MARGIN_WIDTH_LEFT : MARGINALIA_MARGIN_WIDTH_RIGHT,
        zIndex: 10,
      }}
      data-marginalia-margin={side}
    >
      {markers.map((m) => (
        // Every marker — including an applied pending AI change — renders as a
        // plain marker. The applied-change Keep/Revert affordance lives on the
        // card and the in-context left-margin pill, NOT as gutter hover chips
        // (margin-declutter pass).
        <MarkerButton key={`${m.type}:${m.id}`} m={m} cell={m.cell} dragEnabled={dragEnabled} />
      ))}
      {overflow.map((g) => (
        <OverflowPill key={`overflow:${g.side}:${g.textObjectId}:${g.cell.row}`} group={g} dragEnabled={dragEnabled} />
      ))}
    </div>
  );
}
