"use client";

import { useCallback } from "react";
import { generateEntityId } from "@/lib/uuid";
import type { ArchiveState, ArchivedSnippet } from "@/lib/types";
import { normalizeRichContent } from "@/lib/footnote-content";
import { addTextObjectLink, removeTextObjectLink } from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import { nextCardTitle } from "@/panels/panel-registry";
import { usePersistentState } from "./usePersistentState";

const EMPTY: ArchiveState = { snippets: [] };

function migrateSnippet(raw: unknown): ArchivedSnippet {
  const s = raw as Partial<ArchivedSnippet> & { text?: string };
  const content =
    s.text != null && s.content == null
      ? normalizeRichContent(s.text)
      : normalizeRichContent(s.content);
  return {
    id: s.id!,
    title: typeof s.title === "string" ? s.title : "",
    content,
    createdAt: s.createdAt!,
    links: migrateCardLinks("archive", raw),
  };
}

function migrateArchive(raw: unknown): ArchiveState {
  const s = raw as Partial<ArchiveState>;
  return { snippets: Array.isArray(s.snippets) ? s.snippets.map(migrateSnippet) : [] };
}

export function useArchive(docId: string | null) {
  const { state, setState, update, persist, stateRef } =
    usePersistentState<ArchiveState>(docId, "archive.json", EMPTY, {
      migrate: migrateArchive,
      persistMigrationOnLoad: true,
      errorLabel: "archive",
    });

  const archiveContent = useCallback(
    (content: unknown): ArchivedSnippet => {
      const snippet: ArchivedSnippet = {
        id: generateEntityId(),
        title: nextCardTitle("archive", state.snippets.length),
        content: normalizeRichContent(content),
        createdAt: new Date().toISOString(),
        links: [],
      };
      update((prev) => ({ snippets: [...prev.snippets, snippet] }));
      return snippet;
    },
    [update, state.snippets.length],
  );

  const updateSnippet = useCallback(
    (id: string, content: unknown) => {
      update((prev) => ({
        snippets: prev.snippets.map((s) =>
          s.id === id ? { ...s, content: normalizeRichContent(content) } : s,
        ),
      }));
    },
    [update],
  );

  const updateSnippetTitle = useCallback(
    (id: string, title: string) => {
      update((prev) => ({
        snippets: prev.snippets.map((s) => (s.id === id ? { ...s, title } : s)),
      }));
    },
    [update],
  );

  const addParagraphId = useCallback(
    (
      id: string,
      paragraphId: string,
      targetKind?: import("@/text-objects/types").TextObjectKind,
    ) => {
      update((prev) => ({
        snippets: prev.snippets.map((s) =>
          s.id === id ? addTextObjectLink(s, "archive", paragraphId, targetKind) : s,
        ),
      }));
    },
    [update],
  );

  const removeParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        snippets: prev.snippets.map((s) =>
          s.id === id ? removeTextObjectLink(s, paragraphId) : s,
        ),
      }));
    },
    [update],
  );

  const restoreSnippet = useCallback(
    (id: string): ArchivedSnippet | null => {
      // Read directly from the ref to avoid React batching issues
      const current = stateRef.current;
      const found = current.snippets.find((s) => s.id === id) || null;
      if (found) {
        const next = { snippets: current.snippets.filter((s) => s.id !== id) };
        stateRef.current = next;
        setState(next);
        void persist(next);
      }
      return found;
    },
    [setState, persist, stateRef],
  );

  const deleteSnippet = useCallback(
    (id: string) => {
      update((prev) => ({
        snippets: prev.snippets.filter((s) => s.id !== id),
      }));
    },
    [update],
  );

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
