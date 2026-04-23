"use client";

import { useCallback } from "react";
import { generateEntityId } from "@/lib/uuid";
import type {
  QuotationsState,
  QuotationGroup,
  Reference,
  Quote,
} from "@/lib/types";
import { migrateQuotationsState } from "@/lib/migrate-quotations";
import { addParagraphLink, removeParagraphLink } from "@/links/links";
import { usePersistentState } from "./usePersistentState";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: QuotationsState = { groups: [] };

function makeQuote(text = "", page = ""): Quote {
  return { id: generateEntityId(), text, page };
}

function makeReference(citeKey = "", quotes?: Quote[]): Reference {
  return {
    id: generateEntityId(),
    citeKey,
    quotes: quotes && quotes.length ? quotes : [makeQuote()],
  };
}

export function useQuotations(docId: string | null, pristine?: PristineKindApi | null) {
  const { state, update } = usePersistentState<QuotationsState>(
    docId,
    "quotations.json",
    EMPTY_STATE,
    {
      migrate: (raw) => migrateQuotationsState(raw as Parameters<typeof migrateQuotationsState>[0]),
      errorLabel: "quotations",
    },
  );

  // Helper to update one group and persist atomically.
  const updateGroup = useCallback(
    (groupId: string, mutate: (g: QuotationGroup) => QuotationGroup) => {
      update((prev) => ({
        groups: prev.groups.map((g) => (g.id === groupId ? mutate(g) : g)),
      }));
    },
    [update],
  );

  // --- Group ops ---

  const addGroup = useCallback(
    (init?: { text?: string; paragraphId?: string | null }) => {
      let newGroup: QuotationGroup = {
        id: generateEntityId(),
        title: "",
        references: [makeReference("", [makeQuote(init?.text ?? "")])],
        notes: "",
        createdAt: new Date().toISOString(),
        links: [],
      };
      if (init?.paragraphId) {
        newGroup = addParagraphLink(newGroup, "quotation", init.paragraphId);
      }
      const isBlank = !init || (!init.text && !init.paragraphId);
      if (isBlank) pristine?.markNew(newGroup.id);
      update((prev) => ({ ...prev, groups: [newGroup, ...prev.groups] }));
      return newGroup;
    },
    [update, pristine],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      pristine?.markDirty(groupId);
      update((prev) => ({ groups: prev.groups.filter((g) => g.id !== groupId) }));
    },
    [update, pristine],
  );

  const updateGroupTitle = useCallback(
    (groupId: string, title: string) => {
      pristine?.markDirty(groupId);
      updateGroup(groupId, (g) => ({ ...g, title }));
    },
    [updateGroup, pristine],
  );

  const updateNotes = useCallback(
    (groupId: string, notes: string) => {
      pristine?.markDirty(groupId);
      updateGroup(groupId, (g) => ({ ...g, notes }));
    },
    [updateGroup, pristine],
  );

  const addParagraphId = useCallback(
    (groupId: string, paragraphId: string) => {
      updateGroup(groupId, (g) => addParagraphLink(g, "quotation", paragraphId));
    },
    [updateGroup],
  );

  const removeParagraphId = useCallback(
    (groupId: string, paragraphId: string) => {
      updateGroup(groupId, (g) => removeParagraphLink(g, paragraphId));
    },
    [updateGroup],
  );

  // --- Reference ops ---

  const addReference = useCallback(
    (groupId: string) => {
      pristine?.markDirty(groupId);
      const newRef = makeReference();
      updateGroup(groupId, (g) => ({
        ...g,
        references: [...g.references, newRef],
      }));
      return newRef.id;
    },
    [updateGroup, pristine],
  );

  const deleteReference = useCallback(
    (groupId: string, referenceId: string) => {
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.filter((r) => r.id !== referenceId),
      }));
    },
    [updateGroup],
  );

  const updateReferenceCiteKey = useCallback(
    (groupId: string, referenceId: string, citeKey: string) => {
      pristine?.markDirty(groupId);
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.map((r) =>
          r.id === referenceId ? { ...r, citeKey } : r,
        ),
      }));
    },
    [updateGroup, pristine],
  );

  // --- Quote ops ---

  const addQuote = useCallback(
    (groupId: string, referenceId: string) => {
      pristine?.markDirty(groupId);
      const newQuote = makeQuote();
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.map((r) =>
          r.id === referenceId ? { ...r, quotes: [...r.quotes, newQuote] } : r,
        ),
      }));
      return newQuote.id;
    },
    [updateGroup, pristine],
  );

  const updateQuote = useCallback(
    (
      groupId: string,
      referenceId: string,
      quoteId: string,
      fields: Partial<Pick<Quote, "text" | "page">>,
    ) => {
      pristine?.markDirty(groupId);
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.map((r) =>
          r.id === referenceId
            ? {
                ...r,
                quotes: r.quotes.map((q) =>
                  q.id === quoteId ? { ...q, ...fields } : q,
                ),
              }
            : r,
        ),
      }));
    },
    [updateGroup, pristine],
  );

  const deleteQuote = useCallback(
    (groupId: string, referenceId: string, quoteId: string) => {
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.map((r) =>
          r.id === referenceId
            ? { ...r, quotes: r.quotes.filter((q) => q.id !== quoteId) }
            : r,
        ),
      }));
    },
    [updateGroup],
  );

  return {
    groups: state.groups,
    addGroup,
    deleteGroup,
    updateGroupTitle,
    updateNotes,
    addParagraphId,
    removeParagraphId,
    addReference,
    deleteReference,
    updateReferenceCiteKey,
    addQuote,
    updateQuote,
    deleteQuote,
  };
}
