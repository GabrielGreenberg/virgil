"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { BibSettings, BibEntryRequest } from "@/lib/types";

const EMPTY: BibSettings = { generalBibPath: null, entryRequests: [] };

export function useBibSettings(docId: string | null) {
  const [state, setState] = useState<BibSettings>(EMPTY);
  const docIdRef = useRef(docId);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    fetch(`/api/bib-settings?docId=${docId}`)
      .then((r) => r.json())
      .then((data: BibSettings) => {
        if (docIdRef.current === docId) setState(data ?? EMPTY);
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (s: BibSettings) => {
    const id = docIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/bib-settings?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
    } catch (err) {
      console.error("Failed to save bib settings:", err);
    }
  }, []);

  const setGeneralBibPath = useCallback((path: string | null) => {
    setState((prev) => {
      const next = { ...prev, generalBibPath: path };
      persist(next);
      return next;
    });
  }, [persist]);

  const addEntryRequest = useCallback((description: string) => {
    const req: BibEntryRequest = {
      id: uuid(),
      description,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    setState((prev) => {
      const next = { ...prev, entryRequests: [...prev.entryRequests, req] };
      persist(next);
      return next;
    });
  }, [persist]);

  const removeEntryRequest = useCallback((id: string) => {
    setState((prev) => {
      const next = { ...prev, entryRequests: prev.entryRequests.filter((r) => r.id !== id) };
      persist(next);
      return next;
    });
  }, [persist]);

  return {
    generalBibPath: state.generalBibPath,
    entryRequests: state.entryRequests,
    setGeneralBibPath,
    addEntryRequest,
    removeEntryRequest,
  };
}
