import { useCallback, type Dispatch, type SetStateAction } from "react";

type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";

/**
 * Document-lifecycle action handlers: opening an existing file via the
 * native picker, and promoting the permission gate to "granted" once
 * the user clicks through.
 *
 * Promoting `docPermState` to "granted" causes the EditorPane branch
 * to render and the surrounding `<DocPipeline>` to mount, which in
 * turn fires `useDocument`'s load effect — no explicit refetch is
 * needed.
 */
export function useFileActions(deps: {
  openExistingFile: () => Promise<unknown>;
  setDocPermState: Dispatch<SetStateAction<DocPermState>>;
}) {
  const { openExistingFile, setDocPermState } = deps;

  const handleDocPermissionGranted = useCallback(() => {
    setDocPermState("granted");
  }, [setDocPermState]);

  const handleNativeOpen = useCallback(async () => {
    try {
      await openExistingFile();
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [openExistingFile]);

  return {
    handleDocPermissionGranted,
    handleNativeOpen,
  };
}
