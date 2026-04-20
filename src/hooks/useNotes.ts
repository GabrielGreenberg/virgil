"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type { NotesState, UserNote } from "@/lib/types";
import { normalizeRichContent, emptyRichContent } from "@/lib/footnote-content";
import {
  addParagraphLink,
  clearTextAnchorLink,
  derivedLinksForCard,
  getTextAnchor,
  removeParagraphLink,
  setTextAnchorLink,
} from "@/links/links";

const EMPTY_STATE: NotesState = { notes: [] };

/** Migrate a raw sidecar record into the canonical `links`-only shape. */
function migrateNote(raw: unknown): UserNote {
  const r = raw as Partial<UserNote> & {
    anchorPos?: number;
    anchorPositions?: number[];
    paragraphIds?: string[];
    anchorId?: string;
    anchorText?: string;
  };
  // If the sidecar already carries `links`, trust it.
  if (Array.isArray(r.links) && r.links.length > 0) {
    return {
      id: r.id!,
      title: typeof r.title === "string" ? r.title : "",
      content: normalizeRichContent(r.content),
      createdAt: r.createdAt!,
      links: r.links,
    };
  }
  // Otherwise synthesize from legacy fields.
  const base: UserNote = {
    id: r.id!,
    title: typeof r.title === "string" ? r.title : "",
    content: normalizeRichContent(r.content),
    createdAt: r.createdAt!,
    links: [],
  };
  base.links = derivedLinksForCard("note", {
    id: base.id,
    paragraphIds: Array.isArray(r.paragraphIds) ? r.paragraphIds : [],
    anchorId: typeof r.anchorId === "string" ? r.anchorId : undefined,
    anchorText: typeof r.anchorText === "string" ? r.anchorText : undefined,
  });
  return base;
}

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
        setState({ notes: data.notes.map(migrateNote) });
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
      let newNote: UserNote = {
        id: generateEntityId(),
        title: "",
        content: content ?? emptyRichContent(),
        createdAt: new Date().toISOString(),
        links: [],
      };
      if (paragraphId) newNote = addParagraphLink(newNote, "note", paragraphId);
      if (anchor) {
        newNote = setTextAnchorLink(newNote, "note", anchor.anchorId, anchor.anchorText);
      }
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
            n.id === id ? setTextAnchorLink(n, "note", anchorId, anchorText) : n,
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
        if (!prev.notes.some((n) => getTextAnchor(n)?.anchorId === anchorId)) {
          return prev;
        }
        const newState = {
          notes: prev.notes.map((n) =>
            getTextAnchor(n)?.anchorId === anchorId
              ? clearTextAnchorLink(n, "note")
              : n,
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
            n.id === id ? addParagraphLink(n, "note", paragraphId) : n,
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
            n.id === id ? removeParagraphLink(n, paragraphId) : n,
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
