"use client";

import { useEffect, useCallback, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import type { UserNote, AiRequest } from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  PrevNextCounter,
  useCycle,
} from "@/components/panel-primitives";
import { getLinkedParagraphIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { NoteCard } from "./NoteCard";

interface NotesPanelProps {
  notes: UserNote[];
  onAdd: () => UserNote;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelectNote: (id: string | null) => void;
  selectedNoteId: string | null;
  onJumpToCard?: (card: UserNote, sourceEl?: HTMLElement | null) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  aiRequests?: AiRequest[];
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  onEditorFocus?: (editor: any) => void;
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph?: (paragraphId: string) => void;
  recentlyAddedId?: string | null;
}

export default function NotesPanel({
  notes,
  onAdd,
  onUpdate,
  onUpdateTitle,
  onSetAiRequest,
  onDelete,
  onSelectNote,
  selectedNoteId,
  onJumpToCard,
  getCitationDisplayText,
  onCitationCreated,
  aiRequests,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  onEditorFocus,
  onDropSelection,
  onDropParagraph,
  recentlyAddedId,
}: NotesPanelProps) {
  const sortedNotes = useMemo(
    () => {
      const out = [...notes].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      return withRecentlyAddedFirst(out, recentlyAddedId, (n) => n.id);
    },
    [notes, recentlyAddedId],
  );

  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "note"),
    [aiRequests],
  );

  const onActivateNote = useCallback(
    (note: UserNote) => {
      onSelectNote(note.id);
      onJumpToCard?.(note);
    },
    [onSelectNote, onJumpToCard],
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
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="note" label="Note color" />
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
          onSetAiRequest={onSetAiRequest}
          onDelete={onDelete}
          onSelect={onSelectNote}
          onJump={
            onJumpToCard && getLinkedParagraphIds(note).length > 0
              ? (sourceEl) => onJumpToCard(note, sourceEl)
              : undefined
          }
          onEditorFocus={onEditorFocus}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={onCitationCreated}
        />
      )}
    />
  );
}
