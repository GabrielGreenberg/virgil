"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type { TodoItem, AiRequest } from "@/lib/types";
import { MIME_TODO } from "@/lib/marginalia";
import { CARD_THEMES, ItemMenu, PANEL, PanelHeader, BadgeLabel, BadgeOrphaned, CardTargetIcon, AiRequestCard, AiRequestsSectionHeader, CardPopoutButton } from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import PanelThemePicker from "./PanelThemePicker";
import ViewToggle from "./ViewToggle";
import { useInTextPositions, getParagraphAnchorPositions } from "@/hooks/useInTextPositions";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "./FloatingCards";

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

const theme = CARD_THEMES.todo;

export function TodoRow({
  item,
  selected,
  onToggle,
  onUpdate,
  onUpdateNotes,
  onDelete,
  onSelect,
  onJump,
  isAnchored,
  extraDataAttrs,
  onTogglePopout,
  isPoppedOut,
}: {
  item: TodoItem;
  selected: boolean;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  isAnchored: boolean;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const [notes, setNotes] = useState(item.notes);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const popped = usePoppedCards();
  const popKey = `todo:${item.id}`;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitEdit = () => {
    if (editText.trim()) onUpdate(item.id, editText.trim());
    setEditing(false);
  };

  const commitNotes = useCallback(() => {
    if (notes !== item.notes) onUpdateNotes(item.id, notes);
  }, [notes, item.notes, item.id, onUpdateNotes]);

  /** Anchor-only drag — do NOT set text/plain here; ProseMirror's default
   *  drop handler would insert it as inline text when handleDrop returns
   *  false for anchor drags. */
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "link";
      e.dataTransfer.setData(MIME_TODO, JSON.stringify({ todoId: item.id }));
      if (cardRef.current) {
        e.dataTransfer.setDragImage(cardRef.current, 20, -10);
      }
    },
    [item.id],
  );

  const isPoppedNow = popped?.isPopped(popKey) ?? false;
  const onToggleFromCtx = onTogglePopout ?? (popped ? () => popped.toggle(popKey) : undefined);

  const card = (
    <div
      ref={cardRef}
      {...(extraDataAttrs || {})}
      className={`group ${theme.cardClass(selected, item.done ? "opacity-60" : "")} focus:outline-none`}
      tabIndex={selected ? 0 : -1}
      onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : item.id); }}
      onKeyDown={(e) => {
        if (!selected || editing) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(item.id);
        }
      }}
    >
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-1.5 ${selected ? theme.headerSelected : theme.headerDefault}`}>
        {/* Grab handle — sole drag source */}
        <div
          draggable
          onDragStart={handleDragStart}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded text-ink-faint group-hover:text-ink-subtle transition-colors shrink-0"
          title="Drag to anchor in text"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="3" cy="2" r="1.2" />
            <circle cx="7" cy="2" r="1.2" />
            <circle cx="3" cy="7" r="1.2" />
            <circle cx="7" cy="7" r="1.2" />
            <circle cx="3" cy="12" r="1.2" />
            <circle cx="7" cy="12" r="1.2" />
          </svg>
        </div>

        {onToggleFromCtx && (
          <CardPopoutButton isPoppedOut={isPoppedNow} onClick={onToggleFromCtx} />
        )}

        {/* Badge */}
        {isAnchored
          ? <BadgeLabel label="T" theme={theme} />
          : <BadgeOrphaned theme={theme} />
        }

        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(item.id); }}
          className="shrink-0"
        >
          {item.done ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="3" fill="#c8c3bc" stroke="#c8c3bc" strokeWidth="1.5" />
              <path d="M4.5 8l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" />
            </svg>
          )}
        </button>

        {/* Text */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={commitEdit}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") { setEditText(item.text); setEditing(false); }
              }}
              className="w-full text-sm bg-transparent border-b border-[var(--accent)] outline-none py-0 text-ink-strong"
            />
          ) : (
            <span
              className={`block text-sm leading-relaxed truncate ${
                item.done ? "line-through text-ink-muted decoration-stone-300" : "text-stone-900 font-medium"
              }`}
              onDoubleClick={(e) => { e.stopPropagation(); setEditText(item.text); setEditing(true); }}
            >
              {item.text}
            </span>
          )}
        </div>

        {/* Inline delete [x] */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-ink-muted hover:text-danger shrink-0"
          title="Delete"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Jump target */}
        <CardTargetIcon
          selected={selected}
          disabled={!isAnchored}
          onClick={(e) => { e.stopPropagation(); onJump?.(); }}
          title={isAnchored ? "Jump to in text" : "Not anchored in document"}
        />
      </div>

      {/* Separator */}
      <div className={`border-t transition-colors ${selected ? theme.separatorSelected : "border-edge-subtle group-hover:border-edge-hover"}`} />

      {/* Body — notes always visible */}
      <div className="px-3 pt-1.5 pb-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Notes..."
          className="w-full bg-transparent text-xs text-ink-body placeholder:text-ink-muted focus:outline-none resize-none leading-relaxed"
          rows={2}
        />
      </div>
    </div>
  );
  if (isPoppedNow) return <FloatCard cardKey={popKey}>{card}</FloatCard>;
  return card;
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
    editor ?? null, inTextItems, viewMode === "in-text",
  );

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader
        title="Todo List"
        count={pending.length}
        onAdd={() => inputRef.current?.focus()}
        onAiRequest={onAddAiRequest}
      >
        <ItemMenu>
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="todo" label="Todo color" />
            {onViewModeChange && (
              <ViewToggle mode={viewMode} onChange={onViewModeChange} />
            )}
          </div>
        </ItemMenu>
      </PanelHeader>

      {/* Add input */}
      <div className="px-4 py-2.5 border-b border-[var(--border-light)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
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

      {/* Items */}
      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
        onClick={() => onSelectTodo(null)}
      >
        {items.length === 0 && myAiRequests.length === 0 && (
          <div className={PANEL.empty}>
            No tasks yet.
          </div>
        )}

        {viewMode === "in-text" && items.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {items.map((item) => {
              const top = positions.get(item.id);
              if (top === undefined) return null;
              const isSelected = selectedTodoId === item.id;
              const borderColor = todoTheme.override?.selectedBorder ?? todoTheme.badgeBorder;
              const selectedBg = todoTheme.override?.headerBgSelected;
              return (
                <div
                  key={item.id}
                  data-todo-entry={item.id}
                  className={`absolute left-0 right-0 px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${isSelected ? "border-l-2 border-b-stone-300" : "border-b-stone-300 hover:bg-surface-muted"} ${item.done ? "opacity-60" : ""}`}
                  style={{
                    top,
                    ...(isSelected
                      ? { borderLeftColor: borderColor, backgroundColor: selectedBg ?? "rgba(120, 113, 108, 0.08)" }
                      : {}),
                  }}
                  onClick={(e) => { e.stopPropagation(); onSelectTodo(isSelected ? null : item.id); }}
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
                      {item.text || <span className="italic text-ink-muted">Empty task</span>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {myAiRequests.length > 0 && (
              <>
                <AiRequestsSectionHeader count={myAiRequests.length} />
                {myAiRequests.map((req) => (
                  <AiRequestCard
                    key={req.id}
                    request={req}
                    onChangeText={(text) => onUpdateAiRequestText?.(req.id, text)}
                    onDelete={() => onDeleteAiRequest?.(req.id)}
                  />
                ))}
              </>
            )}

            {items.map((item) => (
              <TodoRow
                key={item.id}
                item={item}
                selected={selectedTodoId === item.id}
                onToggle={onToggle}
                onUpdate={onUpdate}
                onUpdateNotes={onUpdateNotes}
                onDelete={onDelete}
                onSelect={onSelectTodo}
                isAnchored={item.paragraphIds.length > 0}
                onJump={onScrollToMarker && item.paragraphIds.length > 0 ? () => onScrollToMarker(item.id) : undefined}
              />
            ))}
          </>
        )}
      </div>

      {/* Archive bar at bottom */}
      {done.length > 0 && (
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
      )}
    </div>
  );
}
