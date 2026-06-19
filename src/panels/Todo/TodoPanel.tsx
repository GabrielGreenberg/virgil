"use client";

import { useMemo } from "react";
import type { TodoItem, AiRequest } from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { getLinkedTextObjectIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { TodoRow } from "./TodoRow";

interface TodoPanelProps {
  items: TodoItem[];
  onAdd: (anchorRect?: DOMRect) => TodoItem;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onArchiveDone: () => void;
  selectedTodoId: string | null;
  onSelectTodo: (id: string | null) => void;
  onJumpToCard?: (card: TodoItem, sourceEl?: HTMLElement | null) => void;
  aiRequests?: AiRequest[];
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  recentlyAddedId?: string | null;
}

export default function TodoPanel({
  items,
  onAdd,
  onToggle,
  onUpdate,
  onUpdateNotes,
  onSetAiRequest,
  onDelete,
  onArchiveDone,
  selectedTodoId,
  onSelectTodo,
  onJumpToCard,
  aiRequests,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  recentlyAddedId,
}: TodoPanelProps) {
  const orderedItems = useMemo(
    () => withRecentlyAddedFirst(items, recentlyAddedId, (i) => i.id),
    [items, recentlyAddedId],
  );
  const pending = orderedItems.filter((i) => !i.done);
  const done = orderedItems.filter((i) => i.done);

  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "todo"),
    [aiRequests],
  );

  return (
    <CardListPanel
      kind="todo"
      count={pending.length}
      onAdd={(rect) => onAdd(rect)}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="todo" label="Todo color" />
          </div>
          <CardViewModeMenuItems kind="todo" />
        </ItemMenu>
      }
      items={orderedItems}
      getId={(t) => t.id}
      getArchived={(t) => !!t.archived}
      selectedId={selectedTodoId}
      onSelect={onSelectTodo}
      emptyState={
        <div className={PANEL.empty}>
          No tasks yet. Click &quot;+&quot; to create one.
        </div>
      }
      aiRequests={myAiRequests}
      onUpdateAiRequestText={onUpdateAiRequestText}
      onDeleteAiRequest={onDeleteAiRequest}
      renderCard={(item, { selected }) => (
        <TodoRow
          item={item}
          selected={selected}
          onToggle={onToggle}
          onUpdate={onUpdate}
          onUpdateNotes={onUpdateNotes}
          onSetAiRequest={onSetAiRequest}
          onDelete={onDelete}
          onSelect={onSelectTodo}
          isAnchored={getLinkedTextObjectIds(item).length > 0}
          onJump={
            onJumpToCard && getLinkedTextObjectIds(item).length > 0
              ? (sourceEl) => onJumpToCard(item, sourceEl)
              : undefined
          }
        />
      )}
      footer={
        done.length > 0 ? (
          <div className="px-4 py-2.5 border-t border-[var(--border)] flex items-center justify-between bg-surface-muted/50">
            <span className="text-xs text-ink-muted">
              {done.length} completed
            </span>
            <button
              onClick={onArchiveDone}
              className="text-xs px-2.5 py-1 rounded text-[var(--muted)] hover:text-ink-body hover-on-light flex items-center gap-1.5"
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
