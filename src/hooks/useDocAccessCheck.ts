"use client";

/**
 * The active paper's access check (task 1459; extracted from EditorLayout).
 *
 * Whenever the active doc changes, look up its folder handle and query (never
 * request) readwrite permission; for a granted paper, also ask whether the
 * folder and its `.tex` are still THERE (task 1102). The result feeds
 * `resolveDocAccessView`, which decides what the pane shows.
 *
 * Two invariants the inline version lacked:
 *   - the handle is held WITH the doc id it was resolved for, and handed out
 *     only for that doc — a stale handle from the previous paper can never
 *     reach the permission gate (whose "Allow access" would grant the wrong
 *     folder, and whose `onGranted` would then call this paper granted);
 *   - every outcome of the check states the paper's load failure, so the
 *     view never has to guess: `no-handle` publishes folder-missing, a
 *     throwing lookup publishes its classified failure, and a successful one
 *     clears whatever stood before.
 *
 * In dev-storage mode there is no folder: the check is always `granted`.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { queryRW, type PermState } from "@/lib/fsa-permissions";
import { getDocHandle } from "@/lib/doc-index";
import {
  classifyDocLoadFailure,
  probeDocFolder,
  publishDocLoadFailure,
} from "@/lib/doc-load-failure";
import { NO_HANDLE_FAILURE, type DocPermState } from "@/lib/doc-access-view";
import { isDevStorage } from "@/lib/storage-mode";

export interface DocAccessCheck {
  docPermState: DocPermState;
  setDocPermState: Dispatch<SetStateAction<DocPermState>>;
  /** The handle resolved for `docId` — null until resolved, and null for any
   *  other doc. */
  handle: FileSystemDirectoryHandle | null;
  /** Run the check again ("Try again", after a Locate). */
  recheck: () => void;
}

export function useDocAccessCheck(
  docId: string | null,
  texFilename: string | null,
): DocAccessCheck {
  const [docPermState, setDocPermState] = useState<DocPermState>("loading");
  const [resolved, setResolved] = useState<{
    docId: string;
    handle: FileSystemDirectoryHandle;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!docId) {
      setDocPermState("no-handle");
      setResolved(null);
      return;
    }
    if (isDevStorage) {
      // No folder to probe: a check (incl. "Try again") clears any standing
      // load failure and lets the pane remount and load afresh.
      publishDocLoadFailure(docId, null);
      setDocPermState("granted");
      return;
    }
    let cancelled = false;
    setDocPermState("loading");
    (async () => {
      let handle: FileSystemDirectoryHandle | undefined;
      try {
        handle = await getDocHandle(docId);
      } catch (err) {
        // The lookup itself failed: there is no handle to grant. Say why,
        // rather than inventing a permission question with nothing to ask.
        console.error("Failed to look up doc folder handle:", err);
        if (cancelled) return;
        setResolved(null);
        publishDocLoadFailure(docId, classifyDocLoadFailure(err));
        setDocPermState("no-handle");
        return;
      }
      if (cancelled) return;
      if (!handle) {
        setResolved(null);
        publishDocLoadFailure(docId, NO_HANDLE_FAILURE);
        setDocPermState("no-handle");
        return;
      }
      setResolved({ docId, handle });
      let state: PermState;
      try {
        state = await queryRW(handle);
      } catch (err) {
        // The handle is real; only the query failed. Asking for the grant
        // from the gate's click is the remedy.
        console.error("Failed to query doc permission:", err);
        if (cancelled) return;
        publishDocLoadFailure(docId, null);
        setDocPermState("needs-grant");
        return;
      }
      if (cancelled) return;
      if (state === "granted" && texFilename) {
        // Task 1102: a stale handle can still answer `granted` for a folder
        // that is gone. Ask whether the paper is still THERE before the pane
        // mounts; an answer either way overwrites any standing failure, so
        // "Try again" after a Finder fix clears the gate.
        const unreachable = await probeDocFolder(handle, texFilename);
        if (cancelled) return;
        publishDocLoadFailure(
          docId,
          unreachable ? { kind: unreachable, detail: "" } : null,
        );
      } else if (state !== "granted") {
        // Granting re-mounts and re-loads the paper, which re-measures it.
        publishDocLoadFailure(docId, null);
      }
      setDocPermState(state === "granted" ? "granted" : "needs-grant");
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, texFilename, attempt]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  const handle = resolved && resolved.docId === docId ? resolved.handle : null;
  return { docPermState, setDocPermState, handle, recheck };
}
