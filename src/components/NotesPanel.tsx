"use client";

import { useEffect, useCallback, useMemo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { UserNote, AiRequest } from "@/lib/types";
import { EditableCard, ItemMenu, PANEL, PanelHeader, PrevNextCounter, BadgeLabel, BadgeOrphaned, CardTitleInput, CardTargetIcon, useCycle, AiRequestCard, AiRequestsSectionHeader, clearStaleHover, startTextDrag } from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import PanelThemePicker from "./PanelThemePicker";
import ViewToggle from "./ViewToggle";
import { useInTextPositions, getParagraphAnchorPositions } from "@/hooks/useInTextPositions";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { MIME_NOTE, MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";

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
  /** Hover handler wired into each NoteCard. Fires with the note id on enter, null on leave. */
  onHoverNote?: (id: string | null) => void;
  /** Called when the user drops the selection chip onto the panel — anchors a new note to that range. */
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  /** Called when the user drags a paragraph by its grab bar onto the panel — creates a new note anchored to that paragraph. */
  onDropParagraph?: (paragraphId: string) => void;
  /** Editor handle used to compute in-text positions. */
  editor?: Editor | null;
  /** Which side of the layout the panel is on (used for in-text connector styling). */
  panelSide?: "left" | "right";
  /** View mode: "list" (default) or "in-text" (cards positioned next to anchors). */
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
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
  onHoverChange,
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
  onHoverChange?: (hovering: boolean) => void;
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
  const theme = useCardTheme("note");

  return (
    <EditableCard
      id={note.id}
      selected={selected}
      theme={theme}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={isOrphaned
        ? <BadgeOrphaned theme={theme} />
        : <BadgeLabel label="N" theme={theme} />
      }
      headerContent={<CardTitleInput defaultValue={note.title} onChange={(t) => onUpdateTitle(note.id, t)} theme={theme} />}
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
      onHoverChange={onHoverChange}
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
  onHoverNote,
  onDropSelection,
  onDropParagraph,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
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

  const inTextItems = useMemo(
    () => getParagraphAnchorPositions(editor ?? null, sortedNotes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, sortedNotes],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor ?? null, inTextItems, viewMode === "in-text",
  );
  const noteTheme = useCardTheme("note");

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
        <ItemMenu>
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="note" label="Note color" />
            {onViewModeChange && (
              <ViewToggle mode={viewMode} onChange={onViewModeChange} />
            )}
          </div>
        </ItemMenu>
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
        onClick={() => onSelectNote(null)}
        onDragOver={(onDropSelection || onDropParagraph) ? (e) => {
          const types = e.dataTransfer.types;
          if (
            (onDropSelection && types.includes(MIME_SELECTION_ANCHOR)) ||
            (onDropParagraph && types.includes(MIME_PAR_CAPTURE))
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        } : undefined}
        onDrop={(onDropSelection || onDropParagraph) ? (e) => {
          if (onDropParagraph) {
            const parRaw = e.dataTransfer.getData(MIME_PAR_CAPTURE);
            if (parRaw) {
              e.preventDefault();
              e.stopPropagation();
              try {
                const { uuid } = JSON.parse(parRaw) as { uuid: string };
                if (uuid) onDropParagraph(uuid);
              } catch { /* ignore */ }
              return;
            }
          }
          if (onDropSelection) {
            const raw = e.dataTransfer.getData(MIME_SELECTION_ANCHOR);
            if (!raw) return;
            e.preventDefault();
            try {
              const payload = JSON.parse(raw);
              if (typeof payload.from === "number" && typeof payload.to === "number") {
                onDropSelection(payload);
              }
            } catch { /* ignore */ }
          }
        } : undefined}
      >
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

        {viewMode === "in-text" && sortedNotes.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {sortedNotes.map((note) => {
              const top = positions.get(note.id);
              if (top === undefined) return null;
              const isSelected = selectedNoteId === note.id;
              const preview = richJsonToPlainText(note.content) || "";
              const borderColor = noteTheme.override?.selectedBorder ?? noteTheme.badgeBorder;
              const selectedBg = noteTheme.override?.headerBgSelected;
              return (
                <div
                  key={note.id}
                  data-note-entry={note.id}
                  draggable
                  onDragStart={(e) => startNoteDrag(e, note.id)}
                  className={`absolute left-0 right-0 px-2 pr-4 py-2 border-b transition-colors cursor-grab active:cursor-grabbing in-text-connector in-text-connector-${panelSide} ${isSelected ? "border-l-2 border-b-stone-300" : "border-b-stone-300 hover:bg-surface-muted"}`}
                  style={{
                    top,
                    ...(isSelected
                      ? { borderLeftColor: borderColor, backgroundColor: selectedBg ?? "rgba(16, 185, 129, 0.08)" }
                      : {}),
                  }}
                  onClick={() => onSelectNote(isSelected ? null : note.id)}
                  onMouseEnter={onHoverNote ? () => onHoverNote(note.id) : undefined}
                  onMouseLeave={onHoverNote ? () => onHoverNote(null) : undefined}
                >
                  {note.title && (
                    <div className="text-[11px] font-medium truncate mb-0.5" style={{ color: noteTheme.titleColor }}>
                      {note.title}
                    </div>
                  )}
                  <p
                    className="text-xs text-ink-body leading-snug line-clamp-2 pr-6"
                    style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                  >
                    {preview || <span className="italic text-ink-muted">Empty note</span>}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          sortedNotes.map((note) => (
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
              onHoverChange={onHoverNote ? (hovering) => onHoverNote(hovering ? note.id : null) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
