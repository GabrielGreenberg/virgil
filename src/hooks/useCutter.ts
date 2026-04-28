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
import { nextCardTitle } from "@/panels/panel-registry";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: CutterState = { cuts: [], goal: null };

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
  const goal =
    typeof s.goal === "number" && Number.isFinite(s.goal) && s.goal > 0
      ? s.goal
      : null;
  return {
    cuts: Array.isArray(s.cuts) ? s.cuts.map(migrateCut) : [],
    goal,
  };
}

export function useCutter(docId: string | null, externalPristine?: PristineKindApi | null) {
  const { state, update } = usePersistentState<CutterState>(
    docId,
    "cutter.json",
    EMPTY_STATE,
    { migrate: migrateCutter, errorLabel: "cuts" },
  );
  const localPristine = usePristineTracker();
  const pristine = externalPristine ?? localPristine;

  const addCut = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: { anchorId: string; anchorText: string },
    ) => {
      let cut: CutItem = {
        id: generateEntityId(),
        title: nextCardTitle("cut", state.cuts.length),
        content: content ?? emptyRichContent(),
        createdAt: new Date().toISOString(),
        links: [],
      };
      if (paragraphId) cut = addParagraphLink(cut, "cut", paragraphId);
      if (anchor) cut = setTextAnchorLink(cut, "cut", anchor.anchorId, anchor.anchorText);
      // Only blank-on-creation cuts are pristine — a cut seeded with text,
      // an anchor, or a paragraph link already carries user intent.
      if (!content && !anchor && !paragraphId) pristine.markNew(cut.id);
      update((prev) => ({ cuts: [...prev.cuts, cut] }));
      return cut;
    },
    [update, pristine, state.cuts.length],
  );

  const updateCut = useCallback(
    (id: string, content: JSONContent) => {
      pristine.markDirty(id);
      update((prev) => ({
        cuts: prev.cuts.map((c) => (c.id === id ? { ...c, content } : c)),
      }));
    },
    [update, pristine],
  );

  const updateCutTitle = useCallback(
    (id: string, title: string) => {
      pristine.markDirty(id);
      update((prev) => ({
        cuts: prev.cuts.map((c) => (c.id === id ? { ...c, title } : c)),
      }));
    },
    [update, pristine],
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
      pristine.markDirty(id);
      update((prev) => ({ cuts: prev.cuts.filter((c) => c.id !== id) }));
    },
    [update, pristine],
  );

  /**
   * Drop cuts that were created via `addCut()` (with no seed content,
   * anchor, or paragraph link) but never edited. Call from panel-close.
   * When the external pristine manager is in use, it owns discard via
   * the registered delete callback.
   */
  const discardPristineCuts = useCallback(() => {
    if (externalPristine) {
      externalPristine.discardAll();
      return;
    }
    const ids = localPristine.takePristine();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    update((prev) => ({ cuts: prev.cuts.filter((c) => !idSet.has(c.id)) }));
  }, [update, externalPristine, localPristine]);

  const setGoal = useCallback(
    (goal: number | null) => {
      const normalized =
        typeof goal === "number" && Number.isFinite(goal) && goal > 0
          ? goal
          : null;
      update((prev) => ({ ...prev, goal: normalized }));
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
    goal: state.goal ?? null,
    setGoal,
    addCut,
    updateCut,
    updateCutTitle,
    addCutParagraphId,
    removeCutParagraphId,
    deleteCut,
    clearCutAnchor,
    discardPristineCuts,
  };
}
