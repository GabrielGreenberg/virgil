"use client";

import { useEffect, useRef, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useMarginalia } from "@/hooks/useMarginalia";
import {
  MARKER_META,
  MARGINALIA_GUTTER_WIDTH_LEFT,
  MARGINALIA_GUTTER_WIDTH_RIGHT,
  MARGINALIA_ICON_SIZE,
  MIME_MARGINALIA_MOVE,
  MIME_QUOTATION,
  MIME_NOTE,
  MIME_TODO,
  MIME_ARCHIVE_ANCHOR,
  MIME_CUT,
  isAnchorDrag,
  type MarginaliaMarker,
  type PositionedMarker,
} from "@/lib/marginalia";
import { ensureAnchorUuid } from "@/lib/anchor-uuid";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import type { PanelId } from "@/hooks/useViewPrefs";
import {
  deriveMarkerPalette,
  getPanelColor,
  getPanelColorVersion,
  isPanelColorOverridden,
  subscribePanelColors,
  type PanelThemeKey,
} from "@/lib/panel-theme";
import {
  cardStore,
  useIsHovered,
  useIsSelected,
  type AnchoredCardRef,
} from "@/links/_shared/anchored-card-store";

/** Marker type → panel theme key for color overrides. */
const MARKER_TO_THEME_KEY: Partial<Record<keyof typeof MARKER_META, PanelThemeKey>> = {
  quote: "quote",
  note: "note",
  archive: "archive",
  revision: "revision",
  cut: "cut",
  todo: "todo",
};

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
  const metrics = useMarginalia(editor);
  const scrollEl = useMarginaliaHost(editor);

  // The host pod is already `position: relative` (set on the white pod
  // wrapper in EditorLayout), so no need to mutate position here.

  // Compute line-aligned grid positions for all markers
  const positioned = useMemo(
    () => computeMarkerPositions(metrics, markers, panelSides),
    [metrics, markers, panelSides],
  );

  // Keep a ref to metrics so the imperative drag handler can read it
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  // Imperative vertical drop indicator for paragraph-linking drags
  // (marginalia gutter icons, quotation panel, note panel).
  useEffect(() => {
    if (!scrollEl || !editor) return;
    let indicator: HTMLDivElement | null = null;
    let rafId = 0;
    // The paragraph UUID currently highlighted by the indicator.
    // onDrop uses this directly — whatever the bar shows is what gets the drop.
    let indicatedParagraphId: string | null = null;

    const showIndicator = (paragraphId: string, side: "left" | "right") => {
      const pos = metricsRef.current.get(paragraphId);
      if (!pos) { hideIndicator(); return; }
      if (!indicator) {
        indicator = document.createElement("div");
        // Same blue token the drop-mode controller uses for its
        // paragraph-side indicator — both gestures land here visually.
        indicator.className = "marginalia-drop-indicator dropmode-bar-side";
        Object.assign(indicator.style, {
          position: "absolute",
          width: "2px",
          background: "var(--accent-blue, #2563eb)",
          pointerEvents: "none",
          zIndex: "20",
          borderRadius: "1px",
        });
        scrollEl.appendChild(indicator);
      }
      // Span just the text lines (not the title or block spacing around them).
      indicator.style.top = `${pos.top}px`;
      indicator.style.height = `${pos.lineCount * pos.lineHeight}px`;
      indicator.style[side] = `${side === "left" ? MARGINALIA_GUTTER_WIDTH_LEFT : MARGINALIA_GUTTER_WIDTH_RIGHT}px`;
      indicator.style[side === "left" ? "right" : "left"] = "";
      indicatedParagraphId = paragraphId;
    };

    const hideIndicator = () => {
      if (indicator) {
        indicator.remove();
        indicator = null;
      }
      indicatedParagraphId = null;
      scrollEl.classList.remove("anchor-drag-active");
    };

    const onDragOver = (e: DragEvent) => {
      if (!isAnchorDrag(e.dataTransfer)) return;
      // Signal the browser this is a valid drop target so the drop event fires
      e.preventDefault();
      scrollEl.classList.add("anchor-drag-active");
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const scrollRect = scrollEl.getBoundingClientRect();
        const yInScroll = e.clientY - scrollRect.top + scrollEl.scrollTop;
        const side = e.clientX < scrollRect.left + scrollRect.width / 2 ? "left" : "right";

        let bestId: string | null = null;
        let bestDist = Infinity;
        for (const [id, pos] of metricsRef.current) {
          if (yInScroll >= pos.domTop && yInScroll <= pos.domTop + pos.height) {
            bestId = id;
            break;
          }
          // Use nearest-edge distance (not midpoint) so gaps between
          // elements resolve to the closer edge, not the closer center.
          const distTop = Math.abs(yInScroll - pos.domTop);
          const distBottom = Math.abs(yInScroll - (pos.domTop + pos.height));
          const dist = Math.min(distTop, distBottom);
          if (dist < bestDist) {
            bestDist = dist;
            bestId = id;
          }
        }

        if (bestId) {
          showIndicator(bestId, side);
        } else {
          hideIndicator();
        }
      });
    };

    const onDragLeave = (e: DragEvent) => {
      if (!scrollEl.contains(e.relatedTarget as Node)) {
        cancelAnimationFrame(rafId);
        hideIndicator();
      }
    };

    const onDragEnd = () => {
      cancelAnimationFrame(rafId);
      hideIndicator();
    };

    const onDrop = (e: DragEvent) => {
      // Capture the indicated paragraph BEFORE hideIndicator clears it.
      const targetId = indicatedParagraphId;
      cancelAnimationFrame(rafId);
      hideIndicator();

      // Only handle anchor drags (paragraph-level linking operations).
      // Non-anchor drags (inline insertion) still need ProseMirror coords,
      // so we let those fall through to the editor's own handleDrop.
      if (!isAnchorDrag(e.dataTransfer)) return;

      // Use whatever paragraph the indicator bar was showing — this is what
      // the user sees and expects the drop to target.
      let resolvedId = targetId;
      if (!resolvedId) return;

      // For synthetic "_pos:NNN" IDs (nodes without UUIDs), hydrate a UUID
      // via the shared `ensureAnchorUuid` helper so all downstream stores
      // get a stable string key.
      if (resolvedId.startsWith("_pos:")) {
        const rawPos = parseInt(resolvedId.slice(5), 10);
        if (isNaN(rawPos)) return;
        const doc = editor.state.doc;
        if (rawPos < 0 || rawPos >= doc.content.size) return;
        const newUuid = ensureAnchorUuid(editor.view, rawPos);
        if (!newUuid) return;
        resolvedId = newUuid;
      }

      const paragraphId = resolvedId;
      e.preventDefault();
      e.stopPropagation();

      // --- Marginalia move (gutter icon re-anchor) ---
      const margData = e.dataTransfer?.getData(MIME_MARGINALIA_MOVE);
      if (margData) {
        try {
          const { type, entityId, currentParagraphId } = JSON.parse(margData);
          if (paragraphId !== currentParagraphId) {
            window.dispatchEvent(
              new CustomEvent("virgil-marginalia-reanchor", {
                detail: { type, entityId, oldParagraphId: currentParagraphId, newParagraphId: paragraphId },
              })
            );
          }
        } catch { /* ignore */ }
        return;
      }

      // --- Quotation drop (from QuotationsPanel) ---
      const quotData = e.dataTransfer?.getData(MIME_QUOTATION);
      if (quotData) {
        try {
          const { groupId } = JSON.parse(quotData);
          if (groupId) {
            window.dispatchEvent(
              new CustomEvent("virgil-quotation-drop", {
                detail: { groupId, paragraphId },
              })
            );
          }
        } catch { /* ignore */ }
        return;
      }

      // --- Note drop (anchor to paragraph) ---
      const noteData = e.dataTransfer?.getData(MIME_NOTE);
      if (noteData) {
        try {
          const { noteId } = JSON.parse(noteData);
          if (noteId) {
            window.dispatchEvent(
              new CustomEvent("virgil-note-drop", {
                detail: { noteId, paragraphId },
              })
            );
          }
        } catch { /* ignore */ }
        return;
      }

      // --- Todo drop (from TodoPanel) ---
      const todoData = e.dataTransfer?.getData(MIME_TODO);
      if (todoData) {
        try {
          const { todoId } = JSON.parse(todoData);
          if (todoId) {
            window.dispatchEvent(
              new CustomEvent("virgil-todo-drop", {
                detail: { todoId, paragraphId },
              })
            );
          }
        } catch { /* ignore */ }
        return;
      }

      // --- Cutter card drop (comment or suggestion, from CutterPanel) ---
      const cutData = e.dataTransfer?.getData(MIME_CUT);
      if (cutData) {
        try {
          const parsed = JSON.parse(cutData);
          const cardId: string | undefined = parsed.cardId ?? parsed.cutId;
          if (cardId) {
            window.dispatchEvent(
              new CustomEvent("virgil-cut-drop", {
                detail: { cardId, paragraphId },
              })
            );
          }
        } catch { /* ignore */ }
        return;
      }

      // --- Archive anchor drop ---
      const archiveData = e.dataTransfer?.getData(MIME_ARCHIVE_ANCHOR);
      if (archiveData) {
        try {
          const { archiveId, oldParagraphId } = JSON.parse(archiveData);
          if (archiveId && paragraphId !== oldParagraphId) {
            window.dispatchEvent(
              new CustomEvent("virgil-marginalia-reanchor", {
                detail: { type: "archive", entityId: archiveId, oldParagraphId, newParagraphId: paragraphId },
              })
            );
          }
        } catch { /* ignore */ }
        return;
      }
    };

    scrollEl.addEventListener("dragover", onDragOver);
    scrollEl.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragend", onDragEnd);
    scrollEl.addEventListener("drop", onDrop);
    return () => {
      cancelAnimationFrame(rafId);
      hideIndicator();
      scrollEl.removeEventListener("dragover", onDragOver);
      scrollEl.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragend", onDragEnd);
      scrollEl.removeEventListener("drop", onDrop);
    };
  }, [scrollEl, editor]);

  if (!scrollEl) return null;
  if (positioned.length === 0) return null;

  const leftMarkers = positioned.filter((m) => m.side === "left");
  const rightMarkers = positioned.filter((m) => m.side === "right");

  // When the host editor is read-only (Library Reader), suppress
  // drag-to-rebind on every marker. Click + Delete still work.
  const dragEnabled = editor?.isEditable !== false;

  return createPortal(
    <>
      <Gutter side="left" markers={leftMarkers} dragEnabled={dragEnabled} />
      <Gutter side="right" markers={rightMarkers} dragEnabled={dragEnabled} />
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
 * Declared before `Gutter` so Turbopack Fast Refresh always sees the
 * binding when Gutter re-evaluates (function-declaration hoisting works
 * but bundler module boundaries can be strict in dev).
 */
function MarkerButton({ m, dragEnabled }: { m: PositionedMarker; dragEnabled: boolean }) {
  const ref: AnchoredCardRef | null = m.entityKind
    ? { kind: m.entityKind, id: m.entityId }
    : null;
  const selected = useIsSelected(ref);
  const hovered = useIsHovered(ref);

  const meta = MARKER_META[m.type];
  const themeKey = MARKER_TO_THEME_KEY[m.type];
  const palette =
    themeKey && isPanelColorOverridden(themeKey)
      ? deriveMarkerPalette(getPanelColor(themeKey))
      : { color: meta.color, bg: meta.bg, border: meta.border };

  // Selected = wider ring + soft outer halo; hover = thin ring; resting = none.
  const interactionShadow = selected
    ? `0 0 0 2px ${palette.border}, 0 0 0 4px color-mix(in oklab, ${palette.border} 40%, transparent)`
    : hovered
      ? `0 0 0 1.5px ${palette.border}`
      : undefined;

  return (
    <button
      type="button"
      draggable={dragEnabled}
      data-marginalia-marker={`${m.type}:${m.id}`}
      data-card-selected={selected ? "true" : undefined}
      data-card-hovered={hovered ? "true" : undefined}
      className="marginalia-marker pointer-events-auto absolute flex items-center justify-center rounded focus:outline-none"
      style={{
        left: m.cell.x,
        top: m.cell.y,
        width: MARGINALIA_ICON_SIZE,
        height: MARGINALIA_ICON_SIZE,
        color: palette.color,
        background: palette.bg,
        border: `1.5px solid ${palette.border}`,
        boxShadow: interactionShadow,
        transition: "box-shadow 120ms ease-out",
        opacity: m.muted ? 0.4 : undefined,
        cursor: dragEnabled ? "grab" : "pointer",
        padding: 0,
        lineHeight: 1,
      }}
      title={m.title || meta.label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        m.onClick?.(rect.top);
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
      onDragStart={dragEnabled ? (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(
          MIME_MARGINALIA_MOVE,
          JSON.stringify({
            type: m.type,
            entityId: m.entityId,
            currentParagraphId: m.paragraphId,
          })
        );
        (e.target as HTMLElement).style.opacity = "0.4";
      } : undefined}
      onDragEnd={dragEnabled ? (e) => {
        (e.target as HTMLElement).style.opacity = "";
      } : undefined}
    >
      {meta.icon}
    </button>
  );
}

function Gutter({
  side,
  markers,
  dragEnabled,
}: {
  side: "left" | "right";
  markers: PositionedMarker[];
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
        <MarkerButton key={`${m.type}:${m.id}`} m={m} dragEnabled={dragEnabled} />
      ))}
    </div>
  );
}
