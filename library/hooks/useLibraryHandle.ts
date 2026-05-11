"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLibraryHandle,
  pickLibraryFolder,
  ensureReadWritePermission,
  queryReadWritePermission,
  clearLibraryHandle,
} from "@library/lib/library-folder";
import { ensureLibraryStructure } from "@library/lib/library-storage";
import { syncSkillBundle, type SyncResult } from "@library/lib/skill-sync";

export type FolderState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "needs-permission"; handle: FileSystemDirectoryHandle }
  | { kind: "ready"; handle: FileSystemDirectoryHandle };

export function useLibraryHandle() {
  const [state, setState] = useState<FolderState>({ kind: "loading" });
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  // Last error from the picker (or grant) flow. Cleared on each fresh
  // attempt; surfaced to the UI so a stuck Chrome picker lock or a
  // permission-prompt rejection isn't a silent no-op.
  const [pickerError, setPickerError] = useState<string | null>(null);
  // De-dupe sync across StrictMode double-mounts and rapid re-renders.
  const syncedHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  // Guard against clicking the picker button twice while the first
  // showDirectoryPicker / requestPermission call is still awaiting
  // user input. Without this, the second click triggers Chrome's
  // "file picker already active" NotAllowedError because the OS
  // dialog from the first click is technically still open (often
  // behind the window or on another macOS Space, where the user
  // can't see it).
  const pickerInFlightRef = useRef(false);

  const becameReady = useCallback(async (handle: FileSystemDirectoryHandle) => {
    console.log("[library] becameReady: starting ensureLibraryStructure");
    // Watchdog: if any FSA call inside ensureLibraryStructure stalls
    // without throwing or resolving (rare but observed under some
    // platform conditions — iCloud Drive sync, locked folders, OS
    // permission prompts that never close), Promise.race lets us
    // proceed to a usable "ready" state instead of stranding the user
    // on the "Loading…" screen forever.
    const STRUCTURE_TIMEOUT_MS = 8000;
    let timedOut = false;
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve("timeout");
      }, STRUCTURE_TIMEOUT_MS),
    );
    try {
      const result = await Promise.race([
        ensureLibraryStructure(handle).then(() => "ok" as const),
        timeout,
      ]);
      if (result === "timeout") {
        console.warn(
          `[library] ensureLibraryStructure did not finish within ${STRUCTURE_TIMEOUT_MS}ms — proceeding to "ready" anyway. ` +
            "This usually means a File System Access call is stuck (iCloud sync, locked folder, OS permission prompt). " +
            "The library will load in degraded mode; some bootstrap files may be missing.",
        );
      } else {
        console.log("[library] becameReady: ensureLibraryStructure done");
      }
    } catch (err) {
      // Don't gate library load on bootstrap. The handle is permissioned;
      // give the user a usable view (degraded if seeds are missing) rather
      // than stranding them on an unhandled rejection.
      console.error("[library] ensureLibraryStructure failed; loading anyway", err);
    }
    setState({ kind: "ready", handle });
    console.log("[library] becameReady: state set to ready", { timedOut });
    if (syncedHandleRef.current === handle) return;
    syncedHandleRef.current = handle;
    try {
      const result = await syncSkillBundle(handle);
      setLastSync(result);
    } catch (err) {
      console.error("[skill-sync] failed", err);
    }
  }, []);

  const refresh = useCallback(async () => {
    console.log("[library] refresh: reading stored handle from IDB");
    const handle = await getLibraryHandle();
    if (!handle) {
      console.log("[library] refresh: no handle stored — state -> none");
      setState({ kind: "none" });
      return;
    }
    console.log("[library] refresh: handle present — querying permission");
    const perm = await queryReadWritePermission(handle);
    console.log("[library] refresh: permission =", perm);
    if (perm === "granted") {
      await becameReady(handle);
    } else {
      setState({ kind: "needs-permission", handle });
    }
  }, [becameReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pick = useCallback(async () => {
    console.log("[library] pick: click received");
    if (pickerInFlightRef.current) {
      console.warn(
        "[library] pick: ignoring click — a picker dialog is already open. Look for a hidden file dialog (Mission Control, other Spaces, secondary display).",
      );
      setPickerError(
        "A file picker dialog from your previous click is still open — but it may be hidden behind the window, on another macOS Space, or on a secondary display. Find and dismiss it (or fully quit and reopen this app), then try again.",
      );
      return;
    }
    setPickerError(null);
    pickerInFlightRef.current = true;
    let result;
    try {
      result = await pickLibraryFolder();
    } finally {
      pickerInFlightRef.current = false;
    }
    if (result.kind === "ok") {
      await becameReady(result.handle);
    } else if (result.kind === "cancelled") {
      // User dismissed the dialog — silent.
    } else {
      // "locked" or "error" — surface to the UI.
      setPickerError(result.message);
    }
  }, [becameReady]);

  const grant = useCallback(async () => {
    if (state.kind !== "needs-permission") return;
    if (pickerInFlightRef.current) {
      setPickerError(
        "A permission prompt from your previous click is still open — but it may be hidden behind the window, on another macOS Space, or on a secondary display. Find and dismiss it (or fully quit and reopen this app), then try again.",
      );
      return;
    }
    setPickerError(null);
    pickerInFlightRef.current = true;
    let perm: PermissionState;
    try {
      perm = await ensureReadWritePermission(state.handle);
    } catch (err) {
      const name = (err as DOMException)?.name;
      // Chrome's "file picker already active" can fire from
      // requestPermission too. Don't crash — let the user retry.
      if (name === "AbortError") return;
      if (name === "NotAllowedError") {
        setPickerError(
          "The browser permission prompt is already active (or stuck from a previous attempt). " +
            "Dismiss any open dialog, then try again. If nothing visible is open, fully quit and reopen the app window.",
        );
        return;
      }
      throw err;
    } finally {
      pickerInFlightRef.current = false;
    }
    if (perm === "granted") {
      await becameReady(state.handle);
    }
  }, [state, becameReady]);

  const reset = useCallback(async () => {
    await clearLibraryHandle();
    syncedHandleRef.current = null;
    setLastSync(null);
    setPickerError(null);
    setState({ kind: "none" });
  }, []);

  return { state, pick, grant, reset, refresh, lastSync, pickerError };
}
