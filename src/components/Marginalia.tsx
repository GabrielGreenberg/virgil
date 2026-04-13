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
  isAnchorableNode,
  type MarginaliaMarker,
  type PositionedMarker,
} from "@/lib/marginalia";
import { generateNodeUuid } from "@/lib/uuid";
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
    // The paragraph UUID currently highlighted by the indicator.
    // onDrop uses this directly — whatever the bar shows is what gets the drop.
    let indicatedParagraphId: string | null = null;

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
      indicator.style.top = `${pos.domTop}px`;
      indicator.style.height = `${pos.height}px`;
      indicator.style[side] = `${MARGINALIA_GUTTER_WIDTH}px`;
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

      // For synthetic "_pos:NNN" IDs (nodes without UUIDs), assign a UUID
      // so all downstream stores get a stable string key.
      if (resolvedId.startsWith("_pos:")) {
        const rawPos = parseInt(resolvedId.slice(5), 10);
        if (isNaN(rawPos)) return;
        const doc = editor.state.doc;
        if (rawPos < 0 || rawPos >= doc.content.size) return;
        const $p = doc.resolve(rawPos);
        for (let d = $p.depth; d >= 0; d--) {
          const node = $p.node(d);
          if (isAnchorableNode(node.type)) {
            if (node.attrs?.uuid) {
              resolvedId = node.attrs.uuid;
            } else {
              // Collect existing UUIDs to guarantee uniqueness
              const existing = new Set<string>();
              doc.descendants((n) => {
                if (n.attrs?.uuid) existing.add(n.attrs.uuid as string);
              });
              const nodePos = d === 0 ? 0 : $p.before(d);
              const newUuid = generateNodeUuid(existing);
              const tr = editor.state.tr.setNodeMarkup(nodePos, undefined, {
                ...node.attrs,
                uuid: newUuid,
              });
              tr.setMeta("addToHistory", false);
              editor.view.dispatch(tr);
              resolvedId = newUuid;
            }
            break;
          }
        }
        // If still synthetic after the walk, bail
        if (resolvedId.startsWith("_pos:")) return;
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
