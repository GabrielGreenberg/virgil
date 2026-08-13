"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { generateEntityId } from "@/lib/uuid";
import type {
  AiRequest,
  AiRequestKind,
  AiRequestPayload,
  AiRequestsState,
} from "@/lib/types";
import { subscribeAiRequests } from "@/lib/ai-request-events";
import {
  isAiRequestsFile,
  mutateAiRequests,
  readAiRequests,
  type AiRequestsMutator,
} from "@/lib/ai-requests-store";
import {
  SIDECAR_CHANGED_EVENT,
  type SidecarChangedDetail,
} from "@/lib/sidecar-watcher";

const EMPTY: AiRequestsState = { requests: [] };

export function useAiRequests(docId: string | null) {
  const [state, setState] = useState<AiRequestsState>(EMPTY);
  // The docId whose initial read has resolved (loaded, absent, or errored).
  // `loaded` is DERIVED from it (below) so it flips back to false the instant
  // `docId` changes — without a synchronous reset-setState in the effect (which
  // trips react-hooks/set-state-in-effect). The card-request migration gates on
  // `loaded` so it never runs over a stale/pre-load request list.
  const [loadedDocId, setLoadedDocId] = useState<string | null>(null);
  const loaded = docId == null ? true : loadedDocId === docId;

  // How many serialized mutations this hook has in flight. The external-change
  // re-hydrate below defers while it is non-zero: a mutation's own write is
  // itself an on-disk change, and adopting a disk read taken mid-flight would
  // show a base the pending mutation is about to supersede. This is the
  // `usePersistentState` DIRTY GUARD in the shape this hook's writes have
  // (immediate + serialized, rather than debounced) — read only inside async
  // callbacks, never during render.
  const inFlight = useRef(0);
  // An external change we were told about but could not adopt yet (a mutation
  // was in flight). The watcher emits ONCE per change, so this is a debt, not a
  // hint — it is replayed the moment `inFlight` drains. See the re-hydrate
  // effect for why "skip and wait for the next poll" loses the change forever.
  const rehydratePending = useRef(false);
  // The live re-hydrate for the current docId, published by the effect below so
  // the mutation drain can replay a deferred signal. Null while no doc is open.
  const rehydrateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!docId) { setState(EMPTY); return; }
    readAiRequests(docId)
      .then((requests) => {
        if (cancelled) return;
        setState({ requests });
        setLoadedDocId(docId);
      })
      .catch(() => { if (!cancelled) setLoadedDocId(docId); });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // Stay in sync with the OTHER in-window writer of `ai-requests.json`. The
  // card-flag bridge (`bridgeCardAiRequestFlag`) mutates the file through the
  // shared authority, behind this hook's back; without this the AIWindow
  // wouldn't reflect a freshly-toggled request until a reload/remount (drop
  // D3). Every writer publishes its authoritative post-write list on the doc
  // channel — including this hook's own setters — and we adopt it verbatim, so
  // the inbox and the on-disk queue can't diverge. Fires only on a real
  // mutation (never on a keystroke), so it's exempt from the keystroke-sanctity
  // list.
  useEffect(() => {
    if (!docId) return;
    return subscribeAiRequests(docId, (requests) => {
      setState({ requests });
    });
  }, [docId]);

  // ── LIVE external-change re-hydrate (task 220) ────────────────────────────
  // The `publishAiRequests` bus above is an in-PROCESS module Map, so it reaches
  // only this window. Two writers it cannot reach touch the same file: a PEER
  // WINDOW on the same doc (multi-window is first-class — `openNewVirgilWindow`)
  // and the `/editor/*` skills, which read-modify-write `ai-requests.json`
  // straight on disk while the paper is open. Without a disk-side signal this
  // hook's state stays permanently stale against both, and — before the store
  // made every mutation a merge over the freshly-read on-disk list — its next
  // write clobbered their change from that stale base.
  //
  // The signal is the `SidecarWatcher`'s per-file external-change event, the
  // same channel `usePersistentState` rides: it fires only on a GENUINE
  // external change (our own writes stamp the disk ledger inside `writeSidecar`,
  // so they're filtered upstream by the own-write guard) and it has already
  // invalidated the sidecar bundle, so the re-read hits disk.
  //
  // THE SIGNAL FIRES ONCE — so a deferral must REMEMBER, never merely skip. The
  // watcher re-baselines its ledger to the new on-disk bytes BEFORE it emits, so
  // its next poll takes the cheap mtime/size path and neither reads nor re-emits;
  // its baseline is disk-vs-ledger, and it has no way to know a listener dropped
  // the event. A dirty-guard that just `return`s therefore loses the change until
  // the NEXT external write — permanently, if none comes. `rehydratePending` is
  // the deferral: set it when we can't act now, and replay once the in-flight
  // mutations drain. (An earlier draft of this comment claimed "the watcher
  // re-emits on its next poll", which is false — the shape this file's own
  // AGENTS.md law calls a justification that describes the gate rather than what
  // it actually relies on.)
  //
  // KEYSTROKE SANCTITY: a `window` listener, not an `editor.on(...)` subscriber.
  // It fires on a wall-clock poll, never per keystroke.
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;

    const rehydrate = () => {
      rehydratePending.current = false;
      readAiRequests(docId)
        .then((requests) => {
          if (cancelled) return;
          // Re-check after the await: a mutation may have started while the read
          // was in flight, and its published result — computed from a base at
          // least as fresh as this one — must win. Re-arm so the drain replays.
          if (inFlight.current > 0) {
            rehydratePending.current = true;
            return;
          }
          setState({ requests });
        })
        .catch(() => {
          // Read failed (transient IO, or a corrupt/truncated file). Leave state
          // untouched and re-arm, so the next mutation's drain retries. Stated
          // residual: with no further mutation and no further external write,
          // this window stays on its last good list until the doc is reopened —
          // better than adopting a blank inbox, and NOT a claim that the watcher
          // will try again, because it will not.
          rehydratePending.current = true;
        });
    };
    rehydrateRef.current = rehydrate;

    const onSidecarChanged = (e: Event) => {
      const detail = (e as CustomEvent<SidecarChangedDetail>).detail;
      if (!detail) return;
      if (detail.docId !== docId || !isAiRequestsFile(detail.filename)) return;
      // DIRTY GUARD: a mutation in flight is about to publish a list computed
      // from a base at least as fresh as this read — defer to it, and REMEMBER
      // (see above). Note the deferred-to mutation is not guaranteed to publish:
      // a declined mutator, a missing handle, a library paper and a failed write
      // all resolve `null` without publishing, which is exactly why the pending
      // flag replays on drain rather than trusting the mutation to cover us.
      if (inFlight.current > 0) {
        rehydratePending.current = true;
        return;
      }
      rehydrate();
    };

    window.addEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    return () => {
      cancelled = true;
      rehydrateRef.current = null;
      rehydratePending.current = false;
      window.removeEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    };
  }, [docId]);

  /**
   * Apply one mutation to the inbox.
   *
   * Two applications of the SAME pure function (task 220): once optimistically
   * against live React state, so the UI never waits on a disk round-trip; once
   * inside the serialized write critical section against the list as it is ON
   * DISK, which is the authoritative one. The store publishes that result and
   * this hook's own subscription adopts it, so the optimistic value is
   * superseded by the merged truth within the same tick's I/O.
   *
   * This replaced a whole-snapshot persist derived from React `prev` with no
   * read-merge — the shape that silently overwrote a concurrent bridge write
   * (and a peer window's) from a stale base. `mutate` must therefore be PURE
   * and stable across two different bases: mint ids and timestamps OUTSIDE it.
   *
   * With no doc / no active write handle the store persists nothing and
   * publishes nothing; the optimistic state stands, exactly as the old
   * handle-less persist behaved.
   *
   * Known, accepted transient: two mutations issued inside ONE disk round-trip
   * (a double-click on two different rows) adopt the FIRST one's published list
   * before the second lands, so the second row reappears for that round-trip and
   * then goes again. The end state is always the merged truth. The obvious cure
   * — adopt a publish only when it is the last in-flight mutation — buys a hole
   * worth more than the flicker: a DECLINED mutation publishes nothing, so the
   * one publish that would have carried a peer's change gets skipped with
   * nothing behind it to supersede it, and the inbox stays stale until the next
   * EXTERNAL WRITE — permanently, if none comes. Not "until the watcher's next
   * poll": the watcher re-baselines before it emits and never re-emits (see the
   * re-hydrate effect above), which is the same false comfort this file already
   * corrects once and must not reintroduce as a justification.
   */
  const applyMutation = useCallback(
    (mutate: AiRequestsMutator) => {
      setState((prev) => {
        const next = mutate(prev.requests);
        return next === null ? prev : { requests: next };
      });
      inFlight.current += 1;
      void mutateAiRequests(docId, mutate).finally(() => {
        inFlight.current -= 1;
        // DRAIN: replay an external change deferred while this write was in
        // flight. The watcher will not tell us again — and this mutation may
        // have resolved `null` without publishing anything, so nothing else
        // would have carried the peer's change.
        if (inFlight.current === 0 && rehydratePending.current) {
          rehydrateRef.current?.();
        }
      });
    },
    [docId],
  );

  const addRequest = useCallback((kind: AiRequestKind, text = ""): AiRequest => {
    const req: AiRequest = {
      id: generateEntityId(),
      kind,
      text,
      createdAt: new Date().toISOString(),
      status: "draft",
    };
    applyMutation((requests) => [...requests, req]);
    return req;
  }, [applyMutation]);

  /**
   * File a style-merge request — submitted directly (skipping the draft
   * state since there's nothing for the user to edit). The backing
   * `/style-merge <docId>` skill drains pending requests, computes the
   * merge, rewrites the .tex, and flips the request to "complete".
   */
  const addStyleMergeRequest = useCallback(
    (
      args: {
        targetStyleId: string;
        targetStyleName: string;
        targetPreamble: string;
        currentPreamble: string;
        note?: string;
      },
    ): AiRequest => {
      const payload: AiRequestPayload = {
        kind: "style-merge",
        targetStyleId: args.targetStyleId,
        targetStyleName: args.targetStyleName,
        targetPreamble: args.targetPreamble,
        currentPreamble: args.currentPreamble,
      };
      const req: AiRequest = {
        id: generateEntityId(),
        kind: "style-merge",
        text: args.note ?? `Merge customizations into "${args.targetStyleName}"`,
        createdAt: new Date().toISOString(),
        status: "submitted",
        payload,
      };
      applyMutation((requests) => [...requests, req]);
      return req;
    },
    [applyMutation],
  );

  const updateRequestText = useCallback((id: string, text: string) => {
    applyMutation((requests) => {
      // Nothing to change if the row is gone (deleted here or by a peer) —
      // returning `null` keeps a stale edit from RESURRECTING it on disk.
      if (!requests.some((r) => r.id === id)) return null;
      return requests.map((r) => (r.id === id ? { ...r, text } : r));
    });
  }, [applyMutation]);

  const deleteRequest = useCallback((id: string) => {
    applyMutation((requests) => {
      if (!requests.some((r) => r.id === id)) return null;
      return requests.filter((r) => r.id !== id);
    });
  }, [applyMutation]);

  /**
   * Merge a set of already-computed request objects back over the store by
   * `id`, persisting the result. Used by the BUG #55b card-request migration
   * to re-bridge converted note/todo requests in place (set `linkedTo` at the
   * freshly-created card). Each entry REPLACES the matching request; ids with
   * no match are ignored. No-op when `updated` is empty.
   */
  const relinkRequests = useCallback((updated: AiRequest[]) => {
    if (updated.length === 0) return;
    const byId = new Map(updated.map((r) => [r.id, r]));
    applyMutation((requests) => {
      if (!requests.some((r) => byId.has(r.id))) return null;
      return requests.map((r) => byId.get(r.id) ?? r);
    });
  }, [applyMutation]);

  return useMemo(
    () => ({
      requests: state.requests,
      loaded,
      addRequest,
      addStyleMergeRequest,
      updateRequestText,
      deleteRequest,
      relinkRequests,
    }),
    [
      state.requests,
      loaded,
      addRequest,
      addStyleMergeRequest,
      updateRequestText,
      deleteRequest,
      relinkRequests,
    ],
  );
}
