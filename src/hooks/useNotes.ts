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
  hasTextAnchor,
  removeTextObjectLink,
  setTextAnchorLink,
} from "@/links/links";
import { useReconcileModeAAnchors } from "./useReconcileModeAAnchors";
import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import { resolveLoadedTitle, resolveTitleAuto } from "@/panels/panel-registry";
import { migrateCardLinks } from "@/links/migrate-card";
import { applyCardMorph } from "@/cards/morphs";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: NotesState = { cards: [] };

function migrateNote(raw: unknown): UserNote {
  const r = (raw ?? {}) as Partial<UserNote>;
  return {
    kind: "note",
    id: r.id!,
    archived: r.archived,
    // T6/C12: recorded provenance, not shape — keep a user-owned title, drop a
    // recorded/legacy generated one, self-stamp the resolved bit.
    title: resolveLoadedTitle("note", r.title, r.titleAuto),
    titleAuto: resolveTitleAuto("note", r.title, r.titleAuto),
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
  const { state, update, stateRef, loaded, loadError } = usePersistentState<NotesState>(
    docId,
    "notes.json",
    EMPTY_STATE,
    {
      migrate: migrateNotes,
      // T6/C12: write the self-stamped `titleAuto` provenance back on first
      // load so the shape heuristic is consulted at most once per record.
      persistMigrationOnLoad: true,
      errorLabel: "notes",
    },
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
        // T6/C12 (FORK-1): blank title + machine-default provenance — the
        // placeholder / +T affordance shows until the user types one (which
        // flips `titleAuto` false via `updateNoteTitle`).
        title: "",
        titleAuto: true,
        content: content ?? emptyRichContent(),
        createdAt: new Date().toISOString(),
        aiRequest: false,
        links: [],
      };
      if (paragraphId) newNote = addTextObjectLink(newNote, "note", paragraphId, targetKind);
      if (anchor) {
        newNote = setTextAnchorLink(newNote, "note", anchor.anchorId, anchor.anchorText);
      }
      // Unified pristine contract (BUG #54): a card is pristine — and so
      // discards on click-away — when it has NO BODY CONTENT, regardless of
      // anchor/paragraph. An anchor is just *where* the card lives, not
      // user-committed content; the common "+ at the cursor" note carries a
      // paragraphId yet is still empty. This matches footnotes/todos/citations
      // (the correct model). Once the user types, `updateNote` marks it dirty.
      if (!content) pristine.markNew(newNote.id);
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
      // No kind gate: a reloaded orphan event carries the parser-default
      // `kind:"note"` for every `\vlid`, so gating could mis-route across
      // panels (BUG1). `clearCardAnchor` self-filters by anchorId membership
      // (no-match early-return) — the owning panel decides.
      const { anchorId } = (e as CustomEvent).detail || {};
      if (!anchorId) return;
      clearCardAnchor(anchorId);
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [clearCardAnchor]);

  // Card-id-keyed Mode-B → Mode-A conversion. Unlike `clearCardAnchor`
  // (keyed by the doc-side anchorId, driven by the orphan event), this is
  // keyed by the card id and is called by the drop-mode re-anchor commit
  // (`clearModeB` on the ParagraphAnchorApi). It converts a surviving
  // `linkedRange` link to a clean `paragraph` link (preserving paragraph
  // ids) so the subsequent paragraph re-anchor isn't folded back into the
  // dead textRange link (RC1). No-op if the card carries no text anchor.
  const clearTextAnchorById = useCallback(
    (id: string) => {
      update((prev) => {
        const card = prev.cards.find((c) => c.id === id);
        if (!card || !hasTextAnchor(card)) return prev;
        return {
          cards: prev.cards.map((c) => {
            if (c.id !== id) return c;
            if (c.kind === "note") return clearTextAnchorLink(c, "note");
            if (c.kind === "highlight") return clearTextAnchorLink(c, "highlight");
            return c;
          }),
        };
      });
    },
    [update],
  );

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
        // T6/C12: user edit → user-owned title forever (clear auto-provenance).
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "note"
            ? { ...c, title, titleAuto: false }
            : c,
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
          "note",
          id,
          value,
          {
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
          "highlight",
          id,
          value,
          {
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
    (
      id: string,
      paragraphId: string,
      targetKind?: import("@/text-objects/types").TextObjectKind,
      paragraphSnapshot?: string | null,
    ) => {
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "note"
            ? addTextObjectLink(c, "note", paragraphId, targetKind, paragraphSnapshot)
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
    (
      id: string,
      paragraphId: string,
      targetKind?: import("@/text-objects/types").TextObjectKind,
      paragraphSnapshot?: string | null,
    ) => {
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "highlight"
            ? addTextObjectLink(c, "highlight", paragraphId, targetKind, paragraphSnapshot)
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

  // Mode-A self-healing reconcile, run once on doc-open by the load
  // reconcile effect. Highlights are Mode B (untouched); Mode-A notes get
  // UUID-first backfill / snapshot-fallback rebind.
  const reconcileAnchors = useReconcileModeAAnchors<NotesState, NoteCardItem>(
    update,
    () => stateRef.current,
    (s) => s.cards,
    (_s, cards) => ({ cards }),
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

  /** Flip a card's archived (set-aside) flag. Works for both notes and
   *  highlights (both carry `archived?`). Filtering active/archived/all happens
   *  at the panel; this just persists the flag through the same sidecar path as
   *  the other mutations. */
  const setArchived = useCallback(
    (id: string, archived: boolean) => {
      pristine.markDirty(id);
      update((prev) => ({
        cards: prev.cards.map((c) => (c.id === id ? { ...c, archived } : c)),
      }));
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
        // T6/C12: carry the title provenance onto the clone.
        titleAuto: source.titleAuto,
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
    (id: string, paragraphId: string, anchorId: string, anchorText: string) => {
      update((prev) => {
        const card = prev.cards.find((c) => c.id === id);
        if (!card) return prev;
        const existing = getTextAnchor(card);
        if (existing?.anchorId === anchorId) return prev;
        const kind = card.kind === "highlight" ? "highlight" : "note";
        return {
          cards: prev.cards.map((c) =>
            c.id === id
              ? setTextAnchorLink(
                  c,
                  kind,
                  anchorId,
                  anchorText,
                  paragraphId ? [paragraphId] : undefined,
                )
              : c,
          ),
        };
      });
    },
    [update],
  );

  /** Flip a notes-panel card's kind in place (note ⇄ highlight) via the
   *  registered morph transform. Preserves id/createdAt/links (the text-range
   *  anchor rides across so the in-doc tint/marker survives). note → highlight
   *  is lossy (discards the rich note body + title); a confirm guards that
   *  direction at the call site (driven by `morph.lossy`). The float-key remap
   *  rides on `convertCardWithRemap` in EditorPane. Replaces the one-way
   *  `addNoteForHighlight` "+ note" path (R14). */
  const convertCard = useCallback(
    (id: string, toKind: "note" | "highlight") => {
      pristine.markDirty(id);
      update((prev) => ({
        cards: prev.cards.map((c) => {
          if (c.id !== id || c.kind === toKind) return c;
          return applyCardMorph(c.kind, c);
        }),
      }));
    },
    [update, pristine],
  );

  /**
   * Drop any notes that were created via `addNote()` but never edited.
   * Call from panel-close / host-unmount so "press +, do nothing, leave"
   * does not leave a blank card behind. Highlights are never pristine —
   * `addHighlight` never calls `markNew` (a highlight is a body-less tint,
   * so the unified empty-body contract doesn't apply to it).
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

  /**
   * Append fully-formed note cards built outside the hook. Used by the BUG
   * #55b card-request migration to materialize an unlinked `note` AI request
   * as a real Note card (already carrying `aiRequest: true`). Append-only and
   * NOT marked pristine — a migrated card is committed content, not a fresh
   * "+" placeholder, so it must survive click-away.
   */
  const appendCards = useCallback(
    (newCards: UserNote[]) => {
      if (newCards.length === 0) return;
      update((prev) => ({ cards: [...prev.cards, ...newCards] }));
    },
    [update],
  );

  return useMemo(
    () => ({
      cards,
      notes,
      highlights,
      addNote,
      appendCards,
      addHighlight,
      updateNote,
      updateNoteTitle,
      setNoteAiRequest,
      setHighlightAiRequest,
      addNoteTextObjectId,
      removeNoteTextObjectId,
      addHighlightTextObjectId,
      removeHighlightTextObjectId,
      reconcileAnchors,
      loaded,
      loadError,
      preserveModeBAnchor,
      deleteNote,
      setArchived,
      cloneNote,
      cloneHighlight,
      convertCard,
      bindAnchor,
      setNoteAnchor,
      clearNoteAnchor: clearCardAnchor,
      clearTextAnchorById,
      discardPristineNotes,
    }),
    [
      cards,
      notes,
      highlights,
      addNote,
      appendCards,
      addHighlight,
      updateNote,
      updateNoteTitle,
      setNoteAiRequest,
      setHighlightAiRequest,
      addNoteTextObjectId,
      removeNoteTextObjectId,
      addHighlightTextObjectId,
      removeHighlightTextObjectId,
      reconcileAnchors,
      loaded,
      loadError,
      preserveModeBAnchor,
      deleteNote,
      setArchived,
      cloneNote,
      cloneHighlight,
      convertCard,
      bindAnchor,
      setNoteAnchor,
      clearCardAnchor,
      clearTextAnchorById,
      discardPristineNotes,
    ],
  );
}
