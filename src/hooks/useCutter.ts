"use client";

import { useCallback, useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import type {
  CutterState,
  CutterCard,
  CutterCommentCard,
  CutterSuggestionCard,
} from "@/lib/types";
import {
  normalizeRichContent,
  emptyRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import {
  addParagraphLink,
  clearTextAnchorLink,
  getTextAnchor,
  removeParagraphLink,
  setTextAnchorLink,
} from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import type { CardKind } from "@/panels/_shared/types";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: CutterState = { cards: [] };

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
  const ta = links.find((l) => l.anchor.type === "anchor" && l.anchor.textRange);
  return {
    kind: "comment",
    id: r.id,
    createdAt: r.createdAt,
    text,
    content,
    aiRequest: !!r.aiRequest,
    selectedText:
      r.selectedText ??
      (ta?.anchor.type === "anchor" ? ta.anchor.textRange?.textSnapshot : undefined),
    links,
  };
}

function migrateSuggestion(raw: unknown): CutterSuggestionCard | null {
  const r = (raw ?? {}) as Partial<CutterSuggestionCard>;
  if (!r.id || !r.createdAt) return null;
  const links = migrateCardLinks("cutter-suggestion", raw);
  const ta = links.find((l) => l.anchor.type === "anchor" && l.anchor.textRange);
  const status: CutterSuggestionCard["status"] =
    r.status === "accepted" || r.status === "rejected" ? r.status : "pending";
  return {
    kind: "suggestion",
    id: r.id,
    createdAt: r.createdAt,
    original_text: typeof r.original_text === "string" ? r.original_text : "",
    suggested_text: typeof r.suggested_text === "string" ? r.suggested_text : "",
    explanation: typeof r.explanation === "string" ? r.explanation : "",
    status,
    source: "author",
    selectedText:
      r.selectedText ??
      (ta?.anchor.type === "anchor" ? ta.anchor.textRange?.textSnapshot : undefined),
    links,
  };
}

function migrateCard(raw: unknown): CutterCard | null {
  const r = (raw ?? {}) as { kind?: string };
  if (r.kind === "suggestion") return migrateSuggestion(raw);
  return migrateComment(raw);
}

function migrateCutter(raw: unknown): CutterState {
  if (!raw || typeof raw !== "object") return { cards: [] };
  const r = raw as { cards?: unknown; cuts?: unknown };

  if (Array.isArray(r.cards)) {
    return {
      cards: r.cards
        .map(migrateCard)
        .filter((c): c is CutterCard => c !== null),
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
        (l) => l.anchor.type === "anchor" && l.anchor.textRange,
      );
      cards.push({
        kind: "comment",
        id: c.id,
        createdAt: c.createdAt,
        text,
        content,
        aiRequest: false,
        selectedText:
          ta?.anchor.type === "anchor" ? ta.anchor.textRange?.textSnapshot : undefined,
        links,
      });
    }
    return { cards };
  }

  return { cards: [] };
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
      if (paragraphId) card = addParagraphLink(card, "cutter-comment", paragraphId);
      if (anchor)
        card = setTextAnchorLink(
          card,
          "cutter-comment",
          anchor.anchorId,
          anchor.anchorText,
        );
      // Only blank-on-creation cards are pristine.
      if (!content && !anchor && !paragraphId) pristine.markNew(card.id);
      update((prev) => ({ cards: [...prev.cards, card] }));
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
        original_text: originalText ?? anchor?.anchorText ?? "",
        suggested_text: "",
        explanation: "",
        status: "pending",
        source: "author",
        selectedText: anchor?.anchorText,
        links: [],
      };
      if (paragraphId)
        card = addParagraphLink(card, "cutter-suggestion", paragraphId);
      if (anchor)
        card = setTextAnchorLink(
          card,
          "cutter-suggestion",
          anchor.anchorId,
          anchor.anchorText,
        );
      // A suggestion with no seed text/anchor/paragraph is pristine.
      if (!originalText && !anchor && !paragraphId) pristine.markNew(card.id);
      update((prev) => ({ cards: [...prev.cards, card] }));
      return card;
    },
    [update, pristine],
  );

  const updateCommentContent = useCallback(
    (id: string, content: JSONContent) => {
      pristine.markDirty(id);
      const text = richJsonToPlainText(content) || "";
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment"
            ? { ...c, content, text }
            : c,
        ),
      }));
    },
    [update, pristine],
  );

  const setCommentAiRequest = useCallback(
    (id: string, value: boolean) => {
      pristine.markDirty(id);
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment" ? { ...c, aiRequest: value } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const updateSuggestionField = useCallback(
    (
      id: string,
      field: "original_text" | "suggested_text" | "explanation",
      value: string,
    ) => {
      pristine.markDirty(id);
      update((prev) => ({
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
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "suggestion" ? { ...c, status } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const addCardParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === id
            ? addParagraphLink(
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
        cards: prev.cards.map((c) =>
          c.id === id ? removeParagraphLink(c, paragraphId) : c,
        ),
      }));
    },
    [update],
  );

  const deleteCard = useCallback(
    (id: string) => {
      pristine.markDirty(id);
      update((prev) => ({ cards: prev.cards.filter((c) => c.id !== id) }));
    },
    [update, pristine],
  );

  const discardPristineCards = useCallback(() => {
    if (externalPristine) {
      externalPristine.discardAll();
      return;
    }
    const ids = localPristine.takePristine();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    update((prev) => ({ cards: prev.cards.filter((c) => !idSet.has(c.id)) }));
  }, [update, externalPristine, localPristine]);

  const clearCardAnchor = useCallback(
    (anchorId: string) => {
      update((prev) => {
        if (
          !prev.cards.some((c) => getTextAnchor(c)?.anchorId === anchorId)
        ) {
          return prev;
        }
        return {
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
    addComment,
    addSuggestion,
    updateCommentContent,
    setCommentAiRequest,
    updateSuggestionField,
    setSuggestionStatus,
    addCardParagraphId,
    removeCardParagraphId,
    deleteCard,
    clearCardAnchor,
    discardPristineCards,
  };
}
