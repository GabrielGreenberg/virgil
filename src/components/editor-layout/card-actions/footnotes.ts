import { useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { JSONContent } from "@tiptap/react";
import type { OrphanedFootnote } from "@/lib/types";
import type { EditorHandle } from "../../Editor";
import { generateEntityId } from "@/lib/uuid";
import { nextCardTitle } from "@/panels/panel-registry";

/**
 * Footnote action handlers that operate on the footnote's editor marker.
 *
 * - `handleEditFootnote` / `handleEditFootnoteTitle` route through the
 *   editor's imperative handle so the marker's attrs stay the source of
 *   truth.
 * - `handleDeleteFootnote` pre-records the id in `suppressOrphanRef` so
 *   the subsequent `virgil-footnote-orphaned` event (fired by the node's
 *   teardown) doesn't revive the footnote as an orphan card.
 * - `handleAddFootnote` creates a brand-new footnote with no editor
 *   marker yet — it lands in `orphanedFootnotes` so the panel can host
 *   the rich-text editor until the user drops it into the document.
 *   Orphan-specific edit/delete handlers live in `./orphans.ts`.
 */
export function useFootnoteActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  suppressOrphanRef: MutableRefObject<Set<string>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setOrphanedFootnotes: Dispatch<SetStateAction<OrphanedFootnote[]>>;
}) {
  const { editorRef, suppressOrphanRef, setSelectedFootnoteId, setOrphanedFootnotes } = deps;

  const handleEditFootnote = useCallback(
    (id: string, newContent: JSONContent) => {
      editorRef.current?.updateFootnoteContent(id, newContent);
    },
    [editorRef],
  );

  const handleEditFootnoteTitle = useCallback(
    (id: string, title: string) => {
      editorRef.current?.updateFootnoteTitle(id, title);
    },
    [editorRef],
  );

  const handleDeleteFootnote = useCallback(
    (id: string) => {
      suppressOrphanRef.current.add(id);
      editorRef.current?.deleteFootnote(id);
      setSelectedFootnoteId(null);
    },
    [editorRef, suppressOrphanRef, setSelectedFootnoteId],
  );

  const handleAddFootnote = useCallback((): string => {
    const id = generateEntityId();
    const anchored = editorRef.current?.getFootnotes().length ?? 0;
    setOrphanedFootnotes((prev) => [
      ...prev,
      {
        footnoteId: id,
        content: { type: "doc", content: [{ type: "paragraph" }] },
        title: nextCardTitle("footnote", anchored + prev.length),
        orphanedAt: new Date().toISOString(),
      },
    ]);
    return id;
  }, [editorRef, setOrphanedFootnotes]);

  return {
    handleEditFootnote,
    handleEditFootnoteTitle,
    handleDeleteFootnote,
    handleAddFootnote,
  };
}
