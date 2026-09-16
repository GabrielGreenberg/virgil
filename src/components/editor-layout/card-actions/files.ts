import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { FsaDocMeta } from "@/lib/doc-index";

type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";

/**
 * Document-lifecycle action handlers: opening an existing file via the
 * native picker, and promoting the permission gate to "granted" once
 * the user clicks through.
 *
 * The grant is also reported to `useFiles` (`noteDocAccessGranted`) —
 * the one way the current doc becomes writable without `currentDocId`
 * changing — so its skill-bundle auto-sync, skipped while the folder
 * was ungranted, runs now (task 602).
 *
 * Promoting `docPermState` to "granted" causes the EditorPane branch
 * to render and the surrounding `<DocPipeline>` to mount, which in
 * turn fires `useDocument`'s load effect — no explicit refetch is
 * needed.
 *
 * `handleNativeOpen` returns the registered `FsaDocMeta` on success
 * (or `null` when the user cancelled / picked a multi-tex folder that
 * triggers a follow-up modal). Callers that need to chain a side
 * effect on the newly-opened doc — e.g. adding it to the Library's
 * "My Papers" curated list — use the return value.
 */
export function useFileActions(deps: {
  openExistingFile: () => Promise<FsaDocMeta | null | undefined>;
  setDocPermState: Dispatch<SetStateAction<DocPermState>>;
  noteDocAccessGranted: () => void;
}) {
  const { openExistingFile, setDocPermState, noteDocAccessGranted } = deps;

  const handleDocPermissionGranted = useCallback(() => {
    setDocPermState("granted");
    noteDocAccessGranted();
  }, [setDocPermState, noteDocAccessGranted]);

  const handleNativeOpen = useCallback(async (): Promise<FsaDocMeta | null> => {
    try {
      const result = await openExistingFile();
      return result ?? null;
    } catch (err) {
      console.error("Failed to open file:", err);
      return null;
    }
  }, [openExistingFile]);

  return {
    handleDocPermissionGranted,
    handleNativeOpen,
  };
}
