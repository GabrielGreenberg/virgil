"use client";

import { useEffect, useCallback, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { UserNote, AiRequest } from "@/lib/types";
import { CARD_THEMES, EditableCard, PANEL, PanelHeader, PrevNextCounter, BadgeLabel, CardTitleInput, CardTargetIcon, useCycle, AiRequestCard, AiRequestsSectionHeader, clearStaleHover, startTextDrag } from "./panel-primitives";
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
  /** Called with the Tiptap editor when a note body gains focus (for main toolbar routing). */
  onEditorFocus?: (editor: any) => void;
}

/* ── Shared helpers ──────────────────────────────────────────────── */

function startNoteDrag(
  e: React.DragEvent,
  noteId: string,
  content: unknown,
  title: string,
) {
  const normalized = normalizeRichContent(content);
  const plain = richJsonToPlainText(normalized) || title || "Note";
  e.dataTransfer.setData("text/plain", plain);
  e.dataTransfer.setData(
    "application/x-virgil-note",
    JSON.stringify({ noteId, content: normalized }),
  );
  e.dataTransfer.effectAllowed = "copy";
  const ghost = document.createElement("div");
  ghost.textContent = plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
  ghost.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#f0fdf4;border:1px solid #34d399;border-radius:4px;font-size:12px;color:#065f46;font-family:var(--font-sans),system-ui,sans-serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 14);
  requestAnimationFrame(() => document.body.removeChild(ghost));
}

/* ── NoteCard ────────────────────────────────────────────────────── */

function NoteCard({
  note,
  selected,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  onJump,
  onEditorFocus,
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
  onEditorFocus?: (editor: any) => void;
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
    <EditableCard
      id={note.id}
      selected={selected}
      theme={CARD_THEMES.note}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={<BadgeLabel label="N" theme={CARD_THEMES.note} />}
      headerContent={<CardTitleInput defaultValue={note.title} onChange={(t) => onUpdateTitle(note.id, t)} />}
      headerTrailing={onJump ? <CardTargetIcon selected={selected} onClick={onJump} title="Jump to note anchor" /> : undefined}
      onClick={() => onSelect(selected ? null : note.id)}
      onDragStart={(e) => startNoteDrag(e, note.id, note.content, note.title)}
      onTextDragStart={(e) => startTextDrag(e, note.content, note.title)}
      onDelete={() => onDelete(note.id)}
      value={note.content}
      variant="note"
      placeholder="Text here."
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "note-entry", value: note.id }}
    />
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
  onEditorFocus,
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

      <div className={PANEL.list} onClick={() => onSelectNote(null)}>
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
            onEditorFocus={onEditorFocus}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        ))}
      </div>
    </div>
  );
}
