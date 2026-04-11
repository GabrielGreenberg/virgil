"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage-fsa";
import type { ArchiveState, ArchivedSnippet } from "@/lib/types";
import { normalizeRichContent } from "@/lib/footnote-content";

const EMPTY: ArchiveState = { snippets: [] };

/**
 * Migrate legacy snippets that stored a plain `text` string instead of
 * rich `content` (Tiptap JSONContent). Returns a new array if any
 * migration occurred, or the original if none needed.
 */
function migrateSnippets(snippets: ArchivedSnippet[]): ArchivedSnippet[] {
  let changed = false;
  const migrated = snippets.map((s) => {
    // Legacy shape: { id, text: string, createdAt }
    const legacy = s as ArchivedSnippet & { text?: string };
    if (legacy.text != null && s.content == null) {
      changed = true;
      return {
        id: s.id,
        content: normalizeRichContent(legacy.text),
        createdAt: s.createdAt,
      };
    }
    return s;
  });
  return changed ? migrated : snippets;
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
          const migrated = migrateSnippets(data.snippets);
          const next = { snippets: migrated };
          setState(next);
          // Persist migration if anything changed
          if (migrated !== data.snippets) {
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
      content: normalizeRichContent(content),
      createdAt: new Date().toISOString(),
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
    restoreSnippet,
    deleteSnippet,
  };
}
