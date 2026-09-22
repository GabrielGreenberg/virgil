"use client";

import { useAnchorOrphaned, useTextObjectOrphaned } from "@/lib/tiptap/orphan-events";
import { useCallback, useMemo } from "react";
import { generateEntityId } from "@/lib/uuid";
import type { JSONContent } from "@tiptap/react";
import type { ArchiveState, ArchivedSnippet } from "@/lib/types";
import { normalizeRichContent } from "@/lib/footnote-content";
import {
  addTextObjectLink,
  clearTextAnchorLink,
  getLinkedTextObjectIds,
  getTextAnchor,
  removeTextObjectLink,
} from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import { resolveLoadedTitle, resolveTitleAuto } from "@/panels/panel-registry";
import type { PullSeed } from "@/lib/stack/pull-seed";
import { carryUnknownKeys, withSidecarEnvelope } from "@/lib/sidecar-migrate";
import { archiveOriginOf, type ArchiveOrigin, type ArchiveOriginPanel } from "@/lib/archive-origin";
import { usePersistentState } from "./usePersistentState";
import { useReconcileModeAAnchors } from "./useReconcileModeAAnchors";

const EMPTY: ArchiveState = { snippets: [] };

function migrateSnippet(raw: unknown): ArchivedSnippet {
  const s = raw as Partial<ArchivedSnippet> & { text?: string };
  const content =
    s.text != null && s.content == null
      ? normalizeRichContent(s.text)
      : normalizeRichContent(s.content);
  // Task 712: an agent-archived snippet carries its ORIGIN (`originalPanel` /
  // `originalCard` / `archivedAt`, typed on ArchivedSnippet) plus whatever a
  // later agent extension adds — the unknown remainder rides through the load
  // (`carryUnknownKeys`). Legacy `text` is consumed: it became `content`.
  return carryUnknownKeys(raw, {
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
  }, ["text"]);
}

function migrateArchiveShape(raw: unknown): ArchiveState {
  const s = raw as Partial<ArchiveState>;
  return { snippets: Array.isArray(s.snippets) ? s.snippets.map(migrateSnippet) : [] };
}

/** Task 715 — no legacy top-level key was ever consumed here. Exported under
 *  the original name: the wrapper is the migrator now, at every caller. */
export const migrateArchive = withSidecarEnvelope(migrateArchiveShape);

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

  /**
   * Stack-pull door (task 330): create a snippet FROM a snapshot seed.
   *
   * The pre-330 host was the CLOSEST of the four to right — it carried the
   * title, through `updateSnippetTitle` — and that is exactly what makes it
   * instructive: `updateSnippetTitle` stamps `titleAuto: false` (a user edit
   * makes the title user-owned), so a pulled snippet with a machine-default
   * title arrived claiming a human had typed it. A per-field setter re-decides
   * provenance it has no business re-deciding; a spread carries the truth.
   */
  const archiveFromSeed = useCallback(
    (paragraphId: string | null, seed: PullSeed<"archive">): ArchivedSnippet => {
      const fresh = {
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        links: [] as ArchivedSnippet["links"],
      };
      const snippet: ArchivedSnippet = {
        title: "",
        titleAuto: true,
        ...fresh,
        ...seed,
        // Born-free intent (task 104) is resolved by THIS pull, never carried:
        // `unanchored` describes whether the record had an anchor target in the
        // SOURCE doc, and the placement decides it here.
        ...(paragraphId ? {} : { unanchored: true as const }),
        content: normalizeRichContent(seed.content),
        ...fresh, // identity floor — see `useNotes.addNoteFromSeed`
      };
      update((prev) => ({ snippets: [...prev.snippets, snippet] }));
      return snippet;
    },
    [update],
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
  // Gated on `docId` by the door (task 598).
  useTextObjectOrphaned(docId, ({ uuid }) => {
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
  });

  // AnchorId-keyed Mode-B → Mode-A conversion (task 698). An archive snippet
  // is normally Mode-A, but `links` is migrated from whatever the sidecar
  // holds (an agent-side archive move carries the card's links), so a
  // text-range link is representable here — and until now it was the one
  // panel with neither the drop re-anchor's release nor the Mode-B orphan
  // sweep every sibling runs. Both share this, as in every sibling hook.
  const clearCardAnchor = useCallback(
    (anchorId: string) => {
      update((prev) => {
        if (!prev.snippets.some((s) => getTextAnchor(s)?.anchorId === anchorId)) {
          return prev;
        }
        return {
          snippets: prev.snippets.map((s) =>
            getTextAnchor(s)?.anchorId === anchorId
              ? clearTextAnchorLink(s, "archive")
              : s,
          ),
        };
      });
    },
    [update],
  );

  // Mode-B orphan sweep — gated on `docId` by the door (task 598); no kind
  // gate (BUG1), `clearCardAnchor` self-filters by anchorId membership.
  useAnchorOrphaned(docId, ({ anchorId }) => {
    if (!anchorId) return;
    clearCardAnchor(anchorId);
  });

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
   * A CARD IS NOT AN EXCERPT (task 712). A snippet carrying an origin record
   * (`archiveOriginOf` → `card`) was a whole card set aside by
   * `/editor/archive-card`; its body is a note's words, not paper text. It
   * never reaches `land`: it goes back to its panel through `reinstate` (the
   * app-side twin of `apply_response.py cmd_restore`) and the snippet is then
   * REMOVED, not set aside — a panel append has no undo entry to protect, and a
   * retired copy would leave the same card id live in two sidecars. With no
   * `reinstate` door, or an origin record too broken to honour, it refuses:
   * pasting the body into the prose is the one outcome that is always wrong.
   *
   * Returns true iff the content landed and the card was retired.
   */
  const restoreSnippet = useCallback(
    (
      id: string,
      land: (content: JSONContent) => boolean,
      reinstate?: (panel: ArchiveOriginPanel, card: Record<string, unknown>) => boolean,
    ): boolean => {
      // The ref, not `state`, so a caller that fires before React re-renders
      // still reads the live collection. `update` below is functional, so the
      // write itself is never based on this read.
      const found = stateRef.current.snippets.find((s) => s.id === id);
      if (!found) return false;
      if (found.archived) return false; // already retired — don't land it twice
      const origin = archiveOriginOf(found);
      if (origin.kind === "unknown-card") return false;
      if (origin.kind === "card") {
        if (!reinstate || !reinstate(origin.panel, origin.card)) return false;
        const remove = (prev: ArchiveState): ArchiveState => ({
          snippets: prev.snippets.filter((s) => s.id !== id),
        });
        stateRef.current = remove(stateRef.current);
        update(remove);
        return true;
      }
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

  /** Where snippet `id` came from (task 712) — null when there is no such
   *  snippet. Reads the live ref, so it is stable per doc and safe to call
   *  from a render-time label or a click handler alike. */
  const snippetOrigin = useCallback(
    (id: string): ArchiveOrigin | null => {
      const found = stateRef.current.snippets.find((s) => s.id === id);
      return found ? archiveOriginOf(found) : null;
    },
    [stateRef],
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
      archiveFromSeed,
      updateSnippet,
      updateSnippetTitle,
      addParagraphId,
      removeParagraphId,
      reconcileAnchors,
      loaded,
      loadError,
      restoreSnippet,
      snippetOrigin,
      deleteSnippet,
      setArchived,
      clearCardAnchor,
    }),
    [
      state.snippets,
      archiveContent,
      archiveFromSeed,
      updateSnippet,
      updateSnippetTitle,
      addParagraphId,
      removeParagraphId,
      reconcileAnchors,
      loaded,
      loadError,
      restoreSnippet,
      snippetOrigin,
      deleteSnippet,
      setArchived,
      clearCardAnchor,
    ],
  );
}
