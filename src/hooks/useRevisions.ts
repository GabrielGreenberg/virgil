"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import type {
  RevisionsState,
  RevisionsTracker,
  RevisionCard,
  RevisionCommentCard,
  RevisionSuggestionCard,
} from "@/lib/types";
import {
  normalizeRichContent,
  emptyRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import {
  addTextObjectLink,
  clearTextAnchorLink,
  getLinkedTextObjectIds,
  getTextAnchor,
  removeTextObjectLink,
  setTextAnchorLink,
} from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import {
  bridgeCardAiRequestFlag,
  type AiRequestSyncMode,
} from "@/lib/ai-request-bridge";
import { applyCardMorph } from "@/cards/morphs";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import { useReconcileModeAAnchors } from "./useReconcileModeAAnchors";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: RevisionsState = { cards: [], tracker: null };

function migrateTracker(raw: unknown): RevisionsTracker | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<RevisionsTracker>;
  const target = typeof t.target === "number" && Number.isFinite(t.target) && t.target >= 0
    ? Math.round(t.target)
    : null;
  const setAt = typeof t.setAt === "string" ? t.setAt : null;
  if (target == null && setAt == null) return null;
  return { target, setAt };
}

function migrateCommentRecord(raw: unknown): RevisionCommentCard | null {
  const r = (raw ?? {}) as Partial<RevisionCommentCard> & {
    authorId?: string;
    resolved?: boolean;
    turns?: Array<{ text?: string }>;
  };
  if (!r.id || !r.createdAt) return null;
  const content = normalizeRichContent(r.content);
  const text =
    typeof r.text === "string" && r.text.length > 0
      ? r.text
      : richJsonToPlainText(content) || "";
  const links = migrateCardLinks("revision-comment", raw);
  const ta = links.find((l) => l.anchor.type === "textObject" && l.anchor.targetKind === "linkedRange" && l.anchor.textRange);
  return {
    kind: "comment",
    id: r.id,
    archived: r.archived,
    createdAt: r.createdAt,
    text,
    content,
    aiRequest: !!r.aiRequest,
    selectedText:
      r.selectedText ??
      (ta?.anchor.type === "textObject" ? ta.anchor.textRange?.textSnapshot : undefined),
    links,
  };
}

function migrateSuggestionRecord(raw: unknown): RevisionSuggestionCard | null {
  const r = (raw ?? {}) as Partial<RevisionSuggestionCard>;
  if (!r.id || !r.createdAt) return null;
  const links = migrateCardLinks("revision-suggestion", raw);
  const ta = links.find((l) => l.anchor.type === "textObject" && l.anchor.targetKind === "linkedRange" && l.anchor.textRange);
  const status: RevisionSuggestionCard["status"] =
    r.status === "accepted" ||
    r.status === "rejected" ||
    r.status === "applied" ||
    r.status === "stale"
      ? r.status
      : "pending";
  return {
    kind: "suggestion",
    id: r.id,
    archived: r.archived,
    createdAt: r.createdAt,
    author: r.author === "ai" ? "ai" : "human",
    original_text: typeof r.original_text === "string" ? r.original_text : "",
    suggested_text: typeof r.suggested_text === "string" ? r.suggested_text : "",
    explanation: typeof r.explanation === "string" ? r.explanation : "",
    user_text: typeof r.user_text === "string" ? r.user_text : "",
    instructions: typeof r.instructions === "string" ? r.instructions : "",
    status,
    // Carry the apply descriptor through unchanged when present (only set on
    // `applied` cards via the flag-ON apply path); absent otherwise.
    ...(r.appliedChange ? { appliedChange: r.appliedChange } : {}),
    selectedText:
      r.selectedText ??
      (ta?.anchor.type === "textObject" ? ta.anchor.textRange?.textSnapshot : undefined),
    links,
  };
}

function migrateCard(raw: unknown): RevisionCard | null {
  const r = (raw ?? {}) as { kind?: string };
  if (r.kind === "suggestion") return migrateSuggestionRecord(raw);
  return migrateCommentRecord(raw);
}

function migrateRevisions(raw: unknown): RevisionsState {
  if (!raw || typeof raw !== "object") return { cards: [], tracker: null };
  const r = raw as {
    cards?: unknown;
    comments?: unknown;
    generalRevisions?: unknown;
    textRevisions?: unknown;
    tracker?: unknown;
  };
  const tracker = migrateTracker(r.tracker);

  if (Array.isArray(r.cards)) {
    return {
      cards: r.cards
        .map(migrateCard)
        .filter((c): c is RevisionCard => c !== null),
      tracker,
    };
  }

  // Legacy shapes — `comments[]` (recent) plus `generalRevisions[]` /
  // `textRevisions[]` (older). Every legacy entry becomes a comment card,
  // dropping the multi-turn dialogue model and the resolved/author plumbing.
  const sources: unknown[] = [];
  if (Array.isArray(r.comments)) sources.push(...r.comments);
  if (Array.isArray(r.generalRevisions)) sources.push(...r.generalRevisions);
  if (Array.isArray(r.textRevisions)) sources.push(...r.textRevisions);
  if (sources.length > 0) {
    const seen = new Set<string>();
    const cards: RevisionCard[] = [];
    for (const raw of sources) {
      const c = migrateCommentRecord(raw);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      cards.push(c);
    }
    cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { cards, tracker };
  }

  return { cards: [], tracker };
}

export function useRevisions(
  docId: string | null,
  externalPristine?: PristineKindApi | null,
) {
  const { state, update, stateRef, loaded, loadError } = usePersistentState<RevisionsState>(
    docId,
    "revisions.json",
    EMPTY_STATE,
    { migrate: migrateRevisions, errorLabel: "revisions" },
  );
  const localPristine = usePristineTracker();
  const pristine = externalPristine ?? localPristine;

  // The ONE bridge seam for a revision-comment (task 2026-07-03-016 6b) — the
  // checkbox toggle AND the default-on-create path both funnel through it, so
  // the `ai-requests.json` payload shape lives once.
  const bridgeComment = useCallback(
    (card: RevisionCommentCard, value: boolean, mode: AiRequestSyncMode = "toggle") => {
      void bridgeCardAiRequestFlag(
        docId,
        "revision-comment",
        card.id,
        value,
        {
          text: card.text || "<revision comment>",
          paragraphIds: getLinkedTextObjectIds(card),
          selectedText: card.selectedText ?? getTextAnchor(card)?.anchorText,
        },
        mode,
      );
    },
    [docId],
  );

  const addComment = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
      targetKind?: import("@/text-objects/types").TextObjectKind,
    ) => {
      let card: RevisionCommentCard = {
        kind: "comment",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        text: content ? richJsonToPlainText(content) || "" : "",
        content: content ?? emptyRichContent(),
        // task 2026-07-03-016 6b: a comment is an AI request by default; the
        // inbox bridge follows the same pristine gate as sidecar persistence
        // (below), so a discarded empty comment never orphans an entry.
        aiRequest: true,
        selectedText: anchor?.anchorText,
        links: [],
      };
      if (paragraphId) card = addTextObjectLink(card, "revision-comment", paragraphId, targetKind);
      if (anchor)
        card = setTextAnchorLink(
          card,
          "revision-comment",
          anchor.anchorId,
          anchor.anchorText,
        );
      // Unified pristine contract (BUG #54): an empty-body comment discards on
      // click-away regardless of anchor/paragraph (an anchor isn't user content).
      if (!content) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      // Seeded-with-content comments are committed at birth → bridge now; empty
      // pristine ones bridge on first edit (updateCommentContent/Text).
      if (content) bridgeComment(card, true);
      return card;
    },
    [update, pristine, bridgeComment],
  );

  const addSuggestion = useCallback(
    (
      paragraphId: string | null,
      originalText?: string,
      anchor?: { anchorId: string; anchorText: string },
    ) => {
      let card: RevisionSuggestionCard = {
        kind: "suggestion",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        author: "human",
        original_text: originalText ?? anchor?.anchorText ?? "",
        suggested_text: "",
        explanation: "",
        user_text: "",
        instructions: "",
        status: "pending",
        selectedText: anchor?.anchorText,
        links: [],
      };
      if (paragraphId)
        card = addTextObjectLink(card, "revision-suggestion", paragraphId);
      if (anchor)
        card = setTextAnchorLink(
          card,
          "revision-suggestion",
          anchor.anchorId,
          anchor.anchorText,
        );
      // Unified pristine contract (BUG #54): a suggestion is pristine when it
      // carries no seed text. `!anchor` is kept (a selection-seeded suggestion
      // captures the anchor text as `original_text` = real content), but
      // `!paragraphId` is dropped so a blank Mode-A suggestion still discards.
      if (!originalText && !anchor) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      return card;
    },
    [update, pristine],
  );

  const updateCommentContent = useCallback(
    (id: string, content: JSONContent) => {
      // A pristine→committed transition bridges the default AI-request flag
      // (task 2026-07-03-016 6b). Read isPristine BEFORE markDirty clears it.
      const firstCommit = pristine.isPristine(id);
      pristine.markDirty(id);
      const text = richJsonToPlainText(content) || "";
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment"
            ? { ...c, content, text }
            : c,
        ),
      }));
      if (firstCommit) {
        const card = state.cards.find(
          (c) => c.id === id && c.kind === "comment",
        ) as RevisionCommentCard | undefined;
        if (card?.aiRequest) bridgeComment({ ...card, content, text }, true);
      }
    },
    [update, pristine, state.cards, bridgeComment],
  );

  const updateCommentText = useCallback(
    (id: string, text: string) => {
      const firstCommit = pristine.isPristine(id);
      pristine.markDirty(id);
      const content: JSONContent = text
        ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
        : emptyRichContent();
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment" ? { ...c, content, text } : c,
        ),
      }));
      if (firstCommit) {
        const card = state.cards.find(
          (c) => c.id === id && c.kind === "comment",
        ) as RevisionCommentCard | undefined;
        if (card?.aiRequest) bridgeComment({ ...card, content, text }, true);
      }
    },
    [update, pristine, state.cards, bridgeComment],
  );

  const setCommentAiRequest = useCallback(
    (id: string, value: boolean, mode: AiRequestSyncMode = "toggle") => {
      pristine.markDirty(id);
      const card = state.cards.find(
        (c) => c.id === id && c.kind === "comment",
      ) as RevisionCommentCard | undefined;
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment" ? { ...c, aiRequest: value } : c,
        ),
      }));
      if (card) bridgeComment({ ...card, aiRequest: value }, value, mode);
    },
    [update, pristine, state.cards, bridgeComment],
  );

  const updateSuggestionField = useCallback(
    (
      id: string,
      field:
        | "original_text"
        | "suggested_text"
        | "explanation"
        | "user_text"
        | "instructions",
      value: string,
    ) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "suggestion" ? { ...c, [field]: value } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const setSuggestionStatus = useCallback(
    (id: string, status: RevisionSuggestionCard["status"]) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "suggestion" ? { ...c, status } : c,
        ),
      }));
    },
    [update, pristine],
  );

  /** Set (or clear, when `appliedChange` is undefined) the `appliedChange`
   *  splice descriptor on a suggestion card. Mirrors `setArchived`: functional
   *  `update`, marks the card pristine-dirty so it persists. Only the flag-ON
   *  apply path calls this; with the flag OFF nothing ever sets it. Clearing
   *  drops the key entirely (Keep) rather than leaving an `undefined` field. */
  const setAppliedChange = useCallback(
    (id: string, appliedChange: RevisionSuggestionCard["appliedChange"] | undefined) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => {
          if (c.id !== id || c.kind !== "suggestion") return c;
          if (appliedChange) return { ...c, appliedChange };
          const { appliedChange: _drop, ...rest } = c;
          return rest;
        }),
      }));
    },
    [update, pristine],
  );

  /** Flip a card's kind in place (comment ⇄ suggestion) via the registered
   *  morph transform. Preserves id, createdAt, anchor and paragraph links;
   *  salvages text fields across the shape change. The float-key remap rides
   *  on `convertCardWithRemap` in EditorPane (the morph chokepoint). */
  const convertCard = useCallback(
    (id: string, toKind: "comment" | "suggestion") => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => {
          if (c.id !== id || c.kind === toKind) return c;
          const fromKind =
            c.kind === "comment" ? "revision-comment" : "revision-suggestion";
          return applyCardMorph(fromKind, c);
        }),
      }));
    },
    [update, pristine],
  );

  const setTrackerTarget = useCallback(
    (target: number | null) => {
      const valid =
        typeof target === "number" && Number.isFinite(target) && target >= 0
          ? Math.round(target)
          : null;
      const tracker: RevisionsTracker | null =
        valid == null
          ? null
          : { target: valid, setAt: new Date().toISOString() };
      update((prev) => ({ ...prev, tracker }));
    },
    [update],
  );

  const addCardParagraphId = useCallback(
    (
      id: string,
      paragraphId: string,
      targetKind?: import("@/text-objects/types").TextObjectKind,
      paragraphSnapshot?: string | null,
    ) => {
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id
            ? addTextObjectLink(
                c,
                c.kind === "suggestion" ? "revision-suggestion" : "revision-comment",
                paragraphId,
                targetKind,
                paragraphSnapshot,
              )
            : c,
        ),
      }));
    },
    [update],
  );

  const removeCardParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id ? removeTextObjectLink(c, paragraphId) : c,
        ),
      }));
    },
    [update],
  );

  // Mode-A self-healing reconcile (load-only). See useReconcileModeAAnchors.
  const reconcileAnchors = useReconcileModeAAnchors<RevisionsState, RevisionCard>(
    update,
    () => stateRef.current,
    (s) => s.cards,
    (s, cards) => ({ ...s, cards }),
  );

  const deleteCard = useCallback(
    (id: string) => {
      pristine.markDirty(id);
      update((prev) => ({ ...prev, cards: prev.cards.filter((c) => c.id !== id) }));
    },
    [update, pristine],
  );

  /** Flip a revision card's archived (set-aside) flag. Filtering happens at the
   *  panel; this persists through the same sidecar path. */
  const setArchived = useCallback(
    (id: string, archived: boolean) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? { ...c, archived } : c)),
      }));
    },
    [update, pristine],
  );

  /** Deep-copy a revision-comment sidecar entry with a fresh id. Links
   *  cleared; walker rewires anchors after slice insertion. */
  const cloneComment = useCallback(
    (sourceId: string): string | null => {
      const source = state.cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "comment") return null;
      const clone: RevisionCommentCard = {
        kind: "comment",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        text: source.text,
        content: normalizeRichContent(source.content),
        aiRequest: false,
        selectedText: source.selectedText,
        links: [],
      };
      update((prev) => ({ ...prev, cards: [...prev.cards, clone] }));
      return clone.id;
    },
    [update, state.cards],
  );

  /** Deep-copy a revision-suggestion sidecar entry with a fresh id. */
  const cloneSuggestion = useCallback(
    (sourceId: string): string | null => {
      const source = state.cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "suggestion") return null;
      const clone: RevisionSuggestionCard = {
        kind: "suggestion",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        author: source.author,
        original_text: source.original_text,
        suggested_text: source.suggested_text,
        explanation: source.explanation,
        user_text: source.user_text,
        instructions: source.instructions,
        status: "pending",
        selectedText: source.selectedText,
        links: [],
      };
      update((prev) => ({ ...prev, cards: [...prev.cards, clone] }));
      return clone.id;
    },
    [update, state.cards],
  );

  const discardPristineCards = useCallback(() => {
    if (externalPristine) {
      externalPristine.discardAll();
      return;
    }
    const ids = localPristine.takePristine();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    update((prev) => ({ ...prev, cards: prev.cards.filter((c) => !idSet.has(c.id)) }));
  }, [update, externalPristine, localPristine]);

  /** Re-attach a Mode B text-range anchor on a freshly-cloned revision
   *  card. Called by the duplicate dispatcher's post-insert walker.
   *  Idempotent — see CardLifecycle.bindAnchor doc. */
  const bindAnchor = useCallback(
    (id: string, paragraphId: string, anchorId: string, anchorText: string) => {
      update((prev) => {
        const card = prev.cards.find((c) => c.id === id);
        if (!card) return prev;
        const existing = getTextAnchor(card);
        if (existing?.anchorId === anchorId) return prev;
        const kind = card.kind === "suggestion" ? "revision-suggestion" : "revision-comment";
        return {
          ...prev,
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

  const clearCardAnchor = useCallback(
    (anchorId: string) => {
      update((prev) => {
        if (
          !prev.cards.some((c) => getTextAnchor(c)?.anchorId === anchorId)
        ) {
          return prev;
        }
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            getTextAnchor(c)?.anchorId === anchorId
              ? clearTextAnchorLink(
                  c,
                  c.kind === "suggestion" ? "revision-suggestion" : "revision-comment",
                )
              : c,
          ),
        };
      });
    },
    [update],
  );

  // Orphan listener — clears dead anchorId on the matching revision card.
  useEffect(() => {
    const handler = (e: Event) => {
      // No kind gate: after a reload the event carries the parser-default
      // `kind:"note"` for EVERY `\vlid`, so gating on `kind` made this panel
      // ignore its own orphaned revision mark (BUG1). `clearCardAnchor`
      // already self-filters by anchorId membership (no-match early-return),
      // so the OWNING panel decides — never the stale event kind.
      const { anchorId } = (e as CustomEvent).detail || {};
      if (!anchorId) return;
      clearCardAnchor(anchorId);
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [clearCardAnchor]);

  return useMemo(
    () => ({
      cards: state.cards,
      tracker: state.tracker ?? null,
      addComment,
      addSuggestion,
      updateCommentContent,
      updateCommentText,
      setCommentAiRequest,
      updateSuggestionField,
      setSuggestionStatus,
      setAppliedChange,
      convertCard,
      setTrackerTarget,
      addCardParagraphId,
      removeCardParagraphId,
      reconcileAnchors,
      loaded,
      loadError,
      deleteCard,
      setArchived,
      cloneComment,
      cloneSuggestion,
      bindAnchor,
      clearCardAnchor,
      discardPristineCards,
    }),
    [
      state.cards,
      state.tracker,
      addComment,
      addSuggestion,
      updateCommentContent,
      updateCommentText,
      setCommentAiRequest,
      updateSuggestionField,
      setSuggestionStatus,
      setAppliedChange,
      convertCard,
      setTrackerTarget,
      addCardParagraphId,
      removeCardParagraphId,
      reconcileAnchors,
      loaded,
      loadError,
      deleteCard,
      setArchived,
      cloneComment,
      cloneSuggestion,
      bindAnchor,
      clearCardAnchor,
      discardPristineCards,
    ],
  );
}
