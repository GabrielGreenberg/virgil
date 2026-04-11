"use client";

import { useEffect, useCallback, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { UserNote, AiRequest } from "@/lib/types";
import { panelCard, PANEL, PanelHeader, ItemMenu, MenuDelete, PrevNextCounter, TargetIcon, useCycle, AiRequestCard, AiRequestsSectionHeader } from "./panel-primitives";
import RichTextField from "./RichTextField";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { MIME_NOTE } from "@/lib/marginalia";

interface NotesPanelProps {
  notes: UserNote[];
  onAdd: (anchorPos: number, content?: JSONContent) => UserNote;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelectNote: (id: string | null) => void;
  selectedNoteId: string | null;
  cursorPos: number;
  onScrollToPos?: (pos: number) => void;
  /** Lookup for rendering dropped/stored citations as formatted text. */
  getCitationDisplayText?: (command: string) => string;
  /** Called when the user drops a brand-new citation into a note. */
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  aiRequests?: AiRequest[];
  onAddAiRequest?: () => void;
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
}

function NoteCard({
  note,
  selected,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  onJump,
  getCitationDisplayText,
  onCitationCreated,
}: {
  note: UserNote;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
}) {

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateTitle(note.id, e.target.value);
    },
    [note.id, onUpdateTitle]
  );

  // Drag handle: serialize the note JSON content into the dataTransfer so the
  // drop target (main editor or another rich text field) can splice it inline.
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLSpanElement>) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "copy";
      const normalized = normalizeRichContent(note.content);
      e.dataTransfer.setData(
        MIME_NOTE,
        JSON.stringify({ noteId: note.id, content: normalized })
      );
      e.dataTransfer.setData("text/plain", richJsonToPlainText(normalized) || note.title || "Note");
    },
    [note.id, note.content, note.title]
  );

  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdate(note.id, normalizeRichContent(json));
    },
    [note.id, onUpdate]
  );

  return (
    <div
      className={panelCard(selected)}
      onClick={() => onSelect(selected ? null : note.id)}
    >
      <div className={PANEL.cardInner}>
        <div className="flex items-center justify-between gap-1.5 mb-1">
          <span
            draggable
            onDragStart={handleDragStart}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center w-5 h-5 rounded border border-emerald-400 bg-emerald-50 text-emerald-700 text-[10px] font-bold leading-none shrink-0 cursor-grab active:cursor-grabbing"
            title="Drag into the document to insert this note's content"
          >
            N
          </span>
          <input
            type="text"
            defaultValue={note.title}
            onChange={handleTitleChange}
            onClick={(e) => e.stopPropagation()}
            placeholder="Title"
            className="flex-1 min-w-0 text-xs font-semibold text-stone-800 bg-transparent outline-none placeholder:text-stone-300 placeholder:font-normal"
          />
          {selected && onJump && (
            <TargetIcon onClick={onJump} title="Jump to note anchor" />
          )}
          <ItemMenu>
            <MenuDelete onClick={() => onDelete(note.id)} />
          </ItemMenu>
        </div>

        <div className="flex-1 min-w-0">
          <RichTextField
            instanceKey={note.id}
            value={note.content}
            placeholder="Write a note..."
            variant="note"
            selected={selected}
            onChange={handleChange}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        </div>
      </div>
    </div>
  );
}

export default function NotesPanel({
  notes,
  onAdd,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelectNote,
  selectedNoteId,
  cursorPos,
  onScrollToPos,
  getCitationDisplayText,
  onCitationCreated,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
}: NotesPanelProps) {
  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => (a.anchorPositions[0] ?? 0) - (b.anchorPositions[0] ?? 0)),
    [notes],
  );

  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "note"),
    [aiRequests],
  );

  const onActivateNote = useCallback(
    (note: UserNote) => {
      onSelectNote(note.id);
      if (note.anchorPositions[0] != null) onScrollToPos?.(note.anchorPositions[0]);
    },
    [onSelectNote, onScrollToPos],
  );
  const { idx, next, prev, setIdx } = useCycle(sortedNotes, onActivateNote);

  // Sync external selection back to cycle index
  useEffect(() => {
    if (!selectedNoteId) return;
    const i = sortedNotes.findIndex((n) => n.id === selectedNoteId);
    if (i >= 0 && i !== idx) setIdx(i);
  }, [selectedNoteId, sortedNotes, idx, setIdx]);

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader
        title="Notes"
        count={notes.length}
        onAdd={() => onAdd(cursorPos)}
        onAiRequest={onAddAiRequest}
      >
        <PrevNextCounter
          current={idx}
          total={sortedNotes.length}
          label="notes"
        />
      </PanelHeader>

      <div className={PANEL.list}>
        {sortedNotes.length === 0 && myAiRequests.length === 0 && (
          <div className={PANEL.empty}>
            No notes yet. Click &quot;Add Note&quot; to create one at the current cursor position.
          </div>
        )}

        {myAiRequests.length > 0 && (
          <>
            <AiRequestsSectionHeader count={myAiRequests.length} />
            {myAiRequests.map((req) => (
              <AiRequestCard
                key={req.id}
                request={req}
                onChangeText={(text) => onUpdateAiRequestText?.(req.id, text)}
                onDelete={() => onDeleteAiRequest?.(req.id)}
              />
            ))}
          </>
        )}

        {sortedNotes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            selected={selectedNoteId === note.id}
            onUpdate={onUpdate}
            onUpdateTitle={onUpdateTitle}
            onDelete={onDelete}
            onSelect={onSelectNote}
            onJump={onScrollToPos && note.anchorPositions[0] != null ? () => onScrollToPos(note.anchorPositions[0]) : undefined}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        ))}
      </div>
    </div>
  );
}
