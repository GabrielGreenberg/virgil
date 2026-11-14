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
  getDocHandle,
  OUTER_LIBRARY_PREFIX,
  OUTER_LIBRARY_ROOT_ID,
  OUTER_PAPER_PREFIX,
  readTabs,
  sweepTabRecords,
  touchDocAccessed,
  writeTabs,
  type ActivePaneKind,
  type FsaDocMeta,
} from "@/lib/doc-index";
import { watchSyncConflicts } from "@/lib/sync-conflict-scan";
import { syncSkillBundle } from "@library/lib/skill-sync";
import { resolveLibraryRootPath } from "@library/lib/library-folder";
import {
  EXAMPLE_DOC_ID,
  ExampleUnavailableError,
  ensureExampleSeeded,
  resetExample,
} from "@/lib/example-doc/example-seeder";
import { ensureRW, queryRW } from "@/lib/fsa-permissions";
import { getWindowId } from "@/lib/multi-window/window-id";
import { settleWindowStartup } from "@/lib/multi-window/window-liveness";
import {
  claimDoc,
  ownsDoc,
  releaseAll,
  releaseDoc,
} from "@/lib/multi-window/doc-ownership";
import {
  claimDocWithHandoff,
  retireDocUnlessOpenElsewhere,
  type HandoffTarget,
} from "@/lib/multi-window/handoff";
import { subscribe, type BusEvent } from "@/lib/multi-window/bus";
import { hasUnlandedWork } from "@/lib/emergency-mirror";
import { onTabReturn } from "@/lib/tab-hidden";
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

/** Claim each doc for this window, in order; the ids this window owns
 *  afterward. The ONE claim-or-drop rule for re-entering a workspace —
 *  the session restore and the back/forward-cache return (task 603). */
async function claimEach(ids: readonly string[]): Promise<string[]> {
  const claimed: string[] = [];
  for (const id of ids) {
    if ((await claimDoc(id)).owned) claimed.push(id);
  }
  return claimed;
}

/** Same rows, same fields, same order — the equality bail that keeps a
 *  peer's no-news re-stamp from handing every `docs` consumer a new array. */
function sameDocList(a: readonly FsaDocMeta[], b: readonly FsaDocMeta[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** A door's claim on admitting one paper (task 1463): `stillWanted` is false
 *  once the paper has been retired from this window since the ticket. */
interface AdmitTicket {
  id: string;
  stillWanted: () => boolean;
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
  const [docs, setDocsState] = useState<FsaDocMeta[]>([]);
  // Every edit THIS window makes to `docs` goes through here, so the peer
  // re-read (`refreshDocs`, task 1460) can tell that a local door changed the
  // list while its read was in flight — and read again rather than land a
  // snapshot taken before that door's own index write.
  const docsEpochRef = useRef(0);
  const setDocs = useCallback(
    (next: FsaDocMeta[] | ((prev: FsaDocMeta[]) => FsaDocMeta[])) => {
      docsEpochRef.current++;
      setDocsState(next);
    },
    [],
  );
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
    // Claim this window's identity before anything keyed by it (task 871):
    // a browser-duplicated tab inherits its source's sessionStorage id, and
    // the claim re-mints when that id's liveness lock is already held. Then
    // retire the tab records of windows that are gone and stale (task 603 —
    // no page event deletes them; see `sweepTabRecords`).
    const startup = settleWindowStartup();
    const identity = startup.then((s) => s.identity);
    startup
      .then(({ live }) => sweepTabRecords({ liveWindowIds: live }))
      .catch(() => {});
    (async () => {
      try {
        // A re-minted twin seeds its tabs from the record it inherited
        // (that is what "Duplicate tab" means) and persists under its NEW
        // id — the write effect below only runs after hydration.
        const { inheritedId } = await identity;
        const [docList, tabs] = await Promise.all([
          listDocs(),
          readTabs(inheritedId),
        ]);
        setDocs(docList);
        const candidates = tabs.openTabIds.filter((id) =>
          docList.some((d) => d.id === id),
        );
        const claimed = await claimEach(candidates);
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

  // Persist tab state on every change after initial hydration.
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
  }, [
    openTabIds,
    currentDocId,
    activePane,
    outerOrder,
    currentPaperCitekey,
    currentLibraryOuterId,
  ]);

  // Mirror openTabIds so the back/forward-cache re-claim reads the set the
  // window is showing without re-binding its listeners.
  const openTabIdsRef = useRef(openTabIds);
  useEffect(() => {
    openTabIdsRef.current = openTabIds;
  }, [openTabIds]);

  // Mirror currentDocId so the bus handler and the async open doors read the
  // latest value without re-subscribing / re-binding on every change.
  const currentDocIdRef = useRef(currentDocId);
  useEffect(() => {
    currentDocIdRef.current = currentDocId;
  }, [currentDocId]);

  // Mirror docs so `deleteFile` can name the paper in a refusal without
  // re-binding (its identity feeds the top bar's memo).
  const docsRef = useRef(docs);
  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

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
    setOuterOrder((prev) =>
      prev.includes(id)
        ? [
            OUTER_LIBRARY_ROOT_ID,
            ...prev.filter((t) => t !== id && t !== OUTER_LIBRARY_ROOT_ID),
          ]
        : prev,
    );
  }, []);

  // ── Admit tickets (task 1463) ───────────────────────────────────────────
  // An open door awaits twice before the paper is shown — the claim, then the
  // outgoing doc's drain inside `admitDoc` — and the paper can LEAVE this
  // window in between: a peer's "Move it here" (`doc-handoff-request`), a
  // close, a delete. Each of those goes through `retireOpenDoc`, which already
  // released the lock. Admitting afterwards would make the paper current in a
  // window that no longer holds it. So every retirement bumps the paper's
  // epoch, a door takes a ticket just BEFORE its claim, and `admitDoc`
  // re-validates the ticket after its own: a retirement since wins, and
  // nothing is admitted.
  const retireEpochRef = useRef(new Map<string, number>());
  const admitTicket = useCallback((id: string): AdmitTicket => {
    const epoch = retireEpochRef.current.get(id) ?? 0;
    return { id, stillWanted: () => (retireEpochRef.current.get(id) ?? 0) === epoch };
  }, []);

  /**
   * "An open doc leaves this window" — the ONE answer for close, forget
   * (delete) and a peer window's handoff (task 602). Drops `id` from the
   * open set and the tab order; when it was the ACTIVE doc, activity passes
   * to its neighbour (the tab that slides into its slot, else the one
   * before it), never to "nothing" while other tabs are open. Then
   * releases the cross-window lock — `releaseDoc` drains the doc's
   * pending writes before dropping the hold (task 596).
   *
   * Draining an ACTIVE doc's in-debounce edits is the caller's first step
   * where the caller has one to take (close flushes, delete awaits); the
   * helper deliberately does not re-drain.
   */
  const retireOpenDoc = useCallback(
    (id: string) => {
      retireEpochRef.current.set(id, (retireEpochRef.current.get(id) ?? 0) + 1);
      setOpenTabIds((prev) => {
        const next = prev.filter((t) => t !== id);
        if (id === currentDocIdRef.current) {
          const idx = prev.indexOf(id);
          const successor =
            idx < 0 ? null : (next[Math.min(idx, next.length - 1)] ?? null);
          currentDocIdRef.current = successor;
          setCurrentDocId(successor);
        }
        return next;
      });
      removeFromOuterOrder(id);
      releaseDoc(id).catch(() => {});
    },
    [removeFromOuterOrder],
  );

  // ── The paper index across windows (task 1460) ──────────────────────────
  // `docs` is this window's snapshot of a list every window shares, and the
  // index lives in IndexedDB, which raises no `storage` event. So a row a peer
  // removed, created or renamed used to stay stale here until reload — and
  // opening a removed one claimed its id and admitted the stale meta.
  //
  // `refreshDocs` is the ONE re-read: storage is the truth, the result
  // replaces `docs` (equality-bailed), and a row that VANISHED while its paper
  // is open here leaves this window through `retireOpenDoc` — the departing-doc
  // door — rather than staying mounted against a forgotten identity. (A peer's
  // removal of a paper open here is normally refused by task 1105's gate; this
  // is the residue: a window that was frozen, or a row dropped by a reset.)
  // Concurrent calls coalesce into one trailing re-read, and a local door that
  // edited `docs` mid-read (`docsEpochRef`) forces another, so a snapshot
  // older than this window's own write never lands. Resolves with the list it
  // settled on, or `null` when storage could not be read (nothing changes).
  const refreshInFlightRef = useRef<Promise<FsaDocMeta[] | null> | null>(null);
  const refreshAgainRef = useRef(false);
  const refreshDocs = useCallback((): Promise<FsaDocMeta[] | null> => {
    if (refreshInFlightRef.current) {
      refreshAgainRef.current = true;
      return refreshInFlightRef.current;
    }
    const run = (async () => {
      let settled: FsaDocMeta[] | null = null;
      try {
        for (let pass = 0; pass < 4; pass++) {
          refreshAgainRef.current = false;
          const epoch = docsEpochRef.current;
          const next = await listDocs();
          if (
            (epoch !== docsEpochRef.current || refreshAgainRef.current) &&
            pass < 3
          ) {
            continue;
          }
          settled = next;
          break;
        }
      } catch (err) {
        console.error("Failed to re-read the paper index:", err);
        return null;
      } finally {
        refreshInFlightRef.current = null;
      }
      if (!settled) return null;
      const next = settled;
      const prev = docsRef.current;
      if (!sameDocList(prev, next)) {
        docsRef.current = next;
        setDocs(next);
      }
      const kept = new Set(next.map((d) => d.id));
      for (const d of prev) {
        if (!kept.has(d.id) && openTabIdsRef.current.includes(d.id)) {
          retireOpenDoc(d.id);
        }
      }
      return next;
    })();
    refreshInFlightRef.current = run;
    return run;
  }, [retireOpenDoc, setDocs]);

  // A peer's write through `mutateIndex` announces itself (our own does too,
  // but this window already applied it); the return edge and the
  // back/forward-cache return (below) cover announcements a frozen or
  // throttled window missed. Nothing here runs per keystroke.
  useEffect(() => {
    const unsub = subscribe((e: BusEvent) => {
      if (e.type !== "doc-index-changed") return;
      if (e.windowId === getWindowId() || !hydratedRef.current) return;
      void refreshDocs();
    });
    const unreturn = onTabReturn(() => {
      if (hydratedRef.current) void refreshDocs();
    });
    return () => {
      unsub();
      unreturn();
    };
  }, [refreshDocs]);

  /** Acquire the cross-window lock for a doc, prompting handoff if it
   *  is currently owned by a peer window. Returns true when this
   *  window owns the doc afterward. Brand-new docs always succeed
   *  immediately because nobody else can know their id yet. The
   *  sequence itself lives in `@/lib/multi-window/handoff` — this is
   *  only the binding of that door to this window's dialog host. */
  const claimWithHandoff = useCallback(
    (target: HandoffTarget): Promise<boolean> => claimDocWithHandoff(target, dialog),
    [dialog],
  );

  /**
   * The ONE post-claim open sequence (task 602). Every door that makes a
   * paper the active doc — Recents / tab "+" (`openFile`), the folder
   * picker and its follow-ups (`activateDoc`), a brand-new paper
   * (`createFile`) — has already taken this window's claim, and then
   * runs exactly this, in this order:
   *
   *   1. drain the OUTGOING doc's pending writes before its pipeline ends
   *      (see `flushOutgoing` for why this is load-bearing under keep-alive),
   *      then re-validate the door's ticket — a paper retired since the
   *      claim (handed off, closed, deleted) is not admitted (task 1463);
   *   2. register the meta in `docs` if it is new to this window;
   *   3. add the tab (open set + outer order), make it current, show the doc;
   *   4. bump its recents timestamp.
   *
   * What happens BECAUSE a doc became current (the skill-bundle sync, the
   * sync-conflict watcher) is not a step here: it is keyed on
   * `currentDocId` below, so the session-restore effect — which sets the
   * current doc without passing through any door — gets it too, and a new
   * door cannot forget it.
   */
  const admitDoc = useCallback(
    async (ticket: AdmitTicket, meta?: FsaDocMeta) => {
      const { id } = ticket;
      const prev = currentDocIdRef.current;
      if (prev && prev !== id) await drainDoc(prev);
      // Retired since the door took its ticket (task 1463) — the lock is
      // already released, so the departure wins.
      if (!ticket.stillWanted()) return;
      if (meta) {
        setDocs((ds) => (ds.some((d) => d.id === id) ? ds : [...ds, meta]));
      }
      setOpenTabIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      appendToOuterOrder(id);
      currentDocIdRef.current = id;
      setCurrentDocId(id);
      setActivePaneState("doc");
      bumpAccessed(id);
    },
    [appendToOuterOrder, bumpAccessed],
  );

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
      // Read the row from STORAGE, not this window's snapshot (task 1460): a
      // peer may have forgotten the paper since `docs` was last refreshed,
      // and admitting the stale meta would claim a dead identity. The re-read
      // also drops the row from Recents. An unreadable index falls back to
      // the snapshot — the open itself will say what is wrong.
      const fresh = await refreshDocs();
      if (fresh && !fresh.some((d) => d.id === id)) return;
      const meta = (fresh ?? docsRef.current).find((d) => d.id === id);
      // Acquire the cross-window lock through the ONE handoff door
      // (`claimDocWithHandoff`) — it prompts, asks the peer to release,
      // re-claims, and tells the user about every failure. Even when this
      // window holds the doc: the claim is free then, and for a paper whose
      // close is still draining it is what keeps the lock (task 1454).
      const ticket = admitTicket(id);
      const owned = await claimWithHandoff(meta ?? { id });
      if (!owned) return;
      await admitDoc(ticket, meta);
    },
    [admitDoc, admitTicket, claimWithHandoff, refreshDocs],
  );

  const closeTab = useCallback(
    (id: string) => {
      // Closing the active tab counts as a doc switch — drain its
      // pending writes first. Fire-and-forget; the storage layer's
      // pipeline check still prevents any cross-doc corruption even
      // if a write lands after the unmount.
      if (id === currentDocIdRef.current) flushOutgoing(id, null);
      retireOpenDoc(id);
    },
    [flushOutgoing, retireOpenDoc],
  );

  // Listen for handoff requests from peer windows. When another window
  // wants a doc we own, drop its tab from this window and release the
  // doc. `releaseDoc` is what makes the release write-ordered.
  useEffect(() => {
    const onEvent = (e: BusEvent) => {
      if (e.type !== "doc-handoff-request") return;
      if (e.toWindowId !== getWindowId()) return;
      if (!ownsDoc(e.docId)) return;
      // Update the UI, then release (both in `retireOpenDoc`). The DRAIN is `releaseDoc`'s
      // (task 596): it awaits this doc's pending writes before dropping
      // the hold, which is the only ordering under which those writes
      // still take `withDocLock`'s owner short-circuit. This handler
      // used to fire `drainDoc` un-awaited beside the release and lean
      // on a comment claiming the lock serialized them — the claim
      // `storage-fsa.ts` itself documents as false in the ordinary case.
      retireOpenDoc(e.docId);
    };
    return subscribe(onEvent);
  }, [retireOpenDoc]);

  // ── Page lifecycle (task 603) ────────────────────────────────────────────
  // `pagehide` releases every doc lock so peer windows see availability at
  // once. It does NOT touch the tab record: `pagehide` fires on every
  // reload, and the reload is exactly the reader that record exists for.
  //
  // A `pagehide` with `persisted` is an entry into the back/forward cache —
  // the page may come back. The release still runs (a frozen page must not
  // keep a paper from its peers); the matching `pageshow` with `persisted`
  // then re-claims what this window still shows, through the same
  // claim-or-drop rule as the session restore: a paper a peer took while
  // we were frozen leaves this window like any other departing doc.
  useEffect(() => {
    let releasing: Promise<void> = Promise.resolve();
    const onHide = () => {
      releasing = releaseAll().catch(() => {});
    };
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      // Index announcements published while this page was frozen were lost.
      void refreshDocs();
      void (async () => {
        await releasing;
        const shown = openTabIdsRef.current;
        const claimed = await claimEach(shown);
        for (const id of shown) {
          if (!claimed.includes(id)) retireOpenDoc(id);
        }
      })();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, [retireOpenDoc, refreshDocs]);

  // ── Sync-conflict scan (task 363) ────────────────────────────────────────
  // Notice what a cloud-sync daemon did to this paper's `virgil/` folder. Keyed
  // on `currentDocId` — the ONE chokepoint every open path funnels through —
  // and deliberately NOT on `activateDoc`, which the paths that actually open
  // an already-indexed paper never reach: `openFile` (the Recents list),
  // `createFile`, and the session-restore effect all set `currentDocId`
  // directly. A scan wired to the picker alone would have made the whole
  // detection half fire for a first-ever open and never again, which is exactly
  // the silence this feature exists to end.
  //
  // Re-scanning on a warm tab switch is a feature rather than a cost: a daemon
  // mints forks while the app is open, and the notice is signature-keyed
  // (`sync-conflict-notice.ts`), so an unchanged folder cannot re-raise a
  // dismissed report. One directory enumeration, no file reads; never throws.
  //
  // …and a warm tab switch is not the only way the folder changes under an
  // open paper (task 542). The pill's own copy sends the user to Finder to
  // clean a content fork, which by construction happens while this tab is not
  // in front — so the watcher also re-scans on the shared tab-RETURN edge
  // (`tab-hidden.ts`), and stands down with the doc.
  useEffect(() => {
    if (!currentDocId) return;
    return watchSyncConflicts(currentDocId);
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
        const ticket = admitTicket(meta.id);
        await claimDoc(meta.id);
        await admitDoc(ticket, meta);
        return meta;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return null;
        console.error("Failed to create file:", err);
        throw err;
      }
    },
    [admitDoc, admitTicket],
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

  // Bumped when the user grants folder access to the CURRENT doc through the
  // permission gate — the one way a doc becomes writable without
  // `currentDocId` changing (a relaunch whose grant did not persist).
  const [docAccessEpoch, setDocAccessEpoch] = useState(0);
  const noteDocAccessGranted = useCallback(
    () => setDocAccessEpoch((n) => n + 1),
    [],
  );

  // ── Skill-bundle auto-sync (task 602) ────────────────────────────────────
  // Write the Virgil skill bundle into the paper folder so a cowork session
  // opened against it sees current /editor:* and /library:* commands. Keyed
  // on `currentDocId` — the ONE chokepoint every open funnels through,
  // exactly as the sync-conflict watcher above is, and for the same reason:
  // wired into `activateDoc` it fired only for the folder picker, never for
  // a paper reopened from Recents, restored on launch, or newly created.
  //
  // Auto path, so it never prompts: a folder whose readwrite grant is not
  // live yet (a relaunch before the gate's click) is skipped WITHOUT being
  // marked, and the gate's grant (`noteDocAccessGranted`) re-runs this.
  // No handle (dev backend) → nothing to sync. Once per doc per session
  // (`syncedDocIdsRef`); the version stamp in skill-sync makes even that a
  // single FSA stat in the steady state. Failures surface via runSkillSync.
  useEffect(() => {
    const docId = currentDocId;
    if (!docId || syncedDocIdsRef.current.has(docId)) return;
    let cancelled = false;
    (async () => {
      const handle = await getDocHandle(docId);
      if (!handle || cancelled) return;
      if ((await queryRW(handle)) !== "granted" || cancelled) return;
      if (syncedDocIdsRef.current.has(docId)) return;
      syncedDocIdsRef.current.add(docId);
      await runSkillSync(docId);
    })().catch((err) => {
      console.error("[skill-sync] could not check the paper folder", err);
    });
    return () => {
      cancelled = true;
    };
  }, [currentDocId, docAccessEpoch, runSkillSync]);

  /** Helper: register a doc and activate its tab. Re-opens of an
   *  existing doc go through the handoff flow when it's owned by
   *  another window. */
  const activateDoc = useCallback(
    async (meta: FsaDocMeta) => {
      const ticket = admitTicket(meta.id);
      const owned = await claimWithHandoff(meta);
      if (!owned) return;
      await admitDoc(ticket, meta);
    },
    [admitDoc, admitTicket, claimWithHandoff],
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
        "This discards your edits (including any unsaved changes) and AI annotations to the example and restores the original.",
      confirmLabel: "Reset",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    try {
      // The reset purges the example's identity — never under a peer
      // window's live editor (task 1105). Drain first: a write still
      // waiting on the doc's lock would read as "held elsewhere". The
      // tab closes INSIDE the gate, so a refused reset leaves it open.
      await drainDoc(EXAMPLE_DOC_ID);
      let meta: FsaDocMeta | null = null;
      const retired = await retireDocUnlessOpenElsewhere(
        { id: EXAMPLE_DOC_ID, name: "The example document" },
        dialog,
        async () => {
          closeTab(EXAMPLE_DOC_ID);
          meta = await resetExample();
        },
      );
      if (!retired || !meta) return;
      // The per-session skill-sync dedup (syncedDocIdsRef) still has this id,
      // so the bundle won't re-sync after a same-session reset — safe,
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
      await activateDoc(meta);
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
  // Resolves whether the paper was actually forgotten (task 1459): a removal
  // REFUSED because a peer window has it open, or one that threw, is `false`,
  // so a caller that tears down UI on success (the unreachable gate) can tell.
  const deleteFile = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        // Drain pending writes for this doc before removing it from
        // the index — otherwise an autosave could land after the
        // index entry is gone.
        await drainDoc(id);
        // Never under a peer window's live editor (task 1105): the
        // purge takes its folder handle and its emergency mirror. Nor over
        // this paper's own unlanded work without the user's answer (task
        // 1616) — the mirror is the only copy of edits that never landed.
        const meta = docsRef.current.find((d) => d.id === id);
        const retired = await retireDocUnlessOpenElsewhere(
          { id, name: meta?.name, folderName: meta?.folderName },
          dialog,
          () => deleteDocFromIndex(id),
          { hasUnlandedWork },
        );
        if (!retired) return false;
        setDocs((prev) => prev.filter((d) => d.id !== id));
        retireOpenDoc(id);
        return true;
      } catch (err) {
        console.error("Failed to remove file from workspace:", err);
        return false;
      }
    },
    [retireOpenDoc, dialog],
  );

  const renameFile = useCallback(async (id: string, name: string) => {
    try {
      await renameDocStorage(id, name);
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
      // The rename is a no-op in storage when a peer already forgot the row
      // (task 1460) — settle on what storage now holds rather than keep
      // showing a name nothing persisted.
      void refreshDocs();
    } catch (err) {
      console.error("Failed to rename file:", err);
    }
  }, [refreshDocs, setDocs]);

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
    noteDocAccessGranted,
  };
}
