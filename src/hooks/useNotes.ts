"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import { v4 as uuid } from "uuid";
import { readSidecar, writeSidecar } from "@/lib/storage-fsa";
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
        const migrated: NotesState = {
          notes: data.notes.map((n) => {
            const raw = n as UserNote & { anchorPos?: number };
            return {
              ...raw,
              title: typeof raw.title === "string" ? raw.title : "",
              content: normalizeRichContent(raw.content),
              // Migrate legacy single anchorPos → anchorPositions array
              anchorPositions: Array.isArray(raw.anchorPositions)
                ? raw.anchorPositions
                : typeof raw.anchorPos === "number"
                  ? [raw.anchorPos]
                  : [0],
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
    (anchorPos: number, content?: JSONContent) => {
      const newNote: UserNote = {
        id: uuid(),
        title: "",
        content: content ?? emptyRichContent(),
        anchorPositions: [anchorPos],
        createdAt: new Date().toISOString(),
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

  const addNoteAnchor = useCallback(
    (id: string, anchorPos: number) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.map((n) =>
            n.id === id && !n.anchorPositions.includes(anchorPos)
              ? { ...n, anchorPositions: [...n.anchorPositions, anchorPos] }
              : n
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const removeNoteAnchor = useCallback(
    (id: string, anchorPos: number) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.map((n) =>
            n.id === id
              ? { ...n, anchorPositions: n.anchorPositions.filter((p) => p !== anchorPos) }
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
    addNoteAnchor,
    removeNoteAnchor,
    deleteNote,
  };
}
