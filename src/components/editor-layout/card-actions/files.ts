import { useCallback, type Dispatch, type SetStateAction } from "react";

type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";

/**
 * Document-lifecycle action handlers: opening an existing file via the
 * native picker, and promoting the permission gate to "granted" once
 * the user clicks through.
 */
export function useFileActions(deps: {
  openExistingFile: () => Promise<unknown>;
  setDocPermState: Dispatch<SetStateAction<DocPermState>>;
  refetchDoc: () => void;
}) {
  const { openExistingFile, setDocPermState, refetchDoc } = deps;

  const handleDocPermissionGranted = useCallback(() => {
    setDocPermState("granted");
    refetchDoc();
  }, [setDocPermState, refetchDoc]);

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
