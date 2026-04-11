"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage-fsa";
import type { ArchiveState, ArchivedSnippet } from "@/lib/types";

const EMPTY: ArchiveState = { snippets: [] };

export function useArchive(docId: string | null) {
  const [state, setState] = useState<ArchiveState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const docRef = useRef(docId);

  useEffect(() => {
    docRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    readSidecar<ArchiveState>(docId, "archive.json", EMPTY)
      .then((data) => {
        if (docRef.current === docId && data.snippets) setState(data);
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (s: ArchiveState) => {
    const id = docRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, "archive.json", s);
    } catch (err) {
      console.error("Failed to save archive:", err);
    }
  }, []);

  const archiveText = useCallback((text: string): ArchivedSnippet => {
    const snippet: ArchivedSnippet = {
      id: generateEntityId(),
      text,
      createdAt: new Date().toISOString(),
    };
    setState((prev) => {
      const next = { snippets: [...prev.snippets, snippet] };
      persist(next);
      return next;
    });
    return snippet;
  }, [persist]);

  const restoreSnippet = useCallback((id: string): ArchivedSnippet | null => {
    // Read directly from the ref to avoid React batching issues
    const current = stateRef.current;
    const found = current.snippets.find((s) => s.id === id) || null;
    if (found) {
      const next = { snippets: current.snippets.filter((s) => s.id !== id) };
      stateRef.current = next;
      setState(next);
      persist(next);
    }
    return found;
  }, [persist]);

  const deleteSnippet = useCallback((id: string) => {
    setState((prev) => {
      const next = { snippets: prev.snippets.filter((s) => s.id !== id) };
      persist(next);
      return next;
    });
  }, [persist]);

  return {
    snippets: state.snippets,
    archiveText,
    restoreSnippet,
    deleteSnippet,
  };
}
