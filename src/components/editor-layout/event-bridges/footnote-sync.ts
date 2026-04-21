import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { OrphanedFootnote } from "@/lib/types";

/**
 * Footnote ↔ orphan bookkeeping bridges.
 *
 * - `virgil-footnote-orphaned` — editor node's teardown fires this when
 *   a footnote mark is deleted. We mirror it into `orphanedFootnotes`
 *   so the footnote can still be edited and re-dropped from the panel.
 *   Deletions done via `handleDeleteFootnote` pre-register the id in
 *   `suppressOrphanRef` so the subsequent teardown event doesn't
 *   resurrect the footnote as an orphan card.
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

  useEffect(() => {
    const handler = (e: Event) => {
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

  useEffect(() => {
    const handler = (e: Event) => {
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
