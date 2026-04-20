"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type { CutterState, CutItem } from "@/lib/types";
import { normalizeRichContent, emptyRichContent } from "@/lib/footnote-content";
import {
  addParagraphLink,
  clearTextAnchorLink,
  derivedLinksForCard,
  getTextAnchor,
  removeParagraphLink,
  setTextAnchorLink,
} from "@/links/links";

const EMPTY_STATE: CutterState = { cuts: [] };

function migrateCut(raw: unknown): CutItem {
  const c = raw as Partial<CutItem> & {
    paragraphIds?: string[];
    anchorId?: string;
    anchorText?: string;
  };
  if (Array.isArray(c.links) && c.links.length > 0) {
    return {
      id: c.id!,
      title: typeof c.title === "string" ? c.title : "",
      content: normalizeRichContent(c.content),
      createdAt: c.createdAt!,
      links: c.links,
    };
  }
  const base: CutItem = {
    id: c.id!,
    title: typeof c.title === "string" ? c.title : "",
    content: normalizeRichContent(c.content),
    createdAt: c.createdAt!,
    links: [],
  };
  base.links = derivedLinksForCard("cut", {
    id: base.id,
    paragraphIds: Array.isArray(c.paragraphIds) ? c.paragraphIds : [],
    anchorId: typeof c.anchorId === "string" ? c.anchorId : undefined,
    anchorText: typeof c.anchorText === "string" ? c.anchorText : undefined,
  });
  return base;
}

export function useCutter(docId: string | null) {
  const [state, setState] = useState<CutterState>(EMPTY_STATE);
  const currentDocIdRef = useRef(docId);

  useEffect(() => {
    currentDocIdRef.current = docId;
    if (!docId) {
      setState(EMPTY_STATE);
      return;
    }
    readSidecar<CutterState>(docId, "cutter.json", EMPTY_STATE)
      .then((data) => {
        if (currentDocIdRef.current !== docId || !data.cuts) return;
        setState({ cuts: data.cuts.map(migrateCut) });
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (newState: CutterState) => {
    const id = currentDocIdRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, "cutter.json", newState);
    } catch (err) {
      console.error("Failed to save cuts:", err);
    }
  }, []);

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
      setState((prev) => {
        const next = { cuts: [...prev.cuts, cut] };
        persist(next);
        return next;
      });
      return cut;
    },
    [persist],
  );

  const updateCut = useCallback(
    (id: string, content: JSONContent) => {
      setState((prev) => {
        const next = {
          cuts: prev.cuts.map((c) => (c.id === id ? { ...c, content } : c)),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateCutTitle = useCallback(
    (id: string, title: string) => {
      setState((prev) => {
        const next = {
          cuts: prev.cuts.map((c) => (c.id === id ? { ...c, title } : c)),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addCutParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      setState((prev) => {
        const next = {
          cuts: prev.cuts.map((c) =>
            c.id === id ? addParagraphLink(c, "cut", paragraphId) : c,
          ),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeCutParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      setState((prev) => {
        const next = {
          cuts: prev.cuts.map((c) =>
            c.id === id ? removeParagraphLink(c, paragraphId) : c,
          ),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const deleteCut = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = { cuts: prev.cuts.filter((c) => c.id !== id) };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clearCutAnchor = useCallback(
    (anchorId: string) => {
      setState((prev) => {
        if (!prev.cuts.some((c) => getTextAnchor(c)?.anchorId === anchorId)) {
          return prev;
        }
        const next = {
          cuts: prev.cuts.map((c) =>
            getTextAnchor(c)?.anchorId === anchorId
              ? clearTextAnchorLink(c, "cut")
              : c,
          ),
        };
        persist(next);
        return next;
      });
    },
    [persist],
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
