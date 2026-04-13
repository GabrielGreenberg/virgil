"use client";

import { useEffect, useCallback, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { UserNote, AiRequest } from "@/lib/types";
import { CARD_THEMES, EditableCard, PANEL, PanelHeader, PrevNextCounter, BadgeLabel, BadgeOrphaned, CardTitleInput, CardTargetIcon, useCycle, AiRequestCard, AiRequestsSectionHeader, clearStaleHover, startTextDrag } from "./panel-primitives";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { MIME_NOTE } from "@/lib/marginalia";

interface NotesPanelProps {
  notes: UserNote[];
  onAdd: () => UserNote;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelectNote: (id: string | null) => void;
  selectedNoteId: string | null;
  onScrollToParagraphId?: (uuid: string) => void;
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

/** Top grab bar: anchor-only drag (no inline text insertion).
 *  NOTE: Do NOT set text/plain here — ProseMirror's default drop handler
 *  would insert it as inline text when the Editor's handleDrop returns false
 *  for anchor drags. */
function startNoteDrag(
  e: React.DragEvent,
  noteId: string,
) {
  e.dataTransfer.setData(
    "application/x-virgil-note",
    JSON.stringify({ noteId }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

/* ── NoteCard ────────────────────────────────────────────────────── */

export function NoteCard({
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
  extraDataAttrs,
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
  extraDataAttrs?: Record<string, string>;
}) {

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateTitle(note.id, e.target.value);
    },
    [note.id, onUpdateTitle]
  );

  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdate(note.id, normalizeRichContent(json));
    },
    [note.id, onUpdate]
  );

  const isOrphaned = note.paragraphIds.length === 0;

  return (
    <EditableCard
      id={note.id}
      selected={selected}
      theme={CARD_THEMES.note}
      grabHandle
      hideToolbar
      inlineDelete
      orphaned={isOrphaned}
      onEditorFocus={onEditorFocus}
      badge={isOrphaned
        ? <BadgeOrphaned theme={CARD_THEMES.note} />
        : <BadgeLabel label="N" theme={CARD_THEMES.note} />
      }
      headerContent={<CardTitleInput defaultValue={note.title} onChange={(t) => onUpdateTitle(note.id, t)} theme={CARD_THEMES.note} />}
      headerTrailing={onJump
        ? <CardTargetIcon selected={selected} onClick={onJump} title="Jump to note anchor" />
        : <CardTargetIcon selected={false} disabled onClick={() => {}} />
      }
      onClick={() => onSelect(selected ? null : note.id)}
      onDragStart={(e) => startNoteDrag(e, note.id)}
      onTextDragStart={(e) => startTextDrag(e, note.content, note.title)}
      onDelete={() => onDelete(note.id)}
      value={note.content}
      variant="footnote"
      placeholder="Text here."
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "note-entry", value: note.id }}
      extraDataAttrs={extraDataAttrs}
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
  onScrollToParagraphId,
  getCitationDisplayText,
  onCitationCreated,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  onEditorFocus,
}: NotesPanelProps) {
  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => {
      // Sort by creation date; notes without anchors sort last
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }),
    [notes],
  );

  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "note"),
    [aiRequests],
  );

  const onActivateNote = useCallback(
    (note: UserNote) => {
      onSelectNote(note.id);
      const firstPid = note.paragraphIds[0];
      if (firstPid) onScrollToParagraphId?.(firstPid);
    },
    [onSelectNote, onScrollToParagraphId],
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
        onAdd={() => onAdd()}
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
            onJump={onScrollToParagraphId && note.paragraphIds[0] ? () => onScrollToParagraphId(note.paragraphIds[0]) : undefined}
            onEditorFocus={onEditorFocus}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        ))}
      </div>
    </div>
  );
}
