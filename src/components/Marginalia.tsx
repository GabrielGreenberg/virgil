"use client";

import { useEffect, useRef, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  useMarginaliaRegistry,
  useRegistryVersion,
} from "@/hooks/useMarginaliaRegistry";
import {
  MARKER_META,
  MARGINALIA_GUTTER_WIDTH_LEFT,
  MARGINALIA_GUTTER_WIDTH_RIGHT,
  MARGINALIA_ICON_SIZE,
  type GridCell,
  type MarginaliaMarker,
  type MarkerOverflowGroup,
  type PositionedMarker,
} from "@/lib/marginalia";
import { buildFloatKey } from "@/floats/float-key";
import { beginCardDropGesture } from "@/components/drop-mode/card-drop-gesture";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import type { PanelId } from "@/hooks/useViewPrefs";
import {
  deriveMarkerPalette,
  getPanelColor,
  getPanelColorVersion,
  isPanelColorOverridden,
  subscribePanelColors,
} from "@/lib/panel-theme";
import { panelThemeKeyForMarkerType } from "@/cards/marker-meta";
import {
  cardStore,
  useIsHovered,
  useIsSelected,
  type AnchoredCardRef,
} from "@/links/_shared/anchored-card-store";

interface MarginaliaProps {
  editor: Editor | null;
  markers: MarginaliaMarker[];
  /** Which side each panel is currently docked on (or null if collapsed) */
  panelSides: Partial<Record<PanelId, "left" | "right" | null>>;
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
  const getSnapshot = (): HTMLElement | null => {
    if (!editor) return null;
    try {
      return (
        (editor.view?.dom?.closest("[data-marginalia-host]") as HTMLElement | null) ??
        null
      );
    } catch {
      return null;
    }
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/**
 * Marginalia gutter — renders icon markers in a line-aligned grid on each
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
  // Orphan markers (card resolved to `source:'orphan'`, CHIP-B) have no live
  // paragraph to line-align against — they come back in `orphans` and render
  // in the fixed re-pin dock instead of being silently culled.
  const { positioned, overflowGroups, orphans } = useMemo(
    () => computeMarkerPositions(registry.getMetrics, markers, panelSides),
    // registryVersion is the re-render trigger; getMetrics itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, markers, panelSides, registryVersion],
  );

  // The gutter-pin re-anchor gesture is no longer native HTML5 DnD: grabbing
  // a marker pin now starts a unified drop-mode session (see `MarkerButton`'s
  // mousedown → `beginCardDropGesture`). The controller owns the hit-test and
  // the blue paragraph-side Indicator for that gesture, so the old imperative
  // dragover/drop/indicator machinery that used to live here is gone.

  if (!scrollEl) return null;
  if (
    positioned.length === 0 &&
    overflowGroups.length === 0 &&
    orphans.length === 0
  )
    return null;

  const leftMarkers = positioned.filter((m) => m.side === "left");
  const rightMarkers = positioned.filter((m) => m.side === "right");
  const leftOverflow = overflowGroups.filter((g) => g.side === "left");
  const rightOverflow = overflowGroups.filter((g) => g.side === "right");
  const leftOrphans = orphans.filter((m) => m.side === "left");
  const rightOrphans = orphans.filter((m) => m.side === "right");

  // When the host editor is read-only (Library Reader), suppress
  // drag-to-rebind on every marker. Click + Delete still work.
  const dragEnabled = editor?.isEditable !== false;

  return createPortal(
    <>
      <Gutter side="left" markers={leftMarkers} overflow={leftOverflow} orphans={leftOrphans} dragEnabled={dragEnabled} />
      <Gutter side="right" markers={rightMarkers} overflow={rightOverflow} orphans={rightOrphans} dragEnabled={dragEnabled} />
    </>,
    scrollEl
  );
}

/**
 * Single gutter marker. Self-subscribes to the global cardStore via
 * `useIsSelected`/`useIsHovered` keyed by the marker's anchored
 * (kind, entityId) — no prop threading from a parent decoration loop.
 * Mouse enter/leave write directly to the store; click delegates to the
 * marker's own onClick (which routes through openForCard for placement).
 *
 * Two layouts: with a `cell` the button positions absolutely in the gutter
 * grid; without one it renders in normal flow (inside the overflow pill's
 * popover — R16), with identical click/delete/drag behavior.
 *
 * Declared before `Gutter` so Turbopack Fast Refresh always sees the
 * binding when Gutter re-evaluates (function-declaration hoisting works
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
  // Set true once a re-anchor grab crosses a small movement threshold, so the
  // browser's trailing click (mousedown→drag→mouseup synthesizes one) is
  // swallowed instead of opening the panel. A plain click (no drag) leaves it
  // false → onClick opens the panel as before. Mirrors PanelCard's
  // `suppressClickRef`.
  const suppressClickRef = useRef(false);

  const meta = MARKER_META[m.type];
  // Registry-derived color slot (R17). Report markers honor a user report
  // color override like every other kind (the old hand-kept map omitted
  // them — a drift bug); "error" derives to the system "error" key, which
  // `isPanelColorOverridden` always reports false for (SYSTEM_THEME_KEYS),
  // so error markers stay fixed.
  const themeKey = panelThemeKeyForMarkerType(m.type);
  const palette =
    isPanelColorOverridden(themeKey)
      ? deriveMarkerPalette(getPanelColor(themeKey))
      : { color: meta.color, bg: meta.bg, border: meta.border };

  // Selected = wider ring + soft outer halo; hover = thin ring; resting = none.
  const interactionShadow = selected
    ? `0 0 0 2px ${palette.border}, 0 0 0 4px color-mix(in oklab, ${palette.border} 40%, transparent)`
    : hovered
      ? `0 0 0 1.5px ${palette.border}`
      : undefined;

  // Re-anchor by grab is folded onto the unified drop-mode controller (chip H).
  // A pin can re-anchor when the editor is editable AND the marker is a real
  // anchored card (`m.entityKind` — `= CardKind` — is present; the only marker
  // without it is the non-card "error" badge, which is not re-anchorable). The
  // gesture mirrors the card DROP BUTTON exactly: a primary-button mousedown
  // starts `beginCardDropGesture`, which begins an `inPlace + externalCommit`
  // drop session and arms a one-shot mouseup commit. The controller owns the
  // hit-test + the blue paragraph-side Indicator; a drop in a paragraph's gutter
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
      data-hint={m.title || meta.label}
      onMouseDown={reanchorKey ? (e) => {
        // Primary button only — a right/middle press passes through to native
        // behavior (matches inline-atom-grab + the header lift + CardDropButton).
        if (e.button !== 0) return;
        // Don't let the press bubble into the card-root lift / native drag.
        e.stopPropagation();
        e.preventDefault();
        // Start the session FIRST and gate everything else on its return. If a
        // session is already live, begin returns false — installing the
        // suppress-click watcher / arming suppressClickRef anyway would let a
        // >3px move+release swallow the trailing panel-open click (a dead
        // press). On a false return, do nothing: no listeners, no suppression.
        const started = beginCardDropGesture({
          cardKey: reanchorKey,
          origin: { x: e.clientX, y: e.clientY },
        });
        if (!started) return;
        // Re-arm the click path; a movement watcher flips it only on a real drag.
        suppressClickRef.current = false;
        const startX = e.clientX;
        const startY = e.clientY;
        const onMove = (ev: MouseEvent) => {
          if (
            Math.abs(ev.clientX - startX) > 3 ||
            Math.abs(ev.clientY - startY) > 3
          ) {
            suppressClickRef.current = true;
          }
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      } : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // A re-anchor drag just completed — swallow the synthetic trailing
        // click so it doesn't also open the panel.
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        m.onClick?.(rect.top);
        onActivated?.();
      }}
      onMouseEnter={ref ? () => cardStore.setHover(ref) : undefined}
      onMouseLeave={ref ? () => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ref.kind && h.id === ref.id) cardStore.setHover(null);
      } : undefined}
      onKeyDown={(e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && m.onDelete) {
          e.preventDefault();
          e.stopPropagation();
          m.onDelete();
          (e.target as HTMLElement).blur();
        }
      }}
      aria-label={m.title || meta.label}
    >
      {meta.icon}
    </button>
  );
}

/**
 * Overflow "+K" pill (R16). Renders in the grid's reserved last cell when a
 * node's markers don't all fit; clicking it opens a small popover beside the
 * gutter listing the hidden markers as ordinary `MarkerButton`s (click /
 * delete / drag behave exactly like in-grid markers). Render-layer only —
 * the open state is local, closed by click-away / Escape / marker click.
 */
function OverflowPill({
  group,
  dragEnabled,
}: {
  group: MarkerOverflowGroup;
  dragEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click-away + Escape close. Mounted only while open.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof Node && rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const count = group.hidden.length;
  const label = `${count} hidden marker${count === 1 ? "" : "s"}`;

  return (
    <div ref={rootRef} className="pointer-events-none" data-marginalia-overflow={`${group.side}:${group.textObjectId}`}>
      <button
        type="button"
        className="marginalia-marker pointer-events-auto absolute flex items-center justify-center rounded focus:outline-none bg-surface text-ink-muted hover:text-ink-body"
        style={{
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
        data-hint={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        +{count}
      </button>
      {open && (
        <div
          className="pointer-events-auto absolute z-30 flex flex-col rounded-md border border-edge-subtle bg-surface shadow-lg"
          style={{
            top: group.cell.y + MARGINALIA_ICON_SIZE + 4,
            [group.side]: 2,
            padding: 5,
            gap: 4,
          }}
          role="menu"
          aria-label={label}
        >
          {group.hidden.map((m) => (
            <MarkerButton
              key={`${m.type}:${m.id}`}
              m={m}
              dragEnabled={dragEnabled}
              onActivated={() => setOpen(false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Orphan dock (CHIP-B). A card whose anchor resolved to `source:'orphan'`
 * (its stored uuid + mark + text-snapshot are all dead in the live doc) has
 * no live paragraph to line-align against. Rather than silently culling it
 * (the RC2 "card vanishes ~10s later" bug), its marker docks here — a fixed,
 * faintly-tinted strip pinned to the top of the gutter that reads
 * "unanchored — click to re-pin". Each entry is a normal `MarkerButton`, so:
 *   - click opens the card's panel (the user can read/triage it), and
 *   - the grab gesture (when editable) starts a drop-mode re-anchor session
 *     exactly like a live gutter pin — that's the "re-pin".
 * Rendered in normal flow (no `cell`), so no paragraph metrics are needed.
 */
function OrphanDock({
  side,
  orphans,
  dragEnabled,
}: {
  side: "left" | "right";
  orphans: Array<MarginaliaMarker & { side: "left" | "right" }>;
  dragEnabled: boolean;
}) {
  if (orphans.length === 0) return null;
  const count = orphans.length;
  const label = `${count} unanchored — click to re-pin`;
  return (
    <div
      className="pointer-events-auto absolute flex flex-col items-center gap-1 rounded-md border border-edge-subtle bg-surface/90 shadow-sm"
      style={{
        top: 6,
        [side]: 2,
        padding: 4,
        zIndex: 12,
      }}
      data-marginalia-orphan-dock={side}
      data-hint={label}
      aria-label={label}
      role="group"
    >
      {orphans.map((m) => (
        <MarkerButton key={`orphan:${m.type}:${m.id}`} m={m} dragEnabled={dragEnabled} />
      ))}
    </div>
  );
}

function Gutter({
  side,
  markers,
  overflow,
  orphans,
  dragEnabled,
}: {
  side: "left" | "right";
  markers: PositionedMarker[];
  overflow: MarkerOverflowGroup[];
  orphans: Array<MarginaliaMarker & { side: "left" | "right" }>;
  dragEnabled: boolean;
}) {
  // Subscribe to panel color changes so the gutter re-renders when the user
  // picks a new color for a panel.
  useSyncExternalStore(subscribePanelColors, getPanelColorVersion, () => 0);
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{
        [side]: 0,
        width: side === "left" ? MARGINALIA_GUTTER_WIDTH_LEFT : MARGINALIA_GUTTER_WIDTH_RIGHT,
        zIndex: 10,
      }}
      data-marginalia-gutter={side}
    >
      {markers.map((m) => (
        <MarkerButton key={`${m.type}:${m.id}`} m={m} cell={m.cell} dragEnabled={dragEnabled} />
      ))}
      {overflow.map((g) => (
        <OverflowPill key={`overflow:${g.side}:${g.textObjectId}`} group={g} dragEnabled={dragEnabled} />
      ))}
      <OrphanDock side={side} orphans={orphans} dragEnabled={dragEnabled} />
    </div>
  );
}
