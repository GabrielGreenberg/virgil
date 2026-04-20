"use client";

import { useState, useRef, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type { TodoItem, AiRequest } from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import ViewToggle from "@/components/ViewToggle";
import {
  useInTextPositions,
  getParagraphAnchorPositions,
} from "@/hooks/useInTextPositions";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { TodoRow } from "./TodoRow";

interface TodoPanelProps {
  items: TodoItem[];
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
  onArchiveDone: () => void;
  selectedTodoId: string | null;
  onSelectTodo: (id: string | null) => void;
  onScrollToMarker?: (id: string) => void;
  aiRequests?: AiRequest[];
  onAddAiRequest?: () => void;
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}

export default function TodoPanel({
  items,
  onAdd,
  onToggle,
  onUpdate,
  onUpdateNotes,
  onDelete,
  onArchiveDone,
  selectedTodoId,
  onSelectTodo,
  onScrollToMarker,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
}: TodoPanelProps) {
  const [newText, setNewText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const todoTheme = useCardTheme("todo");

  const handleAdd = () => {
    if (newText.trim()) {
      onAdd(newText.trim());
      setNewText("");
      inputRef.current?.focus();
    }
  };

  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "todo"),
    [aiRequests],
  );

  const inTextItems = useMemo(
    () => getParagraphAnchorPositions(editor ?? null, items),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, items],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor ?? null,
    inTextItems,
    viewMode === "in-text",
  );

  return (
    <CardListPanel
      kind="todo"
      count={pending.length}
      onAdd={() => inputRef.current?.focus()}
      onAiRequest={onAddAiRequest}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="todo" label="Todo color" />
            {onViewModeChange && (
              <ViewToggle mode={viewMode} onChange={onViewModeChange} />
            )}
          </div>
        </ItemMenu>
      }
      panelExtras={
        <div className="px-4 py-2.5 border-b border-[var(--border-light)]">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="Add a task..."
              className="flex-1 text-sm bg-transparent border-none outline-none text-ink-strong placeholder:text-ink-muted"
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
      }
      items={items}
      getId={(t) => t.id}
      selectedId={selectedTodoId}
      onSelect={onSelectTodo}
      emptyState={<div className={PANEL.empty}>No tasks yet.</div>}
      aiRequests={myAiRequests}
      onUpdateAiRequestText={onUpdateAiRequestText}
      onDeleteAiRequest={onDeleteAiRequest}
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : undefined}
      renderCard={(item, { selected }) => (
        <TodoRow
          item={item}
          selected={selected}
          onToggle={onToggle}
          onUpdate={onUpdate}
          onUpdateNotes={onUpdateNotes}
          onDelete={onDelete}
          onSelect={onSelectTodo}
          isAnchored={getLinkedParagraphIds(item).length > 0}
          onJump={
            onScrollToMarker && getLinkedParagraphIds(item).length > 0
              ? () => onScrollToMarker(item.id)
              : undefined
          }
        />
      )}
      inTextRenderItem={(item, { selected, top }) => {
        const borderColor =
          todoTheme.override?.selectedBorder ?? todoTheme.badgeBorder;
        const selectedBg = todoTheme.override?.headerBgSelected;
        return (
          <div
            data-todo-entry={item.id}
            className={`px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-stone-300" : "border-b-stone-300 hover:bg-surface-muted"} ${item.done ? "opacity-60" : ""}`}
            style={
              selected
                ? {
                    borderLeftColor: borderColor,
                    backgroundColor:
                      selectedBg ?? "rgba(120, 113, 108, 0.08)",
                  }
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              onSelectTodo(selected ? null : item.id);
            }}
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => onToggle(item.id)}
                onClick={(e) => e.stopPropagation()}
                className="mt-0.5 shrink-0"
              />
              <p
                className={`text-xs leading-snug line-clamp-2 pr-6 ${item.done ? "line-through text-ink-muted" : "text-ink-body"}`}
                style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
              >
                {item.text || (
                  <span className="italic text-ink-muted">Empty task</span>
                )}
              </p>
            </div>
          </div>
        );
      }}
      footer={
        done.length > 0 ? (
          <div className="px-4 py-2.5 border-t border-[var(--border)] flex items-center justify-between bg-surface-muted/50">
            <span className="text-xs text-ink-muted">
              {done.length} completed
            </span>
            <button
              onClick={onArchiveDone}
              className="text-xs px-2.5 py-1 rounded text-[var(--muted)] hover:text-ink-body hover:bg-surface-muted-strong transition-colors flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8v13H3V8" />
                <path d="M1 3h22v5H1z" />
                <path d="M10 12h4" />
              </svg>
              Archive
            </button>
          </div>
        ) : null
      }
    />
  );
}
