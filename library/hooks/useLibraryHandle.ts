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
  // De-dupe sync across StrictMode double-mounts and rapid re-renders.
  const syncedHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  const becameReady = useCallback(async (handle: FileSystemDirectoryHandle) => {
    await ensureLibraryStructure(handle);
    setState({ kind: "ready", handle });
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
    const handle = await getLibraryHandle();
    if (!handle) {
      setState({ kind: "none" });
      return;
    }
    const perm = await queryReadWritePermission(handle);
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
    const handle = await pickLibraryFolder();
    await becameReady(handle);
  }, [becameReady]);

  const grant = useCallback(async () => {
    if (state.kind !== "needs-permission") return;
    const perm = await ensureReadWritePermission(state.handle);
    if (perm === "granted") {
      await becameReady(state.handle);
    }
  }, [state, becameReady]);

  const reset = useCallback(async () => {
    await clearLibraryHandle();
    syncedHandleRef.current = null;
    setLastSync(null);
    setState({ kind: "none" });
  }, []);

  return { state, pick, grant, reset, refresh, lastSync };
}
