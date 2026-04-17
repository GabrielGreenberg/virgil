"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";

/**
 * Floating "selection chip" — appears near the end of a non-empty text
 * selection, draggable into any side panel that accepts
 * MIME_SELECTION_ANCHOR. Dropping it creates an anchored linked item in
 * that tool (Notes / Revisions / Cutter).
 *
 * We avoid hijacking ProseMirror's native text drag (already claimed by
 * MIME_TEXT_INSERT and several inline-insert paths). A dedicated chip is
 * easier to reason about and more discoverable.
 */
export default function SelectionChip({ editor }: { editor: Editor | null }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [payload, setPayload] = useState<{ from: number; to: number; selectedText: string } | null>(null);

  useEffect(() => {
    if (!editor) {
      setPos(null);
      setPayload(null);
      return;
    }

    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || from === to) {
        setPos(null);
        setPayload(null);
        return;
      }
      try {
        const text = editor.state.doc.textBetween(from, to, " ").trim();
        if (!text) { setPos(null); setPayload(null); return; }
        const coords = editor.view.coordsAtPos(to);
        setPos({ top: coords.top - 2, left: coords.right + 4 });
        setPayload({ from, to, selectedText: text });
      } catch {
        setPos(null);
        setPayload(null);
      }
    };

    editor.on("selectionUpdate", update);
    editor.on("update", update);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
    };
  }, [editor]);

  if (!pos || !payload) return null;

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(MIME_SELECTION_ANCHOR, JSON.stringify(payload));
    // Also set a text/plain fallback so dragging outside app shows something.
    e.dataTransfer.setData("text/plain", payload.selectedText);
  };

  return createPortal(
    <div
      draggable
      onDragStart={onDragStart}
      onMouseDown={(e) => {
        // Prevent the click from clearing the selection before drag starts.
        e.preventDefault();
      }}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 15,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 500,
        color: "#57534e",
        background: "#fff",
        border: "1px solid #d6d3d1",
        borderRadius: 4,
        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
        cursor: "grab",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      title="Drag into Notes / Revisions / Cutter"
    >
      ↪ selection
    </div>,
    document.body,
  );
}
