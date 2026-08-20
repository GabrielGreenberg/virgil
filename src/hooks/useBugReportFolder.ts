"use client";

/**
 * Folder state machine for the bug-report drop folder — the structural
 * twin of useLibraryHandle, minus the library's structure/skill-sync work.
 * `refresh()` is gated on the window's `open` prop: BugReportWindow is
 * always-mounted (the PrintDialog pattern, so Esc/outside-click hide
 * rather than destroy a half-written report), and an unopened window must
 * cost zero IDB reads.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBugReportHandle,
  pickBugReportFolder,
  clearBugReportHandle,
} from "@/lib/bug-report";
import {
  ensureReadWritePermission,
  queryReadWritePermission,
} from "@library/lib/library-folder";

export type BugReportFolderState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "needs-permission"; handle: FileSystemDirectoryHandle }
  | { kind: "ready"; handle: FileSystemDirectoryHandle };

export function useBugReportFolder(open: boolean) {
  const [state, setState] = useState<BugReportFolderState>({ kind: "loading" });
  // Last error from the picker (or grant) flow — surfaced so a stuck Chrome
  // picker lock or a rejected permission prompt isn't a silent no-op.
  const [pickerError, setPickerError] = useState<string | null>(null);
  // Guard against clicking pick/grant twice while the first
  // showDirectoryPicker / requestPermission is still awaiting user input —
  // the second click trips Chrome's "file picker already active"
  // NotAllowedError (the dialog is often hidden behind the window or on
  // another macOS Space).
  const pickerInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    const handle = await getBugReportHandle();
    if (!handle) {
      setState({ kind: "none" });
      return;
    }
    const perm = await queryReadWritePermission(handle);
    if (perm === "granted") {
      setState({ kind: "ready", handle });
    } else {
      setState({ kind: "needs-permission", handle });
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const pick = useCallback(async () => {
    if (pickerInFlightRef.current) {
      setPickerError(
        "A file picker dialog from your previous click is still open — it may be hidden behind the window, on another macOS Space, or on a secondary display. Find and dismiss it, then try again.",
      );
      return;
    }
    setPickerError(null);
    pickerInFlightRef.current = true;
    let result;
    try {
      result = await pickBugReportFolder();
    } finally {
      pickerInFlightRef.current = false;
    }
    if (result.kind === "ok") {
      setState({ kind: "ready", handle: result.handle });
    } else if (result.kind === "cancelled") {
      // User dismissed the dialog — silent.
    } else {
      setPickerError(result.message);
    }
  }, []);

  const grant = useCallback(async () => {
    if (state.kind !== "needs-permission") return;
    if (pickerInFlightRef.current) {
      setPickerError(
        "A permission prompt from your previous click is still open — it may be hidden behind the window, on another macOS Space, or on a secondary display. Find and dismiss it, then try again.",
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
          "The browser permission prompt is already active (or stuck from a previous attempt). Dismiss any open dialog, then try again.",
        );
        return;
      }
      throw err;
    } finally {
      pickerInFlightRef.current = false;
    }
    if (perm === "granted") {
      setState({ kind: "ready", handle: state.handle });
    }
  }, [state]);

  const reset = useCallback(async () => {
    await clearBugReportHandle();
    setPickerError(null);
    setState({ kind: "none" });
  }, []);

  return { state, pick, grant, reset, refresh, pickerError };
}
