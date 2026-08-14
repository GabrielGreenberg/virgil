"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { TodoItem } from "@/lib/types";
import {
  PANEL,
  PanelCard,
  CardTitleInput,
  AiRequestCheckbox,
  useCardDeleteKey,
} from "@/components/panel-primitives";
import ConfirmDialog from "@/components/ConfirmDialog";
import { cardHasContent } from "@/cards/has-content";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import { iconHint } from "@/components/Hint";

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
      className="shrink-0 bg-transparent p-0 focus-ring"
      {...iconHint({ label: item.done ? "Undo done" : "Mark done", pos: "above" })}
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const popped = usePoppedCards();
  const cardKey = popKey("todo", item.id);
  // Version-subscribed, so the "Todo color" override re-tints the docked card
  // live — the same source the todo margin marker and the popped-out float
  // already read. Never bind `CARD_THEMES.todo` at module scope: that table is
  // a one-time fold over the SHIPPED defaults and is override-blind forever.
  const theme = useCardTheme("todo");
  const todoBodyStyle = usePanelBodyStyle("todo");
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();

  // Reconcile the controlled `notes` mirror with its source of truth. The notes
  // textarea is a local `useState` buffer committed to disk only on blur; without
  // this, an out-of-band write to `todos.json` (an AI cowork skill editing a
  // todo's notes while the panel is open — the live sidecar-reactivity path
  // re-reads disk and updates `item.notes` with the SAME id, so the row never
  // remounts) would be invisible in the card AND get reverted on the next
  // focus/blur. `lastCommittedRef` tracks the last value we know is on disk; we
  // reset the buffer to an external change ONLY when the user has no uncommitted
  // edit in flight (`notes === lastCommittedRef.current`), so a mid-edit local
  // buffer is preserved and wins on commit. (task 2026-07-12-102.)
  const lastCommittedRef = useRef(item.notes);

  const commitNotes = useCallback(() => {
    if (notes !== item.notes) onUpdateNotes(item.id, notes);
    lastCommittedRef.current = notes;
  }, [notes, item.notes, item.id, onUpdateNotes]);

  useEffect(() => {
    if (notes === lastCommittedRef.current) {
      setNotes(item.notes);
      lastCommittedRef.current = item.notes;
    }
  }, [item.notes, notes]);

  // Delete-with-confirm — route the todo trash + panel Delete/Backspace through
  // the `cardHasContent` SSOT like every sibling panel (task 067 facet 2; todo
  // was the lone anchored-body panel whose trash skipped the content gate). Use
  // the LIVE local `notes` (committed on blur only) so typing-then-trashing
  // without first blurring the textarea still trips the confirm.
  const tryDelete = useCallback(() => {
    if (cardHasContent("todo", { ...item, notes })) {
      setConfirmOpen(true);
    } else {
      onDelete(item.id);
    }
  }, [item, notes, onDelete]);

  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const ac = useAnchoredCard({ kind: "todo", id: item.id });
  const cardStore = useCardStore();
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  // Todo is the lone editable card with a bare card-level delete-key handler
  // (plain <input> title + <textarea> notes, no EditableCard focus-tracking).
  // The shared hook bakes in the interactive-control guard so a Backspace typed
  // inside a field edits text instead of deleting the card (tasks 096 + 110).
  const handleDeleteKey = useCardDeleteKey(selected, tryDelete);

  const card = (
    <>
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
      onTrashClick={tryDelete}
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
      onKeyDown={handleDeleteKey}
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
    <ConfirmDialog
      open={confirmOpen}
      message="This item has text. Delete it?"
      confirmLabel="Delete"
      tone="danger"
      anchorRef={cardRef}
      onConfirm={() => { setConfirmOpen(false); onDelete(item.id); }}
      onCancel={() => setConfirmOpen(false)}
    />
    </>
  );
  return card;
}
