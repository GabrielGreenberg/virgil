"use client";

/**
 * useCollab — collaborator-mode state machine and sidecar I/O for one doc.
 *
 * Responsibilities:
 *  - Load / save `virgil/collab.json` via the existing sidecar pipeline.
 *  - Poll the sidecar at COLLAB_TIMINGS.pollMs to pick up partner edits.
 *  - Expose pen state, derived status, and `takePen / passPen / requestPen
 *    / takeOver` actions.
 *  - Heartbeat the pen every penHeartbeatMs while we're the holder, and
 *    heartbeat focus claims every cardHeartbeatMs while a card is focused.
 *  - Flush release on `pagehide` (best-effort), re-join on bfcache restore.
 *  - Every write goes through the collab.json authority (`collab-store`).
 *
 * No co-editing. No cursor sync. The pen is the single coordination
 * primitive for the .tex; per-card focus claims coordinate sidecar cards.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readSidecar, readTextFile } from "@/lib/storage";
import {
  activityMutator,
  adoptSessionsMutator,
  claimCardMutator,
  heartbeatMutator,
  mutateCollab,
  passPenMutator,
  releaseClaimMutator,
  releaseSelf,
  sweepMutator,
  adoptIdentity,
  adoptSelf,
  takePenMutator,
  type CollabMutator,
} from "@/lib/collab-store";
import {
  COLLAB_SIDECAR_FILE,
  COLLAB_TIMINGS,
  EMPTY_COLLAB_SIDECAR,
  derivePen,
  ensureParticipant,
  COLLAB_IDENTITY_KEY,
  findClaim,
  holdsClaim,
  holdsPen,
  loadIdentity,
  mintCollabSession,
  saveIdentity,
  touchPresence,
  type CollabFocusClaim,
  type CollabIdentity,
  type CollabSelf,
  type CollabSidecar,
  type DerivedPen,
} from "@/lib/collab";
// Collab claim/presence scopes are typed as the registry-derived
// `PanelThemeKey` (R28/D-2): the WRITE side emits only tokens from the
// unified theme keyspace (`collabClaimScope` in `@/cards/predicates`). The
// wire-READ side (`@/lib/collab`) deliberately stays `string` — disk data is
// untyped.
import type { PanelThemeKey } from "@/lib/panel-theme";
import { subscribeToStorageKey } from "@/lib/cross-window-storage";
import {
  forgetCollabSession,
  holdLiveSession,
  inheritCollabSessions,
} from "@/lib/collab-session";
import {
  COWORK_PEN_CONTEXT_PATH,
  clearCoworkPen,
  coworkPenReleaseFromContext,
  noteCoworkPen,
  noteCoworkPenRelease,
  resolveCoworkPen,
  type CoworkPenState,
} from "@/lib/cowork-pen";

export interface CollabState {
  /** True when the sidecar's `enabled` flag is set on disk. */
  enabled: boolean;
  /** Whether the local user has set up their identity. */
  identity: CollabIdentity | null;
  /** Latest snapshot from disk. */
  sidecar: CollabSidecar;
  /** Derived pen state (free / active / idle / stale). */
  pen: DerivedPen;
  /** True if the main text may be edited: nothing else holds this paper's
   *  pen, and (when collaborator mode is on) the pen is mine. */
  canEditMainText: boolean;
  /** Task 489 — a cowork skill holds this paper's pen right now, so the
   *  document is read-only and its autosave is paused. `null` otherwise. */
  coworkPen: CoworkPenState | null;
  /** Does THIS session (this pane of this window) hold the pen? Task 1213:
   *  the name is per-browser, so a sibling pane or window of mine holding
   *  it is NOT `iHavePen` here — see `penHeldElsewhere`. */
  iHavePen: boolean;
  /** The pen is held under my name by ANOTHER session — a sibling pane or
   *  window of this browser. Taking it here moves it to this session. */
  penHeldElsewhere: boolean;
  /** When holder is partner: their color (for chrome accents). */
  partnerColor: string | null;
}

export interface CollabActions {
  /** Persist a new identity locally and seed it into participants. */
  setIdentity: (identity: CollabIdentity) => void;
  /** Turn collaborator mode on for this doc. */
  enableCollab: () => Promise<void>;
  /** Turn collaborator mode off; release pen + claims. */
  disableCollab: () => Promise<void>;
  /** Take the pen (only when free or stale). */
  takePen: () => Promise<void>;
  /** Pass the pen back to free. */
  passPen: () => Promise<void>;
  /** Add yourself to the requestedBy queue. */
  requestPen: () => Promise<void>;
  /** Force-take from a stale partner. */
  takeOver: () => Promise<void>;
  /** Stamp activity (throttled) — call from real input handlers. */
  bumpActivity: () => void;
  /** Claim a card for editing — call on focus. The scope is the kind's
   *  registry-derived `collabClaimScope` (R28/D-2). */
  claimCard: (panelKind: PanelThemeKey, cardId: string) => Promise<void>;
  /** Release whatever card the user has claimed — call on blur. */
  releaseClaim: () => Promise<void>;
  /** Lookup whether a card is currently claimed by the partner. */
  getCardClaim: (
    panelKind: PanelThemeKey,
    cardId: string,
  ) => { holder: string; color: string; claim: CollabFocusClaim } | null;
  /** Soft presence: set the user's currently-selected cards. */
  updateSelection: (cards: { panelKind: PanelThemeKey; cardId: string }[]) => void;
  /** Soft presence: set the user's currently-active paragraph in the editor. */
  updateCursorParagraph: (paragraphId: string | null) => void;
  /** Lookup which partners have selected a given card. */
  getCardSelections: (
    panelKind: PanelThemeKey,
    cardId: string,
  ) => { name: string; color: string }[];
  /** Lookup which partners have their cursor on a given paragraph. */
  getCursorSelections: (
    paragraphId: string,
  ) => { name: string; color: string }[];
}

export type CollabHook = CollabState & CollabActions;

/** Collab state when no doc is loaded — every action is a no-op.
 *  Exported as `COLLAB_INERT` so callers that route the live collab
 *  hook through props (e.g. EditorLayout reading the EditorPane-owned
 *  instance via `paneState.collab`) have a safe default while the
 *  pane hasn't bubbled state yet. */
export const COLLAB_INERT: CollabHook = {
  enabled: false,
  identity: null,
  sidecar: EMPTY_COLLAB_SIDECAR,
  pen: { status: "free", holder: null, idleSec: null, staleSec: null, requestedBy: [] },
  canEditMainText: true,
  coworkPen: null,
  iHavePen: false,
  penHeldElsewhere: false,
  partnerColor: null,
  setIdentity: () => {},
  enableCollab: async () => {},
  disableCollab: async () => {},
  takePen: async () => {},
  passPen: async () => {},
  requestPen: async () => {},
  takeOver: async () => {},
  bumpActivity: () => {},
  claimCard: async () => {},
  releaseClaim: async () => {},
  getCardClaim: () => null,
  updateSelection: () => {},
  updateCursorParagraph: () => {},
  getCardSelections: () => [],
  getCursorSelections: () => [],
};

export interface UseCollabOptions {
  /** Is the pane that owns this hook VISIBLE (task 1213)? A paper parked
   *  `display:none` by multi-doc keep-alive is not being worked on: it
   *  writes no heartbeat, so a pen it holds goes stale honestly and the
   *  partner is offered "Take over". Defaults to `true`. */
  visible?: boolean;
}

export function useCollab(
  docId: string | null,
  { visible = true }: UseCollabOptions = {},
): CollabHook {
  // Task 1213 — this instance's holding SESSION. The identity name is
  // per-browser (every pane and window shares it); pen and presence
  // ownership is per session, so one pane's release or heartbeat cannot act
  // for a sibling pane or window of the same name.
  const [session] = useState(mintCollabSession);
  const [identity, setIdentityState] = useState<CollabIdentity | null>(() =>
    loadIdentity(),
  );
  const [sidecar, setSidecar] = useState<CollabSidecar>(EMPTY_COLLAB_SIDECAR);
  // Task 489 — the cowork pen. Derived on the SAME 5s clock the sidecar poll
  // already runs on, because it is the same question about the same paper:
  // who holds this document's pen? Held as state (not just published to the
  // store) because `canEditMainText` — the thing that must flip — is derived
  // here, and a store read during render would not re-render this hook.
  const [coworkPen, setCoworkPen] = useState<CoworkPenState | null>(null);
  const [tick, setTick] = useState(0); // re-derives idle/stale labels

  const sidecarRef = useRef(sidecar);
  sidecarRef.current = sidecar;
  const docIdRef = useRef(docId);
  docIdRef.current = docId;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  /** The live `{ name, session }` — `null` before an identity is set. */
  const selfRef = useRef<() => CollabSelf | null>(() => null);
  selfRef.current = () => {
    const name = identityRef.current?.name;
    return name ? { name, session } : null;
  };
  const lastActivityWriteRef = useRef(0);
  const lastSelectionRef = useRef<string>("");
  const lastCursorRef = useRef<string | null>(null);

  /** Bumped on every local mutation, so a queued write that resolves after
   *  a NEWER optimistic update doesn't roll the UI back to its older result. */
  const mutateSeqRef = useRef(0);

  /** Read-modify-write through the collab.json authority (task 872).
   *
   *  The read happens INSIDE the doc write queue (`mutateCollab` →
   *  `mutateSidecar`), so a partner's change that landed since our last poll
   *  — or a concurrent write from another window — is the base `fn` is
   *  applied to, never overwritten by a stale snapshot. `mergeKeepingSelf`
   *  still lays our own fresher heartbeats over the disk read.
   *
   *  Local state updates optimistically (so the pill flips at once), then
   *  adopts the authoritative post-write sidecar unless a newer mutation has
   *  been issued in the meantime.
   */
  const mutate = useCallback(
    async (fn: CollabMutator): Promise<void> => {
      const id = docIdRef.current;
      if (!id) return;
      const seq = ++mutateSeqRef.current;
      const optimistic = fn(sidecarRef.current);
      if (optimistic) {
        sidecarRef.current = optimistic;
        setSidecar(optimistic);
      }
      // A mutator that REFUSES on the fresh read (task 1015 — its
      // precondition held against our poll-old state but not against disk)
      // writes nothing; adopt the base it refused, or the optimistic update
      // above would show the stale belief until the next poll. Reset per run:
      // the CAS may re-run `fn` on a newer base.
      let refusedBase: CollabSidecar | null = null;
      const landed = await mutateCollab(id, (fresh) => {
        const base = mergeKeepingSelf(fresh, sidecarRef.current, selfRef.current());
        const next = fn(base);
        refusedBase = next === null ? base : null;
        return next;
      });
      const truth = landed ?? refusedBase;
      if (!truth || seq !== mutateSeqRef.current || docIdRef.current !== id) return;
      sidecarRef.current = truth;
      setSidecar(truth);
    },
    [],
  );

  // Task 768 + 1014 — the identity is per-BROWSER, cached here per PANE. A
  // change made anywhere — a peer window (native `storage` event) or this
  // window, this pane or a keep-alive sibling (`saveIdentity`'s in-window
  // announcement) — reaches every mounted hook through this ONE subscription,
  // or its pen heartbeat, claims, unload release and `mergeKeepingSelf` keep
  // writing under the OLD name. And the old name is projected onto this
  // paper's sidecar (pen holder, presence, roster): renaming only the cache
  // would leave `iHavePen` false for a pen this user still holds, so the
  // change also MIGRATES the sidecar old → new, idempotently — through
  // `adoptSelf`, the same door the load below repairs a paper that was
  // CLOSED during the rename with (task 1281: the identity's rename ledger).
  useEffect(
    () =>
      subscribeToStorageKey(COLLAB_IDENTITY_KEY, () => {
        const before = identityRef.current;
        const next = loadIdentity();
        identityRef.current = next;
        setIdentityState(next);
        if (
          before &&
          next &&
          (before.name !== next.name || before.color !== next.color)
        ) {
          void mutate(adoptSelf(next, before.name));
        }
      }),
    [mutate],
  );

  /* ── Load + poll the sidecar ─────────────────────────────────── */

  useEffect(() => {
    if (!docId) {
      setSidecar(EMPTY_COLLAB_SIDECAR);
      setCoworkPen(null);
      return;
    }
    let cancelled = false;
    let lastSerialized = "";
    /** Task 1281 — the identity this paper's on-open repair last ran for:
     *  once per identity per load, so a paper that can't be written (a
     *  library paper) doesn't retry the same write every poll. */
    let adoptedFor = "";
    let lastPenKey = "";
    /** The cowork rung (task 489). Reads BOTH on-disk records and resolves
     *  them through the ONE ladder, then publishes the answer to the store the
     *  autosave gate and the topbar banner read. Re-resolving from the raw
     *  record on every tick is what makes expiry free: a crashed skill's
     *  record stops being believed at its ceiling with no separate sweep. */
    const loadCoworkPen = async (collabPen: CollabSidecar["pen"] | null) => {
      let penContext: unknown = null;
      try {
        const raw = await readTextFile(docId, COWORK_PEN_CONTEXT_PATH);
        if (raw) penContext = JSON.parse(raw);
      } catch {
        // Absent, unparseable, or a permission loss. Fail toward RELEASING —
        // see the module header: a document wedged read-only is worse than a
        // brief window in which the disk-side gates alone stand.
      }
      if (cancelled) return;
      // Task 545 — the RELEASE TRACE. A released record (`holder: null`,
      // task 496) says when the last hold ended; that is what lets a later
      // "changed on disk" be attributed to Virgil's own AI rather than to
      // "another app". Published before the hold answer so a hold→released
      // transition on this very tick carries the record's own time rather
      // than the poll's estimate.
      const releasedAt = coworkPenReleaseFromContext(penContext);
      if (releasedAt !== null) noteCoworkPenRelease(docId, releasedAt);
      const next = resolveCoworkPen({ penContext, collabPen });
      // Identity-stable: an unchanged answer must not re-render the whole
      // EditorPane → paneState → EditorLayout cascade every 5 seconds.
      const key = next
        ? `${next.source}:${next.holder}:${next.since}:${next.expiresAt}`
        : "";
      noteCoworkPen(docId, next);
      if (key === lastPenKey) return;
      lastPenKey = key;
      setCoworkPen(next);
    };
    const load = async () => {
      try {
        const fresh = await readSidecar<CollabSidecar>(
          docId,
          COLLAB_SIDECAR_FILE,
          EMPTY_COLLAB_SIDECAR,
        );
        void loadCoworkPen(fresh.pen ?? null);
        // Task 1281 — a rename only migrated the papers mounted at the time;
        // this one may still carry a released name (pen, presence, roster).
        // Fold the identity's rename ledger onto it, through the door.
        const me = identityRef.current;
        const meKey = me ? JSON.stringify(me) : "";
        if (!cancelled && me && meKey !== adoptedFor) {
          adoptedFor = meKey;
          if (adoptIdentity(fresh, me) !== fresh) void mutate(adoptSelf(me));
        }
        if (!cancelled) {
          // Merge: keep our own focus heartbeat if we wrote it more recently.
          const merged = mergeKeepingSelf(fresh, sidecarRef.current, selfRef.current());
          // Skip setSidecar when the polled-then-merged content is
          // byte-identical to what we already have. `mergeKeepingSelf`
          // returns a fresh object literal every call, so without this
          // bail-out the 5s polling fires a setState (and a full
          // EditorPane → paneState → EditorLayout cascade) every tick,
          // even when nothing on disk has actually changed.
          const serialized = JSON.stringify(merged);
          if (serialized === lastSerialized) return;
          lastSerialized = serialized;
          sidecarRef.current = merged;
          setSidecar(merged);
        }
      } catch {
        /* file may not exist yet */
        void loadCoworkPen(null);
      }
    };
    load();
    const interval = setInterval(load, COLLAB_TIMINGS.pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
      // Nothing is polling this doc any more, so a retained answer could only
      // go stale — and a stale "Virgil is editing" would wedge the pause for a
      // doc whose pane is gone.
      clearCoworkPen(docId);
    };
  }, [docId]);

  /* ── Re-derive labels every second so "idle 4m" updates live ──── */
  // Only tick when someone actually holds the pen. When the pen is
  // free, derivePen returns a structurally-stable value (no idleSec /
  // staleSec to advance), so a re-render every second just churns
  // every downstream consumer — useCollab → EditorPane → paneState →
  // EditorLayout — for nothing. The pen-holder gate keeps the live-
  // updating "idle 4m" → "idle 5m" label working when it matters and
  // makes the idle case zero-cost.

  useEffect(() => {
    if (!sidecar.pen.holder) return;
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [sidecar.pen.holder]);

  /* ── Heartbeats: pen + claimed card ──────────────────────────── */

  // Gated on the pane being VISIBLE (task 1213): a keep-alive pane parked
  // `display:none` must not keep a pen fresh while its holder works on a
  // different paper — staleness is heartbeat-clocked, so the partner would
  // never be offered "Take over". Hidden, the pen goes stale honestly; shown
  // again, the next beat refreshes it if no one took it meanwhile.
  useEffect(() => {
    if (!identity || !sidecar.enabled || !visible) return;
    const id = setInterval(() => {
      const self = selfRef.current();
      if (!self) return;
      void mutate(heartbeatMutator(self));
    }, COLLAB_TIMINGS.cardHeartbeatMs);
    return () => clearInterval(id);
  }, [identity, sidecar.enabled, visible, mutate]);

  /* ── Leaving the paper in-app: release (task 1213) ──────────── */
  // Closing the pane or switching it to another doc is a release door like
  // `pagehide` — before, unmount only stopped the heartbeat and the partner
  // waited the full stale window for a pen nobody was holding. The release
  // is THIS session's (fresh-read mutator), so a sibling pane or window on
  // the same paper keeps its pen and presence.
  useEffect(() => {
    if (!docId) return;
    return () => {
      // A clean leave: the window no longer runs this session on the paper,
      // so a later reload must not adopt it (task 1392).
      forgetCollabSession(docId, session);
      const self = selfRef.current();
      if (!self) return;
      void mutateCollab(docId, releaseSelf(self));
    };
  }, [docId, session]);

  /* ── Reload continuity: adopt my dead predecessors (task 1392) ── */
  // This session is live in the page for the hook's life; on each paper it
  // registers with the window's record and ADOPTS what the sessions this
  // window ran there before a reload still hold (the pen, the claim). A
  // duplicated tab reads its own empty record (the window id is checked),
  // so it adopts nothing.
  useEffect(() => holdLiveSession(session), [session]);
  useEffect(() => {
    if (!docId) return;
    let current = true;
    void inheritCollabSessions(docId, session, () => current).then((dead) => {
      const self = selfRef.current();
      if (!current || !self || dead.length === 0) return;
      void mutate(adoptSessionsMutator(self, dead));
    });
    return () => {
      current = false;
    };
  }, [docId, session, mutate]);

  /* ── pagehide: best-effort release; pageshow(persisted): re-join ── */
  // `pagehide`, not `beforeunload` (task 872): it fires on close AND on
  // bfcache entry, and iOS Safari / discarded tabs never fire
  // `beforeunload` — the doc locks and the emergency mirror release on the
  // same event. The release is a MUTATOR applied to a fresh in-queue read
  // (clear my pen, drop my presence), never the last-polled snapshot, so a
  // partner's pen request or presence written since that poll survives.
  // Unload can't await: the queued op is fire-and-forget, best-effort.

  useEffect(() => {
    const onPageHide = () => {
      const id = docIdRef.current;
      const self = selfRef.current();
      if (!id || !self) return;
      const release = releaseSelf(self);
      const local = release(sidecarRef.current);
      if (local) sidecarRef.current = local;
      void mutateCollab(id, release);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      // Restored from the bfcache: the release above already ran, so re-join
      // presence (the pen stays released — taking it is a user act).
      if (!e.persisted) return;
      const me = identityRef.current;
      if (!docIdRef.current || !me) return;
      void mutate((prev) =>
        prev.enabled
          ? touchPresence(ensureParticipant(prev, me), me.name, {}, session)
          : prev,
      );
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [mutate, session]);

  /* ── Actions ─────────────────────────────────────────────────── */

  // Through the door only: `saveIdentity` announces the change, and the
  // subscription above (in this hook and every sibling's) adopts + migrates.
  const setIdentity = useCallback((next: CollabIdentity) => {
    saveIdentity(next);
  }, []);

  const enableCollab = useCallback(async () => {
    const me = identityRef.current;
    if (!me) return;
    await mutate((prev) => {
      let next: CollabSidecar = { ...prev, enabled: true };
      next = ensureParticipant(next, me);
      next = touchPresence(next, me.name, {}, session);
      return next;
    });
  }, [mutate, session]);

  const disableCollab = useCallback(async () => {
    await mutate((prev) => {
      const self = selfRef.current();
      // Leave exactly as the unload release does (my pen, my presence), then
      // switch the mode off.
      const released = self ? releaseSelf(self)(prev) ?? prev : prev;
      return { ...released, enabled: false };
    });
  }, [mutate]);

  // The pen transitions are the store's pure state machine (task 1015): each
  // re-checks its precondition against the FRESH disk read, so a button
  // offered from a poll-old state can't erase or steal a partner's pen.
  const takePen = useCallback(async () => {
    const me = identityRef.current;
    if (!me) return;
    await mutate(takePenMutator(me, session, "take"));
  }, [mutate, session]);

  const passPen = useCallback(async () => {
    const self = selfRef.current();
    if (!self) return;
    await mutate(passPenMutator(self));
  }, [mutate]);

  const requestPen = useCallback(async () => {
    const me = identityRef.current?.name;
    if (!me) return;
    await mutate((prev) => {
      const reqs = prev.pen.requestedBy ?? [];
      if (reqs.some((r) => r.name === me)) return prev;
      return {
        ...prev,
        pen: {
          ...prev.pen,
          requestedBy: [
            ...reqs,
            { name: me, requestedAt: new Date().toISOString() },
          ],
        },
      };
    });
  }, [mutate]);

  const takeOver = useCallback(async () => {
    const me = identityRef.current;
    if (!me) return;
    await mutate(takePenMutator(me, session, "take-over"));
  }, [mutate, session]);

  const bumpActivity = useCallback(() => {
    const self = selfRef.current();
    if (!self) return;
    const now = Date.now();
    if (now - lastActivityWriteRef.current < COLLAB_TIMINGS.activityThrottleMs) {
      return;
    }
    lastActivityWriteRef.current = now;
    void mutate(activityMutator(self, now));
  }, [mutate]);

  // The claim is this SESSION's (task 1392): a sibling pane or window of my
  // name neither refreshes nor releases it.
  const claimCard = useCallback(
    async (panelKind: PanelThemeKey, cardId: string) => {
      const self = selfRef.current();
      if (!self) return;
      await mutate(claimCardMutator(self, panelKind, cardId));
    },
    [mutate],
  );

  const releaseClaim = useCallback(async () => {
    const self = selfRef.current();
    if (!self) return;
    await mutate(releaseClaimMutator(self));
  }, [mutate]);

  const updateSelection = useCallback(
    (cards: { panelKind: PanelThemeKey; cardId: string }[]) => {
      const me = identityRef.current?.name;
      if (!me) return;
      // De-dupe by stable serialization to avoid write churn.
      const key = cards
        .map((c) => `${c.panelKind}:${c.cardId}`)
        .sort()
        .join("|");
      if (key === lastSelectionRef.current) return;
      lastSelectionRef.current = key;
      void mutate((prev) => {
        if (!prev.enabled) return prev;
        return touchPresence(prev, me, { selectedCards: cards }, session);
      });
    },
    [mutate, session],
  );

  const updateCursorParagraph = useCallback(
    (paragraphId: string | null) => {
      const me = identityRef.current?.name;
      if (!me) return;
      if (paragraphId === lastCursorRef.current) return;
      lastCursorRef.current = paragraphId;
      void mutate((prev) => {
        if (!prev.enabled) return prev;
        return touchPresence(prev, me, { cursorParagraphId: paragraphId }, session);
      });
    },
    [mutate, session],
  );

  const getCardSelections = useCallback(
    (panelKind: PanelThemeKey, cardId: string) => {
      if (!sidecar.enabled) return [];
      const selfName = identityRef.current?.name ?? null;
      const out: { name: string; color: string }[] = [];
      for (const [name, entry] of Object.entries(sidecar.presence)) {
        if (name === selfName) continue;
        if (
          entry.selectedCards?.some(
            (c) => c.panelKind === panelKind && c.cardId === cardId,
          )
        ) {
          const color =
            sidecar.participants.find((p) => p.name === name)?.color ?? "#888";
          out.push({ name, color });
        }
      }
      return out;
    },
    [sidecar],
  );

  const getCursorSelections = useCallback(
    (paragraphId: string) => {
      if (!sidecar.enabled) return [];
      const selfName = identityRef.current?.name ?? null;
      const out: { name: string; color: string }[] = [];
      for (const [name, entry] of Object.entries(sidecar.presence)) {
        if (name === selfName) continue;
        if (entry.cursorParagraphId === paragraphId) {
          const color =
            sidecar.participants.find((p) => p.name === name)?.color ?? "#888";
          out.push({ name, color });
        }
      }
      return out;
    },
    [sidecar],
  );

  /* ── Periodic stale sweep ───────────────────────────────────── */

  // The VISIBLE pane sweeps (a hidden keep-alive pane has nothing to show),
  // and a sweep that finds nothing stale writes nothing (task 1392).
  useEffect(() => {
    if (!sidecar.enabled || !visible) return;
    const id = setInterval(() => {
      void mutate(sweepMutator());
    }, COLLAB_TIMINGS.penStaleMs);
    return () => clearInterval(id);
  }, [sidecar.enabled, visible, mutate]);

  /* ── Derived state ─────────────────────────────────────────── */

  // `tick` bumps every 1s to refresh idle/stale labels. When the pen is
  // free or the derived values haven't changed (e.g. idleSec rounds to
  // the same integer), keep the *same* reference so collab → paneState
  // → EditorLayout doesn't re-render every second. derivePen returns a
  // fresh object literal on every call (including a fresh empty array
  // for `requestedBy ?? []`), which used to churn the whole hook
  // downstream of `tick`.
  const prevPenRef = useRef<ReturnType<typeof derivePen> | null>(null);
  const pen = useMemo(() => {
    const next = derivePen(sidecar.pen);
    const prev = prevPenRef.current;
    if (
      prev &&
      prev.status === next.status &&
      prev.holder === next.holder &&
      prev.idleSec === next.idleSec &&
      prev.staleSec === next.staleSec &&
      prev.requestedBy.length === next.requestedBy.length &&
      prev.requestedBy.every((r, i) => r === next.requestedBy[i])
    ) {
      return prev;
    }
    prevPenRef.current = next;
    return next;
  }, [sidecar.pen, tick]);
  const me = identity?.name ?? null;
  const iHavePen = !!me && holdsPen(sidecar.pen, { name: me, session });
  const penHeldElsewhere = !!me && sidecar.pen.holder === me && !iHavePen;
  const partnerColor = useMemo(() => {
    if (!sidecar.pen.holder || sidecar.pen.holder === me) return null;
    return (
      sidecar.participants.find((p) => p.name === sidecar.pen.holder)
        ?.color ?? null
    );
  }, [sidecar.pen.holder, sidecar.participants, me]);

  // Task 489 — a cowork skill holding the pen makes the main text read-only
  // REGARDLESS of collaborator mode. That is the whole of the reported gap:
  // the pre-489 gate bit only when the USER had turned collab on, so on an
  // ordinary solo paper the skill's pen meant nothing to the UI and the user
  // could type (and autosave) straight over a commit in flight. Nothing here
  // is a second pen vocabulary — `coworkPen` is the ONE ladder's answer, and
  // when collab IS on the sidecar rung and `iHavePen` agree with it by
  // construction (an AI holder is not me).
  const canEditMainText = coworkPen === null && (!sidecar.enabled || iHavePen);

  const getCardClaim = useCallback(
    (panelKind: PanelThemeKey, cardId: string) => {
      if (!sidecar.enabled) return null;
      return findClaim(sidecar, me, panelKind, cardId);
    },
    [sidecar, me],
  );

  // Memoize the returned hook so the topbar (which now reads it via
  // `paneState.collab` and pipes it through `<CollabProvider>`) can
  // hand the same reference back through context without triggering a
  // re-render every render. Without this, every EditorPane render
  // produced a fresh hook object → context value churn → context
  // consumers re-render → EditorPane re-renders → fresh hook again →
  // infinite "Maximum update depth exceeded" loop. The deps cover
  // every field carried by the hook; identity-stable useCallbacks
  // ensure the memo only re-derives on real state change.
  const liveHook = useMemo(
    () => ({
      enabled: sidecar.enabled,
      identity,
      sidecar,
      pen,
      canEditMainText,
      coworkPen,
      iHavePen,
      penHeldElsewhere,
      partnerColor,
      setIdentity,
      enableCollab,
      disableCollab,
      takePen,
      passPen,
      requestPen,
      takeOver,
      bumpActivity,
      claimCard,
      releaseClaim,
      getCardClaim,
      updateSelection,
      updateCursorParagraph,
      getCardSelections,
      getCursorSelections,
    }),
    [
      sidecar,
      identity,
      pen,
      canEditMainText,
      coworkPen,
      iHavePen,
      penHeldElsewhere,
      partnerColor,
      setIdentity,
      enableCollab,
      disableCollab,
      takePen,
      passPen,
      requestPen,
      takeOver,
      bumpActivity,
      claimCard,
      releaseClaim,
      getCardClaim,
      updateSelection,
      updateCursorParagraph,
      getCardSelections,
      getCursorSelections,
    ],
  );

  if (!docId) return COLLAB_INERT;
  return liveHook;
}

/* ── Context for deep card components ─────────────────────────────── */

const CollabContext = createContext<CollabHook | null>(null);

export const CollabProvider = CollabContext.Provider;

/** Read collab state from context. Returns the inert no-op hook when no
 *  provider is mounted, so cards rendered outside an EditorLayout still
 *  work normally. */
export function useCollabContext(): CollabHook {
  return useContext(CollabContext) ?? COLLAB_INERT;
}

/** Per-card claim helper. Returns the partner claim (if any), and stable
 *  `claim` / `release` callbacks scoped to this (panelKind, cardId). */
export function useCardClaim(
  panelKind: PanelThemeKey | undefined,
  cardId: string | undefined,
): {
  partnerClaim: { holder: string; color: string } | null;
  claim: () => void;
  release: () => void;
} {
  const collab = useCollabContext();
  const partnerClaim = useMemo(() => {
    if (!collab.enabled || !panelKind || !cardId) return null;
    const c = collab.getCardClaim(panelKind, cardId);
    if (!c) return null;
    return { holder: c.holder, color: c.color };
  }, [collab, panelKind, cardId]);

  const claim = useCallback(() => {
    if (!collab.enabled || !panelKind || !cardId) return;
    void collab.claimCard(panelKind, cardId);
  }, [collab, panelKind, cardId]);

  const release = useCallback(() => {
    if (!collab.enabled) return;
    void collab.releaseClaim();
  }, [collab]);

  return { partnerClaim, claim, release };
}

/* ── Internal: merge a fresh disk read with our local state ─────── */

/**
 * The poller's read could clobber heartbeats we wrote since the file
 * was fetched. To avoid that, when we are the pen holder or have a
 * recent focus claim, prefer our local timestamps over the freshly-read
 * ones for our own slots. Everything else mirrors the disk truth.
 */
function mergeKeepingSelf(
  fresh: CollabSidecar,
  local: CollabSidecar,
  self: CollabSelf | null,
): CollabSidecar {
  if (!self) return fresh;
  const selfName = self.name;
  let next = fresh;
  // Pen: if THIS session still thinks it holds it AND fresh agrees, keep our
  // timestamps (task 1213 — a sibling session of my name is not "self").
  if (
    holdsPen(local.pen, self) &&
    holdsPen(fresh.pen, self) &&
    local.pen.lastHeartbeat &&
    (!fresh.pen.lastHeartbeat ||
      Date.parse(local.pen.lastHeartbeat) >
        Date.parse(fresh.pen.lastHeartbeat))
  ) {
    next = {
      ...next,
      pen: {
        ...fresh.pen,
        lastHeartbeat: local.pen.lastHeartbeat,
        lastActivity: local.pen.lastActivity ?? fresh.pen.lastActivity,
      },
    };
  }
  // Presence: if we have a fresher local heartbeat, prefer it — but the
  // `sessions` map stays the disk's, with only OUR session's stamp laid over
  // it, so a sibling session's join or release on disk is never undone.
  const localMine = local.presence[selfName];
  const freshMine = fresh.presence[selfName];
  if (
    localMine &&
    (!freshMine ||
      Date.parse(localMine.lastHeartbeat) >
        Date.parse(freshMine.lastHeartbeat))
  ) {
    const mineAt = localMine.sessions?.[self.session];
    const sessions =
      mineAt !== undefined
        ? { ...(freshMine?.sessions ?? {}), [self.session]: mineAt }
        : freshMine?.sessions;
    // The claim likewise: ours only if THIS session holds it (task 1392) —
    // otherwise the disk's, so a sibling's claim or release is not undone.
    const entry = {
      ...localMine,
      focusedCard: holdsClaim(localMine.focusedCard, self)
        ? localMine.focusedCard
        : (freshMine?.focusedCard ?? null),
    };
    if (sessions) entry.sessions = sessions;
    else delete entry.sessions;
    next = {
      ...next,
      presence: { ...next.presence, [selfName]: entry },
    };
  }
  return next;
}
