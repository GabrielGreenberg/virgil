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
  addQuotationParagraphId: AddRemove["add"];
  removeQuotationParagraphId: AddRemove["remove"];
  addTodoParagraphId: AddRemove["add"];
  removeTodoParagraphId: AddRemove["remove"];
  addNoteParagraphId: AddRemove["add"];
  removeNoteParagraphId: AddRemove["remove"];
  addArchiveParagraphId: AddRemove["add"];
  removeArchiveParagraphId: AddRemove["remove"];
  addCardParagraphId: AddRemove["add"];
  removeCardParagraphId: AddRemove["remove"];
}) {
  const {
    addQuotationParagraphId, removeQuotationParagraphId,
    addTodoParagraphId, removeTodoParagraphId,
    addNoteParagraphId, removeNoteParagraphId,
    addArchiveParagraphId, removeArchiveParagraphId,
    addCardParagraphId, removeCardParagraphId,
  } = deps;

  useEffect(() => {
    const mutators: Record<string, AddRemove | undefined> = {
      quote: { remove: removeQuotationParagraphId, add: addQuotationParagraphId },
      todo: { remove: removeTodoParagraphId, add: addTodoParagraphId },
      note: { remove: removeNoteParagraphId, add: addNoteParagraphId },
      archive: { remove: removeArchiveParagraphId, add: addArchiveParagraphId },
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
  }, [addQuotationParagraphId, removeQuotationParagraphId, addNoteParagraphId, removeNoteParagraphId, addTodoParagraphId, removeTodoParagraphId, addArchiveParagraphId, removeArchiveParagraphId, addCardParagraphId, removeCardParagraphId]);
}
