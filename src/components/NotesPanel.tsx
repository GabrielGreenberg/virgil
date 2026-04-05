"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { UserNote } from "@/lib/types";
import { panelCard, PANEL, PanelHeader, ItemMenu, MenuDelete } from "./panel-primitives";

interface NotesPanelProps {
  notes: UserNote[];
  onAdd: (anchorPos: number, content?: string) => UserNote;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onSelectNote: (id: string | null) => void;
  selectedNoteId: string | null;
  cursorPos: number;
}

function FormatToolbar({ editorRef }: { editorRef: React.RefObject<HTMLDivElement | null> }) {
  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5 border-b border-[var(--border-light)]">
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-stone-600 hover:bg-stone-100 transition-colors"
        title="Bold"
      >
        B
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs italic text-stone-600 hover:bg-stone-100 transition-colors"
        title="Italic"
      >
        I
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs underline text-stone-600 hover:bg-stone-100 transition-colors"
        title="Underline"
      >
        U
      </button>
      <div className="w-px h-4 bg-[var(--border-light)] mx-0.5" />
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-stone-600 hover:bg-stone-100 transition-colors"
        title="Bullet list"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="2" cy="4" r="1.5" />
          <rect x="5" y="3" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="8" r="1.5" />
          <rect x="5" y="7" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="12" r="1.5" />
          <rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-stone-600 hover:bg-stone-100 transition-colors"
        title="Numbered list"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <text x="0" y="5.5" fontSize="5" fontWeight="600">1</text>
          <rect x="5" y="3" width="10" height="2" rx="0.5" />
          <text x="0" y="9.5" fontSize="5" fontWeight="600">2</text>
          <rect x="5" y="7" width="10" height="2" rx="0.5" />
          <text x="0" y="13.5" fontSize="5" fontWeight="600">3</text>
          <rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
    </div>
  );
}

function NoteEditor({
  note,
  selected,
  onUpdate,
  onDelete,
  onSelect,
}: {
  note: UserNote;
  selected: boolean;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== note.content) {
      editorRef.current.innerHTML = note.content || "";
    }
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const html = editorRef.current?.innerHTML || "";
      onUpdate(note.id, html);
    }, 400);
  }, [note.id, onUpdate]);

  return (
    <div
      className={panelCard(selected)}
      onClick={() => onSelect(selected ? null : note.id)}
    >
      <div className={PANEL.cardInner}>
        <div className="flex items-center justify-between mb-1">
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-emerald-400 bg-emerald-50 text-emerald-700 text-[10px] font-bold leading-none">
              N
            </span>
            <span className="text-[10px] text-[var(--muted)]">
              {new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </span>
          <ItemMenu>
            <MenuDelete onClick={() => onDelete(note.id)} />
          </ItemMenu>
        </div>

        {selected && <FormatToolbar editorRef={editorRef} />}

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onClick={(e) => e.stopPropagation()}
          className="note-editor py-1 text-sm text-stone-700 leading-relaxed focus:outline-none min-h-[2.5rem]"
          data-placeholder="Write a note..."
        />
      </div>
    </div>
  );
}

export default function NotesPanel({
  notes,
  onAdd,
  onUpdate,
  onDelete,
  onSelectNote,
  selectedNoteId,
  cursorPos,
}: NotesPanelProps) {
  const sortedNotes = [...notes].sort((a, b) => a.anchorPos - b.anchorPos);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Notes" count={notes.length} onAdd={() => onAdd(cursorPos)} />

      <div className={PANEL.list}>
        {sortedNotes.length === 0 && (
          <div className={PANEL.empty}>
            No notes yet. Click &quot;Add Note&quot; to create one at the current cursor position.
          </div>
        )}

        {sortedNotes.map((note) => (
          <NoteEditor
            key={note.id}
            note={note}
            selected={selectedNoteId === note.id}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onSelect={onSelectNote}
          />
        ))}
      </div>
    </div>
  );
}
