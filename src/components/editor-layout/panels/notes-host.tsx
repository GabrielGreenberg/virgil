"use client";

import { useEffect, useRef } from "react";
import NotesPanel from "@/panels/Notes";
import type { useNotes } from "@/hooks/useNotes";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { useCardCreationContext } from "../contexts/card-creation";
import { useRecentlyAddedId } from "../contexts/recently-added";
import { createLinkedAnchor, updateLinkedAnchorCard } from "@/links/links";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";

type NotesHook = ReturnType<typeof useNotes>;

export interface NotesHostProps {
  side: Side;
  panelSide: Side | null;
  cards: NotesHook["cards"];
  addNote: NotesHook["addNote"];
  addHighlight: NotesHook["addHighlight"];
  updateNote: NotesHook["updateNote"];
  updateNoteTitle: NotesHook["updateNoteTitle"];
  setNoteAiRequest: NotesHook["setNoteAiRequest"];
  setHighlightAiRequest: NotesHook["setHighlightAiRequest"];
  /** Morph note ⇄ highlight via the kind-chevron (R14) — routes through the
   *  EditorPane morph chokepoint (lossy confirm + float-key remap). */
  convertCard: (id: string, toKind: "note" | "highlight") => void;
  deleteNote: NotesHook["deleteNote"];
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
}

export function NotesHost(p: NotesHostProps) {
  const { editorRef, setOverrideEditor } = useEditorRefContext();
  const { selectedNoteId, setSelectedNoteId } = useSelectionsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();
  const {
    createNote,
    createHighlight,
    deleteHighlightOrNote,
  } = useCardCreationContext();
  // Each kind has its own recently-added slot — only one can be the
  // freshly-pinned card at a time, but querying both lets either kind
  // surface to the top of the list when added.
  const recentlyAddedNote = useRecentlyAddedId("note");
  const recentlyAddedHighlight = useRecentlyAddedId("highlight");
  const recentlyAddedId = recentlyAddedHighlight ?? recentlyAddedNote;
  const discardRef = useRef(p.discardPristine);
  discardRef.current = p.discardPristine;
  useEffect(() => () => discardRef.current(), []);
  return (
    <NotesPanel
      cards={p.cards}
      onAddNote={(rect) => createNote({ anchorRect: rect })}
      onAddHighlight={(rect) => {
        // Header "+" → Highlight requires a live selection. When the user
        // clicks the dropdown with no selection, do nothing (the action is
        // a no-op rather than creating an unanchored highlight).
        const handle = editorRef.current;
        const ed = handle?.getEditor();
        if (!ed || !handle) return null;
        const { from, to } = ed.state.selection;
        if (from === to) return null;
        const paragraphId = handle.ensureParagraphUuid(from);
        const record = createLinkedAnchor(
          ed,
          "highlight",
          { from, to },
          undefined,
          { tintColor: defaultTintForLinkedAnchorKind("highlight") },
        );
        if (!record) return null;
        const card = createHighlight({
          anchor: { anchorId: record.anchorId, anchorText: record.text },
          paragraphId,
          anchorRect: rect,
        });
        updateLinkedAnchorCard(ed, record.anchorId, "highlight", card.id);
        try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
        return card;
      }}
      onConvertCard={p.convertCard}
      onUpdate={p.updateNote}
      onUpdateTitle={p.updateNoteTitle}
      onSetNoteAiRequest={p.setNoteAiRequest}
      onSetHighlightAiRequest={p.setHighlightAiRequest}
      onDelete={deleteHighlightOrNote}
      onSelectNote={setSelectedNoteId}
      selectedNoteId={selectedNoteId}
      onJumpToCard={(card, sourceEl) => editorRef.current?.jumpToCard(card, sourceEl)}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      onEditorFocus={setOverrideEditor}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
