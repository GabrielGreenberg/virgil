"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { QuotationsState, QuotationGroup, Quotation } from "@/lib/types";

const EMPTY_STATE: QuotationsState = { groups: [] };

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
      .then((data: QuotationsState) => {
        if (currentDocIdRef.current === docId && data.groups) {
          setState(data);
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

  const addGroup = useCallback(
    (init?: { text?: string; paragraphId?: string | null }) => {
      const newGroup: QuotationGroup = {
        id: uuid(),
        title: "",
        citeKey: "",
        paragraphId: init?.paragraphId ?? null,
        quotations: [
          { id: uuid(), title: "", text: init?.text ?? "", page: "" },
        ],
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

  const setParagraphId = useCallback(
    (groupId: string, paragraphId: string | null) => {
      setState((prev) => {
        const newState = {
          groups: prev.groups.map((g) =>
            g.id === groupId ? { ...g, paragraphId } : g
          ),
        };
        persist(newState);
        return newState;
      });
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

  const addQuotation = useCallback(
    (groupId: string) => {
      const newQuote: Quotation = { id: uuid(), title: "", text: "", page: "" };
      setState((prev) => {
        const newState = {
          groups: prev.groups.map((g) =>
            g.id === groupId
              ? { ...g, quotations: [...g.quotations, newQuote] }
              : g
          ),
        };
        persist(newState);
        return newState;
      });
      return newQuote.id;
    },
    [persist]
  );

  const updateGroupTitle = useCallback(
    (groupId: string, title: string) => {
      setState((prev) => {
        const newState = {
          groups: prev.groups.map((g) =>
            g.id === groupId ? { ...g, title } : g
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const updateQuotation = useCallback(
    (groupId: string, quotationId: string, fields: Partial<Pick<Quotation, "title" | "text" | "page">>) => {
      setState((prev) => {
        const newState = {
          groups: prev.groups.map((g) =>
            g.id === groupId
              ? {
                  ...g,
                  quotations: g.quotations.map((q) =>
                    q.id === quotationId ? { ...q, ...fields } : q
                  ),
                }
              : g
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const deleteQuotation = useCallback(
    (groupId: string, quotationId: string) => {
      setState((prev) => {
        const newState = {
          groups: prev.groups.map((g) =>
            g.id === groupId
              ? { ...g, quotations: g.quotations.filter((q) => q.id !== quotationId) }
              : g
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const updateCiteKey = useCallback(
    (groupId: string, citeKey: string) => {
      setState((prev) => {
        const newState = {
          groups: prev.groups.map((g) =>
            g.id === groupId ? { ...g, citeKey } : g
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const updateNotes = useCallback(
    (groupId: string, notes: string) => {
      setState((prev) => {
        const newState = {
          groups: prev.groups.map((g) =>
            g.id === groupId ? { ...g, notes } : g
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  return {
    groups: state.groups,
    addGroup,
    deleteGroup,
    updateGroupTitle,
    addQuotation,
    updateQuotation,
    deleteQuotation,
    updateCiteKey,
    updateNotes,
    setParagraphId,
  };
}
