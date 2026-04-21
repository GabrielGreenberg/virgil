import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import type { ArchivedSnippet } from "@/lib/types";
import type { EditorHandle } from "../../Editor";

/**
 * Archive action handlers.
 *
 * - `handleArchive` is the toolbar action: pull selected text, create a
 *   snippet, then let the editor handle (which knows its PM state) do
 *   the delete + rich-content extraction. The hook gives us the empty
 *   snippet up front so the editor can tag its marker with the id.
 * - `handleArchiveCapture` is the drop-side counterpart: content is
 *   already extracted by `usePanelCapture` (grip-drag / text-drag), we
 *   just anchor and persist.
 * - Insert, restore, delete follow the same archive-hook mutators; the
 *   local `insertingRef` debounces back-to-back inserts (paragraph
 *   drops fire both Archive and PanelCapture on some paths).
 */
export function useArchiveActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  archiveContent: (content: unknown) => ArchivedSnippet;
  updateArchiveSnippet: (id: string, content: unknown) => void;
  addArchiveParagraphId: (id: string, paragraphId: string) => void;
  archiveSnippets: ArchivedSnippet[];
  deleteSnippet: (id: string) => void;
  restoreSnippet: (id: string) => ArchivedSnippet | null | undefined;
  setSelectedArchiveId: Dispatch<SetStateAction<string | null>>;
  prefs: ViewPrefs;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
}) {
  const {
    editorRef,
    archiveContent,
    updateArchiveSnippet,
    addArchiveParagraphId,
    archiveSnippets,
    deleteSnippet,
    restoreSnippet,
    setSelectedArchiveId,
    prefs,
    setActiveLeft,
    setActiveRight,
  } = deps;

  const handleArchive = useCallback(() => {
    if (!editorRef.current) return;
    const selectedText = editorRef.current.getSelectedText();
    if (!selectedText || !selectedText.trim()) return;
    const snippet = archiveContent(selectedText);
    const result = editorRef.current.archiveSelection(snippet.id);
    if (result) {
      if (result.content) updateArchiveSnippet(snippet.id, result.content);
      if (result.paragraphId) addArchiveParagraphId(snippet.id, result.paragraphId);
    }
    const archivePlacement = prefs.placements.find((p) => p.id === "archive");
    if (archivePlacement?.side === "left") {
      if (prefs.activeLeft !== "archive") setActiveLeft("archive");
    } else {
      if (prefs.activeRight !== "archive") setActiveRight("archive");
    }
  }, [editorRef, archiveContent, updateArchiveSnippet, addArchiveParagraphId, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight]);

  const handleArchiveCapture = useCallback(
    ({ content, paragraphId }: { content: unknown; paragraphId: string | null }) => {
      const snippet = archiveContent(content);
      if (paragraphId) addArchiveParagraphId(snippet.id, paragraphId);
      const archivePlacement = prefs.placements.find((p) => p.id === "archive");
      if (archivePlacement?.side === "left") {
        if (prefs.activeLeft !== "archive") setActiveLeft("archive");
      } else {
        if (prefs.activeRight !== "archive") setActiveRight("archive");
      }
    },
    [archiveContent, addArchiveParagraphId, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight],
  );

  const insertingRef = useRef(false);
  const handleInsertArchive = useCallback(
    (id: string) => {
      if (insertingRef.current) return;
      insertingRef.current = true;
      const found = archiveSnippets.find((s) => s.id === id);
      if (found && editorRef.current) {
        editorRef.current.restoreArchive(found.content);
        deleteSnippet(id);
        setSelectedArchiveId(null);
      }
      requestAnimationFrame(() => { insertingRef.current = false; });
    },
    [editorRef, archiveSnippets, deleteSnippet, setSelectedArchiveId],
  );

  const handleRestoreArchive = useCallback(
    (id: string) => {
      const snippet = restoreSnippet(id);
      if (snippet) {
        editorRef.current?.restoreArchive(snippet.content);
      }
      setSelectedArchiveId(null);
    },
    [editorRef, restoreSnippet, setSelectedArchiveId],
  );

  const handleDeleteArchive = useCallback(
    (id: string) => {
      deleteSnippet(id);
      setSelectedArchiveId(null);
    },
    [deleteSnippet, setSelectedArchiveId],
  );

  return {
    handleArchive,
    handleArchiveCapture,
    handleInsertArchive,
    handleRestoreArchive,
    handleDeleteArchive,
  };
}
