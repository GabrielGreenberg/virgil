"use client";

import { useEffect, useCallback, useMemo, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { UserNote, AiRequest } from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  PrevNextCounter,
  useCycle,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import ViewToggle from "@/components/ViewToggle";
import {
  useInTextPositions,
  getParagraphAnchorPositions,
} from "@/hooks/useInTextPositions";
import { richJsonToPlainText } from "@/lib/footnote-content";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { NoteCard, startNoteDrag } from "./NoteCard";

interface NotesPanelProps {
  notes: UserNote[];
  onAdd: () => UserNote;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelectNote: (id: string | null) => void;
  selectedNoteId: string | null;
  onScrollToParagraphId?: (uuid: string) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  aiRequests?: AiRequest[];
  onAddAiRequest?: () => void;
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  onEditorFocus?: (editor: any) => void;
  onHoverNote?: (id: string | null) => void;
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph?: (paragraphId: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}

export default function NotesPanel({
  notes,
  onAdd,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelectNote,
  selectedNoteId,
  onScrollToParagraphId,
  getCitationDisplayText,
  onCitationCreated,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  onEditorFocus,
  onHoverNote,
  onDropSelection,
  onDropParagraph,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
}: NotesPanelProps) {
  const sortedNotes = useMemo(
    () =>
      [...notes].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [notes],
  );

  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "note"),
    [aiRequests],
  );

  const inTextItems = useMemo(
    () => getParagraphAnchorPositions(editor ?? null, sortedNotes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, sortedNotes],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor ?? null,
    inTextItems,
    viewMode === "in-text",
  );
  const noteTheme = useCardTheme("note");

  const onActivateNote = useCallback(
    (note: UserNote) => {
      onSelectNote(note.id);
      const firstPid = getLinkedParagraphIds(note)[0];
      if (firstPid) onScrollToParagraphId?.(firstPid);
    },
    [onSelectNote, onScrollToParagraphId],
  );
  const { idx, setIdx } = useCycle(sortedNotes, onActivateNote);

  useEffect(() => {
    if (!selectedNoteId) return;
    const i = sortedNotes.findIndex((n) => n.id === selectedNoteId);
    if (i >= 0 && i !== idx) setIdx(i);
  }, [selectedNoteId, sortedNotes, idx, setIdx]);

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
        // Fires when leaving any descendant too; only reset when we've
        // actually left the scroll container (relatedTarget not contained).
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
      kind="notes"
      count={notes.length}
      onAdd={() => onAdd()}
      onAiRequest={onAddAiRequest}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="note" label="Note color" />
            {onViewModeChange && (
              <ViewToggle mode={viewMode} onChange={onViewModeChange} />
            )}
          </div>
        </ItemMenu>
      }
      headerExtras={
        <PrevNextCounter
          current={idx}
          total={sortedNotes.length}
          label="notes"
        />
      }
      items={sortedNotes}
      getId={(n) => n.id}
      selectedId={selectedNoteId}
      onSelect={onSelectNote}
      emptyState={
        <div className={PANEL.empty}>
          No notes yet. Click &quot;Add Note&quot; to create one at the current
          cursor position.
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
      renderCard={(note, { selected }) => (
        <NoteCard
          note={note}
          selected={selected}
          onUpdate={onUpdate}
          onUpdateTitle={onUpdateTitle}
          onDelete={onDelete}
          onSelect={onSelectNote}
          onJump={(() => {
            const pid = getLinkedParagraphIds(note)[0];
            return onScrollToParagraphId && pid
              ? () => onScrollToParagraphId(pid)
              : undefined;
          })()}
          onEditorFocus={onEditorFocus}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={onCitationCreated}
          onHoverChange={
            onHoverNote
              ? (hovering) => onHoverNote(hovering ? note.id : null)
              : undefined
          }
        />
      )}
      inTextRenderItem={(note, { selected, top: _top }) => {
        const preview = richJsonToPlainText(note.content) || "";
        const borderColor =
          noteTheme.override?.selectedBorder ?? noteTheme.badgeBorder;
        const selectedBg = noteTheme.override?.headerBgSelected;
        return (
          <div
            data-note-entry={note.id}
            draggable
            onDragStart={(e) => startNoteDrag(e, note.id)}
            className={`px-2 pr-4 py-2 border-b transition-colors cursor-grab active:cursor-grabbing in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-stone-300" : "border-b-stone-300 hover:bg-surface-muted"}`}
            style={
              selected
                ? {
                    borderLeftColor: borderColor,
                    backgroundColor:
                      selectedBg ?? "rgba(16, 185, 129, 0.08)",
                  }
                : undefined
            }
            onClick={() => onSelectNote(selected ? null : note.id)}
            onMouseEnter={onHoverNote ? () => onHoverNote(note.id) : undefined}
            onMouseLeave={onHoverNote ? () => onHoverNote(null) : undefined}
          >
            {note.title && (
              <div
                className="text-[11px] font-medium truncate mb-0.5"
                style={{ color: noteTheme.titleColor }}
              >
                {note.title}
              </div>
            )}
            <p
              className="text-xs text-ink-body leading-snug line-clamp-2 pr-6"
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {preview || (
                <span className="italic text-ink-muted">Empty note</span>
              )}
            </p>
          </div>
        );
      }}
    />
  );
}
