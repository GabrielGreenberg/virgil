"use client";

import { useState, useRef, useCallback } from "react";
import type { TodoItem } from "@/lib/types";
import {
  CARD_THEMES,
  PANEL,
  PanelCard,
  CardTitleInput,
  AiRequestCheckbox,
} from "@/components/panel-primitives";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";

const theme = CARD_THEMES.todo;

/** The done/undone checkbox shown in a Todo's header (docked) and its float
 *  chrome trailing slot. Exported so the `toFloatable` factory can place the
 *  same control in `FloatChrome` without duplicating the SVG. */
export function TodoDoneToggle({
  item,
  onToggle,
}: {
  item: TodoItem;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(item.id);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="shrink-0 bg-transparent p-0"
      data-hint={item.done ? "Undo done" : "Mark done"}
      data-hint-pos="above"
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
  );
}

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

  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const ac = useAnchoredCard({ kind: "todo", id: item.id });
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;

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
      chromeless={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
      onTrashClick={() => onDelete(item.id)}
      extraCardClass=""
      className="focus:outline-none"
      tabIndex={isSelected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        const card = (e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null;
        ac.onBodyActivate({
          onSelect: () => onSelect(item.id),
          jump: isAnchored && onJump ? () => onJump(card) : undefined,
        });
      }}
      onMouseEnter={() => cardStore.setHover(ac.ref)}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
      }}
      onFocusCapture={() => { if (!isSelected) onSelect(item.id); }}
      onKeyDown={(e) => {
        if (!selected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(item.id);
        }
      }}
      kind="todo"
      canJump={isAnchored && !!onJump}
      onJump={(e) => onJump?.((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
      headerTrailing={<TodoDoneToggle item={item} onToggle={onToggle} />}
    >
      <div className={`${PANEL.cardBody}${isPoppedOut ? " flex-1 min-h-0 overflow-auto flex flex-col" : ""}`}>
        <CardTitleInput
          defaultValue={item.text}
          onChange={(t) => onUpdate(item.id, t)}
          placeholder="Task"
          theme={theme}
          // TITLE dialect — design-system-fixed (CardTitleInput owns the
          // par-title styling). The per-panel body-font picker
          // (`todoBodyStyle`) applies to the notes textarea below only.
          style={item.done ? { textDecoration: "line-through" } : undefined}
        />
        {!compressed && (
          <>
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
              className={`w-full bg-transparent placeholder:text-ink-muted focus:outline-none resize-none leading-relaxed mt-1${isPoppedOut ? " flex-1 min-h-0" : ""}`}
              rows={isPoppedOut ? undefined : 2}
            />
            <AiRequestCheckbox
              checked={item.aiRequest}
              onToggle={(next) => onSetAiRequest(item.id, next)}
              className="mt-1"
            />
          </>
        )}
      </div>
    </PanelCard>
  );
  return card;
}
