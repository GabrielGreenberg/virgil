"use client";

// The Library folder gate's hook — a thin adapter over the ONE app-level
// library root (`library-root-store.ts`, task 766). Every surface that calls
// it — the Library tab, each torn-out Library outer tab, each popped-out
// paper tab — reads the same root, so a Reset or re-pick in any of them moves
// all of them (and, via the stamp, every other window). Only `pickerError` is
// per-surface: it belongs to the gate whose button was clicked.

import { useCallback, useState } from "react";
import {
  useLibraryRoot,
  resolveLibraryRoot,
  retryLibraryRoot,
  pickLibraryRoot,
  grantLibraryRoot,
  resetLibraryRoot,
  resyncLibrarySkills,
  dismissLibrarySyncError,
} from "@library/lib/library-root-store";

export type { FolderState, SkillSyncError } from "@library/lib/library-root-store";

/** Worded for the gate when the browser answers a grant with "denied".
 *  Chrome remembers a denial per site, so re-clicking cannot re-prompt; the
 *  way back is the site's own permission settings (task 764). */
export const GRANT_DENIED_MESSAGE =
  "Access to your library folder was denied, so the browser won't ask again from this button. " +
  "Open this site's settings (the icon left of the address bar → Site settings), allow file editing, " +
  "then click Grant access — or pick a different folder.";

const PICKER_BUSY_MESSAGE =
  "A file picker dialog from your previous click is still open — but it may be hidden behind the window, on another macOS Space, or on a secondary display. Find and dismiss it (or fully quit and reopen this app), then try again.";

const GRANT_BUSY_MESSAGE =
  "The browser permission prompt is already active (or stuck from a previous attempt). " +
  "Dismiss any open dialog, then try again. If nothing visible is open, fully quit and reopen the app window.";

export function useLibraryHandle() {
  const { state, lastSync, syncError } = useLibraryRoot();
  // Last error from THIS gate's picker (or grant) flow. Cleared on each fresh
  // attempt; surfaced so a stuck Chrome picker lock or a permission-prompt
  // rejection isn't a silent no-op.
  const [pickerError, setPickerError] = useState<string | null>(null);

  const pick = useCallback(async () => {
    setPickerError(null);
    const r = await pickLibraryRoot();
    if (r.kind === "busy") setPickerError(PICKER_BUSY_MESSAGE);
    else if (r.kind === "error") setPickerError(r.message);
    // "cancelled" — the user dismissed the dialog: silent.
  }, []);

  const grant = useCallback(async () => {
    setPickerError(null);
    const r = await grantLibraryRoot();
    if (r.kind === "busy") setPickerError(GRANT_BUSY_MESSAGE);
    else if (r.kind === "error") setPickerError(r.message);
    else if (r.kind === "not-granted") {
      // "denied" (or a prompt dismissed back to "prompt"): say so — the gate
      // otherwise looks exactly as it did before the click.
      setPickerError(
        r.perm === "denied"
          ? GRANT_DENIED_MESSAGE
          : "Access wasn't granted. Click Grant access and choose Allow in the browser's prompt.",
      );
    }
  }, []);

  const reset = useCallback(async () => {
    setPickerError(null);
    await resetLibraryRoot();
  }, []);

  return {
    state,
    pick,
    grant,
    reset,
    refresh: resolveLibraryRoot,
    retry: retryLibraryRoot,
    lastSync,
    pickerError,
    syncError,
    resyncSkills: resyncLibrarySkills,
    dismissSyncError: dismissLibrarySyncError,
  };
}
