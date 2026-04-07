"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import { v4 as uuid } from "uuid";
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

    fetch(`/api/notes?docId=${docId}`)
      .then((r) => r.json())
      .then((data: NotesState) => {
        if (currentDocIdRef.current !== docId || !data.notes) return;
        // Migrate legacy notes:
        //   - missing `title`  → coerce to ""
        //   - HTML string body → convert to JSONContent
        const migrated: NotesState = {
          notes: data.notes.map((n) => ({
            ...n,
            title: typeof n.title === "string" ? n.title : "",
            content: normalizeRichContent(n.content),
          })),
        };
        setState(migrated);
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (newState: NotesState) => {
    const id = currentDocIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/notes?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newState),
      });
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
        anchorPos,
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

  const updateNotePosition = useCallback(
    (id: string, anchorPos: number) => {
      setState((prev) => {
        const newState = {
          notes: prev.notes.map((n) =>
            n.id === id ? { ...n, anchorPos } : n
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
    updateNotePosition,
    deleteNote,
  };
}
