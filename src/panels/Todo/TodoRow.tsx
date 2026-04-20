"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { TodoItem } from "@/lib/types";
import { MIME_TODO } from "@/lib/marginalia";
import {
  CARD_THEMES,
  PanelCard,
  BadgeLabel,
  BadgeOrphaned,
  CardTargetIcon,
} from "@/components/panel-primitives";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { popKey } from "@/panels/panel-registry";

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
  const cardKey = popKey("todo", item.id);

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

  const isPoppedInCtx = popped?.isPopped(cardKey) ?? false;
  if (!isPoppedOut && isPoppedInCtx) return null;
  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);

  const card = (
    <PanelCard
      ref={cardRef}
      {...(extraDataAttrs || {})}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      onTrashClick={() => onDelete(item.id)}
      extraCardClass={item.done ? "opacity-60" : ""}
      className="focus:outline-none"
      tabIndex={selected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : item.id);
      }}
      onKeyDown={(e) => {
        if (!selected || editing) return;
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

        {isAnchored ? (
          <BadgeLabel label="T" theme={theme} />
        ) : (
          <BadgeOrphaned theme={theme} />
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item.id);
          }}
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
                if (e.key === "Escape") {
                  setEditText(item.text);
                  setEditing(false);
                }
              }}
              className="w-full text-sm bg-transparent border-b border-[var(--accent)] outline-none py-0 text-ink-strong"
            />
          ) : (
            <span
              className={`block text-sm leading-relaxed truncate ${
                item.done
                  ? "line-through text-ink-muted decoration-stone-300"
                  : "text-stone-900 font-medium"
              }`}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditText(item.text);
                setEditing(true);
              }}
            >
              {item.text}
            </span>
          )}
        </div>

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
          className={`w-full bg-transparent text-xs text-ink-body placeholder:text-ink-muted focus:outline-none resize-none leading-relaxed${isPoppedOut ? " flex-1 min-h-0" : ""}`}
          rows={isPoppedOut ? undefined : 2}
        />
      </div>
    </PanelCard>
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
