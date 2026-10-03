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
  isAiRequestsWriteRefused,
  mutateAiRequests,
  readAiRequests,
  type AiRequestsMutator,
} from "@/lib/ai-requests-store";
import { recordSidecarRefusal } from "@/lib/sidecar-refusal";
import { closeRequestRow, isTerminalStatus } from "@/lib/ai-request-open";
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
  // `loaded` AND `!loadError` (below) so it never runs over a stale/pre-load
  // request list — nor over a failed read's empty one.
  const [loadedDocId, setLoadedDocId] = useState<string | null>(null);
  const loaded = docId == null ? true : loadedDocId === docId;
  // The docId whose initial read THREW (task 679). DERIVED the same way
  // `loaded` is, so it resets on `docId` change for free — and the same
  // DISTINCTION `usePersistentState` draws: an errored read still flips
  // `loaded` (the read terminated) but leaves `state` at EMPTY, so the request
  // list is NOT authoritative. `[]` here does not mean "no requests", it means
  // "we don't know". Any AUTOMATIC write derived from this list (the card
  // migration) must gate on `!loadError`, and any surface that renders "nothing
  // here" must not claim it.
  const [loadErrorDocId, setLoadErrorDocId] = useState<string | null>(null);
  const loadError = docId == null ? false : loadErrorDocId === docId;

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
  // The live READ DOOR for the current docId, published by the effect below so
  // the mutation drain can replay a deferred signal and `refresh()` can retry a
  // failed read. Null while no doc is open.
  const readRef = useRef<(() => void) | null>(null);

  // Stay in sync with the OTHER in-window writer of `ai-requests.json`. The
  // card-flag bridge (`bridgeCardAiRequestFlag`) mutates the file through the
  // shared authority, behind this hook's back; without this the AIWindow
  // wouldn't reflect a freshly-toggled request until a reload/remount (drop
  // D3). Every writer publishes its authoritative post-write list on the doc
  // channel — including this hook's own setters — and we adopt it verbatim, so
  // the inbox and the on-disk queue can't diverge. Fires only on a real
  // mutation (never on a keystroke), so it's exempt from the keystroke-sanctity
  // list.
  //
  // A publish is AUTHORITATIVE (task 906): `mutateAiRequests` publishes only a
  // `written` result, computed by `mutateSidecar` from a DIRECT disk read taken
  // inside the doc lock, so it is exactly as true as a fresh read — and it
  // clears `loadError` the same way the read door does.
  useEffect(() => {
    if (!docId) return;
    return subscribeAiRequests(docId, (requests) => {
      setState({ requests });
      setLoadErrorDocId(null);
    });
  }, [docId]);

  // ── ONE authoritative READ door (task 906) ────────────────────────────────
  // The mount read, the external-change re-hydrate (task 220) and the user's
  // Refresh are the SAME act — "adopt what the file says now" — and they go
  // through one function, `readAuthoritative`, which owns BOTH halves of the
  // answer: the list and the `loadError` flag. Success adopts the list and
  // CLEARS the flag; failure SETS it and voices one refusal. Before task 906
  // these were three hand copies, and only the mount read cleared the flag, so
  // one transient failure left `loadError` true for the life of the doc — the
  // card migration shut over a known-good inbox, and the AI window told the
  // user to reopen the paper under a Refresh button that could not retry it.
  //
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
    if (!docId) { setState(EMPTY); return; }
    let cancelled = false;

    const readAuthoritative = () => {
      rehydratePending.current = false;
      readAiRequests(docId)
        .then((requests) => {
          if (cancelled) return;
          // Re-check after the await: a mutation may have started while the read
          // was in flight, and its published result — computed from a base at
          // least as fresh as this one — must win. Re-arm so the drain replays.
          // (`loaded` stays false meanwhile on a first read: the drain's replay
          // is what flips it, over a list nothing is about to supersede.)
          if (inFlight.current > 0) {
            rehydratePending.current = true;
            return;
          }
          setState({ requests });
          setLoadErrorDocId(null);
          setLoadedDocId(docId);
        })
        .catch((err) => {
          if (cancelled) return;
          // The read terminated but FAILED (transient IO, or a corrupt/truncated
          // file). Flag it, so the automatic card migration stands down rather
          // than minting cards from a list that is not the one on disk (task
          // 679); and SAY so, on the same channel this hook's WRITE path speaks
          // from (task 630). The list itself is left untouched — EMPTY on a
          // first read, the last good list on a later one — never blanked.
          //
          // Re-arm, so the next mutation's drain retries; the user's Refresh
          // (`refresh()` below) retries too. Stated residual: with neither, this
          // window stays flagged until the doc is reopened — NOT a claim that
          // the watcher will try again, because it will not.
          rehydratePending.current = true;
          setLoadErrorDocId(docId);
          setLoadedDocId(docId);
          recordSidecarRefusal({
            docId,
            what: "AI request list",
            reason: "unreadable",
            detail: err instanceof Error ? err.message : undefined,
          });
        });
    };
    readRef.current = readAuthoritative;
    readAuthoritative();

    const onSidecarChanged = (e: Event) => {
      const detail = (e as CustomEvent<SidecarChangedDetail>).detail;
      if (!detail) return;
      if (detail.docId !== docId || !isAiRequestsFile(detail.filename)) return;
      // DIRTY GUARD: a mutation in flight is about to publish a list computed
      // from a base at least as fresh as this read — defer to it, and REMEMBER
      // (see above). Note the deferred-to mutation is not guaranteed to publish:
      // every result but `written` publishes nothing (a declined mutator, a
      // missing handle, a read-only paper, a failed write, a stale pipeline),
      // which is exactly why the pending flag replays on drain rather than
      // trusting the mutation to cover us.
      if (inFlight.current > 0) {
        rehydratePending.current = true;
        return;
      }
      readAuthoritative();
    };

    window.addEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    return () => {
      cancelled = true;
      readRef.current = null;
      rehydratePending.current = false;
      window.removeEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    };
  }, [docId]);

  /**
   * Re-run the authoritative read on demand — the AI window's Refresh (task
   * 906). The same door the mount read and the external-change re-hydrate go
   * through, under the same DIRTY GUARD: with a mutation in flight it defers
   * (and remembers) rather than adopting a base that mutation supersedes.
   */
  const refresh = useCallback(() => {
    if (inFlight.current > 0) {
      rehydratePending.current = true;
      return;
    }
    readRef.current?.();
  }, []);

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
   * ## When the write does NOT happen (task 630)
   *
   * Optimism is only honest if it is TAKEN BACK when the disk disagrees. The
   * store used to answer `null` for five different outcomes and this hook
   * inspected none of them, so a request filed with no write handle, onto a
   * read-only library paper, or into a folder whose write threw, sat in the
   * Open bucket with the inbox dot lit, reached no skill, and vanished on the
   * next reload with nothing said. Now the store answers
   * {@link AiRequestsWriteResult} and this door branches on it:
   *
   * - `written` / `declined` — nothing to do (a `written` result has already
   *   published the merged truth, which the subscription above adopts; a
   *   `declined` mutator returned the same `prev` optimistically too).
   * - `stale` — SILENT and NOT rolled back. The doc switched under the write
   *   and the new owner is authoritative; this window's state is about to be
   *   replaced wholesale, so a notice would be about a paper the user has left.
   * - refused (`no-handle` / `read-only` / `failed`) — publish ONE refusal to
   *   the sidecar channel (the band says it in plain words) and RECONCILE:
   *   re-arm the pending re-hydrate so the drain below re-reads the file and
   *   the optimistic row goes. Reconciling from disk rather than "undoing"
   *   `mutate` is what makes this correct under concurrent mutations — the
   *   mutators are not invertible, and disk is the only base that is true for
   *   all of them.
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
      void mutateAiRequests(docId, mutate)
        .then((result) => {
          if (!isAiRequestsWriteRefused(result)) return;
          recordSidecarRefusal({
            docId,
            what: "AI request",
            reason: result.kind === "failed" ? "failed" : result.kind,
            detail:
              result.kind === "failed" && result.error instanceof Error
                ? result.error.message
                : undefined,
          });
          // ROLL BACK by reconciling, not by inverting: arm the same deferral
          // the external-change guard uses, and let the drain below re-read the
          // file once every in-flight mutation has settled.
          rehydratePending.current = true;
        })
        .finally(() => {
          inFlight.current -= 1;
          // DRAIN: replay an external change deferred while this write was in
          // flight — or this write's OWN roll-back. The watcher will not tell
          // us again, and this mutation may have published nothing at all, so
          // nothing else would have carried the peer's change (or undone the
          // phantom row).
          if (inFlight.current === 0 && rehydratePending.current) {
            readRef.current?.();
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

  /**
   * WITHDRAW a row by id — the AI window's Cancel for a request with no card
   * behind it to untick: an unlinked composer row, a corrupt link, or a link
   * that resolves to no card (task 697).
   *
   * It CLOSES the row (`complete` / `"withdrawn"`, the shared
   * `closeRequestRow`); it used to `filter` it out of the file, which is the
   * same defect the card-flag untick had — a skill that had already claimed
   * the id found no such row and died on `die("request id not found")` after
   * all its work (task 720). There is no claim step, so an unlinked row a
   * skill is actively working still reads `pending`: "nobody has it" is not
   * derivable, and erasure is never the safe guess. Withdrawal is a state.
   *
   * Idempotent: an unknown id, or a row that is already terminal, returns
   * `null` — no write, no publish, no second stamp.
   */
  const withdrawRequest = useCallback((id: string) => {
    applyMutation((requests) => {
      const idx = requests.findIndex((r) => r.id === id);
      if (idx < 0 || isTerminalStatus(requests[idx].status)) return null;
      return requests.map((r, i) =>
        i === idx ? closeRequestRow(r, "withdrawn") : r,
      );
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
      loadError,
      addRequest,
      addStyleMergeRequest,
      updateRequestText,
      withdrawRequest,
      relinkRequests,
      refresh,
    }),
    [
      state.requests,
      loaded,
      loadError,
      addRequest,
      addStyleMergeRequest,
      updateRequestText,
      withdrawRequest,
      relinkRequests,
      refresh,
    ],
  );
}
