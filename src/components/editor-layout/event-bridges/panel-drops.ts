import { useEffect, type Dispatch, type SetStateAction } from "react";

/**
 * "Drop on a paragraph" bridges for the four panel kinds that attach
 * cards to paragraphs by UUID. The editor's drop handler dispatches a
 * `virgil-{kind}-drop` CustomEvent with `{ [kindId], paragraphId }` when
 * a panel chip is released over a paragraph node.
 *
 * Each bridge calls the hook's `addParagraphId` to attach the link, then
 * sets the relevant "selected" slot so the panel highlights the just-
 * linked card. Four near-identical listeners; kept in one file because
 * they share the same shape and the same selection-setter dep pattern.
 */
export function usePanelDropBridges(deps: {
  addQuotationTextObjectId: (groupId: string, paragraphId: string) => void;
  setSelectedQuotationGroupId: Dispatch<SetStateAction<string | null>>;
  addTodoTextObjectId: (todoId: string, paragraphId: string) => void;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  addNoteTextObjectId: (noteId: string, paragraphId: string) => void;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  addCardParagraphId: (cutId: string, paragraphId: string) => void;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    addQuotationTextObjectId,
    setSelectedQuotationGroupId,
    addTodoTextObjectId,
    setSelectedTodoId,
    addNoteTextObjectId,
    setSelectedNoteId,
    addCardParagraphId,
    setSelectedCutterCardId,
  } = deps;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.groupId && detail?.paragraphId) {
        addQuotationTextObjectId(detail.groupId, detail.paragraphId);
        setSelectedQuotationGroupId(detail.groupId);
      }
    };
    window.addEventListener("virgil-quotation-drop", handler);
    return () => window.removeEventListener("virgil-quotation-drop", handler);
  }, [addQuotationTextObjectId, setSelectedQuotationGroupId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.todoId && detail?.paragraphId) {
        addTodoTextObjectId(detail.todoId, detail.paragraphId);
        setSelectedTodoId(detail.todoId);
      }
    };
    window.addEventListener("virgil-todo-drop", handler);
    return () => window.removeEventListener("virgil-todo-drop", handler);
  }, [addTodoTextObjectId, setSelectedTodoId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.noteId && detail?.paragraphId) {
        addNoteTextObjectId(detail.noteId, detail.paragraphId);
        setSelectedNoteId(detail.noteId);
      }
    };
    window.addEventListener("virgil-note-drop", handler);
    return () => window.removeEventListener("virgil-note-drop", handler);
  }, [addNoteTextObjectId, setSelectedNoteId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const cardId: string | undefined = detail?.cardId ?? detail?.cutId;
      if (cardId && detail?.paragraphId) {
        addCardParagraphId(cardId, detail.paragraphId);
        setSelectedCutterCardId(cardId);
      }
    };
    window.addEventListener("virgil-cut-drop", handler);
    return () => window.removeEventListener("virgil-cut-drop", handler);
  }, [addCardParagraphId, setSelectedCutterCardId]);
}
