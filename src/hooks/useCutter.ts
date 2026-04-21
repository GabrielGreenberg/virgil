"use client";

import { useCallback, useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import type { CutterState, CutItem } from "@/lib/types";
import { normalizeRichContent, emptyRichContent } from "@/lib/footnote-content";
import {
  addParagraphLink,
  clearTextAnchorLink,
  getTextAnchor,
  removeParagraphLink,
  setTextAnchorLink,
} from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import { usePersistentState } from "./usePersistentState";

const EMPTY_STATE: CutterState = { cuts: [] };

function migrateCut(raw: unknown): CutItem {
  const c = raw as Partial<CutItem>;
  return {
    id: c.id!,
    title: typeof c.title === "string" ? c.title : "",
    content: normalizeRichContent(c.content),
    createdAt: c.createdAt!,
    links: migrateCardLinks("cut", raw),
  };
}

function migrateCutter(raw: unknown): CutterState {
  const s = raw as Partial<CutterState>;
  return { cuts: Array.isArray(s.cuts) ? s.cuts.map(migrateCut) : [] };
}

export function useCutter(docId: string | null) {
  const { state, update } = usePersistentState<CutterState>(
    docId,
    "cutter.json",
    EMPTY_STATE,
    { migrate: migrateCutter, errorLabel: "cuts" },
  );

  const addCut = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
    ) => {
      let cut: CutItem = {
        id: generateEntityId(),
        title: "",
        content: content ?? emptyRichContent(),
        createdAt: new Date().toISOString(),
        links: [],
      };
      if (paragraphId) cut = addParagraphLink(cut, "cut", paragraphId);
      if (anchor) cut = setTextAnchorLink(cut, "cut", anchor.anchorId, anchor.anchorText);
      update((prev) => ({ cuts: [...prev.cuts, cut] }));
      return cut;
    },
    [update],
  );

  const updateCut = useCallback(
    (id: string, content: JSONContent) => {
      update((prev) => ({
        cuts: prev.cuts.map((c) => (c.id === id ? { ...c, content } : c)),
      }));
    },
    [update],
  );

  const updateCutTitle = useCallback(
    (id: string, title: string) => {
      update((prev) => ({
        cuts: prev.cuts.map((c) => (c.id === id ? { ...c, title } : c)),
      }));
    },
    [update],
  );

  const addCutParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        cuts: prev.cuts.map((c) =>
          c.id === id ? addParagraphLink(c, "cut", paragraphId) : c,
        ),
      }));
    },
    [update],
  );

  const removeCutParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        cuts: prev.cuts.map((c) =>
          c.id === id ? removeParagraphLink(c, paragraphId) : c,
        ),
      }));
    },
    [update],
  );

  const deleteCut = useCallback(
    (id: string) => {
      update((prev) => ({ cuts: prev.cuts.filter((c) => c.id !== id) }));
    },
    [update],
  );

  const clearCutAnchor = useCallback(
    (anchorId: string) => {
      update((prev) => {
        if (!prev.cuts.some((c) => getTextAnchor(c)?.anchorId === anchorId)) {
          return prev;
        }
        return {
          cuts: prev.cuts.map((c) =>
            getTextAnchor(c)?.anchorId === anchorId
              ? clearTextAnchorLink(c, "cut")
              : c,
          ),
        };
      });
    },
    [update],
  );

  // Orphan listener — when the mark is deleted from the doc, clear the
  // dead anchorId on the matching cut (card stays; becomes un-anchored).
  useEffect(() => {
    const handler = (e: Event) => {
      const { anchorId, kind } = (e as CustomEvent).detail || {};
      if (kind !== "cut" || !anchorId) return;
      clearCutAnchor(anchorId);
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [clearCutAnchor]);

  return {
    cuts: state.cuts,
    addCut,
    updateCut,
    updateCutTitle,
    addCutParagraphId,
    removeCutParagraphId,
    deleteCut,
    clearCutAnchor,
  };
}
