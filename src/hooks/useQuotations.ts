"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import type {
  QuotationsState,
  QuotationGroup,
  Reference,
  Quote,
} from "@/lib/types";
import { migrateQuotationsState } from "@/lib/migrate-quotations";

const EMPTY_STATE: QuotationsState = { groups: [] };

function makeQuote(text = "", page = ""): Quote {
  return { id: uuid(), text, page };
}

function makeReference(citeKey = "", quotes?: Quote[]): Reference {
  return {
    id: uuid(),
    citeKey,
    quotes: quotes && quotes.length ? quotes : [makeQuote()],
  };
}

export function useQuotations(docId: string | null) {
  const [state, setState] = useState<QuotationsState>(EMPTY_STATE);
  const currentDocIdRef = useRef(docId);

  useEffect(() => {
    currentDocIdRef.current = docId;
    if (!docId) {
      setState(EMPTY_STATE);
      return;
    }

    fetch(`/api/quotations?docId=${docId}`)
      .then((r) => r.json())
      .then((data) => {
        if (currentDocIdRef.current === docId) {
          // Belt-and-suspenders: route already migrates, but if a stale
          // file slips through we still want a clean shape on the client.
          setState(migrateQuotationsState(data));
        }
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (newState: QuotationsState) => {
    const id = currentDocIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/quotations?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newState),
      });
    } catch (err) {
      console.error("Failed to save quotations:", err);
    }
  }, []);

  // Helper to update one group and persist atomically.
  const updateGroup = useCallback(
    (groupId: string, mutate: (g: QuotationGroup) => QuotationGroup) => {
      setState((prev) => {
        const newState = {
          groups: prev.groups.map((g) => (g.id === groupId ? mutate(g) : g)),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  // --- Group ops ---

  const addGroup = useCallback(
    (init?: { text?: string; paragraphId?: string | null }) => {
      const newGroup: QuotationGroup = {
        id: uuid(),
        title: "",
        references: [makeReference("", [makeQuote(init?.text ?? "")])],
        paragraphId: init?.paragraphId ?? null,
        notes: "",
        createdAt: new Date().toISOString(),
      };
      setState((prev) => {
        const newState = { groups: [newGroup, ...prev.groups] };
        persist(newState);
        return newState;
      });
      return newGroup;
    },
    [persist]
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      setState((prev) => {
        const newState = { groups: prev.groups.filter((g) => g.id !== groupId) };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const updateGroupTitle = useCallback(
    (groupId: string, title: string) => {
      updateGroup(groupId, (g) => ({ ...g, title }));
    },
    [updateGroup]
  );

  const updateNotes = useCallback(
    (groupId: string, notes: string) => {
      updateGroup(groupId, (g) => ({ ...g, notes }));
    },
    [updateGroup]
  );

  const setParagraphId = useCallback(
    (groupId: string, paragraphId: string | null) => {
      updateGroup(groupId, (g) => ({ ...g, paragraphId }));
    },
    [updateGroup]
  );

  // --- Reference ops ---

  const addReference = useCallback(
    (groupId: string) => {
      const newRef = makeReference();
      updateGroup(groupId, (g) => ({
        ...g,
        references: [...g.references, newRef],
      }));
      return newRef.id;
    },
    [updateGroup]
  );

  const deleteReference = useCallback(
    (groupId: string, referenceId: string) => {
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.filter((r) => r.id !== referenceId),
      }));
    },
    [updateGroup]
  );

  const updateReferenceCiteKey = useCallback(
    (groupId: string, referenceId: string, citeKey: string) => {
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.map((r) =>
          r.id === referenceId ? { ...r, citeKey } : r
        ),
      }));
    },
    [updateGroup]
  );

  // --- Quote ops ---

  const addQuote = useCallback(
    (groupId: string, referenceId: string) => {
      const newQuote = makeQuote();
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.map((r) =>
          r.id === referenceId ? { ...r, quotes: [...r.quotes, newQuote] } : r
        ),
      }));
      return newQuote.id;
    },
    [updateGroup]
  );

  const updateQuote = useCallback(
    (
      groupId: string,
      referenceId: string,
      quoteId: string,
      fields: Partial<Pick<Quote, "text" | "page">>
    ) => {
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.map((r) =>
          r.id === referenceId
            ? {
                ...r,
                quotes: r.quotes.map((q) =>
                  q.id === quoteId ? { ...q, ...fields } : q
                ),
              }
            : r
        ),
      }));
    },
    [updateGroup]
  );

  const deleteQuote = useCallback(
    (groupId: string, referenceId: string, quoteId: string) => {
      updateGroup(groupId, (g) => ({
        ...g,
        references: g.references.map((r) =>
          r.id === referenceId
            ? { ...r, quotes: r.quotes.filter((q) => q.id !== quoteId) }
            : r
        ),
      }));
    },
    [updateGroup]
  );

  return {
    groups: state.groups,
    addGroup,
    deleteGroup,
    updateGroupTitle,
    updateNotes,
    setParagraphId,
    addReference,
    deleteReference,
    updateReferenceCiteKey,
    addQuote,
    updateQuote,
    deleteQuote,
  };
}
