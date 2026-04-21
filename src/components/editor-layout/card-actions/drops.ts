import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { JSONContent } from "@tiptap/react";
import type { UserNote, CutItem } from "@/lib/types";
import { createLinkedAnchor, updateLinkedAnchorCard } from "@/links/links";
import type { EditorHandle } from "../../Editor";

type DropSelectionPayload = { from: number; to: number; selectedText: string };
type AddNote = (
  paragraphId: string | null,
  content?: JSONContent,
  anchor?: { anchorId: string; anchorText: string },
) => UserNote;
type AddCut = (
  paragraphId: string | null,
  content?: JSONContent,
  anchor?: { anchorId: string; anchorText: string },
) => CutItem;

/**
 * Panel-drop handlers for Notes and Cutter.
 *
 * - `onDropSelection`: selection chip dropped onto the panel. Re-creates
 *   the linked-anchor from the payload range (the live selection may be
 *   gone by the time the drop fires) and attaches it to a new card.
 * - `onDropParagraph`: whole paragraph dragged by its grip handle. No
 *   text-range linkedAnchor — the card is bound at paragraph granularity
 *   and the source paragraph stays intact in the document (unlike
 *   capture-style drops that extract content).
 *
 * Quotation and Todo drops are not here — they're dispatched via
 * `virgil-quotation-drop` / `virgil-todo-drop` window events and handled
 * in `event-bridges/panel-drops.ts` (E7).
 */
export function useDropActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  addNote: AddNote;
  addCut: AddCut;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutId: Dispatch<SetStateAction<string | null>>;
}) {
  const { editorRef, addNote, addCut, setSelectedNoteId, setSelectedCutId } = deps;

  const handleDropSelectionOnNotes = useCallback(
    (payload: DropSelectionPayload) => {
      const ed = editorRef.current?.getEditor();
      if (!ed || !editorRef.current) return;
      const paragraphId = editorRef.current.ensureParagraphUuid(payload.from);
      const record = createLinkedAnchor(ed, "note", { from: payload.from, to: payload.to });
      if (!record) return;
      const note = addNote(
        paragraphId,
        undefined,
        { anchorId: record.anchorId, anchorText: record.text || payload.selectedText },
      );
      updateLinkedAnchorCard(ed, record.anchorId, "note", note.id);
      setSelectedNoteId(note.id);
    },
    [editorRef, addNote, setSelectedNoteId],
  );

  const handleDropParagraphOnNotes = useCallback(
    (paragraphId: string) => {
      if (!paragraphId) return;
      const note = addNote(paragraphId);
      setSelectedNoteId(note.id);
    },
    [addNote, setSelectedNoteId],
  );

  const handleDropSelectionOnCutter = useCallback(
    (payload: DropSelectionPayload) => {
      const ed = editorRef.current?.getEditor();
      if (!ed || !editorRef.current) return;
      const paragraphId = editorRef.current.ensureParagraphUuid(payload.from);
      const record = createLinkedAnchor(ed, "cut", { from: payload.from, to: payload.to });
      if (!record) return;
      const cut = addCut(
        paragraphId,
        undefined,
        { anchorId: record.anchorId, anchorText: record.text || payload.selectedText },
      );
      updateLinkedAnchorCard(ed, record.anchorId, "cut", cut.id);
      setSelectedCutId(cut.id);
    },
    [editorRef, addCut, setSelectedCutId],
  );

  const handleDropParagraphOnCutter = useCallback(
    (paragraphId: string) => {
      if (!paragraphId) return;
      const cut = addCut(paragraphId);
      setSelectedCutId(cut.id);
    },
    [addCut, setSelectedCutId],
  );

  return {
    handleDropSelectionOnNotes,
    handleDropParagraphOnNotes,
    handleDropSelectionOnCutter,
    handleDropParagraphOnCutter,
  };
}
