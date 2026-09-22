"use client";

import type { DockedJumpGate } from "@/links/card-anchor-rows";
import { useMemo } from "react";
import type { TodoItem } from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { useArchiveVisibleItems } from "@/panels/_shared/card-archive-view";
import { useCardArchiveActions } from "@/panels/_shared/card-archive-actions";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { TodoRow } from "./TodoRow";

// Module-const predicates so their identity is stable across renders — both
// `useArchiveVisibleItems`' memo and `CardListPanel`'s `getArchived`/`getCounted`
// memoize on these, so a shared reference keeps the derivations identity-stable.
const isArchived = (t: TodoItem) => !!t.archived;
const isPending = (t: TodoItem) => !t.done;

interface TodoPanelProps {
  items: TodoItem[];
  onAdd: (anchorRect?: DOMRect) => TodoItem;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  selectedTodoId: string | null;
  onSelectTodo: (id: string | null) => void;
  onJumpToCard?: (card: TodoItem, sourceEl?: HTMLElement | null) => void;
  /** Task 699: the ONE Jump gate (`cardJumpGate` over the pane's shared
   *  anchor pass). Required so no docked panel can fall back to gating Jump on
   *  "the card stores a link". */
  jumpGate: DockedJumpGate;
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
  selectedTodoId,
  onSelectTodo,
  onJumpToCard,
  jumpGate,
  recentlyAddedId,
}: TodoPanelProps) {
  const orderedItems = useMemo(
    () => withRecentlyAddedFirst(items, recentlyAddedId, (i) => i.id),
    [items, recentlyAddedId],
  );
  // Footer + Archive derive from the SAME archive-view-filtered slice
  // `CardListPanel` renders (via the shared `useArchiveVisibleItems`), so an
  // archived (hidden, deliberately set-aside) done todo can't inflate the
  // "N completed" count or be touched by the button in the Active view.
  // (task 2026-07-12-103.)
  const visible = useArchiveVisibleItems("todo", orderedItems, isArchived);
  const done = visible.filter((i) => i.done);
  // The footer's "Archive" ARCHIVES (task 706). It used to reach the pane's
  // clear-done door — a permanent, unconfirmed hard delete of every completed
  // todo, notes and all, under the one label in the app that promises the
  // reversible set-aside. It now runs each done, not-yet-archived todo through
  // the SAME per-card archive door every card's own archive button uses
  // (`useCardArchiveActions().archive`): the flag flips, any pending AI
  // request resolves exactly as it does for a single archive, and the card
  // stays restorable from the Archives view. Already-archived done todos (shown
  // in the All/Archives views) are skipped — `archive` is a toggle, and this
  // control never un-archives.
  const archiveActions = useCardArchiveActions();
  const archivable = done.filter((i) => !i.archived);
  const archiveCompleted = () => {
    for (const t of archivable) archiveActions.archive("todo", t.id);
  };

  return (
    <CardListPanel
      kind="todo"
      // Badge counts pending (not-done) todos among the visible set — done
      // todos no longer inflate it. See `getCounted` on CardListPanel.
      getCounted={isPending}
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
      getArchived={isArchived}
      selectedId={selectedTodoId}
      onSelect={onSelectTodo}
      emptyState={
        <div className={PANEL.empty}>
          No tasks yet. Click &quot;+&quot; to create one.
        </div>
      }
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
          isAnchored={jumpGate(item).anchored}
          onJump={
            onJumpToCard
              ? jumpGate(item).withJump((sourceEl?: HTMLElement | null) => onJumpToCard(item, sourceEl))
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
            {archiveActions.enabled && archivable.length > 0 ? (
            <button
              onClick={archiveCompleted}
              title="Archive completed todos (restore them from the Archives view)"
              className="text-xs px-2.5 py-1 rounded text-[var(--muted)] hover:text-ink-body hover-on-light flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8v13H3V8" />
                <path d="M1 3h22v5H1z" />
                <path d="M10 12h4" />
              </svg>
              Archive
            </button>
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
