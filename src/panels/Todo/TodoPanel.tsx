"use client";

import { useMemo, useState } from "react";
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
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { TodoRow } from "./TodoRow";

interface TodoPanelProps {
  items: TodoItem[];
  onAdd: () => TodoItem;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onArchiveDone: () => void;
  selectedTodoId: string | null;
  onSelectTodo: (id: string | null) => void;
  onJumpToCard?: (card: TodoItem) => void;
  aiRequests?: AiRequest[];
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph?: (paragraphId: string) => void;
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
  onSetAiRequest,
  onDelete,
  onArchiveDone,
  selectedTodoId,
  onSelectTodo,
  onJumpToCard,
  aiRequests,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  onDropSelection,
  onDropParagraph,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
}: TodoPanelProps) {
  const todoTheme = useCardTheme("todo");

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

  const dropEnabled = onDropSelection || onDropParagraph;
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = dropEnabled
    ? (e: React.DragEvent) => {
        const types = e.dataTransfer.types;
        if (
          (onDropSelection && types.includes(MIME_SELECTION_ANCHOR)) ||
          (onDropParagraph && types.includes(MIME_PAR_CAPTURE))
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!isDragOver) setIsDragOver(true);
        }
      }
    : undefined;
  const handleDragLeave = dropEnabled
    ? (e: React.DragEvent) => {
        const current = e.currentTarget as HTMLElement;
        const next = e.relatedTarget as Node | null;
        if (!next || !current.contains(next)) setIsDragOver(false);
      }
    : undefined;
  const handleDrop = dropEnabled
    ? (e: React.DragEvent) => {
        setIsDragOver(false);
        if (onDropParagraph) {
          const parRaw = e.dataTransfer.getData(MIME_PAR_CAPTURE);
          if (parRaw) {
            e.preventDefault();
            e.stopPropagation();
            try {
              const { uuid } = JSON.parse(parRaw) as { uuid: string };
              if (uuid) onDropParagraph(uuid);
            } catch {
              // ignore
            }
            return;
          }
        }
        if (onDropSelection) {
          const raw = e.dataTransfer.getData(MIME_SELECTION_ANCHOR);
          if (!raw) return;
          e.preventDefault();
          try {
            const payload = JSON.parse(raw);
            if (
              typeof payload.from === "number" &&
              typeof payload.to === "number"
            ) {
              onDropSelection(payload);
            }
          } catch {
            // ignore
          }
        }
      }
    : undefined;

  return (
    <CardListPanel
      kind="todo"
      count={pending.length}
      onAdd={() => onAdd()}
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
      items={items}
      getId={(t) => t.id}
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
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      showDropPlaceholder={isDragOver}
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
          isAnchored={getLinkedParagraphIds(item).length > 0}
          onJump={
            onJumpToCard && getLinkedParagraphIds(item).length > 0
              ? () => onJumpToCard(item)
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
            className={`px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-stone-300" : "border-b-stone-300 hover-on-light"} ${item.done ? "opacity-60" : ""}`}
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
              className="text-xs px-2.5 py-1 rounded text-[var(--muted)] hover:text-ink-body hover-on-light transition-colors flex items-center gap-1.5"
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
