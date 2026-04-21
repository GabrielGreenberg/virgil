import { useCallback, type Dispatch, type SetStateAction } from "react";

type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";

/**
 * Document-lifecycle action handlers: opening an existing file via the
 * native picker, creating a new doc through the tab-strip "+" flow,
 * and promoting the permission gate to "granted" once the user clicks
 * through.
 *
 * `newDocName` is null when the inline input is closed, "" while the
 * user is typing, or a trimmed name ready to commit. The submit handler
 * closes the input on success and keeps it open on error so the user
 * can retry.
 */
export function useFileActions(deps: {
  openExistingFile: () => Promise<unknown>;
  createFile: (name: string) => Promise<unknown>;
  newDocName: string | null;
  setNewDocName: Dispatch<SetStateAction<string | null>>;
  setDocPermState: Dispatch<SetStateAction<DocPermState>>;
  refetchDoc: () => void;
}) {
  const {
    openExistingFile,
    createFile,
    newDocName,
    setNewDocName,
    setDocPermState,
    refetchDoc,
  } = deps;

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

  const handleNewDocStart = useCallback(() => {
    setNewDocName("");
  }, [setNewDocName]);

  const handleNewDocSubmit = useCallback(async () => {
    const name = (newDocName ?? "").trim();
    if (!name) {
      setNewDocName(null);
      return;
    }
    try {
      const meta = await createFile(name);
      if (meta) setNewDocName(null);
    } catch (err) {
      console.error("Failed to create new paper:", err);
    }
  }, [newDocName, setNewDocName, createFile]);

  const handleNewDocCancel = useCallback(() => {
    setNewDocName(null);
  }, [setNewDocName]);

  return {
    handleDocPermissionGranted,
    handleNativeOpen,
    handleNewDocStart,
    handleNewDocSubmit,
    handleNewDocCancel,
  };
}
