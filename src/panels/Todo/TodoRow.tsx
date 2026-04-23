"use client";

import { useState, useRef, useCallback } from "react";
import type { TodoItem } from "@/lib/types";
import { MIME_TODO } from "@/lib/marginalia";
import {
  CARD_THEMES,
  PanelCard,
  CardTitleInput,
  CardTargetIcon,
} from "@/components/panel-primitives";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { FloatCard } from "@/components/FloatingCards";
import { popKey } from "@/panels/panel-registry";

const theme = CARD_THEMES.todo;

export function TodoRow({
  item,
  selected,
  onToggle,
  onUpdate,
  onUpdateNotes,
  onSetAiRequest,
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
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  isAnchored: boolean;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
}) {
  const [notes, setNotes] = useState(item.notes);
  const cardRef = useRef<HTMLDivElement>(null);
  const popped = usePoppedCards();
  const cardKey = popKey("todo", item.id);
  const todoBodyStyle = usePanelBodyStyle("todo");

  const commitNotes = useCallback(() => {
    if (notes !== item.notes) onUpdateNotes(item.id, notes);
  }, [notes, item.notes, item.id, onUpdateNotes]);

  // Anchor-only drag — do NOT set text/plain, ProseMirror's default drop
  // handler would otherwise insert it as inline text.
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

  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);

  const card = (
    <PanelCard
      ref={cardRef}
      data-todo-entry={item.id}
      {...(extraDataAttrs || {})}
      data-pristine-card-id={item.id}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      onTrashClick={() => onDelete(item.id)}
      extraCardClass=""
      className="focus:outline-none"
      tabIndex={selected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : item.id);
      }}
      onKeyDown={(e) => {
        if (!selected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(item.id);
        }
      }}
    >
      <div
        className={`flex items-center gap-2 pl-3 pr-7 py-1.5 ${selected ? theme.headerSelected : theme.headerDefault}`}
      >
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

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item.id);
          }}
          className="shrink-0"
          title={item.done ? "Mark as not done" : "Mark as done"}
        >
          {item.done ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="3" fill="#ece9e4" stroke="#b5b0aa" strokeWidth="1.5" />
              <path d="M4.5 8l2.5 2.5 4.5-5" stroke="#1c1917" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" />
            </svg>
          )}
        </button>

        <CardTitleInput
          defaultValue={item.text}
          onChange={(t) => onUpdate(item.id, t)}
          placeholder="Task"
          theme={theme}
          style={{
            ...(item.done ? { textDecoration: "line-through" } : null),
            ...todoBodyStyle,
          }}
        />

        <CardTargetIcon
          selected={selected}
          disabled={!isAnchored}
          onClick={(e) => {
            e.stopPropagation();
            onJump?.();
          }}
          title={isAnchored ? "Jump to in text" : "Not anchored in document"}
        />
      </div>

      <div
        className={`border-t transition-colors ${selected ? theme.separatorSelected : "border-edge-subtle group-hover:border-edge-hover"}`}
      />

      <div
        className={`px-3 pt-1.5 pb-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto flex flex-col" : ""}`}
      >
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Notes..."
          data-panel-kind="todo"
          style={todoBodyStyle}
          className={`w-full bg-transparent text-xs text-ink-body placeholder:text-ink-muted focus:outline-none resize-none leading-relaxed${isPoppedOut ? " flex-1 min-h-0" : ""}`}
          rows={isPoppedOut ? undefined : 2}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetAiRequest(item.id, !item.aiRequest);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-subtle cursor-pointer select-none bg-transparent p-0"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" fill="none" />
            {item.aiRequest && (
              <path d="M4.5 8l2.5 2.5 4.5-5" stroke="#0369a1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            )}
          </svg>
          AI request
        </button>
      </div>
    </PanelCard>
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
