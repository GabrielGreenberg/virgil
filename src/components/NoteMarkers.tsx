"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { UserNote } from "@/lib/types";

interface MarkerPos {
  id: string;
  top: number;
}

export default function NoteMarkers({
  editor,
  notes,
  panelSide,
  selectedNoteId,
  onSelectNote,
}: {
  editor: Editor | null;
  notes: UserNote[];
  panelSide: "left" | "right" | null;
  selectedNoteId: string | null;
  onSelectNote: (id: string | null) => void;
}) {
  const [markers, setMarkers] = useState<MarkerPos[]>([]);
  const rafRef = useRef(0);

  const compute = useCallback(() => {
    if (!editor || !panelSide || notes.length === 0) {
      setMarkers([]);
      return;
    }

    const scrollEl = editor.view?.dom?.closest(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) {
      setMarkers([]);
      return;
    }
    const scrollRect = scrollEl.getBoundingClientRect();

    const result: MarkerPos[] = [];
    for (const note of notes) {
      const pos = Math.min(note.anchorPos, editor.state.doc.content.size);
      try {
        const coords = editor.view.coordsAtPos(pos);
        const top = coords.top - scrollRect.top + scrollEl.scrollTop;
        result.push({ id: note.id, top });
      } catch {
        // pos out of range — skip
      }
    }

    setMarkers(result);
  }, [editor, notes, panelSide]);

  useEffect(() => {
    compute();

    if (!editor || !editor.view?.dom) return;

    const onUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };

    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onUpdate);

    const scrollEl = editor.view.dom?.closest(".overflow-y-auto");
    scrollEl?.addEventListener("scroll", onUpdate, { passive: true });
    window.addEventListener("resize", onUpdate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onUpdate);
      scrollEl?.removeEventListener("scroll", onUpdate);
      window.removeEventListener("resize", onUpdate);
    };
  }, [editor, compute]);

  if (!panelSide || markers.length === 0) return null;

  const scrollEl = editor?.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
  if (!scrollEl) return null;

  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{
        [panelSide === "left" ? "left" : "right"]: 0,
        width: 28,
        zIndex: 10,
      }}
    >
      {markers.map((m) => (
        <button
          key={m.id}
          className={`note-marker pointer-events-auto absolute ${
            selectedNoteId === m.id ? "note-marker-selected" : ""
          }`}
          style={{
            top: m.top - 8,
            [panelSide === "left" ? "left" : "right"]: 2,
          }}
          onClick={() => onSelectNote(selectedNoteId === m.id ? null : m.id)}
          title="Note"
        >
          N
        </button>
      ))}
    </div>
  );
}
