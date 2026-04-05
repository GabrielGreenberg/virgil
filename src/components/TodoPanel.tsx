"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { TodoItem } from "@/lib/types";
import { panelCard, PANEL, PanelHeader, Chevron, ItemMenu, MenuDelete } from "./panel-primitives";

interface TodoPanelProps {
  items: TodoItem[];
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
  onArchiveDone: () => void;
}

function TodoRow({
  item,
  index,
  onToggle,
  onUpdate,
  onUpdateNotes,
  onDelete,
}: {
  item: TodoItem;
  index: number;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const [notes, setNotes] = useState(item.notes);
  const inputRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (expanded && item.notes === "" && notesRef.current) {
      notesRef.current.focus();
    }
  }, [expanded, item.notes]);

  const commitEdit = () => {
    if (editText.trim()) onUpdate(item.id, editText.trim());
    setEditing(false);
  };

  const commitNotes = useCallback(() => {
    if (notes !== item.notes) onUpdateNotes(item.id, notes);
  }, [notes, item.notes, item.id, onUpdateNotes]);

  return (
    <div className={panelCard(false, item.done ? "opacity-60" : "")}>
      <div className={PANEL.cardInner}>
        <div className="flex items-start gap-2">
          {/* Number */}
          <span className={`text-xs mt-0.5 w-4 text-right shrink-0 tabular-nums ${item.done ? "text-stone-300" : "text-stone-500"}`}>
            {index + 1}.
          </span>

          {/* Checkbox */}
          <button
            onClick={() => onToggle(item.id)}
            className="mt-0.5 shrink-0"
          >
            {item.done ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="14" height="14" rx="3" fill="#c8c3bc" stroke="#c8c3bc" strokeWidth="1.5" />
                <path d="M4.5 8l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" />
              </svg>
            )}
          </button>

          {/* Text + expand arrow */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1">
              {/* Chevron for notes */}
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-1 p-0 text-[var(--muted-light)] hover:text-[var(--muted)] transition-colors shrink-0"
                title={expanded ? "Collapse notes" : "Expand notes"}
              >
                <Chevron expanded={expanded} />
              </button>

              {editing ? (
                <input
                  ref={inputRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") { setEditText(item.text); setEditing(false); }
                  }}
                  className="text-sm bg-transparent border-b border-[var(--accent)] outline-none py-0 text-stone-800"
                  style={{ width: Math.max(editText.length + 1, 2) + "ch" }}
                />
              ) : (
                <span
                  className={`flex-1 text-sm leading-relaxed cursor-pointer ${
                    item.done ? "line-through text-stone-400 decoration-stone-300" : "text-stone-900 font-medium hover:underline decoration-[var(--accent)]"
                  }`}
                  onDoubleClick={() => { setEditText(item.text); setEditing(true); }}
                >
                  {item.text}
                </span>
              )}
            </div>

            {/* Notes (expanded) — sub-pod */}
            {expanded && (
              <div className={`mt-2 ${PANEL.subpod}`}>
                <textarea
                  ref={notesRef}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={commitNotes}
                  placeholder="Add notes..."
                  className="w-full bg-transparent text-xs text-stone-600 placeholder:text-stone-400 focus:outline-none resize-none leading-relaxed"
                  rows={3}
                />
              </div>
            )}

            {/* Notes indicator when collapsed */}
            {!expanded && item.notes && (
              <div className="ml-5 mt-0.5 text-[10px] text-[var(--muted-light)] truncate">
                {item.notes.slice(0, 60)}{item.notes.length > 60 ? "..." : ""}
              </div>
            )}
          </div>

          <ItemMenu>
            <MenuDelete onClick={() => onDelete(item.id)} />
          </ItemMenu>
        </div>
      </div>
    </div>
  );
}

export default function TodoPanel({
  items,
  onAdd,
  onToggle,
  onUpdate,
  onUpdateNotes,
  onDelete,
  onArchiveDone,
}: TodoPanelProps) {
  const [newText, setNewText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    if (newText.trim()) {
      onAdd(newText.trim());
      setNewText("");
      inputRef.current?.focus();
    }
  };

  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Todo List" count={pending.length} />

      {/* Add input */}
      <div className="px-4 py-2.5 border-b border-[var(--border-light)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            placeholder="Add a task..."
            className="flex-1 text-sm bg-transparent border-none outline-none text-stone-800 placeholder:text-stone-400"
          />
          <button
            onClick={handleAdd}
            disabled={!newText.trim()}
            className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-colors disabled:opacity-30"
          >
            Add
          </button>
        </div>
      </div>

      {/* Items */}
      <div className={PANEL.list}>
        {items.length === 0 && (
          <div className={PANEL.empty}>
            No tasks yet.
          </div>
        )}

        {items.map((item, i) => (
          <TodoRow
            key={item.id}
            item={item}
            index={i}
            onToggle={onToggle}
            onUpdate={onUpdate}
            onUpdateNotes={onUpdateNotes}
            onDelete={onDelete}
          />
        ))}
      </div>

      {/* Archive bar at bottom */}
      {done.length > 0 && (
        <div className="px-4 py-2.5 border-t border-[var(--border)] flex items-center justify-between bg-stone-50/50">
          <span className="text-xs text-stone-400">
            {done.length} completed
          </span>
          <button
            onClick={onArchiveDone}
            className="text-xs px-2.5 py-1 rounded text-[var(--muted)] hover:text-stone-700 hover:bg-stone-100 transition-colors flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13H3V8" />
              <path d="M1 3h22v5H1z" />
              <path d="M10 12h4" />
            </svg>
            Archive
          </button>
        </div>
      )}
    </div>
  );
}
