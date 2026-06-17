"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLibraryHandle,
  pickLibraryFolder,
  ensureReadWritePermission,
  queryReadWritePermission,
  clearLibraryHandle,
  resolveLibraryRootPath,
} from "@library/lib/library-folder";
import { ensureLibraryStructure } from "@library/lib/library-storage";
import { syncSkillBundle, type SyncResult } from "@library/lib/skill-sync";

export type FolderState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "needs-permission"; handle: FileSystemDirectoryHandle }
  | { kind: "ready"; handle: FileSystemDirectoryHandle };

/** A surfaced skill-bundle sync failure for the library folder. Drives a
 *  dismissible banner in LibraryView so a failed sync is a visible, fixable
 *  event rather than a silent console.error. */
export interface SkillSyncError {
  /** True for a revoked/denied FSA permission (NotAllowedError) — the
   *  banner words it as a permission problem and Retry re-grants. */
  permission: boolean;
  message: string;
}

function describeSyncError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

export function useLibraryHandle() {
  const [state, setState] = useState<FolderState>({ kind: "loading" });
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  // Surfaced sync failure (driven into LibraryView's banner). Makes a
  // failed skill sync loud + retryable instead of a silent console.error.
  const [syncError, setSyncError] = useState<SkillSyncError | null>(null);
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

  /**
   * Write the Virgil skill bundle into the library folder. Best-effort on
   * the auto path (library-open), but never silent: any failure becomes a
   * surfaced `syncError` and a successful sync clears it + records lastSync.
   *
   * `regrant` re-acquires a possibly-revoked FSA permission first (e.g.
   * after a PWA reinstall); its prompt must ride a user gesture, so it's
   * only passed from the Re-sync / Retry click, never the auto path.
   */
  const runSkillSync = useCallback(
    async (
      handle: FileSystemDirectoryHandle,
      opts: { dedupe?: boolean; regrant?: boolean } = {},
    ) => {
      if (opts.dedupe && syncedHandleRef.current === handle) return;
      syncedHandleRef.current = handle;
      try {
        if (opts.regrant) {
          const perm = await ensureReadWritePermission(handle);
          if (perm !== "granted") {
            setSyncError({
              permission: true,
              message:
                "Virgil couldn't get permission to write the skill bundle into your library folder. Grant access and try again.",
            });
            return;
          }
        }
        // Library folder writes its own library-path.json pointing to
        // itself. In dev-storage we have the abs path via the dev API;
        // in production FSA we leave it null (handled gracefully by
        // library_path.py's resolution chain).
        const libraryRoot = (await resolveLibraryRootPath()) ?? null;
        const result = await syncSkillBundle(handle, { libraryRoot });
        setSyncError(null);
        setLastSync(result);
      } catch (err) {
        const permission =
          err instanceof DOMException && err.name === "NotAllowedError";
        setSyncError({
          permission,
          message: permission
            ? "Virgil lost permission to write the skill bundle into your library folder (this can happen after reinstalling the app). Click Retry to re-grant access."
            : `Virgil couldn't sync the skill bundle into your library: ${describeSyncError(err)}. Your cowork commands may be out of date — click Retry.`,
        });
        console.error("[skill-sync] failed", err);
      }
    },
    [],
  );

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
    // Best-effort, deduped, and never silent — failures surface via syncError.
    void runSkillSync(handle, { dedupe: true });
  }, [runSkillSync]);

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
    setSyncError(null);
    setState({ kind: "none" });
  }, []);

  /** Manually re-run the skill sync for the library. Clears the per-handle
   *  dedup so the write happens even if this folder already synced, and
   *  re-grants permission from the click. Idempotent. */
  const resyncSkills = useCallback(async () => {
    if (state.kind !== "ready") return;
    syncedHandleRef.current = null;
    await runSkillSync(state.handle, { regrant: true });
  }, [state, runSkillSync]);

  const dismissSyncError = useCallback(() => setSyncError(null), []);

  return {
    state,
    pick,
    grant,
    reset,
    refresh,
    lastSync,
    pickerError,
    syncError,
    resyncSkills,
    dismissSyncError,
  };
}
