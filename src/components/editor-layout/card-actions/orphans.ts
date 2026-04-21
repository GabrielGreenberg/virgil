import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { OrphanedFootnote } from "@/lib/types";

/**
 * Orphaned-footnote handlers. An orphan is a footnote that exists in
 * the side panel but has no corresponding editor marker — either freshly
 * created through the footnote panel's "+" or left over after the user
 * deleted the marker in the document. The panel hosts its own rich-text
 * editor for each orphan; these handlers persist the edits into
 * `orphanedFootnotes` state.
 */
export function useOrphanActions(deps: {
  setOrphanedFootnotes: Dispatch<SetStateAction<OrphanedFootnote[]>>;
}) {
  const { setOrphanedFootnotes } = deps;

  const handleDeleteOrphan = useCallback(
    (id: string) => {
      setOrphanedFootnotes((prev) => prev.filter((o) => o.footnoteId !== id));
    },
    [setOrphanedFootnotes],
  );

  const handleEditOrphan = useCallback(
    (id: string, newContent: unknown) => {
      setOrphanedFootnotes((prev) =>
        prev.map((o) => (o.footnoteId === id ? { ...o, content: newContent } : o)),
      );
    },
    [setOrphanedFootnotes],
  );

  const handleEditOrphanTitle = useCallback(
    (id: string, title: string) => {
      setOrphanedFootnotes((prev) =>
        prev.map((o) => (o.footnoteId === id ? { ...o, title } : o)),
      );
    },
    [setOrphanedFootnotes],
  );

  return { handleDeleteOrphan, handleEditOrphan, handleEditOrphanTitle };
}
