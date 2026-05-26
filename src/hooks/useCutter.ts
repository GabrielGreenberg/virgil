"use client";

import { useCallback, useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import type {
  CutterState,
  CutterCard,
  CutterCommentCard,
  CutterSuggestionCard,
  CutterGoal,
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
import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import type { CardKind } from "@/panels/_shared/types";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: CutterState = { cards: [], goal: null };

function migrateGoal(raw: unknown): CutterGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Partial<CutterGoal>;
  if (
    typeof g.target !== "number" ||
    typeof g.initialWords !== "number" ||
    typeof g.setAt !== "string"
  )
    return null;
  if (!Number.isFinite(g.target) || g.target < 0) return null;
  if (!Number.isFinite(g.initialWords) || g.initialWords < 0) return null;
  return { target: g.target, initialWords: g.initialWords, setAt: g.setAt };
}

function rewriteLinkTargetKind(
  links: unknown[],
  from: string,
  to: CardKind,
): ReturnType<typeof migrateCardLinks> {
  if (!Array.isArray(links)) return [];
  return links.map((raw) => {
    const l = raw as {
      target?: { type?: string; ref?: { kind?: string; id?: string } };
    } & Record<string, unknown>;
    if (l?.target?.ref?.kind === from) {
      return {
        ...l,
        target: { ...l.target, ref: { ...l.target.ref, kind: to } },
      };
    }
    return raw;
  }) as ReturnType<typeof migrateCardLinks>;
}

function migrateComment(raw: unknown): CutterCommentCard | null {
  const r = (raw ?? {}) as Partial<CutterCommentCard>;
  if (!r.id || !r.createdAt) return null;
  const content = normalizeRichContent(r.content);
  const text = typeof r.text === "string" ? r.text : richJsonToPlainText(content) || "";
  const links = migrateCardLinks("cutter-comment", raw);
  const ta = links.find((l) => l.anchor.type === "textObject" && l.anchor.targetKind === "linkedRange" && l.anchor.textRange);
  return {
    kind: "comment",
    id: r.id,
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

function migrateSuggestion(raw: unknown): CutterSuggestionCard | null {
  const r = (raw ?? {}) as Partial<CutterSuggestionCard>;
  if (!r.id || !r.createdAt) return null;
  const links = migrateCardLinks("cutter-suggestion", raw);
  const ta = links.find((l) => l.anchor.type === "textObject" && l.anchor.targetKind === "linkedRange" && l.anchor.textRange);
  const status: CutterSuggestionCard["status"] =
    r.status === "accepted" || r.status === "rejected" ? r.status : "pending";
  return {
    kind: "suggestion",
    id: r.id,
    createdAt: r.createdAt,
    author: r.author === "ai" ? "ai" : "human",
    original_text: typeof r.original_text === "string" ? r.original_text : "",
    suggested_text: typeof r.suggested_text === "string" ? r.suggested_text : "",
    explanation: typeof r.explanation === "string" ? r.explanation : "",
    user_text: typeof r.user_text === "string" ? r.user_text : "",
    instructions: typeof r.instructions === "string" ? r.instructions : "",
    status,
    selectedText:
      r.selectedText ??
      (ta?.anchor.type === "textObject" ? ta.anchor.textRange?.textSnapshot : undefined),
    links,
  };
}

function migrateCard(raw: unknown): CutterCard | null {
  const r = (raw ?? {}) as { kind?: string };
  if (r.kind === "suggestion") return migrateSuggestion(raw);
  return migrateComment(raw);
}

function migrateCutter(raw: unknown): CutterState {
  if (!raw || typeof raw !== "object") return { cards: [], goal: null };
  const r = raw as { cards?: unknown; cuts?: unknown; goal?: unknown };
  const goal = migrateGoal(r.goal);

  if (Array.isArray(r.cards)) {
    return {
      cards: r.cards
        .map(migrateCard)
        .filter((c): c is CutterCard => c !== null),
      goal,
    };
  }

  // Legacy `cuts` shape — every cut becomes a comment.
  if (Array.isArray(r.cuts)) {
    const cards: CutterCard[] = [];
    for (const raw of r.cuts) {
      const c = (raw ?? {}) as {
        id?: string;
        title?: string;
        content?: unknown;
        createdAt?: string;
        links?: unknown[];
      };
      if (!c.id || !c.createdAt) continue;
      const content = normalizeRichContent(c.content);
      const titlePart = (c.title || "").trim();
      const bodyPart = richJsonToPlainText(content) || "";
      const text = [titlePart, bodyPart].filter(Boolean).join(" — ");
      const links = rewriteLinkTargetKind(
        migrateCardLinks("cutter-comment", raw),
        "cut",
        "cutter-comment",
      );
      const ta = links.find(
        (l) =>
          l.anchor.type === "textObject" &&
          l.anchor.targetKind === "linkedRange" &&
          l.anchor.textRange,
      );
      cards.push({
        kind: "comment",
        id: c.id,
        createdAt: c.createdAt,
        text,
        content,
        aiRequest: false,
        selectedText:
          ta?.anchor.type === "textObject" ? ta.anchor.textRange?.textSnapshot : undefined,
        links,
      });
    }
    return { cards, goal };
  }

  return { cards: [], goal };
}

export function useCutter(
  docId: string | null,
  externalPristine?: PristineKindApi | null,
) {
  const { state, update } = usePersistentState<CutterState>(
    docId,
    "cutter.json",
    EMPTY_STATE,
    { migrate: migrateCutter, errorLabel: "cutter cards" },
  );
  const localPristine = usePristineTracker();
  const pristine = externalPristine ?? localPristine;

  const addComment = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
      targetKind?: import("@/text-objects/types").TextObjectKind,
    ) => {
      let card: CutterCommentCard = {
        kind: "comment",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        text: content ? richJsonToPlainText(content) || "" : "",
        content: content ?? emptyRichContent(),
        aiRequest: false,
        selectedText: anchor?.anchorText,
        links: [],
      };
      if (paragraphId) card = addTextObjectLink(card, "cutter-comment", paragraphId, targetKind);
      if (anchor)
        card = setTextAnchorLink(
          card,
          "cutter-comment",
          anchor.anchorId,
          anchor.anchorText,
        );
      // Only blank-on-creation cards are pristine.
      if (!content && !anchor && !paragraphId) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      return card;
    },
    [update, pristine, state.cards.length],
  );

  const addSuggestion = useCallback(
    (
      paragraphId: string | null,
      originalText?: string,
      anchor?: { anchorId: string; anchorText: string },
    ) => {
      let card: CutterSuggestionCard = {
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
        card = addTextObjectLink(card, "cutter-suggestion", paragraphId);
      if (anchor)
        card = setTextAnchorLink(
          card,
          "cutter-suggestion",
          anchor.anchorId,
          anchor.anchorText,
        );
      // A suggestion with no seed text/anchor/paragraph is pristine.
      if (!originalText && !anchor && !paragraphId) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      return card;
    },
    [update, pristine],
  );

  const updateCommentContent = useCallback(
    (id: string, content: JSONContent) => {
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
    },
    [update, pristine],
  );

  const updateCommentText = useCallback(
    (id: string, text: string) => {
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
    },
    [update, pristine],
  );

  const setCommentAiRequest = useCallback(
    (id: string, value: boolean) => {
      pristine.markDirty(id);
      const card = state.cards.find(
        (c) => c.id === id && c.kind === "comment",
      ) as CutterCommentCard | undefined;
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment" ? { ...c, aiRequest: value } : c,
        ),
      }));
      if (card) {
        void bridgeCardAiRequestFlag(
          docId,
          { panel: "cutter", cardId: id },
          value,
          {
            text: card.text || "<cutter comment>",
            paragraphIds: getLinkedTextObjectIds(card),
            selectedText: card.selectedText ?? getTextAnchor(card)?.anchorText,
          },
        );
      }
    },
    [update, pristine, docId, state.cards],
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
    (id: string, status: CutterSuggestionCard["status"]) => {
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

  const setGoal = useCallback(
    (target: number, initialWords: number) => {
      if (!Number.isFinite(target) || target < 0) return;
      if (!Number.isFinite(initialWords) || initialWords < 0) return;
      const goal: CutterGoal = {
        target: Math.round(target),
        initialWords: Math.round(initialWords),
        setAt: new Date().toISOString(),
      };
      update((prev) => ({ ...prev, goal }));
    },
    [update],
  );

  const clearGoal = useCallback(() => {
    update((prev) => ({ ...prev, goal: null }));
  }, [update]);

  const addCardParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id
            ? addTextObjectLink(
                c,
                c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment",
                paragraphId,
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

  const deleteCard = useCallback(
    (id: string) => {
      pristine.markDirty(id);
      update((prev) => ({ ...prev, cards: prev.cards.filter((c) => c.id !== id) }));
    },
    [update, pristine],
  );

  /** Deep-copy a cutter-comment sidecar entry with a fresh id. Links
   *  cleared; walker rewires anchors after slice insertion. */
  const cloneComment = useCallback(
    (sourceId: string): string | null => {
      const source = state.cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "comment") return null;
      const clone: CutterCommentCard = {
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

  /** Deep-copy a cutter-suggestion sidecar entry with a fresh id. */
  const cloneSuggestion = useCallback(
    (sourceId: string): string | null => {
      const source = state.cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "suggestion") return null;
      const clone: CutterSuggestionCard = {
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

  /** Re-attach a Mode B text-range anchor on a freshly-cloned cutter
   *  card. Idempotent — see CardLifecycle.bindAnchor doc. */
  const bindAnchor = useCallback(
    (id: string, _paragraphId: string, anchorId: string, anchorText: string) => {
      update((prev) => {
        const card = prev.cards.find((c) => c.id === id);
        if (!card) return prev;
        const existing = getTextAnchor(card);
        if (existing?.anchorId === anchorId) return prev;
        const kind = card.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment";
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            c.id === id ? setTextAnchorLink(c, kind, anchorId, anchorText) : c,
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
                  c.kind === "suggestion"
                    ? "cutter-suggestion"
                    : "cutter-comment",
                )
              : c,
          ),
        };
      });
    },
    [update],
  );

  // Orphan listener — when a linkedAnchor mark is deleted from the doc,
  // clear the dead anchorId on the matching cutter card. Single panel-
  // scoped listener handles both card kinds.
  useEffect(() => {
    const handler = (e: Event) => {
      const { anchorId, kind } = (e as CustomEvent).detail || {};
      if (!anchorId) return;
      // Accept legacy "cut" plus the two new kinds.
      if (
        kind !== "cut" &&
        kind !== "cutter-comment" &&
        kind !== "cutter-suggestion"
      )
        return;
      clearCardAnchor(anchorId);
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [clearCardAnchor]);

  return {
    cards: state.cards,
    goal: state.goal ?? null,
    addComment,
    addSuggestion,
    updateCommentContent,
    updateCommentText,
    setCommentAiRequest,
    updateSuggestionField,
    setSuggestionStatus,
    setGoal,
    clearGoal,
    addCardParagraphId,
    removeCardParagraphId,
    deleteCard,
    cloneComment,
    cloneSuggestion,
    bindAnchor,
    clearCardAnchor,
    discardPristineCards,
  };
}
