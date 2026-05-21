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
 *  - Flush release on `beforeunload` (best-effort).
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
import { readSidecar, writeSidecar } from "@/lib/storage";
import {
  beginDocPipeline,
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import {
  COLLAB_SIDECAR_FILE,
  COLLAB_TIMINGS,
  EMPTY_COLLAB_SIDECAR,
  derivePen,
  ensureParticipant,
  findClaim,
  loadIdentity,
  saveIdentity,
  sweepStalePresence,
  touchPresence,
  type CollabFocusClaim,
  type CollabIdentity,
  type CollabSidecar,
  type DerivedPen,
} from "@/lib/collab";

export interface CollabState {
  /** True when the sidecar's `enabled` flag is set on disk. */
  enabled: boolean;
  /** Whether the local user has set up their identity. */
  identity: CollabIdentity | null;
  /** Latest snapshot from disk. */
  sidecar: CollabSidecar;
  /** Derived pen state (free / active / idle / stale). */
  pen: DerivedPen;
  /** True if collab is disabled OR I currently hold the pen. */
  canEditMainText: boolean;
  /** Have I currently claimed the pen? */
  iHavePen: boolean;
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
  /** Claim a card for editing — call on focus. */
  claimCard: (panelKind: string, cardId: string) => Promise<void>;
  /** Release whatever card the user has claimed — call on blur. */
  releaseClaim: () => Promise<void>;
  /** Lookup whether a card is currently claimed by the partner. */
  getCardClaim: (
    panelKind: string,
    cardId: string,
  ) => { holder: string; color: string; claim: CollabFocusClaim } | null;
  /** Soft presence: set the user's currently-selected cards. */
  updateSelection: (cards: { panelKind: string; cardId: string }[]) => void;
  /** Soft presence: set the user's currently-active paragraph in the editor. */
  updateCursorParagraph: (paragraphId: string | null) => void;
  /** Lookup which partners have selected a given card. */
  getCardSelections: (
    panelKind: string,
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
  iHavePen: false,
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

export function useCollab(docId: string | null): CollabHook {
  const [identity, setIdentityState] = useState<CollabIdentity | null>(() =>
    loadIdentity(),
  );
  const [sidecar, setSidecar] = useState<CollabSidecar>(EMPTY_COLLAB_SIDECAR);
  const [tick, setTick] = useState(0); // re-derives idle/stale labels

  const sidecarRef = useRef(sidecar);
  sidecarRef.current = sidecar;
  const docIdRef = useRef(docId);
  docIdRef.current = docId;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const lastActivityWriteRef = useRef(0);
  const lastSelectionRef = useRef<string>("");
  const lastCursorRef = useRef<string | null>(null);

  /** Read-modify-write under a single in-flight chain.
   *
   *  Re-reads from disk before applying the mutation so we don't stomp
   *  partner-side changes that landed since our last poll. Without this,
   *  a 10s heartbeat that fires between 5s polls would write back the
   *  stale (partner-less) snapshot and lose the partner's presence on
   *  every cycle. The per-file write queue serializes *our* writes; this
   *  pre-read serializes against the disk's current state.
   *
   *  The active doc-write handle is resolved *lazily* at call time
   *  (not memoized into the callback's deps) so that React StrictMode
   *  / Fast Refresh remounts — which can rotate the underlying
   *  pipelineId in the doc-pipeline registry mid-flight — don't leave
   *  every subsequent mutate writing through a stale handle that fails
   *  `assertActive` and silently drops the change.
   */
  const mutate = useCallback(
    async (fn: (prev: CollabSidecar) => CollabSidecar): Promise<void> => {
      const id = docIdRef.current;
      if (!id) return;
      // Prefer the pipeline that <DocPipeline> already registered, but
      // fall back to beginDocPipeline if the registry is empty. The
      // registry can be empty in two situations: (1) we're running in
      // a component tree that doesn't mount <DocPipeline> for this
      // doc (e.g. a sidecar-only consumer), and (2) React StrictMode /
      // Fast Refresh has rotated through enough mount/unmount cycles
      // that the queued microtask cleanup deleted the entry before
      // the matching remount could revive it. beginDocPipeline is
      // idempotent — when DocPipeline next mounts/remounts, it
      // reuses this entry rather than creating a fresh pipelineId,
      // so this fallback doesn't fragment the registry.
      const handle = getActiveHandle(id) ?? beginDocPipeline(id);
      let base = sidecarRef.current;
      try {
        const fresh = await readSidecar<CollabSidecar>(
          id,
          COLLAB_SIDECAR_FILE,
          EMPTY_COLLAB_SIDECAR,
        );
        base = mergeKeepingSelf(fresh, sidecarRef.current, identityRef.current?.name ?? null);
      } catch {
        /* fall back to local */
      }
      const next = fn(base);
      sidecarRef.current = next;
      setSidecar(next);
      try {
        await writeSidecar(handle, COLLAB_SIDECAR_FILE, next);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        /* swallow other errors — partner will re-converge on next poll */
      }
    },
    [],
  );

  /* ── Load + poll the sidecar ─────────────────────────────────── */

  useEffect(() => {
    if (!docId) {
      setSidecar(EMPTY_COLLAB_SIDECAR);
      return;
    }
    let cancelled = false;
    let lastSerialized = "";
    const load = async () => {
      try {
        const fresh = await readSidecar<CollabSidecar>(
          docId,
          COLLAB_SIDECAR_FILE,
          EMPTY_COLLAB_SIDECAR,
        );
        if (!cancelled) {
          // Merge: keep our own focus heartbeat if we wrote it more recently.
          const merged = mergeKeepingSelf(fresh, sidecarRef.current, identityRef.current?.name ?? null);
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
      }
    };
    load();
    const interval = setInterval(load, COLLAB_TIMINGS.pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
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

  useEffect(() => {
    if (!identity || !sidecar.enabled) return;
    const id = setInterval(() => {
      const me = identityRef.current?.name;
      if (!me) return;
      mutate((prev) => {
        if (!prev.enabled) return prev;
        let next = prev;
        const now = new Date().toISOString();
        if (prev.pen.holder === me) {
          next = {
            ...next,
            pen: { ...next.pen, lastHeartbeat: now },
          };
        }
        const myEntry = next.presence[me];
        if (myEntry?.focusedCard) {
          next = touchPresence(next, me, {
            focusedCard: { ...myEntry.focusedCard, lastHeartbeat: now },
          });
        } else if (myEntry) {
          next = touchPresence(next, me, {});
        }
        return next;
      });
    }, COLLAB_TIMINGS.cardHeartbeatMs);
    return () => clearInterval(id);
  }, [identity, sidecar.enabled, mutate]);

  /* ── beforeunload: best-effort release ───────────────────────── */

  useEffect(() => {
    const handler = () => {
      const id = docIdRef.current;
      const me = identityRef.current?.name;
      if (!id || !me) return;
      const handle = getActiveHandle(id) ?? beginDocPipeline(id);
      const prev = sidecarRef.current;
      if (!prev.enabled) return;
      let next = prev;
      if (prev.pen.holder === me) {
        next = {
          ...next,
          pen: {
            ...next.pen,
            holder: null,
            since: null,
            lastHeartbeat: null,
            lastActivity: null,
          },
        };
      }
      if (next.presence[me]) {
        const { [me]: _gone, ...rest } = next.presence;
        next = { ...next, presence: rest };
      }
      sidecarRef.current = next;
      // Fire-and-forget; FSA writes are async but the queue may not
      // flush before unload completes. This is best-effort.
      void writeSidecar(handle, COLLAB_SIDECAR_FILE, next).catch(() => {});
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /* ── Actions ─────────────────────────────────────────────────── */

  const setIdentity = useCallback((next: CollabIdentity) => {
    saveIdentity(next);
    setIdentityState(next);
    identityRef.current = next;
  }, []);

  const enableCollab = useCallback(async () => {
    const me = identityRef.current;
    if (!me) return;
    await mutate((prev) => {
      let next: CollabSidecar = { ...prev, enabled: true };
      next = ensureParticipant(next, me);
      next = touchPresence(next, me.name, {});
      return next;
    });
  }, [mutate]);

  const disableCollab = useCallback(async () => {
    await mutate((prev) => {
      const me = identityRef.current?.name ?? null;
      let next: CollabSidecar = { ...prev, enabled: false };
      if (me && prev.pen.holder === me) {
        next = {
          ...next,
          pen: {
            ...next.pen,
            holder: null,
            since: null,
            lastHeartbeat: null,
            lastActivity: null,
          },
        };
      }
      if (me && next.presence[me]) {
        const { [me]: _gone, ...rest } = next.presence;
        next = { ...next, presence: rest };
      }
      return next;
    });
  }, [mutate]);

  const takePen = useCallback(async () => {
    const me = identityRef.current;
    if (!me) return;
    await mutate((prev) => {
      const now = new Date().toISOString();
      let next = ensureParticipant(prev, me);
      next = touchPresence(next, me.name, {});
      return {
        ...next,
        enabled: true,
        pen: {
          holder: me.name,
          since: now,
          lastHeartbeat: now,
          lastActivity: now,
          requestedBy: (prev.pen.requestedBy ?? []).filter(
            (r) => r.name !== me.name,
          ),
        },
      };
    });
  }, [mutate]);

  const passPen = useCallback(async () => {
    await mutate((prev) => ({
      ...prev,
      pen: {
        holder: null,
        since: null,
        lastHeartbeat: null,
        lastActivity: null,
        requestedBy: [],
      },
    }));
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
    await takePen();
  }, [takePen]);

  const bumpActivity = useCallback(() => {
    const me = identityRef.current?.name;
    if (!me) return;
    const now = Date.now();
    if (now - lastActivityWriteRef.current < COLLAB_TIMINGS.activityThrottleMs) {
      return;
    }
    lastActivityWriteRef.current = now;
    void mutate((prev) => {
      if (prev.pen.holder !== me) return prev;
      return {
        ...prev,
        pen: {
          ...prev.pen,
          lastActivity: new Date(now).toISOString(),
          lastHeartbeat: new Date(now).toISOString(),
        },
      };
    });
  }, [mutate]);

  const claimCard = useCallback(
    async (panelKind: string, cardId: string) => {
      const me = identityRef.current?.name;
      if (!me) return;
      const now = new Date().toISOString();
      await mutate((prev) =>
        touchPresence(prev, me, {
          focusedCard: {
            panelKind,
            cardId,
            focusedAt: now,
            lastHeartbeat: now,
          },
        }),
      );
    },
    [mutate],
  );

  const releaseClaim = useCallback(async () => {
    const me = identityRef.current?.name;
    if (!me) return;
    await mutate((prev) => {
      const entry = prev.presence[me];
      if (!entry?.focusedCard) return prev;
      return touchPresence(prev, me, { focusedCard: null });
    });
  }, [mutate]);

  const updateSelection = useCallback(
    (cards: { panelKind: string; cardId: string }[]) => {
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
        return touchPresence(prev, me, { selectedCards: cards });
      });
    },
    [mutate],
  );

  const updateCursorParagraph = useCallback(
    (paragraphId: string | null) => {
      const me = identityRef.current?.name;
      if (!me) return;
      if (paragraphId === lastCursorRef.current) return;
      lastCursorRef.current = paragraphId;
      void mutate((prev) => {
        if (!prev.enabled) return prev;
        return touchPresence(prev, me, { cursorParagraphId: paragraphId });
      });
    },
    [mutate],
  );

  const getCardSelections = useCallback(
    (panelKind: string, cardId: string) => {
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

  useEffect(() => {
    if (!sidecar.enabled) return;
    const id = setInterval(() => {
      mutate((prev) => sweepStalePresence(prev));
    }, COLLAB_TIMINGS.penStaleMs);
    return () => clearInterval(id);
  }, [sidecar.enabled, mutate]);

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
  const iHavePen = !!me && sidecar.pen.holder === me;
  const partnerColor = useMemo(() => {
    if (!sidecar.pen.holder || sidecar.pen.holder === me) return null;
    return (
      sidecar.participants.find((p) => p.name === sidecar.pen.holder)
        ?.color ?? null
    );
  }, [sidecar.pen.holder, sidecar.participants, me]);

  const canEditMainText = !sidecar.enabled || iHavePen;

  const getCardClaim = useCallback(
    (panelKind: string, cardId: string) => {
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
      iHavePen,
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
      iHavePen,
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
  panelKind: string | undefined,
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
  selfName: string | null,
): CollabSidecar {
  if (!selfName) return fresh;
  let next = fresh;
  // Pen: if we still think we hold it AND fresh agrees, keep our timestamps.
  if (
    local.pen.holder === selfName &&
    fresh.pen.holder === selfName &&
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
  // Presence: if we have a fresher local heartbeat, prefer it.
  const localMine = local.presence[selfName];
  const freshMine = fresh.presence[selfName];
  if (
    localMine &&
    (!freshMine ||
      Date.parse(localMine.lastHeartbeat) >
        Date.parse(freshMine.lastHeartbeat))
  ) {
    next = {
      ...next,
      presence: { ...next.presence, [selfName]: localMine },
    };
  }
  return next;
}
