import { useEffect } from "react";

type AddRemove = {
  remove: (id: string, pid: string) => void;
  add: (id: string, pid: string) => void;
};

/**
 * `virgil-marginalia-reanchor` — dispatched when the user drags a gutter
 * icon onto a different paragraph. Removes the link from the old
 * paragraph and adds it to the new one; the per-entity add/remove
 * mutators all share the same `(entityId, paragraphId)` shape so a
 * small dispatch table (keyed by entity type) replaces what used to be
 * an if/else ladder.
 */
export function useAnchorRebindBridge(deps: {
  addQuotationTextObjectId: AddRemove["add"];
  removeQuotationTextObjectId: AddRemove["remove"];
  addTodoTextObjectId: AddRemove["add"];
  removeTodoTextObjectId: AddRemove["remove"];
  addNoteTextObjectId: AddRemove["add"];
  removeNoteTextObjectId: AddRemove["remove"];
  addArchiveTextObjectId: AddRemove["add"];
  removeArchiveTextObjectId: AddRemove["remove"];
  addCardParagraphId: AddRemove["add"];
  removeCardParagraphId: AddRemove["remove"];
}) {
  const {
    addQuotationTextObjectId, removeQuotationTextObjectId,
    addTodoTextObjectId, removeTodoTextObjectId,
    addNoteTextObjectId, removeNoteTextObjectId,
    addArchiveTextObjectId, removeArchiveTextObjectId,
    addCardParagraphId, removeCardParagraphId,
  } = deps;

  useEffect(() => {
    const mutators: Record<string, AddRemove | undefined> = {
      quote: { remove: removeQuotationTextObjectId, add: addQuotationTextObjectId },
      todo: { remove: removeTodoTextObjectId, add: addTodoTextObjectId },
      note: { remove: removeNoteTextObjectId, add: addNoteTextObjectId },
      archive: { remove: removeArchiveTextObjectId, add: addArchiveTextObjectId },
      cut: { remove: removeCardParagraphId, add: addCardParagraphId },
    };
    const handler = (e: Event) => {
      const { type, entityId, oldParagraphId, newParagraphId } = (e as CustomEvent).detail;
      if (!type || !entityId || !newParagraphId) return;
      const m = mutators[type];
      if (!m) return;
      m.remove(entityId, oldParagraphId);
      m.add(entityId, newParagraphId);
    };
    window.addEventListener("virgil-marginalia-reanchor", handler);
    return () => window.removeEventListener("virgil-marginalia-reanchor", handler);
  }, [addQuotationTextObjectId, removeQuotationTextObjectId, addNoteTextObjectId, removeNoteTextObjectId, addTodoTextObjectId, removeTodoTextObjectId, addArchiveTextObjectId, removeArchiveTextObjectId, addCardParagraphId, removeCardParagraphId]);
}
