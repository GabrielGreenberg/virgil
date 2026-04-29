"use client";

import { useEffect, useRef } from "react";
import NotesPanel from "@/panels/Notes";
import type { useNotes } from "@/hooks/useNotes";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";
import { useAiRequestsContext } from "../contexts/ai-requests";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { useCardCreationContext } from "../contexts/card-creation";
import { useRecentlyAddedId } from "../contexts/recently-added";

type NotesHook = ReturnType<typeof useNotes>;

export interface NotesHostProps {
  side: Side;
  panelSide: Side | null;
  notes: NotesHook["notes"];
  addNote: NotesHook["addNote"];
  updateNote: NotesHook["updateNote"];
  updateNoteTitle: NotesHook["updateNoteTitle"];
  deleteNote: NotesHook["deleteNote"];
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
  onHoverNote: (noteId: string | null) => void;
  onDropSelection: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph: (paragraphId: string) => void;
}

export function NotesHost(p: NotesHostProps) {
  const { editorInstance, editorRef, setOverrideEditor } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedNoteId, setSelectedNoteId } = useSelectionsContext();
  const { aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest } = useAiRequestsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();
  const { createNote } = useCardCreationContext();
  const recentlyAddedId = useRecentlyAddedId("note");
  const discardRef = useRef(p.discardPristine);
  discardRef.current = p.discardPristine;
  useEffect(() => () => discardRef.current(), []);
  return (
    <NotesPanel
      notes={p.notes}
      onAdd={() => createNote({})}
      onUpdate={p.updateNote}
      onUpdateTitle={p.updateNoteTitle}
      onDelete={p.deleteNote}
      onSelectNote={setSelectedNoteId}
      selectedNoteId={selectedNoteId}
      onJumpToCard={(note, sourceEl) => editorRef.current?.jumpToCard(note, sourceEl)}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      aiRequests={aiRequests}
      onAddAiRequest={() => addAiRequest("note")}
      onUpdateAiRequestText={updateAiRequestText}
      onDeleteAiRequest={deleteAiRequest}
      onEditorFocus={setOverrideEditor}
      onHoverNote={p.onHoverNote}
      onDropSelection={p.onDropSelection}
      onDropParagraph={p.onDropParagraph}
      editor={editorInstance}
      panelSide={p.panelSide ?? p.side}
      viewMode={getPanelViewMode("notes")}
      onViewModeChange={(m) => setPanelViewMode("notes", m)}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
