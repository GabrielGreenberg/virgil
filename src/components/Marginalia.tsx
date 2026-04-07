"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useMarginalia } from "@/hooks/useMarginalia";
import {
  MARKER_META,
  MARGINALIA_COLS,
  MARGINALIA_GUTTER_WIDTH,
  MARGINALIA_ICON_SIZE,
  MARGINALIA_ROW_GAP,
  type MarginaliaMarker,
} from "@/lib/marginalia";
import type { PanelId } from "@/hooks/useViewPrefs";

interface MarginaliaProps {
  editor: Editor | null;
  markers: MarginaliaMarker[];
  /** Which side each panel is currently docked on (or null if collapsed) */
  panelSides: Partial<Record<PanelId, "left" | "right" | null>>;
}

interface PositionedMarker extends MarginaliaMarker {
  side: "left" | "right";
  paragraphTop: number;
  /** Index within the paragraph's gutter on this side, 0-based */
  index: number;
}

/**
 * Marginalia gutter — renders icon markers in two columns of width
 * MARGINALIA_GUTTER_WIDTH (one on each side of the editor column). Markers
 * are anchored to a paragraph by UUID and packed into rows of MARGINALIA_COLS
 * starting at the paragraph's first line.
 */
/**
 * Subscribe to the editor's scroll container element via useSyncExternalStore.
 * The subscription installs a tiptap "create"/"update" listener and re-resolves
 * the closest `.overflow-y-auto` ancestor each time, notifying React only when
 * the result actually changes.
 */
function useScrollContainer(editor: Editor | null): HTMLElement | null {
  const subscribe = (notify: () => void) => {
    if (!editor) return () => {};
    const recheck = () => notify();
    editor.on("create", recheck);
    editor.on("update", recheck);
    // First mount may resolve via the next animation frame if the view dom
    // isn't ready yet — ask once.
    const id = requestAnimationFrame(recheck);
    return () => {
      cancelAnimationFrame(id);
      editor.off("create", recheck);
      editor.off("update", recheck);
    };
  };
  const getSnapshot = (): HTMLElement | null => {
    if (!editor) return null;
    try {
      return (
        (editor.view?.dom?.closest(".overflow-y-auto") as HTMLElement | null) ??
        null
      );
    } catch {
      return null;
    }
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export default function Marginalia({ editor, markers, panelSides }: MarginaliaProps) {
  const positions = useMarginalia(editor);
  const scrollEl = useScrollContainer(editor);

  // Make sure the scroll container is a positioned ancestor so absolutely
  // positioned children land in the right coordinate system. This element is
  // not React-managed (it's TipTap's), so we mutate it from an effect.
  useEffect(() => {
    if (!scrollEl) return;
    const style = scrollEl.style;
    const prev = style.position;
    if (prev === "" || prev === "static") {
      style.setProperty("position", "relative");
    }
  }, [scrollEl]);

  // Resolve marker side and pack into per-paragraph + per-side stacks
  const positioned = useMemo<PositionedMarker[]>(() => {
    if (positions.size === 0) return [];
    const result: PositionedMarker[] = [];
    // Group by `${paragraphId}|${side}` to assign indices
    const counters = new Map<string, number>();
    for (const m of markers) {
      const top = positions.get(m.paragraphId);
      if (top == null) continue; // paragraph not yet known
      const meta = MARKER_META[m.type];
      // Determine side: explicit override, else current panel side, else default
      const dockedSide = panelSides[meta.panelId];
      const side: "left" | "right" =
        m.side ?? dockedSide ?? meta.defaultSide;
      const key = `${m.paragraphId}|${side}`;
      const idx = counters.get(key) ?? 0;
      counters.set(key, idx + 1);
      result.push({ ...m, side, paragraphTop: top, index: idx });
    }
    return result;
  }, [markers, positions, panelSides]);

  if (!scrollEl) return null;
  if (positioned.length === 0) return null;

  const leftMarkers = positioned.filter((m) => m.side === "left");
  const rightMarkers = positioned.filter((m) => m.side === "right");

  return createPortal(
    <>
      <Gutter side="left" markers={leftMarkers} />
      <Gutter side="right" markers={rightMarkers} />
    </>,
    scrollEl
  );
}

function Gutter({
  side,
  markers,
}: {
  side: "left" | "right";
  markers: PositionedMarker[];
}) {
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{
        [side]: 0,
        width: MARGINALIA_GUTTER_WIDTH,
        zIndex: 10,
      }}
      data-marginalia-gutter={side}
    >
      {markers.map((m) => {
        const col = m.index % MARGINALIA_COLS;
        const row = Math.floor(m.index / MARGINALIA_COLS);
        const xOffset =
          side === "left"
            ? MARGINALIA_GUTTER_WIDTH -
              (col + 1) * (MARGINALIA_ICON_SIZE + MARGINALIA_ROW_GAP)
            : col * (MARGINALIA_ICON_SIZE + MARGINALIA_ROW_GAP);
        const yOffset =
          m.paragraphTop +
          row * (MARGINALIA_ICON_SIZE + MARGINALIA_ROW_GAP) -
          // Slight nudge so the icon is vertically centered on the first line
          2;
        const meta = MARKER_META[m.type];
        return (
          <button
            key={`${m.type}:${m.id}`}
            type="button"
            data-marginalia-marker={`${m.type}:${m.id}`}
            className="marginalia-marker pointer-events-auto absolute flex items-center justify-center rounded transition-colors"
            style={{
              left: xOffset,
              top: yOffset,
              width: MARGINALIA_ICON_SIZE,
              height: MARGINALIA_ICON_SIZE,
              color: meta.color,
              background: m.selected ? meta.selectedBg : meta.bg,
              border: `1.5px solid ${meta.border}`,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
            title={m.title || meta.label}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              m.onClick?.();
            }}
          >
            {meta.icon}
          </button>
        );
      })}
    </div>
  );
}
