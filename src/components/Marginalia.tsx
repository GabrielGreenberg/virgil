"use client";

import { useEffect, useRef, useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useMarginalia } from "@/hooks/useMarginalia";
import {
  MARKER_META,
  MARGINALIA_GUTTER_WIDTH,
  MARGINALIA_ICON_SIZE,
  MIME_MARGINALIA_MOVE,
  MIME_QUOTATION,
  MIME_NOTE,
  MIME_TODO,
  MIME_ARCHIVE_ANCHOR,
  isAnchorDrag,
  type MarginaliaMarker,
  type PositionedMarker,
} from "@/lib/marginalia";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import type { PanelId } from "@/hooks/useViewPrefs";

interface MarginaliaProps {
  editor: Editor | null;
  markers: MarginaliaMarker[];
  /** Which side each panel is currently docked on (or null if collapsed) */
  panelSides: Partial<Record<PanelId, "left" | "right" | null>>;
}

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

/**
 * Marginalia gutter — renders icon markers in a line-aligned grid on each
 * side of the editor column. Each UUID-bearing text element generates an
 * implicit 2-column grid where rows correspond to actual text lines.
 * Markers fill left-to-right, top-to-bottom.
 */
export default function Marginalia({ editor, markers, panelSides }: MarginaliaProps) {
  const metrics = useMarginalia(editor);
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

    const showIndicator = (paragraphId: string, side: "left" | "right") => {
      const pos = metricsRef.current.get(paragraphId);
      if (!pos) { hideIndicator(); return; }
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "marginalia-drop-indicator";
        Object.assign(indicator.style, {
          position: "absolute",
          width: "2px",
          background: "var(--accent, #b45757)",
          pointerEvents: "none",
          zIndex: "20",
          borderRadius: "1px",
          transition: "top 0.08s ease, height 0.08s ease",
        });
        scrollEl.appendChild(indicator);
      }
      indicator.style.top = `${pos.top}px`;
      indicator.style.height = `${pos.height}px`;
      indicator.style[side] = `${MARGINALIA_GUTTER_WIDTH}px`;
      indicator.style[side === "left" ? "right" : "left"] = "";
    };

    const hideIndicator = () => {
      if (indicator) {
        indicator.remove();
        indicator = null;
      }
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
          if (yInScroll >= pos.top && yInScroll <= pos.top + pos.height) {
            bestId = id;
            break;
          }
          const mid = pos.top + pos.height / 2;
          const dist = Math.abs(yInScroll - mid);
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

    /** Resolve the nearest paragraph UUID from a mouse/drag event. */
    const resolveParagraphAt = (e: DragEvent): string | null => {
      const scrollRect = scrollEl.getBoundingClientRect();
      const yInScroll = e.clientY - scrollRect.top + scrollEl.scrollTop;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const [id, pos] of metricsRef.current) {
        if (yInScroll >= pos.top && yInScroll <= pos.top + pos.height) {
          return id;
        }
        const mid = pos.top + pos.height / 2;
        const dist = Math.abs(yInScroll - mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }
      return bestId;
    };

    const onDrop = (e: DragEvent) => {
      cancelAnimationFrame(rafId);
      hideIndicator();

      // Only handle anchor drags (paragraph-level linking operations).
      // Non-anchor drags (inline insertion) still need ProseMirror coords,
      // so we let those fall through to the editor's own handleDrop.
      if (!isAnchorDrag(e.dataTransfer)) return;

      const paragraphId = resolveParagraphAt(e);
      if (!paragraphId) return;

      // --- Marginalia move (gutter icon re-anchor) ---
      const margData = e.dataTransfer?.getData(MIME_MARGINALIA_MOVE);
      if (margData) {
        e.preventDefault();
        e.stopPropagation();
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
        e.preventDefault();
        e.stopPropagation();
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

      // --- Note drop (anchor-only when dropped in margin) ---
      const noteData = e.dataTransfer?.getData(MIME_NOTE);
      if (noteData) {
        e.preventDefault();
        e.stopPropagation();
        try {
          const { noteId } = JSON.parse(noteData);
          if (noteId) {
            // Resolve the paragraph's start position in the doc for the
            // note anchor. Walk the doc to find the node with this UUID.
            let anchorPos = 0;
            editor.state.doc.descendants((node, pos) => {
              if (node.attrs?.uuid === paragraphId) {
                anchorPos = pos;
                return false;
              }
              return true;
            });
            window.dispatchEvent(
              new CustomEvent("virgil-note-drop", {
                detail: { noteId, anchorPos, inserted: false },
              })
            );
          }
        } catch { /* ignore */ }
        return;
      }

      // --- Todo drop (from TodoPanel) ---
      const todoData = e.dataTransfer?.getData(MIME_TODO);
      if (todoData) {
        e.preventDefault();
        e.stopPropagation();
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

      // --- Archive anchor drop ---
      const archiveData = e.dataTransfer?.getData(MIME_ARCHIVE_ANCHOR);
      if (archiveData) {
        e.preventDefault();
        e.stopPropagation();
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
        const meta = MARKER_META[m.type];
        return (
          <button
            key={`${m.type}:${m.id}`}
            type="button"
            draggable
            data-marginalia-marker={`${m.type}:${m.id}`}
            className="marginalia-marker pointer-events-auto absolute flex items-center justify-center rounded transition-colors focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]"
            style={{
              left: m.cell.x,
              top: m.cell.y,
              width: MARGINALIA_ICON_SIZE,
              height: MARGINALIA_ICON_SIZE,
              color: meta.color,
              background: m.selected ? meta.selectedBg : meta.bg,
              border: `1.5px solid ${meta.border}`,
              opacity: m.muted ? 0.4 : undefined,
              cursor: "grab",
              padding: 0,
              lineHeight: 1,
            }}
            title={m.title || meta.label}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              m.onClick?.();
            }}
            onKeyDown={(e) => {
              if ((e.key === "Delete" || e.key === "Backspace") && m.onDelete) {
                e.preventDefault();
                e.stopPropagation();
                m.onDelete();
                (e.target as HTMLElement).blur();
              }
            }}
            onDragStart={(e) => {
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
            }}
            onDragEnd={(e) => {
              (e.target as HTMLElement).style.opacity = "";
            }}
          >
            {meta.icon}
          </button>
        );
      })}
    </div>
  );
}
