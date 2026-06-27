import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { OrphanedFootnote } from "@/lib/types";
import { isInlineAtomLifecycleOn } from "@/lib/identity/inline-atom-lifecycle-flag";

/**
 * Footnote ↔ orphan + archive bookkeeping bridges.
 *
 * Split into two hooks because their state lives at two different layers:
 *
 *  - {@link useFootnoteOrphanBridges} is **per-pane** — it writes the per-doc
 *    orphan store (`useOrphanedFootnotes(docId)`), so it is mounted inside
 *    `EditorPane` once per mounted doc. Each instance only processes events
 *    that ORIGINATED in its own doc (the `detail.docId` filter), which is what
 *    keeps two warm keep-alive panes from co-mingling each other's orphans
 *    (FN-A2-03). Before the per-doc cutover the orphan list was a single shell
 *    `useState` above the `<DocPipeline>` boundary, so a window-level event web
 *    accumulated every doc's orphans into one list.
 *
 *  - {@link useFootnoteSyncBridges} is the **shell-level archive bridge** — it
 *    deletes an archive snippet swallowed by a footnote drop target. It targets
 *    the ACTIVE doc's archive (via the bubbled-up `deleteSnippet`) and is
 *    flag-agnostic, so it stays in `EditorLayout`.
 *
 * Both are decoupled from their producers by `window` CustomEvents — the
 * decoupling seam exists because the orphan detector lives in ProseMirror-land
 * (`footnote.ts`) while the state lives in React-land.
 */

/** The orphan-store surface the per-pane bridge writes (the array-shaped setter
 *  exposed by `useOrphanedFootnotes`). */
export interface OrphanBridgeStore {
  setOrphanedFootnotes: Dispatch<SetStateAction<OrphanedFootnote[]>>;
}

/**
 * Per-pane orphan event web (legacy / flag-OFF path). Mounted in `EditorPane`
 * beside `useOrphanedFootnotes(docId)`.
 *
 * Each handler:
 *  - bails when `virgil:inline-atom-lifecycle` is ON — the bus reconciler
 *    (`useInlineAtomLifecycle`) is then the sole orphan-store writer and the
 *    detector in `footnote.ts` no longer emits these events. The flag is read
 *    at EVENT time (not mount time) so a per-test toggle takes effect without
 *    re-subscribing.
 *  - bails when `detail.docId !== docId` — the events are window-level, so
 *    every mounted pane's listener receives a teardown from any doc; this
 *    filter routes each one to its ORIGINATING doc's store only (FN-A2-03).
 *    `docId == null` events (cards / floats / Reader) never match an authored
 *    pane, so they are inert.
 *
 * - `virgil-footnote-orphaned` — the detector fires this (deferred) when a
 *   footnote-with-content's marker is deleted; we upsert an orphan so it can be
 *   recovered/re-dropped from the panel. A deliberate trash-delete pre-arms
 *   `suppressRef` (below) so this event is swallowed instead.
 * - `virgil-footnote-suppress-orphan` — `handleDeleteFootnote` /
 *   `spliceAndArchiveAtom` (EditorPane, same pane) dispatch this synchronously
 *   BEFORE removing the atom, arming the latch so the immediately-following
 *   `virgil-footnote-orphaned` doesn't resurrect the footnote as an orphan card.
 *   The latch is per-pane (one `suppressRef` per doc), so two docs that happen
 *   to share a short footnoteId don't cross-suppress.
 * - `virgil-footnote-panel-dropped` — the panel reports the orphan was dropped
 *   back into the doc; clear its orphan slot.
 */
export function useFootnoteOrphanBridges(deps: {
  docId: string | null;
  store: OrphanBridgeStore;
}) {
  const { docId, store } = deps;
  const { setOrphanedFootnotes } = store;

  // Per-pane suppression latch (was a shared ref in EditorLayout pre-cutover).
  const suppressRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handler = (e: Event) => {
      if (isInlineAtomLifecycleOn()) return;
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      if (detail.docId !== docId) return;
      if (suppressRef.current.has(detail.footnoteId)) {
        suppressRef.current.delete(detail.footnoteId);
        return;
      }
      setOrphanedFootnotes((prev) => {
        if (prev.some((o) => o.footnoteId === detail.footnoteId)) return prev;
        return [...prev, {
          footnoteId: detail.footnoteId,
          content: detail.content,
          orphanedAt: new Date().toISOString(),
        }];
      });
    };
    window.addEventListener("virgil-footnote-orphaned", handler);
    return () => window.removeEventListener("virgil-footnote-orphaned", handler);
  }, [docId, setOrphanedFootnotes]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (isInlineAtomLifecycleOn()) return;
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      if (detail.docId !== docId) return;
      suppressRef.current.add(detail.footnoteId);
    };
    window.addEventListener("virgil-footnote-suppress-orphan", handler);
    return () =>
      window.removeEventListener("virgil-footnote-suppress-orphan", handler);
  }, [docId]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (isInlineAtomLifecycleOn()) return;
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      if (detail.docId !== docId) return;
      if (detail.isOrphan) {
        setOrphanedFootnotes((prev) => prev.filter((o) => o.footnoteId !== detail.footnoteId));
      }
    };
    window.addEventListener("virgil-footnote-panel-dropped", handler);
    return () => window.removeEventListener("virgil-footnote-panel-dropped", handler);
  }, [docId, setOrphanedFootnotes]);
}

/**
 * Shell-level archive bridge (flag-agnostic). When a footnote drop target
 * swallows an archive snippet, delete the matching archive entry. `deleteSnippet`
 * targets the active doc's archive. Kept in `EditorLayout` — it has nothing to
 * do with the per-doc orphan store.
 */
export function useFootnoteSyncBridges(deps: {
  deleteSnippet: (id: string) => void;
}) {
  const { deleteSnippet } = deps;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const archiveId = detail?.archiveId;
      if (!archiveId) return;
      deleteSnippet(archiveId);
    };
    window.addEventListener("virgil-footnote-consumed-archive", handler);
    return () => window.removeEventListener("virgil-footnote-consumed-archive", handler);
  }, [deleteSnippet]);
}
