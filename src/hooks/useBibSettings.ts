"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import { readSidecar, writeSidecar } from "@/lib/storage-fsa";
import type { BibSettings, BibEntryRequest } from "@/lib/types";

const EMPTY: BibSettings = { generalBibPath: null, entryRequests: [] };

export function useBibSettings(docId: string | null) {
  const [state, setState] = useState<BibSettings>(EMPTY);
  const docIdRef = useRef(docId);

  const fetchState = useCallback(() => {
    const id = docIdRef.current;
    if (!id) return;
    readSidecar<BibSettings>(id, "bib-settings.json", EMPTY)
      .then((data) => {
        if (docIdRef.current === id) setState(data ?? EMPTY);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    fetchState();
  }, [docId, fetchState]);

  const persist = useCallback(async (s: BibSettings) => {
    const id = docIdRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, "bib-settings.json", s);
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
    refresh: fetchState,
  };
}
