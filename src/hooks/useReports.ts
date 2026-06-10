"use client";

import { useCallback, useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import type {
  ReportsState,
  ReportItem,
  ReportCard,
  ReportRequestCard,
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
import { applyCardMorph } from "@/cards/morphs";
import { nextCardTitle } from "@/panels/panel-registry";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: ReportsState = { cards: [] };

function migrateReportRecord(raw: unknown): ReportCard | null {
  const r = (raw ?? {}) as Partial<ReportCard>;
  if (!r.id || !r.createdAt) return null;
  const content = normalizeRichContent(r.content);
  const text =
    typeof r.text === "string" && r.text.length > 0
      ? r.text
      : richJsonToPlainText(content) || "";
  const links = migrateCardLinks("report", raw);
  const ta = links.find(
    (l) =>
      l.anchor.type === "textObject" &&
      l.anchor.targetKind === "linkedRange" &&
      l.anchor.textRange,
  );
  return {
    kind: "report",
    id: r.id,
    createdAt: r.createdAt,
    author: r.author === "ai" ? "ai" : "human",
    title: typeof r.title === "string" ? r.title : "",
    text,
    content,
    selectedText:
      r.selectedText ??
      (ta?.anchor.type === "textObject" ? ta.anchor.textRange?.textSnapshot : undefined),
    links,
  };
}

function migrateRequestRecord(raw: unknown): ReportRequestCard | null {
  const r = (raw ?? {}) as Partial<ReportRequestCard>;
  if (!r.id || !r.createdAt) return null;
  const content = normalizeRichContent(r.content);
  const text =
    typeof r.text === "string" && r.text.length > 0
      ? r.text
      : richJsonToPlainText(content) || "";
  const links = migrateCardLinks("report-request", raw);
  const ta = links.find(
    (l) =>
      l.anchor.type === "textObject" &&
      l.anchor.targetKind === "linkedRange" &&
      l.anchor.textRange,
  );
  return {
    kind: "report-request",
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

function migrateCardRecord(raw: unknown): ReportItem | null {
  const r = (raw ?? {}) as { kind?: string };
  if (r.kind === "report-request") return migrateRequestRecord(raw);
  return migrateReportRecord(raw);
}

function migrateReports(raw: unknown): ReportsState {
  if (!raw || typeof raw !== "object") return { cards: [] };
  const r = raw as { cards?: unknown };
  if (Array.isArray(r.cards)) {
    return {
      cards: r.cards
        .map(migrateCardRecord)
        .filter((c): c is ReportItem => c !== null),
    };
  }
  return { cards: [] };
}

export function useReports(
  docId: string | null,
  externalPristine?: PristineKindApi | null,
) {
  const { state, update } = usePersistentState<ReportsState>(
    docId,
    "reports.json",
    EMPTY_STATE,
    { migrate: migrateReports, errorLabel: "reports" },
  );
  const localPristine = usePristineTracker();
  const pristine = externalPristine ?? localPristine;

  /** Create a Report (the authored content card). Defaults `author` to
   *  "human" — the answer-report-request skill writes `author: "ai"`
   *  directly into reports.json. */
  const addReport = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
      targetKind?: import("@/text-objects/types").TextObjectKind,
      author: "human" | "ai" = "human",
    ) => {
      const count = state.cards.filter((c) => c.kind === "report").length;
      let card: ReportCard = {
        kind: "report",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        author,
        title: nextCardTitle("report", count),
        text: content ? richJsonToPlainText(content) || "" : "",
        content: content ?? emptyRichContent(),
        selectedText: anchor?.anchorText,
        links: [],
      };
      if (paragraphId) card = addTextObjectLink(card, "report", paragraphId, targetKind);
      if (anchor) card = setTextAnchorLink(card, "report", anchor.anchorId, anchor.anchorText);
      if (!content && !anchor && !paragraphId) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      return card;
    },
    [update, pristine, state.cards],
  );

  /** Create a Report Request (the user's "ask"). */
  const addReportRequest = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
      targetKind?: import("@/text-objects/types").TextObjectKind,
    ) => {
      let card: ReportRequestCard = {
        kind: "report-request",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        text: content ? richJsonToPlainText(content) || "" : "",
        content: content ?? emptyRichContent(),
        aiRequest: false,
        selectedText: anchor?.anchorText,
        links: [],
      };
      if (paragraphId)
        card = addTextObjectLink(card, "report-request", paragraphId, targetKind);
      if (anchor)
        card = setTextAnchorLink(card, "report-request", anchor.anchorId, anchor.anchorText);
      if (!content && !anchor && !paragraphId) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      return card;
    },
    [update, pristine],
  );

  const updateReportContent = useCallback(
    (id: string, content: JSONContent) => {
      pristine.markDirty(id);
      const text = richJsonToPlainText(content) || "";
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "report" ? { ...c, content, text } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const updateReportTitle = useCallback(
    (id: string, title: string) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "report" ? { ...c, title } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const updateRequestContent = useCallback(
    (id: string, content: JSONContent) => {
      pristine.markDirty(id);
      const text = richJsonToPlainText(content) || "";
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "report-request" ? { ...c, content, text } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const setRequestAiRequest = useCallback(
    (id: string, value: boolean) => {
      pristine.markDirty(id);
      const card = state.cards.find(
        (c) => c.id === id && c.kind === "report-request",
      ) as ReportRequestCard | undefined;
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "report-request"
            ? { ...c, aiRequest: value }
            : c,
        ),
      }));
      if (card) {
        void bridgeCardAiRequestFlag(
          docId,
          { panel: "reports", cardId: id },
          value,
          {
            text: card.text || "<report request>",
            paragraphIds: getLinkedTextObjectIds(card),
            selectedText: card.selectedText ?? getTextAnchor(card)?.anchorText,
          },
        );
      }
    },
    [update, pristine, docId, state.cards],
  );

  /** Flip a report card's kind in place (report ⇄ report-request) via the
   *  registered morph transform. Preserves id/createdAt/links; the rich body
   *  carries across (title/author + aiRequest are the lossy fields). The
   *  float-key remap rides on `convertCardWithRemap` in EditorPane. */
  const convertCard = useCallback(
    (id: string, toKind: "report" | "report-request") => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => {
          if (c.id !== id || c.kind === toKind) return c;
          return applyCardMorph(c.kind, c);
        }),
      }));
    },
    [update, pristine],
  );

  const addCardParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id ? addTextObjectLink(c, c.kind, paragraphId) : c,
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

  /** Deep-copy a report sidecar entry with a fresh id. Links cleared; the
   *  duplicate walker rewires anchors after slice insertion. */
  const cloneReport = useCallback(
    (sourceId: string): string | null => {
      const source = state.cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "report") return null;
      const clone: ReportCard = {
        kind: "report",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        author: source.author,
        title: source.title,
        text: source.text,
        content: normalizeRichContent(source.content),
        selectedText: source.selectedText,
        links: [],
      };
      update((prev) => ({ ...prev, cards: [...prev.cards, clone] }));
      return clone.id;
    },
    [update, state.cards],
  );

  const cloneRequest = useCallback(
    (sourceId: string): string | null => {
      const source = state.cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "report-request") return null;
      const clone: ReportRequestCard = {
        kind: "report-request",
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

  /** Re-attach a Mode B text-range anchor on a freshly-cloned report card.
   *  Idempotent — see CardLifecycle.bindAnchor doc. */
  const bindAnchor = useCallback(
    (id: string, _paragraphId: string, anchorId: string, anchorText: string) => {
      update((prev) => {
        const card = prev.cards.find((c) => c.id === id);
        if (!card) return prev;
        const existing = getTextAnchor(card);
        if (existing?.anchorId === anchorId) return prev;
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            c.id === id ? setTextAnchorLink(c, c.kind, anchorId, anchorText) : c,
          ),
        };
      });
    },
    [update],
  );

  const clearCardAnchor = useCallback(
    (anchorId: string) => {
      update((prev) => {
        if (!prev.cards.some((c) => getTextAnchor(c)?.anchorId === anchorId)) {
          return prev;
        }
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            getTextAnchor(c)?.anchorId === anchorId
              ? clearTextAnchorLink(c, c.kind)
              : c,
          ),
        };
      });
    },
    [update],
  );

  // Orphan listener — clears dead anchorId on the matching report card.
  useEffect(() => {
    const handler = (e: Event) => {
      const { anchorId, kind } = (e as CustomEvent).detail || {};
      if (!anchorId) return;
      if (kind !== "report" && kind !== "report-request") return;
      clearCardAnchor(anchorId);
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [clearCardAnchor]);

  return {
    cards: state.cards,
    addReport,
    addReportRequest,
    updateReportContent,
    updateReportTitle,
    updateRequestContent,
    setRequestAiRequest,
    addCardParagraphId,
    removeCardParagraphId,
    deleteCard,
    cloneReport,
    cloneRequest,
    convertCard,
    bindAnchor,
    clearCardAnchor,
    discardPristineCards,
  };
}
