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
  const { state, update, stateRef, loaded, loadError } =
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

  /**
   * Un-archive: hand the snippet's content back to the document and retire the
   * card. `land` performs the re-insertion and reports whether the content
   * actually made it into the document.
   *
   * THE OBLIGATION IS CARRIED, NOT REMEMBERED. This used to be a bare
   * `restoreSnippet(id) → snippet | null` that removed the entry and left the
   * caller to insert it — so the two EditorPane callers deleted the archive
   * entry and only THEN asked an editor handle that could no-op (no editor
   * mounted, read-only chrome, a body the document's schema can't hold) to take
   * the text. That is the capture law read backwards: an archive snippet is the
   * only copy of prose that was deleted from the document, and a restore that
   * doesn't land destroys it. Taking the landing function means the removal
   * cannot be sequenced wrongly — there is no order for a caller to get right.
   *
   * RETIRING IS SET-ASIDE, NOT DELETE, and that is the load-bearing half. The
   * document insert is an ordinary history entry; the sidecar write is not.
   * Delete the entry and the user's next Cmd+Z — the most natural key to press
   * when an excerpt lands somewhere unintended — pulls the prose back out of the
   * document while nothing puts it back in the Archive: gone from both, with no
   * undo left. So the card flips to `archived` (the reversible per-card
   * set-aside axis every kind already has: it leaves the panel's active list and
   * appears under Archives, one click from being brought back). The same choice
   * also drains the durability race — the sidecar's 300 ms write no longer
   * outruns the document's 1500 ms autosave into a window where a crash loses
   * both halves, because the surviving record IS the content.
   *
   * The flip goes through `update()` so it JOINS the debounce queue (see the
   * "two doors, one queue" note in `usePersistentState.persist`): the old
   * hand-rolled `setState` + immediate `persist` left a title-edit's pending
   * write armed with pre-removal state, which then flushed and resurrected the
   * restored snippet in `archive.json`.
   *
   * Returns true iff the content landed and the card was retired.
   */
  const restoreSnippet = useCallback(
    (id: string, land: (content: unknown) => boolean): boolean => {
      // The ref, not `state`, so a caller that fires before React re-renders
      // still reads the live collection. `update` below is functional, so the
      // write itself is never based on this read.
      const found = stateRef.current.snippets.find((s) => s.id === id);
      if (!found) return false;
      if (found.archived) return false; // already retired — don't land it twice
      if (!land(found.content)) return false;
      const retire = (prev: ArchiveState): ArchiveState => ({
        snippets: prev.snippets.map((s) =>
          s.id === id ? { ...s, archived: true } : s,
        ),
      });
      // Advance the ref mirror too (the next render re-assigns it anyway), so a
      // second call for the same id before React re-renders sees the retired
      // flag and refuses instead of landing the excerpt a second time.
      stateRef.current = retire(stateRef.current);
      update(retire);
      return true;
    },
    [update, stateRef],
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
