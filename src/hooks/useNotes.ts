"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import type {
  HighlightCard,
  NoteCardItem,
  NotesState,
  UserNote,
} from "@/lib/types";
import { normalizeRichContent, emptyRichContent } from "@/lib/footnote-content";
import {
  addTextObjectLink,
  clearTextAnchorLink,
  getLinkedTextObjectIds,
  getTextAnchor,
  removeTextObjectLink,
  setTextAnchorLink,
} from "@/links/links";
import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import { migrateCardLinks } from "@/links/migrate-card";
import { nextCardTitle } from "@/panels/panel-registry";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: NotesState = { cards: [] };

function migrateNote(raw: unknown): UserNote {
  const r = (raw ?? {}) as Partial<UserNote>;
  return {
    kind: "note",
    id: r.id!,
    title: typeof r.title === "string" ? r.title : "",
    content: normalizeRichContent(r.content),
    createdAt: r.createdAt!,
    aiRequest: !!r.aiRequest,
    links: migrateCardLinks("note", raw),
  };
}

function migrateHighlight(raw: unknown): HighlightCard {
  const r = (raw ?? {}) as Partial<HighlightCard> & { highlightColor?: unknown };
  return {
    kind: "highlight",
    id: r.id!,
    createdAt: r.createdAt!,
    highlightColor:
      typeof r.highlightColor === "string" ? r.highlightColor : null,
    aiRequest: !!r.aiRequest,
    links: migrateCardLinks("highlight", raw),
  };
}

function migrateCard(raw: unknown): NoteCardItem | null {
  const r = (raw ?? {}) as { kind?: string; id?: string };
  if (!r.id) return null;
  if (r.kind === "highlight") return migrateHighlight(raw);
  return migrateNote(raw);
}

function migrateNotes(raw: unknown): NotesState {
  const s = (raw ?? {}) as { cards?: unknown; notes?: unknown };
  if (Array.isArray(s.cards)) {
    return {
      cards: s.cards
        .map(migrateCard)
        .filter((c): c is NoteCardItem => c !== null),
    };
  }
  // Legacy { notes: UserNote[] } sidecars — stamp kind: "note" on each.
  if (Array.isArray(s.notes)) {
    return { cards: s.notes.map(migrateNote) };
  }
  return { cards: [] };
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

  const cards = state.cards;
  const notes = useMemo(
    () => cards.filter((c): c is UserNote => c.kind === "note"),
    [cards],
  );
  const highlights = useMemo(
    () => cards.filter((c): c is HighlightCard => c.kind === "highlight"),
    [cards],
  );

  const addNote = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
      targetKind?: import("@/text-objects/types").TextObjectKind,
    ) => {
      let newNote: UserNote = {
        kind: "note",
        id: generateEntityId(),
        title: nextCardTitle("note", notes.length),
        content: content ?? emptyRichContent(),
        createdAt: new Date().toISOString(),
        aiRequest: false,
        links: [],
      };
      if (paragraphId) newNote = addTextObjectLink(newNote, "note", paragraphId, targetKind);
      if (anchor) {
        newNote = setTextAnchorLink(newNote, "note", anchor.anchorId, anchor.anchorText);
      }
      // Only a truly blank note (no content, no anchor, no paragraph) is
      // pristine — a note seeded from a drop or selection counts as
      // "written to" since the user already committed an intent.
      if (!content && !anchor && !paragraphId) pristine.markNew(newNote.id);
      update((prev) => ({ cards: [...prev.cards, newNote] }));
      return newNote;
    },
    [update, pristine, notes.length],
  );

  const addHighlight = useCallback(
    (
      anchor: { anchorId: string; anchorText: string },
      paragraphId: string | null,
      color?: string | null,
    ): HighlightCard => {
      let newCard: HighlightCard = {
        kind: "highlight",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        highlightColor: color ?? null,
        aiRequest: false,
        links: [],
      };
      if (paragraphId) {
        newCard = addTextObjectLink(newCard, "highlight", paragraphId);
      }
      newCard = setTextAnchorLink(
        newCard,
        "highlight",
        anchor.anchorId,
        anchor.anchorText,
      );
      update((prev) => ({ cards: [...prev.cards, newCard] }));
      return newCard;
    },
    [update],
  );

  const setNoteAnchor = useCallback(
    (id: string, anchorId: string, anchorText: string) => {
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "note"
            ? setTextAnchorLink(c, "note", anchorId, anchorText)
            : c,
        ),
      }));
    },
    [update],
  );

  // Orphan listener — when the mark vanishes from the doc, clear the dead
  // anchor on the matching card (note or highlight). Highlights with no
  // anchor are kept; the card stays orphaned in the panel until deleted.
  const clearCardAnchor = useCallback(
    (anchorId: string) => {
      update((prev) => {
        if (!prev.cards.some((c) => getTextAnchor(c)?.anchorId === anchorId)) {
          return prev;
        }
        return {
          cards: prev.cards.map((c) => {
            if (getTextAnchor(c)?.anchorId !== anchorId) return c;
            if (c.kind === "note") return clearTextAnchorLink(c, "note");
            if (c.kind === "highlight") return clearTextAnchorLink(c, "highlight");
            return c;
          }),
        };
      });
    },
    [update],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const { anchorId, kind } = (e as CustomEvent).detail || {};
      if (!anchorId) return;
      if (kind !== "note" && kind !== "highlight") return;
      clearCardAnchor(anchorId);
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [clearCardAnchor]);

  const updateNote = useCallback(
    (id: string, content: JSONContent) => {
      pristine.markDirty(id);
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "note" ? { ...c, content } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const updateNoteTitle = useCallback(
    (id: string, title: string) => {
      pristine.markDirty(id);
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "note" ? { ...c, title } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const setNoteAiRequest = useCallback(
    (id: string, value: boolean) => {
      pristine.markDirty(id);
      const note = notes.find((n) => n.id === id);
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "note" ? { ...c, aiRequest: value } : c,
        ),
      }));
      if (note) {
        void bridgeCardAiRequestFlag(
          docId,
          { panel: "notes", cardId: id },
          value,
          {
            kind: "note",
            text: note.title || "<note>",
            paragraphIds: getLinkedTextObjectIds(note),
            selectedText: getTextAnchor(note)?.anchorText,
          },
        );
      }
    },
    [update, pristine, docId, notes],
  );

  const setHighlightAiRequest = useCallback(
    (id: string, value: boolean) => {
      const card = highlights.find((h) => h.id === id);
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "highlight" ? { ...c, aiRequest: value } : c,
        ),
      }));
      if (card) {
        const anchorText = getTextAnchor(card)?.anchorText || "";
        void bridgeCardAiRequestFlag(
          docId,
          { panel: "notes", cardId: id },
          value,
          {
            kind: "highlight",
            text: anchorText || "<highlight>",
            paragraphIds: getLinkedTextObjectIds(card),
            selectedText: anchorText,
          },
        );
      }
    },
    [update, docId, highlights],
  );

  const addNoteTextObjectId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "note"
            ? addTextObjectLink(c, "note", paragraphId)
            : c,
        ),
      }));
    },
    [update],
  );

  const removeNoteTextObjectId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "note"
            ? removeTextObjectLink(c, paragraphId)
            : c,
        ),
      }));
    },
    [update],
  );

  const addHighlightTextObjectId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "highlight"
            ? addTextObjectLink(c, "highlight", paragraphId)
            : c,
        ),
      }));
    },
    [update],
  );

  const removeHighlightTextObjectId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "highlight"
            ? removeTextObjectLink(c, paragraphId)
            : c,
        ),
      }));
    },
    [update],
  );

  /**
   * Phase 4 sidecar capture: before drop mode strips a Mode B anchor
   * (text-range) from a note or highlight, save the original anchor
   * data onto the card so future UX can restore the range. No-op if
   * the card has no textRange (Mode A already). Returns the captured
   * `anchorId` if any, so callers can clean up the linkedAnchor mark
   * in the editor after the re-anchor lands.
   */
  const preserveModeBAnchor = useCallback(
    (id: string): string | null => {
      const card = cards.find((c) => c.id === id);
      if (!card) return null;
      const textAnchor = getTextAnchor(card);
      if (!textAnchor) return null;
      const original: import("@/lib/types").OriginalAnchor = {
        droppedAt: new Date().toISOString(),
        anchorId: textAnchor.anchorId,
        textSnapshot: textAnchor.anchorText,
        paragraphIds: getLinkedTextObjectIds(card),
      };
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && (c.kind === "note" || c.kind === "highlight")
            ? { ...c, originalAnchor: original }
            : c,
        ),
      }));
      return textAnchor.anchorId;
    },
    [cards, update],
  );

  const deleteNote = useCallback(
    (id: string) => {
      pristine.markDirty(id);
      update((prev) => ({ cards: prev.cards.filter((c) => c.id !== id) }));
    },
    [update, pristine],
  );

  /** Deep-copy a note sidecar entry with a fresh id. Returns the new id,
   *  or null if the source wasn't a note. Links are cleared so the clone
   *  starts without stale paragraph or anchor references; the duplicator
   *  walker rewires anchors after the slice is inserted. */
  const cloneNote = useCallback(
    (sourceId: string): string | null => {
      const source = cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "note") return null;
      const clone: UserNote = {
        kind: "note",
        id: generateEntityId(),
        title: source.title,
        content: normalizeRichContent(source.content),
        createdAt: new Date().toISOString(),
        aiRequest: false,
        links: [],
      };
      update((prev) => ({ cards: [...prev.cards, clone] }));
      return clone.id;
    },
    [update, cards],
  );

  /** Deep-copy a highlight sidecar entry with a fresh id. Same shape as
   *  cloneNote — links cleared, walker rewires after insertion. */
  const cloneHighlight = useCallback(
    (sourceId: string): string | null => {
      const source = cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "highlight") return null;
      const clone: HighlightCard = {
        kind: "highlight",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        highlightColor: source.highlightColor,
        aiRequest: false,
        links: [],
      };
      update((prev) => ({ cards: [...prev.cards, clone] }));
      return clone.id;
    },
    [update, cards],
  );

  /** Re-attach a Mode B text-range anchor on a freshly-cloned note or
   *  highlight. Called by the duplicate dispatcher's post-insert walker
   *  for every linkedAnchor mark inside the cloned slice. Idempotent:
   *  if the card already carries this anchorId, no-op. */
  const bindAnchor = useCallback(
    (id: string, _paragraphId: string, anchorId: string, anchorText: string) => {
      update((prev) => {
        const card = prev.cards.find((c) => c.id === id);
        if (!card) return prev;
        const existing = getTextAnchor(card);
        if (existing?.anchorId === anchorId) return prev;
        const kind = card.kind === "highlight" ? "highlight" : "note";
        return {
          cards: prev.cards.map((c) =>
            c.id === id ? setTextAnchorLink(c, kind, anchorId, anchorText) : c,
          ),
        };
      });
    },
    [update],
  );

  /**
   * Drop any notes that were created via `addNote()` but never edited.
   * Call from panel-close / host-unmount so "press +, do nothing, leave"
   * does not leave a blank card behind. Highlights are never pristine —
   * they always carry a text anchor.
   */
  const discardPristineNotes = useCallback(() => {
    if (externalPristine) {
      externalPristine.discardAll();
      return;
    }
    const ids = localPristine.takePristine();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    update((prev) => ({ cards: prev.cards.filter((c) => !idSet.has(c.id)) }));
  }, [update, externalPristine, localPristine]);

  return {
    cards,
    notes,
    highlights,
    addNote,
    addHighlight,
    updateNote,
    updateNoteTitle,
    setNoteAiRequest,
    setHighlightAiRequest,
    addNoteTextObjectId,
    removeNoteTextObjectId,
    addHighlightTextObjectId,
    removeHighlightTextObjectId,
    preserveModeBAnchor,
    deleteNote,
    cloneNote,
    cloneHighlight,
    bindAnchor,
    setNoteAnchor,
    clearNoteAnchor: clearCardAnchor,
    discardPristineNotes,
  };
}
