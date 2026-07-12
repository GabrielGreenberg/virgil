"use client";

import { useCallback, useEffect, useMemo } from "react";
import { generateEntityId } from "@/lib/uuid";
import type { ArchiveState, ArchivedSnippet } from "@/lib/types";
import { normalizeRichContent } from "@/lib/footnote-content";
import {
  addTextObjectLink,
  getLinkedTextObjectIds,
  removeTextObjectLink,
} from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import { resolveLoadedTitle, resolveTitleAuto } from "@/panels/panel-registry";
import { usePersistentState } from "./usePersistentState";
import { useReconcileModeAAnchors } from "./useReconcileModeAAnchors";

const EMPTY: ArchiveState = { snippets: [] };

function migrateSnippet(raw: unknown): ArchivedSnippet {
  const s = raw as Partial<ArchivedSnippet> & { text?: string };
  const content =
    s.text != null && s.content == null
      ? normalizeRichContent(s.text)
      : normalizeRichContent(s.content);
  return {
    // A migrator is the boundary where malformed input (a hand-edit, a partial
    // write, an agent sidecar write of archive.json) must be tolerated, not
    // asserted away. A missing/blank id would otherwise mint `id: undefined`,
    // which `persistMigrationOnLoad` writes back keyless (JSON.stringify drops
    // it) — then `popKey`/`deleteSnippet(undefined)` collide across every
    // keyless entry. Heal to a fresh stable id at migrate time instead.
    id: s.id || generateEntityId(),
    archived: s.archived,
    // T6/C12: recorded provenance, not shape — keep a user-owned title, drop a
    // recorded/legacy generated one, self-stamp the resolved bit.
    title: resolveLoadedTitle("archive", s.title, s.titleAuto),
    titleAuto: resolveTitleAuto("archive", s.title, s.titleAuto),
    content,
    createdAt: s.createdAt || new Date().toISOString(),
    // Carry the born-free intent through load (absent ≡ false); the
    // free-vs-orphaned split is derived from it via resolveAnchorState.
    unanchored: s.unanchored,
    links: migrateCardLinks("archive", raw),
  };
}

export function migrateArchive(raw: unknown): ArchiveState {
  const s = raw as Partial<ArchiveState>;
  return { snippets: Array.isArray(s.snippets) ? s.snippets.map(migrateSnippet) : [] };
}

export function useArchive(docId: string | null) {
  const { state, setState, update, persist, stateRef, loaded, loadError } =
    usePersistentState<ArchiveState>(docId, "archive.json", EMPTY, {
      migrate: migrateArchive,
      persistMigrationOnLoad: true,
      errorLabel: "archive",
    });

  const archiveContent = useCallback(
    (content: unknown, opts?: { unanchored?: boolean }): ArchivedSnippet => {
      const snippet: ArchivedSnippet = {
        id: generateEntityId(),
        // T6/C12 (FORK-1): blank title + machine-default provenance.
        title: "",
        titleAuto: true,
        content: normalizeRichContent(content),
        createdAt: new Date().toISOString(),
        // Born-free intent (task 104): the caller records here whether the
        // snippet is being created with no anchor target, so a link-less clip
        // reads "free" (neutral) rather than "orphaned" (red). Absent ≡ false.
        ...(opts?.unanchored ? { unanchored: true } : {}),
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
        // T6/C12: user edit → user-owned title forever (clear auto-provenance).
        snippets: prev.snippets.map((s) =>
          s.id === id ? { ...s, title, titleAuto: false } : s,
        ),
      }));
    },
    [update],
  );

  const addParagraphId = useCallback(
    (
      id: string,
      paragraphId: string,
      targetKind?: import("@/text-objects/types").TextObjectKind,
      paragraphSnapshot?: string | null,
    ) => {
      update((prev) => ({
        snippets: prev.snippets.map((s) =>
          s.id === id
            ? addTextObjectLink(s, "archive", paragraphId, targetKind, paragraphSnapshot)
            : s,
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

  // Mode A orphan sweep — when a paragraph / heading / list / etc.
  // vanishes from the doc, drop the dead uuid from any archive
  // snippet's Mode A links. For paragraph × Archive this is the
  // common case: the source paragraph is the snippet's anchor, gets
  // deleted, the link is now stale. See ACTION-MENU-DIAGNOSIS.md C3.
  useEffect(() => {
    const handler = (e: Event) => {
      const uuid = (e as CustomEvent).detail?.uuid;
      if (typeof uuid !== "string" || !uuid) return;
      update((prev) => {
        let changed = false;
        const next = prev.snippets.map((s) => {
          if (!getLinkedTextObjectIds(s).includes(uuid)) return s;
          changed = true;
          return removeTextObjectLink(s, uuid);
        });
        return changed ? { snippets: next } : prev;
      });
    };
    window.addEventListener("virgil-textobject-orphaned", handler);
    return () =>
      window.removeEventListener("virgil-textobject-orphaned", handler);
  }, [update]);

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

  /** Flip an archive snippet card's archived (set-aside) flag. This is the
   *  card-archive axis (hide the card from the panel's active view), wholly
   *  orthogonal to what this panel IS (a home for archived *text objects*) and
   *  to `restoreSnippet` (which re-inserts the text into the document). */
  const setArchived = useCallback(
    (id: string, archived: boolean) => {
      update((prev) => ({
        snippets: prev.snippets.map((s) =>
          s.id === id ? { ...s, archived } : s,
        ),
      }));
    },
    [update],
  );

  // Mode-A self-healing reconcile (load-only). See useReconcileModeAAnchors.
  const reconcileAnchors = useReconcileModeAAnchors<ArchiveState, ArchivedSnippet>(
    update,
    () => stateRef.current,
    (s) => s.snippets,
    (_s, snippets) => ({ snippets }),
  );

  return useMemo(
    () => ({
      snippets: state.snippets,
      archiveContent,
      updateSnippet,
      updateSnippetTitle,
      addParagraphId,
      removeParagraphId,
      reconcileAnchors,
      loaded,
      loadError,
      restoreSnippet,
      deleteSnippet,
      setArchived,
    }),
    [
      state.snippets,
      archiveContent,
      updateSnippet,
      updateSnippetTitle,
      addParagraphId,
      removeParagraphId,
      reconcileAnchors,
      loaded,
      loadError,
      restoreSnippet,
      deleteSnippet,
      setArchived,
    ],
  );
}
