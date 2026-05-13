import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { JSONContent } from "@tiptap/react";
import type { UserNote, HighlightCard, CutterCommentCard } from "@/lib/types";
import { createLinkedAnchor, updateLinkedAnchorCard } from "@/links/links";
import type { EditorHandle } from "../../Editor";

type DropSelectionPayload = { from: number; to: number; selectedText: string };
type AddNote = (
  paragraphId: string | null,
  content?: JSONContent,
  anchor?: { anchorId: string; anchorText: string },
) => UserNote;
type AddHighlight = (
  anchor: { anchorId: string; anchorText: string },
  paragraphId: string | null,
  color?: string | null,
) => HighlightCard;
type AddCutterComment = (
  paragraphId: string | null,
  content?: JSONContent,
  anchor?: { anchorId: string; anchorText: string },
) => CutterCommentCard;

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
 * Every card created here is seeded (anchor or paragraph link), so the
 * per-hook pristine check recognizes it as "already carrying intent" and
 * skips pristine enrollment — the card is never auto-discarded.
 *
 * Quotation and Todo drops are not here — they're dispatched via
 * `virgil-quotation-drop` / `virgil-todo-drop` window events and handled
 * in `event-bridges/panel-drops.ts` (E7).
 */
export function useDropActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  addNote: AddNote;
  addHighlight: AddHighlight;
  addCutterComment: AddCutterComment;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    editorRef,
    addNote,
    addHighlight,
    addCutterComment,
    setSelectedNoteId,
    setSelectedCutterCardId,
  } = deps;

  // Selection-drop on Notes defaults to Highlight (Adobe-style: dragging
  // a text selection in is the "give me a yellow swatch" gesture). The
  // panel header "+" dropdown lets the user create a Note from selection
  // explicitly.
  const handleDropSelectionOnNotes = useCallback(
    (payload: DropSelectionPayload) => {
      const ed = editorRef.current?.getEditor();
      if (!ed || !editorRef.current) return;
      const paragraphId = editorRef.current.ensureParagraphUuid(payload.from);
      const record = createLinkedAnchor(
        ed,
        "highlight",
        { from: payload.from, to: payload.to },
        undefined,
        { tintColor: "#fbbf24" },
      );
      if (!record) return;
      const card = addHighlight(
        { anchorId: record.anchorId, anchorText: record.text || payload.selectedText },
        paragraphId,
      );
      updateLinkedAnchorCard(ed, record.anchorId, "highlight", card.id);
      setSelectedNoteId(card.id);
    },
    [editorRef, addHighlight, setSelectedNoteId],
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
      const record = createLinkedAnchor(ed, "cutter-comment", {
        from: payload.from,
        to: payload.to,
      });
      if (!record) return;
      const card = addCutterComment(
        paragraphId,
        undefined,
        {
          anchorId: record.anchorId,
          anchorText: record.text || payload.selectedText,
        },
      );
      updateLinkedAnchorCard(ed, record.anchorId, "cutter-comment", card.id);
      setSelectedCutterCardId(card.id);
    },
    [editorRef, addCutterComment, setSelectedCutterCardId],
  );

  const handleDropParagraphOnCutter = useCallback(
    (paragraphId: string) => {
      if (!paragraphId) return;
      const card = addCutterComment(paragraphId);
      setSelectedCutterCardId(card.id);
    },
    [addCutterComment, setSelectedCutterCardId],
  );

  return {
    handleDropSelectionOnNotes,
    handleDropParagraphOnNotes,
    handleDropSelectionOnCutter,
    handleDropParagraphOnCutter,
  };
}
