"use client";

import { useCallback, useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import type { NotesState, UserNote } from "@/lib/types";
import { normalizeRichContent, emptyRichContent } from "@/lib/footnote-content";
import {
  addParagraphLink,
  clearTextAnchorLink,
  getTextAnchor,
  removeParagraphLink,
  setTextAnchorLink,
} from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import { nextCardTitle } from "@/panels/panel-registry";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: NotesState = { notes: [] };

function migrateNote(raw: unknown): UserNote {
  const r = raw as Partial<UserNote>;
  return {
    id: r.id!,
    title: typeof r.title === "string" ? r.title : "",
    content: normalizeRichContent(r.content),
    createdAt: r.createdAt!,
    links: migrateCardLinks("note", raw),
  };
}

function migrateNotes(raw: unknown): NotesState {
  const s = raw as Partial<NotesState>;
  return { notes: Array.isArray(s.notes) ? s.notes.map(migrateNote) : [] };
}

export function useNotes(docId: string | null, externalPristine?: PristineKindApi | null) {
  const { state, update } = usePersistentState<NotesState>(
    docId,
    "notes.json",
    EMPTY_STATE,
    { migrate: migrateNotes, errorLabel: "notes" },
  );
  const localPristine = usePristineTracker();
  const pristine = externalPristine ?? localPristine;

  const addNote = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
    ) => {
      let newNote: UserNote = {
        id: generateEntityId(),
        title: nextCardTitle("note", state.notes.length),
        content: content ?? emptyRichContent(),
        createdAt: new Date().toISOString(),
        links: [],
      };
      if (paragraphId) newNote = addParagraphLink(newNote, "note", paragraphId);
      if (anchor) {
        newNote = setTextAnchorLink(newNote, "note", anchor.anchorId, anchor.anchorText);
      }
      // Only a truly blank note (no content, no anchor, no paragraph) is
      // pristine — a note seeded from a drop or selection counts as
      // "written to" since the user already committed an intent.
      if (!content && !anchor && !paragraphId) pristine.markNew(newNote.id);
      update((prev) => ({ notes: [...prev.notes, newNote] }));
      return newNote;
    },
    [update, pristine, state.notes.length],
  );

  const setNoteAnchor = useCallback(
    (id: string, anchorId: string, anchorText: string) => {
      update((prev) => ({
        notes: prev.notes.map((n) =>
          n.id === id ? setTextAnchorLink(n, "note", anchorId, anchorText) : n,
        ),
      }));
    },
    [update],
  );

  const clearNoteAnchor = useCallback(
    (anchorId: string) => {
      update((prev) => {
        if (!prev.notes.some((n) => getTextAnchor(n)?.anchorId === anchorId)) {
          return prev;
        }
        return {
          notes: prev.notes.map((n) =>
            getTextAnchor(n)?.anchorId === anchorId
              ? clearTextAnchorLink(n, "note")
              : n,
          ),
        };
      });
    },
    [update],
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
      pristine.markDirty(id);
      update((prev) => ({
        notes: prev.notes.map((n) => (n.id === id ? { ...n, content } : n)),
      }));
    },
    [update, pristine],
  );

  const updateNoteTitle = useCallback(
    (id: string, title: string) => {
      pristine.markDirty(id);
      update((prev) => ({
        notes: prev.notes.map((n) => (n.id === id ? { ...n, title } : n)),
      }));
    },
    [update, pristine],
  );

  const addNoteParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        notes: prev.notes.map((n) =>
          n.id === id ? addParagraphLink(n, "note", paragraphId) : n,
        ),
      }));
    },
    [update],
  );

  const removeNoteParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        notes: prev.notes.map((n) =>
          n.id === id ? removeParagraphLink(n, paragraphId) : n,
        ),
      }));
    },
    [update],
  );

  const deleteNote = useCallback(
    (id: string) => {
      pristine.markDirty(id);
      update((prev) => ({ notes: prev.notes.filter((n) => n.id !== id) }));
    },
    [update, pristine],
  );

  /**
   * Drop any notes that were created via `addNote()` but never edited.
   * Call from panel-close / host-unmount so "press +, do nothing, leave"
   * does not leave a blank card behind. When the external pristine manager
   * is in use, it owns discard via the registered delete callback.
   */
  const discardPristineNotes = useCallback(() => {
    if (externalPristine) {
      externalPristine.discardAll();
      return;
    }
    const ids = localPristine.takePristine();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    update((prev) => ({ notes: prev.notes.filter((n) => !idSet.has(n.id)) }));
  }, [update, externalPristine, localPristine]);

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
    discardPristineNotes,
  };
}
