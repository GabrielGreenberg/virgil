import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { OrphanedFootnote } from "@/lib/types";
import { isInlineAtomLifecycleOn } from "@/lib/identity/inline-atom-lifecycle-flag";

/**
 * Footnote ↔ orphan bookkeeping bridges.
 *
 * - `virgil-footnote-orphaned` — editor node's teardown fires this when
 *   a footnote mark is deleted. We mirror it into `orphanedFootnotes`
 *   so the footnote can still be edited and re-dropped from the panel.
 *   Deletions done via `handleDeleteFootnote` pre-register the id in
 *   `suppressOrphanRef` so the subsequent teardown event doesn't
 *   resurrect the footnote as an orphan card.
 * - `virgil-footnote-suppress-orphan` — the PRODUCER side of the
 *   suppression latch. `handleDeleteFootnote` (EditorPane) dispatches
 *   this synchronously, BEFORE removing the atom, so the id is in
 *   `suppressOrphanRef` by the time the orphan-detector's deferred
 *   `virgil-footnote-orphaned` arrives. (The ref lives in EditorLayout
 *   alongside this hook; the delete handler lives in EditorPane — the
 *   window event is the decoupling seam.)
 * - `virgil-footnote-panel-dropped` — panel reports that the orphan was
 *   dropped back into the doc; we clear the orphan slot.
 * - `virgil-footnote-consumed-archive` — a footnote drop target swallowed
 *   an archive snippet; delete the archive entry to match.
 */
export function useFootnoteSyncBridges(deps: {
  suppressOrphanRef: MutableRefObject<Set<string>>;
  setOrphanedFootnotes: Dispatch<SetStateAction<OrphanedFootnote[]>>;
  deleteSnippet: (id: string) => void;
}) {
  const { suppressOrphanRef, setOrphanedFootnotes, deleteSnippet } = deps;

  // W2 cutover: flag-ON the bus reconciler (`useInlineAtomLifecycle`) is the
  // SOLE orphan store writer (the durable sidecar), so this legacy event web
  // is RETIRED — each handler bails before touching the (now-dormant) shell
  // `orphanedFootnotes` state, leaving ONE store. Flag-OFF every handler runs
  // exactly as before (byte-identical). The flag is read inside each handler
  // (at event time, not mount time) so a per-test toggle takes effect without
  // re-subscribing. The archive bridge below is flag-agnostic (unrelated).
  useEffect(() => {
    const handler = (e: Event) => {
      if (isInlineAtomLifecycleOn()) return;
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      if (suppressOrphanRef.current.has(detail.footnoteId)) {
        suppressOrphanRef.current.delete(detail.footnoteId);
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
  }, [suppressOrphanRef, setOrphanedFootnotes]);

  // Producer for the orphan-suppression latch. A deliberate trash-delete
  // (`handleDeleteFootnote`) fires this before removing the atom; we arm
  // `suppressOrphanRef` so the immediately-following `virgil-footnote-
  // orphaned` is swallowed instead of resurrecting the footnote as an
  // orphan card. O(1) per event; no doc walk.
  useEffect(() => {
    const handler = (e: Event) => {
      if (isInlineAtomLifecycleOn()) return;
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      suppressOrphanRef.current.add(detail.footnoteId);
    };
    window.addEventListener("virgil-footnote-suppress-orphan", handler);
    return () =>
      window.removeEventListener("virgil-footnote-suppress-orphan", handler);
  }, [suppressOrphanRef]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (isInlineAtomLifecycleOn()) return;
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      if (detail.isOrphan) {
        setOrphanedFootnotes((prev) => prev.filter((o) => o.footnoteId !== detail.footnoteId));
      }
    };
    window.addEventListener("virgil-footnote-panel-dropped", handler);
    return () => window.removeEventListener("virgil-footnote-panel-dropped", handler);
  }, [setOrphanedFootnotes]);

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
