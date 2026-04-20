"use client";

/**
 * Per-doc overlay for the library. Holds notes the user wrote about a
 * library item, scoped to the current document (different docs can have
 * different notes on the same PDF). Persisted as `library-overlay.json`
 * in the doc's `virgil/` sidecar folder.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readSidecar, writeSidecar } from "@/lib/storage";
import {
  EMPTY_LIBRARY_OVERLAY,
  type LibraryOverlay,
} from "@/lib/library/library-types";

const SIDECAR = "library-overlay.json";

export function useLibraryOverlay(docId: string | null) {
  const [state, setState] = useState<LibraryOverlay>(EMPTY_LIBRARY_OVERLAY);
  const docRef = useRef(docId);

  useEffect(() => {
    docRef.current = docId;
    if (!docId) {
      setState(EMPTY_LIBRARY_OVERLAY);
      return;
    }
    readSidecar<LibraryOverlay>(docId, SIDECAR, EMPTY_LIBRARY_OVERLAY)
      .then((data) => {
        if (docRef.current === docId && data) {
          setState({
            notesByItemId: data.notesByItemId ?? {},
          });
        }
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (next: LibraryOverlay) => {
    const id = docRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, SIDECAR, next);
    } catch (err) {
      console.error("Failed to save library overlay:", err);
    }
  }, []);

  const setItemNotes = useCallback(
    (itemId: string, notes: string) => {
      setState((prev) => {
        const nextMap = { ...prev.notesByItemId };
        if (notes.trim().length === 0) {
          delete nextMap[itemId];
        } else {
          nextMap[itemId] = notes;
        }
        const next: LibraryOverlay = { notesByItemId: nextMap };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const getItemNotes = useCallback(
    (itemId: string): string => state.notesByItemId[itemId] ?? "",
    [state.notesByItemId],
  );

  return {
    notesByItemId: state.notesByItemId,
    getItemNotes,
    setItemNotes,
  };
}
