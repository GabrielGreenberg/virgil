"use client";

import { useState, useRef, useCallback } from "react";
import type { TodoItem } from "@/lib/types";
import { MIME_TODO } from "@/lib/marginalia";
import {
  CARD_THEMES,
  PanelCard,
  CardTitleInput,
  CardTargetIcon,
  CardTypeLabel,
  CardDragHandle,
  AiRequestCheckbox,
} from "@/components/panel-primitives";
import { useInOmni } from "@/components/editor-layout/contexts/omni";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
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
  onJump?: (sourceEl: HTMLElement | null) => void;
  isAnchored: boolean;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const [notes, setNotes] = useState(item.notes);
  const cardRef = useRef<HTMLDivElement>(null);
  const popped = usePoppedCards();
  const cardKey = popKey("todo", item.id);
  const todoBodyStyle = usePanelBodyStyle("todo");
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();

  const commitNotes = useCallback(() => {
    if (notes !== item.notes) onUpdateNotes(item.id, notes);
  }, [notes, item.notes, item.id, onUpdateNotes]);

  // TODO(grip-redesign): drop-into-document via the grip is disabled
  // during the unified header redesign. Re-introduce thoughtfully via a
  // separate body-level affordance, not the grip.
  // const handleDragStart = useCallback(
  //   (e: React.DragEvent) => {
  //     e.stopPropagation();
  //     e.dataTransfer.effectAllowed = "link";
  //     e.dataTransfer.setData(MIME_TODO, JSON.stringify({ todoId: item.id }));
  //     if (cardRef.current) {
  //       e.dataTransfer.setDragImage(cardRef.current, 20, -10);
  //     }
  //   },
  //   [item.id],
  // );

  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const inOmni = useInOmni() != null;
  const compressed = !selected && !isPoppedOut;

  const card = (
    <PanelCard
      ref={cardRef}
      data-todo-entry={item.id}
      data-card-key={cardKey}
      {...(extraDataAttrs || {})}
      data-pristine-card-id={item.id}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onTrashClick={() => onDelete(item.id)}
      extraCardClass=""
      className="focus:outline-none"
      tabIndex={selected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : item.id);
      }}
      onFocusCapture={() => { if (!selected) onSelect(item.id); }}
      onKeyDown={(e) => {
        if (!selected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(item.id);
        }
      }}
    >
      <div
        className="flex items-center gap-2 pl-3 pr-7 py-1.5"
        style={{ backgroundColor: selected ? theme.headerSelected : theme.headerDefault }}
      >
        <CardDragHandle />

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item.id);
          }}
          className="shrink-0"
          title={item.done ? "Mark as not done" : "Mark as done"}
          data-helper={item.done ? "Undo done" : "Mark done"}
          data-helper-pos="above"
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

        {inOmni ? (
          <div className="flex-1 min-w-0 flex flex-col">
            <CardTypeLabel kind="todo" />
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
          </div>
        ) : (
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
        )}

        <CardTargetIcon
          selected={selected}
          disabled={!isAnchored}
          onClick={(e) => {
            e.stopPropagation();
            onJump?.((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
          }}
          title={isAnchored ? "Jump to in text" : "Not anchored in document"}
          data-helper={isAnchored ? "Jump to" : "Not anchored"}
          data-helper-pos="above"
        />
      </div>

      {!compressed && (
        <>
      <div
        className={`border-t transition-colors ${selected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={selected ? { borderTopColor: theme.separatorSelected } : undefined}
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
          onKeyDown={onTextareaKeyDown}
          placeholder="Notes..."
          data-panel-kind="todo"
          style={todoBodyStyle}
          className={`w-full bg-transparent placeholder:text-ink-muted focus:outline-none resize-none leading-relaxed${isPoppedOut ? " flex-1 min-h-0" : ""}`}
          rows={isPoppedOut ? undefined : 2}
        />
        <AiRequestCheckbox
          checked={item.aiRequest}
          onToggle={(next) => onSetAiRequest(item.id, next)}
          className="mt-1"
        />
      </div>
        </>
      )}
    </PanelCard>
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
