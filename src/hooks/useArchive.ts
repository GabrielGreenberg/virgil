"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type { ArchiveState, ArchivedSnippet } from "@/lib/types";
import { normalizeRichContent } from "@/lib/footnote-content";
import {
  addParagraphLink,
  derivedLinksForCard,
  removeParagraphLink,
} from "@/links/links";

const EMPTY: ArchiveState = { snippets: [] };

function migrateSnippet(raw: unknown): ArchivedSnippet {
  const s = raw as Partial<ArchivedSnippet> & {
    text?: string;
    paragraphIds?: string[];
  };
  const content =
    s.text != null && s.content == null
      ? normalizeRichContent(s.text)
      : normalizeRichContent(s.content);
  if (Array.isArray(s.links) && s.links.length > 0) {
    return {
      id: s.id!,
      title: typeof s.title === "string" ? s.title : "",
      content,
      createdAt: s.createdAt!,
      links: s.links,
    };
  }
  const base: ArchivedSnippet = {
    id: s.id!,
    title: typeof s.title === "string" ? s.title : "",
    content,
    createdAt: s.createdAt!,
    links: [],
  };
  base.links = derivedLinksForCard("archive", {
    id: base.id,
    paragraphIds: Array.isArray(s.paragraphIds) ? s.paragraphIds : [],
  });
  return base;
}

export function useArchive(docId: string | null) {
  const [state, setState] = useState<ArchiveState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const docRef = useRef(docId);

  useEffect(() => {
    docRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    readSidecar<ArchiveState>(docId, "archive.json", EMPTY)
      .then((data) => {
        if (docRef.current === docId && data.snippets) {
          const migrated = data.snippets.map(migrateSnippet);
          const next = { snippets: migrated };
          setState(next);
          // Persist migration if any snippet was converted.
          if (migrated.some((m, i) => m !== data.snippets[i])) {
            writeSidecar(docId, "archive.json", next).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (s: ArchiveState) => {
    const id = docRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, "archive.json", s);
    } catch (err) {
      console.error("Failed to save archive:", err);
    }
  }, []);

  const archiveContent = useCallback((content: unknown): ArchivedSnippet => {
    const snippet: ArchivedSnippet = {
      id: generateEntityId(),
      title: "",
      content: normalizeRichContent(content),
      createdAt: new Date().toISOString(),
      links: [],
    };
    setState((prev) => {
      const next = { snippets: [...prev.snippets, snippet] };
      persist(next);
      return next;
    });
    return snippet;
  }, [persist]);

  const updateSnippet = useCallback((id: string, content: unknown) => {
    setState((prev) => {
      const next = {
        snippets: prev.snippets.map((s) =>
          s.id === id ? { ...s, content: normalizeRichContent(content) } : s
        ),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const updateSnippetTitle = useCallback((id: string, title: string) => {
    setState((prev) => {
      const next = {
        snippets: prev.snippets.map((s) =>
          s.id === id ? { ...s, title } : s
        ),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const addParagraphId = useCallback((id: string, paragraphId: string) => {
    setState((prev) => {
      const next = {
        snippets: prev.snippets.map((s) =>
          s.id === id ? addParagraphLink(s, "archive", paragraphId) : s,
        ),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const removeParagraphId = useCallback((id: string, paragraphId: string) => {
    setState((prev) => {
      const next = {
        snippets: prev.snippets.map((s) =>
          s.id === id ? removeParagraphLink(s, paragraphId) : s,
        ),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const restoreSnippet = useCallback((id: string): ArchivedSnippet | null => {
    // Read directly from the ref to avoid React batching issues
    const current = stateRef.current;
    const found = current.snippets.find((s) => s.id === id) || null;
    if (found) {
      const next = { snippets: current.snippets.filter((s) => s.id !== id) };
      stateRef.current = next;
      setState(next);
      persist(next);
    }
    return found;
  }, [persist]);

  const deleteSnippet = useCallback((id: string) => {
    setState((prev) => {
      const next = { snippets: prev.snippets.filter((s) => s.id !== id) };
      persist(next);
      return next;
    });
  }, [persist]);

  return {
    snippets: state.snippets,
    archiveContent,
    updateSnippet,
    updateSnippetTitle,
    addParagraphId,
    removeParagraphId,
    restoreSnippet,
    deleteSnippet,
  };
}
