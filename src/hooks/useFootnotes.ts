"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { FootnotesState, FootnoteRef } from "@/lib/types";

const EMPTY: FootnotesState = { footnotes: [] };

export function useFootnotes(docId: string | null) {
  const [state, setState] = useState<FootnotesState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const docRef = useRef(docId);

  useEffect(() => {
    docRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    fetch(`/api/footnotes?docId=${docId}`)
      .then((r) => r.json())
      .then((data: FootnotesState) => {
        if (docRef.current === docId && data.footnotes) setState(data);
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (s: FootnotesState) => {
    const id = docRef.current;
    if (!id) return;
    try {
      await fetch(`/api/footnotes?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
    } catch (err) {
      console.error("Failed to save footnotes:", err);
    }
  }, []);

  const addFootnote = useCallback((content: string, existingId?: string): FootnoteRef => {
    const ref: FootnoteRef = {
      id: existingId || crypto.randomUUID(),
      content,
      createdAt: new Date().toISOString(),
    };
    // Skip if already registered
    const current = stateRef.current;
    if (current.footnotes.some((f) => f.id === ref.id)) return ref;
    const next = { footnotes: [...current.footnotes, ref] };
    stateRef.current = next;
    setState(next);
    persist(next);
    return ref;
  }, [persist]);

  const updateFootnoteContent = useCallback((id: string, content: string) => {
    setState((prev) => {
      const next = {
        footnotes: prev.footnotes.map((f) =>
          f.id === id ? { ...f, content } : f
        ),
      };
      stateRef.current = next;
      persist(next);
      return next;
    });
  }, [persist]);

  const deleteFootnote = useCallback((id: string) => {
    setState((prev) => {
      const next = { footnotes: prev.footnotes.filter((f) => f.id !== id) };
      stateRef.current = next;
      persist(next);
      return next;
    });
  }, [persist]);

  const syncFromEditor = useCallback(
    (editorFootnotes: Array<{ footnoteId: string; content: string }>) => {
      const current = stateRef.current;
      const existingIds = new Set(current.footnotes.map((f) => f.id));
      const editorIds = new Set(editorFootnotes.map((f) => f.footnoteId));

      // Keep unanchored footnotes (in state but not in editor)
      const unanchored = current.footnotes.filter((f) => !editorIds.has(f.id));

      // Build list from editor footnotes (canonical for anchored)
      const anchored: FootnoteRef[] = editorFootnotes.map((ef) => {
        const existing = current.footnotes.find((f) => f.id === ef.footnoteId);
        return existing
          ? { ...existing, content: ef.content }
          : { id: ef.footnoteId, content: ef.content, createdAt: new Date().toISOString() };
      });

      const next = { footnotes: [...anchored, ...unanchored] };
      stateRef.current = next;
      setState(next);
      persist(next);
    },
    [persist]
  );

  return {
    footnoteRefs: state.footnotes,
    addFootnote,
    updateFootnoteContent,
    deleteFootnote,
    syncFromEditor,
  };
}
