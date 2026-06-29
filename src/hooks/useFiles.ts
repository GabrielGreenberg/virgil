"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  listDocs,
  createDocFromPicker,
  createDocInFolder,
  drainDoc,
  pickProjectFolder,
  registerDocInFolder,
  renameDoc as renameDocStorage,
  deleteDocFromIndex,
  type FolderPickResult,
} from "@/lib/storage";
import {
  forgetWindow,
  getDocHandle,
  OUTER_LIBRARY_PREFIX,
  OUTER_LIBRARY_ROOT_ID,
  OUTER_PAPER_PREFIX,
  readTabs,
  touchDocAccessed,
  touchWindow,
  writeTabs,
  type ActivePaneKind,
  type FsaDocMeta,
} from "@/lib/doc-index";
import { syncSkillBundle } from "@library/lib/skill-sync";
import { resolveLibraryRootPath } from "@library/lib/library-folder";
import {
  EXAMPLE_DOC_ID,
  ExampleUnavailableError,
  ensureExampleSeeded,
  resetExample,
} from "@/lib/example-doc/example-seeder";
import { ensureRW } from "@/lib/fsa-permissions";
import { getWindowId } from "@/lib/multi-window/window-id";
import {
  claimDoc,
  ownsDoc,
  releaseAll,
  releaseDoc,
  requestHandoff,
} from "@/lib/multi-window/doc-ownership";
import { subscribe, type BusEvent } from "@/lib/multi-window/bus";
import { useSystemDialog } from "@/components/system-dialog-host";

/** A surfaced skill-bundle sync failure for the open paper folder. Drives
 *  a dismissible top-bar banner (see SkillSyncControls) so a failed sync
 *  is a visible, fixable event rather than a silent console.error. */
export interface SkillSyncError {
  /** True when the failure is a revoked/denied FSA permission
   *  (NotAllowedError) — the banner words it as a permission problem and
   *  Retry re-grants via the user-gesture click. */
  permission: boolean;
  /** Human-readable explanation shown in the banner. */
  message: string;
}

/** A surfaced "skills updated" notice. Fires only when a sync actually
 *  WROTE files, so the user is told to restart their cowork session. */
export interface SkillSyncNotice {
  version: string;
  filesWritten: number;
}

function describeSyncError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

/**
 * Manages the workspace tabs and the doc index.
 *
 * Tab state is persisted to IndexedDB so reloads restore the same set
 * of open papers. Loading the actual document content (or prompting
 * for permission) is the responsibility of EditorLayout, not this hook.
 *
 * Invariants:
 *   - `outerOrder[0]` is always `OUTER_LIBRARY_ROOT_ID` — the singleton
 *     Library outer tab. New docs / papers / tear-out library tabs
 *     insert at index ≥ 1; close paths refuse the singleton id.
 */
export function useFiles() {
  const [docs, setDocs] = useState<FsaDocMeta[]>([]);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [activePane, setActivePaneState] = useState<ActivePaneKind>("doc");
  // Source of truth for the Virgil-bar tab ORDER. Doc ids appear bare;
  // paper outer tabs use the `paper:<citekey>` prefix; the pinned
  // singleton Library tab uses `OUTER_LIBRARY_ROOT_ID`. openTabIds
  // remains the source of truth for which docs are open (claim/release,
  // file mounting, etc.) — outerOrder only reorders + interleaves.
  const [outerOrder, setOuterOrder] = useState<string[]>([
    OUTER_LIBRARY_ROOT_ID,
  ]);
  const [currentPaperCitekey, setCurrentPaperCitekey] = useState<string | null>(
    null,
  );
  const [currentLibraryOuterId, setCurrentLibraryOuterId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [pendingFolderPick, setPendingFolderPick] = useState<FolderPickResult | null>(null);
  const hydratedRef = useRef(false);
  const outerOrderRef = useRef(outerOrder);
  outerOrderRef.current = outerOrder;

  const dialog = useSystemDialog();

  // Initial load: read both the doc index and the persisted tab state
  // for THIS window. The windowId is stable across reloads (sessionStorage)
  // and unique per window, so each browser window has its own tab set.
  // For each restored tab, attempt to claim the cross-window lock. Tabs
  // currently owned by another window are dropped from the restore set
  // (the user can reopen via the handoff flow).
  useEffect(() => {
    const windowId = getWindowId();
    (async () => {
      try {
        const [docList, tabs] = await Promise.all([
          listDocs(),
          readTabs(windowId),
        ]);
        setDocs(docList);
        const candidates = tabs.openTabIds.filter((id) =>
          docList.some((d) => d.id === id),
        );
        const claimed: string[] = [];
        for (const id of candidates) {
          const result = await claimDoc(id);
          if (result.owned) claimed.push(id);
        }
        setOpenTabIds(claimed);
        setCurrentDocId(
          tabs.currentDocId && claimed.includes(tabs.currentDocId)
            ? tabs.currentDocId
            : (claimed[0] ?? null),
        );
        // Backfill outerOrder from openTabIds for legacy registries with
        // no recorded order. Filter to entries that are still valid:
        // doc ids must be in `claimed`; paper / library outer ids stay
        // (they don't have window claims). The Library root sentinel is
        // always pinned at index 0 as a defensive backstop, even if a
        // pre-pinned legacy registry had it elsewhere.
        const baseOrder = tabs.outerOrder ?? claimed;
        const filteredOrder = baseOrder.filter((id) =>
          id === OUTER_LIBRARY_ROOT_ID ||
          id.startsWith(OUTER_PAPER_PREFIX) ||
          id.startsWith(OUTER_LIBRARY_PREFIX)
            ? true
            : claimed.includes(id),
        );
        // Append any claimed doc ids that aren't already in the order
        // (defensive: stays consistent if openTabIds changed independently).
        for (const id of claimed) {
          if (!filteredOrder.includes(id)) filteredOrder.push(id);
        }
        // Pin the Library root at index 0.
        const withoutRoot = filteredOrder.filter(
          (id) => id !== OUTER_LIBRARY_ROOT_ID,
        );
        const pinnedOrder = [OUTER_LIBRARY_ROOT_ID, ...withoutRoot];
        setOuterOrder(pinnedOrder);
        setCurrentPaperCitekey(tabs.currentPaperCitekey ?? null);
        setCurrentLibraryOuterId(tabs.currentLibraryOuterId ?? null);
        // Map any legacy "library" pane kind to "doc" — the inline
        // shadow Library pane was removed in favor of the singleton
        // outer Library tab.
        const restoredPane = tabs.activePane ?? "doc";
        setActivePaneState(
          (restoredPane as string) === "library" ? "doc" : restoredPane,
        );
      } catch (err) {
        console.error("Failed to load files index:", err);
      } finally {
        hydratedRef.current = true;
        setLoading(false);
      }
    })();
  }, []);

  // Persist tab state on every change after initial hydration. Also
  // refresh this window's entry in the windows registry so other
  // windows can see what we have open (and so a stale window gets
  // detected if it stops heartbeating).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const windowId = getWindowId();
    writeTabs(windowId, {
      openTabIds,
      currentDocId,
      activePane,
      outerOrder,
      currentPaperCitekey,
      currentLibraryOuterId,
    }).catch(() => {});
    touchWindow(windowId, openTabIds).catch(() => {});
  }, [
    openTabIds,
    currentDocId,
    activePane,
    outerOrder,
    currentPaperCitekey,
    currentLibraryOuterId,
  ]);

  // Mirror openTabIds in a ref so the heartbeat interval reads the
  // latest set without having to re-arm the timer on every change.
  const openTabIdsRef = useRef(openTabIds);
  useEffect(() => {
    openTabIdsRef.current = openTabIds;
  }, [openTabIds]);

  // Register this window in the registry on mount, heartbeat every 30s,
  // and forget it on `pagehide` so a clean close doesn't leave orphan
  // tabs records behind. Also release every held doc lock so peer
  // windows see availability immediately.
  useEffect(() => {
    const windowId = getWindowId();
    touchWindow(windowId, openTabIdsRef.current).catch(() => {});
    const heartbeat = window.setInterval(() => {
      touchWindow(windowId, openTabIdsRef.current).catch(() => {});
    }, 30_000);
    const onHide = () => {
      forgetWindow(windowId).catch(() => {});
      releaseAll().catch(() => {});
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  const bumpAccessed = useCallback((id: string) => {
    const now = new Date().toISOString();
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, lastAccessedAt: now } : d)),
    );
    touchDocAccessed(id).catch(() => {});
  }, []);

  /**
   * Flush-on-switch barrier — wait for the outgoing doc's queued writes
   * (autosave bundle, sidecars, bib) to finish before its pipeline ends.
   *
   * Layer 1 (DocWriteHandle.assertActive) already prevents cross-doc
   * overwrite by rejecting writes whose pipeline has ended. This barrier
   * is the data-PRESERVATION half: without it, A's pending autosave
   * gets rejected when A's pipeline ends, and A's most recent edits are
   * lost. With it, A's writes complete on A's still-active pipeline
   * before <DocPipeline key={docId}> remounts and ends the pipeline.
   *
   * LOAD-BEARING UNDER MULTI-DOC KEEP-ALIVE: when the outgoing doc stays
   * mounted-but-hidden across the switch (the keep-alive LRU keeps it warm),
   * there is NO unmount, so `useDocument`'s unmount-cleanup flush does NOT fire
   * on the switch. This `drainDoc` is then the SOLE switch-time flush barrier
   * (it captures the outgoing editor's live `getJSON()` snapshot synchronously
   * at call time, then lets the write settle in the background on the warm
   * pipeline). Any future refactor of the switch handlers MUST keep calling
   * `flushOutgoing` first, or in-debounce edits silently drop with no remount to
   * catch them.
   *
   * Sync paths fire-and-forget; the data-loss risk window is small and
   * the storage layer's correctness guarantee is unaffected either way.
   */
  const flushOutgoing = useCallback((prevId: string | null, nextId: string | null) => {
    if (prevId && prevId !== nextId) {
      drainDoc(prevId).catch(() => {});
    }
  }, []);

  /** Append `id` at the end of outerOrder. Defensively re-pins the
   *  Library root at index 0 if it's missing or out of place. No-op
   *  when `id` is already present. */
  const appendToOuterOrder = useCallback((id: string) => {
    setOuterOrder((prev) => {
      if (prev.includes(id)) return prev;
      const withoutRoot = prev.filter((x) => x !== OUTER_LIBRARY_ROOT_ID);
      return [OUTER_LIBRARY_ROOT_ID, ...withoutRoot, id];
    });
  }, []);

  /** Insert `id` at `dropIdx`, clamped to [1, length] so the Library
   *  root stays pinned at index 0. `dropIdx` is interpreted as a slot
   *  in the *displayed* outerOrder (with the root at index 0); a value
   *  of 0 is treated as 1 (insert just after the root). When `id` is
   *  already present, no reordering happens. */
  const insertIntoOuterOrder = useCallback(
    (id: string, dropIdx: number | undefined) => {
      setOuterOrder((prev) => {
        if (prev.includes(id)) return prev;
        // Defensively normalize: root pinned at index 0.
        const withoutRoot = prev.filter((x) => x !== OUTER_LIBRARY_ROOT_ID);
        const normalized = [OUTER_LIBRARY_ROOT_ID, ...withoutRoot];
        const target =
          typeof dropIdx === "number"
            ? Math.max(1, Math.min(dropIdx, normalized.length))
            : normalized.length;
        const next = [...normalized];
        next.splice(target, 0, id);
        return next;
      });
    },
    [],
  );

  /** Remove `id` from outerOrder, refusing to remove the Library root. */
  const removeFromOuterOrder = useCallback((id: string) => {
    if (id === OUTER_LIBRARY_ROOT_ID) return;
    setOuterOrder((prev) => prev.filter((t) => t !== id));
  }, []);

  const openFile = useCallback(
    async (id: string) => {
      // Re-opening the example from recents self-heals the OPFS sandbox:
      // idempotent (a cheap no-op when the marker is current), but it
      // re-seeds + re-`setDocHandle` if OPFS was cleared while the index
      // row survived (dead-handle case), so the normal open below finds a
      // live handle. No-op/ignored when OPFS isn't available.
      if (id === EXAMPLE_DOC_ID) {
        try {
          await ensureExampleSeeded();
        } catch (err) {
          if (!(err instanceof ExampleUnavailableError)) {
            console.error("Failed to prepare example:", err);
          }
        }
      }
      // Drain pending writes for the doc we're switching away from
      // BEFORE its pipeline ends, so its autosave isn't lost.
      const prev = currentDocIdRef.current;
      if (prev && prev !== id) await drainDoc(prev);
      // Already open in this window — no claim needed, just activate.
      if (ownsDoc(id)) {
        setCurrentDocId(id);
        setActivePaneState("doc");
        return;
      }
      // Try to acquire the cross-window lock. If it's held elsewhere,
      // confirm handoff with the user, then ask the other window to
      // release before claiming.
      let result = await claimDoc(id);
      if (!result.owned) {
        const meta = docs.find((d) => d.id === id);
        const docLabel = meta?.name ?? meta?.folderName ?? "this document";
        const ok = await dialog.confirm({
          title: "Document is open elsewhere",
          message: `${docLabel} is open in another Virgil window. Move it here?`,
          confirmLabel: "Move it here",
          cancelLabel: "Keep it there",
        });
        if (!ok) return;
        const released = await requestHandoff(id);
        if (!released) {
          await dialog.alert({
            title: "Couldn't move the document",
            message:
              "The other window didn't release the document in time. Try again, or close it there first.",
            tone: "danger",
          });
          return;
        }
        result = await claimDoc(id);
        if (!result.owned) return;
      }
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      appendToOuterOrder(id);
      setCurrentDocId(id);
      setActivePaneState("doc");
      bumpAccessed(id);
    },
    [appendToOuterOrder, bumpAccessed, dialog, docs],
  );

  const closeTab = useCallback(
    (id: string) => {
      // Closing the active tab counts as a doc switch — drain its
      // pending writes first. Fire-and-forget; the storage layer's
      // pipeline check still prevents any cross-doc corruption even
      // if a write lands after the unmount.
      if (id === currentDocId) flushOutgoing(id, null);
      setOpenTabIds((prev) => {
        const next = prev.filter((t) => t !== id);
        if (id === currentDocId) {
          const idx = prev.indexOf(id);
          const newActive = next[Math.min(idx, next.length - 1)] || null;
          setCurrentDocId(newActive);
        }
        return next;
      });
      removeFromOuterOrder(id);
      releaseDoc(id).catch(() => {});
    },
    [currentDocId, flushOutgoing, removeFromOuterOrder],
  );

  // Listen for handoff requests from peer windows. When another window
  // wants a doc we own, close its tab gracefully (write queue + lock
  // serialize together, so any in-flight save finishes before release).
  useEffect(() => {
    const onEvent = (e: BusEvent) => {
      if (e.type !== "doc-handoff-request") return;
      if (e.toWindowId !== getWindowId()) return;
      if (!ownsDoc(e.docId)) return;
      // Reuse closeTab to update UI + release the lock.
      // closeTab reads currentDocId from closure, but the dependency
      // array on this effect intentionally excludes it — closing the
      // tab is correct regardless of which doc is active.
      // Peer wants this doc — drain its pending writes before we
      // release. withDocLock holds the cross-window lock until the
      // active task completes, so this also serializes against the
      // peer's claim.
      drainDoc(e.docId).catch(() => {});
      setOpenTabIds((prev) => {
        const next = prev.filter((t) => t !== e.docId);
        if (e.docId === currentDocIdRef.current) {
          const idx = prev.indexOf(e.docId);
          const newActive = next[Math.min(idx, next.length - 1)] || null;
          setCurrentDocId(newActive);
        }
        return next;
      });
      setOuterOrder((prev) =>
        prev.filter((t) => t !== e.docId && t !== OUTER_LIBRARY_ROOT_ID).length === 0
          ? [OUTER_LIBRARY_ROOT_ID]
          : prev.filter((t) => t !== e.docId),
      );
      releaseDoc(e.docId).catch(() => {});
    };
    return subscribe(onEvent);
  }, []);

  // Mirror currentDocId so the bus handler reads the latest value
  // without re-subscribing on every change.
  const currentDocIdRef = useRef(currentDocId);
  useEffect(() => {
    currentDocIdRef.current = currentDocId;
  }, [currentDocId]);

  const activateDocPane = useCallback(
    (id: string) => {
      flushOutgoing(currentDocIdRef.current, id);
      setCurrentDocId(id);
      setActivePaneState("doc");
    },
    [flushOutgoing],
  );

  /** Set `currentDocId` without changing `activePane`. Used by the
   *  Library outer tab when the user clicks a per-doc project inner
   *  tab — the bib content reflects the new doc, but the user stays
   *  inside the library view. */
  const focusDoc = useCallback(
    (id: string) => {
      flushOutgoing(currentDocIdRef.current, id);
      setCurrentDocId(id);
    },
    [flushOutgoing],
  );

  /** Toggle between the active doc pane and the singleton Library
   *  outer tab (Cmd-L). When already on the library, returns to the
   *  current doc (or the first open doc if none is current). */
  const toggleActivePane = useCallback(() => {
    setActivePaneState((prev) => {
      if (prev === "library-outer") {
        if (currentDocId) return "doc";
        return prev;
      }
      setCurrentLibraryOuterId(OUTER_LIBRARY_ROOT_ID);
      return "library-outer";
    });
  }, [currentDocId]);

  /** Acquire the cross-window lock for a doc, prompting handoff if it
   *  is currently owned by a peer window. Returns true when this
   *  window owns the doc afterward. Brand-new docs always succeed
   *  immediately because nobody else can know their id yet. */
  const claimWithHandoff = useCallback(
    async (meta: FsaDocMeta): Promise<boolean> => {
      if (ownsDoc(meta.id)) return true;
      let result = await claimDoc(meta.id);
      if (result.owned) return true;
      const docLabel = meta.name || meta.folderName || "this document";
      const ok = await dialog.confirm({
        title: "Document is open elsewhere",
        message: `${docLabel} is open in another Virgil window. Move it here?`,
        confirmLabel: "Move it here",
        cancelLabel: "Keep it there",
      });
      if (!ok) return false;
      const released = await requestHandoff(meta.id);
      if (!released) {
        await dialog.alert({
          title: "Couldn't move the document",
          message:
            "The other window didn't release the document in time. Try again, or close it there first.",
          tone: "danger",
        });
        return false;
      }
      result = await claimDoc(meta.id);
      return result.owned;
    },
    [dialog],
  );

  /**
   * Create a new paper. In FSA mode this prompts for a parent folder —
   * must be called from a user gesture because the directory picker
   * requires transient activation. In dev mode it creates under
   * `virgil-data/` with no prompt.
   */
  const createFile = useCallback(
    async (name: string, templateId?: string) => {
      try {
        const meta = await createDocFromPicker(name, templateId);
        // Brand-new doc — claim is uncontested.
        await claimDoc(meta.id);
        // Drain pending writes for the doc we're switching away from
        // before its pipeline ends.
        const prev = currentDocIdRef.current;
        if (prev && prev !== meta.id) await drainDoc(prev);
        setDocs((prev) => [...prev, meta]);
        setOpenTabIds((prev) => [...prev, meta.id]);
        appendToOuterOrder(meta.id);
        setCurrentDocId(meta.id);
        setActivePaneState("doc");
        return meta;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return null;
        console.error("Failed to create file:", err);
        throw err;
      }
    },
    [appendToOuterOrder],
  );

  // De-dup paper-folder skill syncs across StrictMode double-mounts and
  // re-activations within the same session. Keyed by docId; reset on
  // page reload (which is also when a new bundle version arrives).
  const syncedDocIdsRef = useRef<Set<string>>(new Set());
  // Surfaced sync state (driven into the top-bar SkillSyncControls). The
  // error makes a failed sync loud + retryable; the notice tells the user
  // to restart their cowork session after a real bundle update.
  const [skillSyncError, setSkillSyncError] = useState<SkillSyncError | null>(
    null,
  );
  const [skillSyncNotice, setSkillSyncNotice] =
    useState<SkillSyncNotice | null>(null);

  /**
   * Write the Virgil skill bundle into a paper folder. Best-effort on the
   * auto path (doc-open), but never silent: any failure becomes a surfaced
   * `skillSyncError` and a real write becomes a `skillSyncNotice`.
   *
   * `regrant` re-acquires a possibly-revoked FSA permission first (e.g.
   * after a PWA reinstall). `ensureRW` is a no-op when already granted and
   * its prompt must ride a user gesture — so it's only passed from the
   * Re-sync / Retry click, never the auto path.
   */
  const runSkillSync = useCallback(
    async (docId: string, opts: { regrant?: boolean } = {}) => {
      try {
        const handle = await getDocHandle(docId);
        if (!handle) return;
        if (opts.regrant && !(await ensureRW(handle))) {
          setSkillSyncError({
            permission: true,
            message:
              "Virgil couldn't get permission to write the skill bundle into this paper's folder. Grant access and try again.",
          });
          return;
        }
        const libraryRoot = (await resolveLibraryRootPath()) ?? null;
        const result = await syncSkillBundle(handle, { libraryRoot });
        setSkillSyncError(null);
        // Only announce when a sync actually WROTE files — a version-match
        // no-op shouldn't nag the user to restart their cowork session.
        if (result.synced && result.filesWritten > 0) {
          setSkillSyncNotice({
            version: result.version,
            filesWritten: result.filesWritten,
          });
        }
      } catch (err) {
        const permission =
          err instanceof DOMException && err.name === "NotAllowedError";
        setSkillSyncError({
          permission,
          message: permission
            ? "Virgil lost permission to write the skill bundle into this paper's folder (this can happen after reinstalling the app). Click Retry to re-grant access."
            : `Virgil couldn't sync the skill bundle into this paper's folder: ${describeSyncError(err)}. Your cowork commands may be out of date — click Retry.`,
        });
        console.error("[skill-sync] paper-folder sync failed", err);
      }
    },
    [],
  );

  /** Manually re-run the skill sync for the current paper. Clears the
   *  per-session dedup so the write happens even if this folder already
   *  synced, and re-grants permission from the click. Idempotent. */
  const resyncSkills = useCallback(async () => {
    const docId = currentDocIdRef.current;
    if (!docId) return;
    syncedDocIdsRef.current.delete(docId);
    await runSkillSync(docId, { regrant: true });
    syncedDocIdsRef.current.add(docId);
  }, [runSkillSync]);

  const dismissSkillSyncError = useCallback(() => setSkillSyncError(null), []);
  const dismissSkillSyncNotice = useCallback(() => setSkillSyncNotice(null), []);

  /** Helper: register a doc and activate its tab. Re-opens of an
   *  existing doc go through the handoff flow when it's owned by
   *  another window. */
  const activateDoc = useCallback(
    async (meta: FsaDocMeta) => {
      const owned = await claimWithHandoff(meta);
      if (!owned) return;
      // Drain pending writes for the doc we're switching away from
      // before its pipeline ends.
      const prev = currentDocIdRef.current;
      if (prev && prev !== meta.id) await drainDoc(prev);
      setDocs((prev) =>
        prev.some((d) => d.id === meta.id) ? prev : [...prev, meta],
      );
      setOpenTabIds((prev) =>
        prev.includes(meta.id) ? prev : [...prev, meta.id],
      );
      appendToOuterOrder(meta.id);
      setCurrentDocId(meta.id);
      setActivePaneState("doc");
      bumpAccessed(meta.id);
      // Fire-and-forget: write the Virgil skill bundle into this paper
      // folder so any cowork session opened against it sees /editor:*
      // and /library:* commands. Idempotent — the version-stamp dedup
      // in skill-sync makes the steady-state cost a single FSA stat.
      // Failures are surfaced (not swallowed) via runSkillSync.
      if (!syncedDocIdsRef.current.has(meta.id)) {
        syncedDocIdsRef.current.add(meta.id);
        void runSkillSync(meta.id);
      }
    },
    [appendToOuterOrder, bumpAccessed, claimWithHandoff, runSkillSync],
  );

  /**
   * Open the bundled EXAMPLE document — seed it into OPFS on first use
   * (idempotent + self-healing), then activate it like any indexed doc.
   * This is the only delta from a normal open: `ensureExampleSeeded` runs
   * first. A no-op (silently ignored) when OPFS isn't available.
   */
  const openExample = useCallback(async () => {
    try {
      const meta = await ensureExampleSeeded();
      await activateDoc(meta);
    } catch (err) {
      if (err instanceof ExampleUnavailableError) return;
      console.error("Failed to open example document:", err);
    }
  }, [activateDoc]);

  /**
   * Restore the example to its pristine bundled state, discarding the
   * user's edits + AI annotations. Confirms first (destructive), closes
   * the tab so the editor unmounts, wipes + re-seeds OPFS, then re-opens
   * to force a fresh read of the restored content.
   */
  const resetExampleDoc = useCallback(async () => {
    const ok = await dialog.confirm({
      title: "Reset example document?",
      message:
        "This discards your edits and AI annotations to the example and restores the original.",
      confirmLabel: "Reset",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    closeTab(EXAMPLE_DOC_ID);
    try {
      const meta = await resetExample();
      // activateDoc's per-session skill-sync dedup (syncedDocIdsRef) still has
      // this id, so the bundle won't re-sync after a same-session reset — safe,
      // since the bundle is idempotent + version-gated (and re-syncs on reload).
      await activateDoc(meta);
    } catch (err) {
      if (err instanceof ExampleUnavailableError) return;
      console.error("Failed to reset example document:", err);
    }
  }, [dialog, closeTab, activateDoc]);

  /**
   * Open an existing paper folder. Must be called from a user gesture.
   * When the folder has multiple .tex files, sets `pendingFolderPick`
   * so the UI can show a file picker modal.
   */
  const openExistingFile = useCallback(async () => {
    try {
      const result = await pickProjectFolder();
      if (result.texFiles.length === 1) {
        const meta = await registerDocInFolder(result.handle, result.texFiles[0]);
        await activateDoc(meta);
        return meta;
      }
      // Multiple .tex files — let the user choose via modal
      setPendingFolderPick(result);
      return null;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      console.error("Failed to open file:", err);
      throw err;
    }
  }, [activateDoc]);

  /** Complete a pending folder pick by choosing a specific .tex file. */
  const selectFileInFolder = useCallback(async (texFilename: string) => {
    if (!pendingFolderPick) return null;
    try {
      const meta = await registerDocInFolder(pendingFolderPick.handle, texFilename);
      activateDoc(meta);
      setPendingFolderPick(null);
      return meta;
    } catch (err) {
      console.error("Failed to open file in folder:", err);
      throw err;
    }
  }, [pendingFolderPick, activateDoc]);

  /** Cancel a pending folder pick. */
  const cancelFolderPick = useCallback(() => {
    setPendingFolderPick(null);
  }, []);

  /**
   * Create a new doc inside the already-picked folder (the one backing
   * the pending TexFilePicker modal). Uses the folder handle the user
   * already granted, so no second directory prompt is needed.
   */
  const createFileInPendingFolder = useCallback(
    async (name: string, templateId?: string) => {
      if (!pendingFolderPick) return null;
      try {
        const meta = await createDocInFolder(
          pendingFolderPick.handle,
          name,
          templateId,
        );
        await activateDoc(meta);
        setPendingFolderPick(null);
        return meta;
      } catch (err) {
        console.error("Failed to create file in folder:", err);
        throw err;
      }
    },
    [pendingFolderPick, activateDoc],
  );

  /**
   * Forget a paper from the workspace. Does NOT touch the folder on
   * disk — the user's files are theirs.
   */
  const deleteFile = useCallback(
    async (id: string) => {
      try {
        // Drain pending writes for this doc before removing it from
        // the index — otherwise an autosave could land after the
        // index entry is gone.
        await drainDoc(id);
        await deleteDocFromIndex(id);
        setDocs((prev) => prev.filter((d) => d.id !== id));
        setOpenTabIds((prev) => prev.filter((t) => t !== id));
        removeFromOuterOrder(id);
        setCurrentDocId((prev) => (prev === id ? null : prev));
        releaseDoc(id).catch(() => {});
      } catch (err) {
        console.error("Failed to remove file from workspace:", err);
      }
    },
    [removeFromOuterOrder],
  );

  const renameFile = useCallback(async (id: string, name: string) => {
    try {
      await renameDocStorage(id, name);
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
    } catch (err) {
      console.error("Failed to rename file:", err);
    }
  }, []);

  const currentDoc = docs.find((d) => d.id === currentDocId) || null;
  // Memoized so its identity is stable across renders where neither the open
  // set nor the doc list changed. The top bar's memoized <TabStrip> derives
  // `openTabIds` from this; a fresh array every render would defeat that memo
  // and re-render the whole tab strip on every unrelated EditorLayout tick
  // (e.g. the keep-alive paneState bubble cascade during a paper switch).
  const openTabs = useMemo(
    () =>
      openTabIds
        .map((id) => docs.find((d) => d.id === id))
        .filter(Boolean) as FsaDocMeta[],
    [openTabIds, docs],
  );

  // ───────────────────────────────────────────────────────────────────
  // Paper outer-tabs (Virgil bar)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Open (or activate) a paper outer tab. `dropIndex` is the position in
   * outerOrder where the new tab should land. The Library root pinning
   * is enforced inside `insertIntoOuterOrder`. If a paper tab with this
   * citekey is already open, just activate it (no reorder).
   */
  const openPaperTab = useCallback(
    (citekey: string, dropIndex?: number) => {
      if (!citekey) return;
      const id = OUTER_PAPER_PREFIX + citekey;
      insertIntoOuterOrder(id, dropIndex);
      setCurrentPaperCitekey(citekey);
      setActivePaneState("paper");
    },
    [insertIntoOuterOrder],
  );

  const closePaperTab = useCallback(
    (citekey: string) => {
      if (!citekey) return;
      const id = OUTER_PAPER_PREFIX + citekey;
      removeFromOuterOrder(id);
      setCurrentPaperCitekey((prev) => {
        if (prev !== citekey) return prev;
        // Falling off the active paper — return focus to a doc if any.
        setActivePaneState("doc");
        return null;
      });
    },
    [removeFromOuterOrder],
  );

  const activatePaperPane = useCallback((citekey: string) => {
    if (!citekey) return;
    setCurrentPaperCitekey(citekey);
    setActivePaneState("paper");
  }, []);

  // ───────────────────────────────────────────────────────────────────
  // Library outer-tabs (Virgil bar)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Open (or activate) a library outer tab. COPY semantics — donor
   * inner library tab stays. If a library outer tab with this libId is
   * already open, just activate it without reordering. The pinned
   * singleton Library root is special-cased: callers passing it just
   * activate the existing pinned tab.
   */
  const openLibraryOuterTab = useCallback(
    (libId: string, dropIndex?: number) => {
      if (!libId) return;
      const id =
        libId === OUTER_LIBRARY_ROOT_ID ? libId : OUTER_LIBRARY_PREFIX + libId;
      insertIntoOuterOrder(id, dropIndex);
      setCurrentLibraryOuterId(libId);
      setActivePaneState("library-outer");
    },
    [insertIntoOuterOrder],
  );

  const closeLibraryOuterTab = useCallback(
    (libId: string) => {
      if (!libId) return;
      // The pinned singleton is non-closable.
      if (libId === OUTER_LIBRARY_ROOT_ID) return;
      const id = OUTER_LIBRARY_PREFIX + libId;
      removeFromOuterOrder(id);
      setCurrentLibraryOuterId((prev) => {
        if (prev !== libId) return prev;
        // Falling off the active library outer tab — return focus to a doc.
        setActivePaneState("doc");
        return null;
      });
    },
    [removeFromOuterOrder],
  );

  const activateLibraryOuterPane = useCallback((libId: string) => {
    if (!libId) return;
    setCurrentLibraryOuterId(libId);
    setActivePaneState("library-outer");
  }, []);

  return {
    docs,
    openTabs,
    currentDocId,
    currentDoc,
    loading,
    createFile,
    openExistingFile,
    openExample,
    resetExampleDoc,
    deleteFile,
    renameFile,
    openFile,
    closeTab,
    pendingFolderPick,
    selectFileInFolder,
    cancelFolderPick,
    createFileInPendingFolder,
    activePane,
    activateDocPane,
    focusDoc,
    toggleActivePane,
    // Paper outer tabs
    outerOrder,
    currentPaperCitekey,
    openPaperTab,
    closePaperTab,
    activatePaperPane,
    // Library outer tabs
    currentLibraryOuterId,
    openLibraryOuterTab,
    closeLibraryOuterTab,
    activateLibraryOuterPane,
    // Skill-bundle sync surface (loud failure + manual re-sync + reload nag)
    skillSyncError,
    skillSyncNotice,
    resyncSkills,
    dismissSkillSyncError,
    dismissSkillSyncNotice,
  };
}
