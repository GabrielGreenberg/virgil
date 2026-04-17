"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type { NotesState, UserNote } from "@/lib/types";
import { normalizeRichContent, emptyRichContent } from "@/lib/footnote-content";

const EMPTY_STATE: NotesState = { notes: [] };

export function useNotes(docId: string | null) {
  const [state, setState] = useState<NotesState>(EMPTY_STATE);
  const currentDocIdRef = useRef(docId);

  useEffect(() => {
    currentDocIdRef.current = docId;
    if (!docId) {
      setState(EMPTY_STATE);
      return;
    }

    readSidecar<NotesState>(docId, "notes.json", EMPTY_STATE)
      .then((data) => {
        if (currentDocIdRef.current !== docId || !data.notes) return;
        // Migrate legacy notes:
        //   - missing `title`  → coerce to ""
        //   - HTML string body → convert to JSONContent
        //   - anchorPositions (old number[]) → paragraphIds (string[])
        //     Legacy positions are dropped — notes that still have numeric
        //     anchors will appear un-anchored until re-dropped. This is safe
        //     because numeric positions are unstable across edits anyway.
        const migrated: NotesState = {
          notes: data.notes.map((n) => {
            const raw = n as UserNote & { anchorPos?: number; anchorPositions?: number[] };
            return {
              id: raw.id,
              title: typeof raw.title === "string" ? raw.title : "",
              content: normalizeRichContent(raw.content),
              createdAt: raw.createdAt,
              paragraphIds: Array.isArray(raw.paragraphIds)
                ? raw.paragraphIds
                : [], // drop legacy numeric anchors
              anchorId: typeof raw.anchorId === "string" ? raw.anchorId : undefined,
              anchorText: typeof raw.anchorText === "string" ? raw.anchorText : undefined,
            };
          }) as UserNote[],
        };
        setState(migrated);
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (newState: NotesState) => {
    const id = currentDocIdRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, "notes.json", newState);
    } catch (err) {
      console.error("Failed to save notes:", err);
    }
  }, []);

  const addNote = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
    ) => {
      const newNote: UserNote = {
        id: generateEntityId(),
        title: "",
        content: content ?? emptyRichContent(),
        paragraphIds: paragraphId ? [paragraphId] : [],
        createdAt: new Date().toISOString(),
        anchorId: anchor?.anchorId,
        anchorText: anchor?.anchorText,
      };
      setState((prev) => {
        const newState = { notes: [...prev.notes, newNote] };
        persist(newState);
        return newState;
      });
      return newNote;
    },
    [persist]
  );

  const setNoteAnchor = useCallback(
    (id: string, anchorId: string, anchorText: string) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.map((n) =>
            n.id === id ? { ...n, anchorId, anchorText } : n,
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist],
  );

  const clearNoteAnchor = useCallback(
    (anchorId: string) => {
      setState((prev) => {
        if (!prev.notes.some((n) => n.anchorId === anchorId)) return prev;
        const newState = {
          notes: prev.notes.map((n) =>
            n.anchorId === anchorId ? { ...n, anchorId: undefined } : n,
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist],
  );

  // Orphan listener — when the mark vanishes from the doc, clear the dead id
  // on the matching note (keep the note; it becomes un-anchored).
  useEffect(() => {
    const handler = (e: Event) => {
      const { anchorId, kind } = (e as CustomEvent).detail || {};
      if (kind !== "note" || !anchorId) return;
      clearNoteAnchor(anchorId);
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [clearNoteAnchor]);

  const updateNote = useCallback(
    (id: string, content: JSONContent) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.map((n) =>
            n.id === id ? { ...n, content } : n
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const updateNoteTitle = useCallback(
    (id: string, title: string) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.map((n) =>
            n.id === id ? { ...n, title } : n
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const addNoteParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.map((n) =>
            n.id === id && !n.paragraphIds.includes(paragraphId)
              ? { ...n, paragraphIds: [...n.paragraphIds, paragraphId] }
              : n
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const removeNoteParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.map((n) =>
            n.id === id
              ? { ...n, paragraphIds: n.paragraphIds.filter((p) => p !== paragraphId) }
              : n
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const deleteNote = useCallback(
    (id: string) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.filter((n) => n.id !== id),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  return {
    notes: state.notes,
    addNote,
    updateNote,
    updateNoteTitle,
    addNoteParagraphId,
    removeNoteParagraphId,
    deleteNote,
    setNoteAnchor,
    clearNoteAnchor,
  };
}
