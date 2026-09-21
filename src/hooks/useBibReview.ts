"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { readSidecar, writeSidecar } from "@/lib/storage";
import { libraryPaperSidecarWritable } from "@/lib/host-writability";
import { recordSidecarRefusal } from "@/lib/sidecar-refusal";
import type { BibReviewState, BibReviewRequest, BibEntry } from "@/lib/types";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { isIdentityCascadeOn } from "@/lib/identity/identity-flag";
import {
  buildKeyToUid,
  migrateBibReviewToUid,
} from "@/lib/identity/sidecar-uid-migrate";

const EMPTY: BibReviewState = { requests: [] };

/**
 * Bib-review requests sidecar.
 *
 * Identity model (T1 Stage 1): with the `virgil:identity-cascade` flag ON, each
 * row carries the durable {@link BibEntry.uid} (`entryUid`) so a citekey rename
 * re-points nothing (BIB-A2-02) — a pending review survives the rename. The
 * public API is UNCHANGED (callers pass `bibKey` citekeys); the hook resolves
 * citekey → uid internally and matches on uid when present.
 *
 * **Flag OFF preserves the legacy behavior exactly** — rows have no `entryUid`,
 * every match is by `bibKey`, and the on-disk file is byte-identical to today.
 */
type GetBibEntry = (key: string) => BibEntry | undefined;

export function useBibReview(
  docId: string | null,
  getBibEntry?: GetBibEntry,
  bibEntries?: readonly BibEntry[],
) {
  const cascadeOn = isIdentityCascadeOn() && !!getBibEntry;
  const [state, setState] = useState<BibReviewState>(EMPTY);
  const docIdRef = useRef(docId);
  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  const keyToUid = useMemo(
    () => buildKeyToUid(bibEntries ?? []),
    [bibEntries],
  );
  // Live mirrors of the latest resolver/flag/map for the stable
  // `fetchState`/`matchesKey` callbacks (which can't list these in deps without
  // re-running the load effect on every keystroke-adjacent bib change). Updated
  // in an effect — never written during render (react-hooks/refs).
  const keyToUidRef = useRef(keyToUid);
  const cascadeRef = useRef(cascadeOn);
  const getBibEntryRef = useRef(getBibEntry);
  useEffect(() => {
    keyToUidRef.current = keyToUid;
    cascadeRef.current = cascadeOn;
    getBibEntryRef.current = getBibEntry;
  });

  const fetchState = useCallback(async (id: string) => {
    try {
      const data = await readSidecar<BibReviewState>(
        id,
        "bib-review-requests.json",
        EMPTY,
      );
      if (docIdRef.current !== id) return;
      // Normalize the SHAPE, not just the absence. `readSidecar`'s fallback
      // covers a missing file; a file that exists but does not hold a
      // `requests` array (an empty `{}`, a hand-edited or half-written
      // sidecar) sails past `?? EMPTY` and every later `state.requests.some`
      // throws — on the flag-OFF path, which is every shipping build, and
      // during render, so it takes the whole pane down. The flag-ON path
      // happened to be safe only because `migrateBibReviewToUid` rebuilds the
      // shape on its way through.
      const raw: BibReviewState = Array.isArray(data?.requests)
        ? (data as BibReviewState)
        : EMPTY;
      // Migrate-on-load: stamp `entryUid` onto rows whose citekey resolves
      // (non-destructive — unresolvable rows keep their bare bibKey).
      setState(cascadeRef.current ? migrateBibReviewToUid(raw, keyToUidRef.current) : raw);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    fetchState(docId);
  }, [docId, fetchState]);

  // Re-stamp entryUids once the bib entries arrive after the sidecar load
  // (the read can resolve before the .bib parse). Idempotent + non-destructive.
  useEffect(() => {
    if (!cascadeOn) return;
    setState((prev) => migrateBibReviewToUid(prev, keyToUid));
  }, [cascadeOn, keyToUid]);

  // Poll every 10s for status changes, but only when there are pending requests
  const hasPending = state.requests.some((r) => r.status === "pending");
  useEffect(() => {
    if (!docId || !hasPending) return;
    const interval = setInterval(() => {
      if (docIdRef.current) fetchState(docIdRef.current);
    }, 10000);
    return () => clearInterval(interval);
  }, [docId, hasPending, fetchState]);

  /**
   * Persist the queue — and SAY SO when it does not land (task 630).
   *
   * This was the AI-request inbox's swallow one hook over: optimistic state
   * first, a fire-and-forget write, and every path on which the write did not
   * happen ending at a `console.error` the user never sees. All three of them
   * leave a pending review showing in the panel that no skill will ever serve
   * and that is gone on the next reload:
   *
   *   - no active write handle (a pipeline swap, or a paper not open for
   *     writing);
   *   - a host that refuses the file — a `library-paper:` doc may persist only
   *     its derived writable set, and `bib-review-requests.json` is not in it,
   *     so `writeSidecar` returns having written NOTHING and throws nothing.
   *     Asked here through `libraryPaperSidecarWritable`, which is the funnel's
   *     own exported question rather than a second copy of its rule, because a
   *     void-returning door leaves no other way to see the refusal;
   *   - a real write failure.
   *
   * A stale-pipeline throw stays silent and un-reconciled: the doc switched
   * under the write and the new owner is authoritative.
   *
   * The roll-back is the same reconcile the inbox does — re-read the file, so
   * the panel shows what is actually on disk. `fetchState` is safe to call with
   * a doc that has since changed (it bails on `docIdRef`).
   */
  const persist = useCallback(
    async (s: BibReviewState) => {
      const docId = docIdRef.current;
      const refuse = (
        reason: "no-handle" | "read-only" | "failed",
        detail?: string,
      ) => {
        recordSidecarRefusal({ docId, what: "bibliography review", reason, detail });
        if (docId) fetchState(docId);
      };
      if (!handle) return refuse("no-handle");
      if (!libraryPaperSidecarWritable(handle.docId, "bib-review-requests.json")) {
        return refuse("read-only");
      }
      try {
        await writeSidecar(handle, "bib-review-requests.json", s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save bib review requests:", err);
        refuse("failed", err instanceof Error ? err.message : undefined);
      }
    },
    [handle, fetchState],
  );

  /** Does a row target the same entry as `bibKey`? Under the flag, prefer the
   *  durable uid (so a rename can't make a row stop matching); fall back to the
   *  citekey for rows that never got an entryUid. */
  const matchesKey = useCallback(
    (r: BibReviewRequest, bibKey: string): boolean => {
      if (cascadeRef.current && r.entryUid) {
        const uid = getBibEntryRef.current?.(bibKey)?.uid;
        if (uid) return r.entryUid === uid;
      }
      return r.bibKey === bibKey;
    },
    [],
  );

  const requestReview = useCallback((bibKey: string, type: "fields" | "notes", requestNotes?: string) => {
    setState((prev) => {
      // Don't duplicate an existing pending request for same entry+type
      const existing = prev.requests.find(
        (r) => matchesKey(r, bibKey) && r.type === type && r.status === "pending"
      );
      if (existing) return prev;
      const uid = cascadeRef.current ? getBibEntryRef.current?.(bibKey)?.uid : undefined;
      const req: BibReviewRequest = {
        bibKey,
        type,
        requestedAt: new Date().toISOString(),
        status: "pending",
        requestNotes: requestNotes || undefined,
        ...(uid ? { entryUid: uid } : {}),
      };
      const next = { requests: [...prev.requests, req] };
      persist(next);
      return next;
    });
  }, [persist, matchesKey]);

  const cancelRequest = useCallback((bibKey: string, type: "fields" | "notes") => {
    setState((prev) => {
      const next = {
        requests: prev.requests.filter(
          (r) => !(matchesKey(r, bibKey) && r.type === type && r.status === "pending")
        ),
      };
      persist(next);
      return next;
    });
  }, [persist, matchesKey]);

  const getRequestStatus = useCallback(
    (bibKey: string, type: "fields" | "notes"): "none" | "pending" | "complete" => {
      const req = state.requests.find(
        (r) => matchesKey(r, bibKey) && r.type === type
      );
      return req?.status ?? "none";
    },
    [state.requests, matchesKey]
  );

  const clearRequest = useCallback((bibKey: string, type: "fields" | "notes") => {
    setState((prev) => {
      const next = {
        requests: prev.requests.filter(
          (r) => !(matchesKey(r, bibKey) && r.type === type)
        ),
      };
      persist(next);
      return next;
    });
  }, [persist, matchesKey]);

  const refresh = useCallback(() => {
    const id = docIdRef.current;
    if (id) fetchState(id);
  }, [fetchState]);

  /**
   * Re-key this sidecar for a citekey rename — the IdentityCascade migrator
   * EditorPane registers for `bibEntry` (task 689).
   *
   * Correct on BOTH shapes, and needed on both. With the flag off no row has an
   * `entryUid`, so every match is `r.bibKey === bibKey` and a rename strands the
   * entry's pending reviews (BIB-A2-02): the panel shows no request, and a new
   * one can be filed alongside the orphan. With the flag on a uid-carrying row
   * survives the rename by uid — but its `bibKey` is then STALE, and that field
   * is what the skill side reads to find the entry it was asked to review, so
   * leaving it is a rename that half-lands. Rows whose citekey never resolved to
   * a uid match by `bibKey` on both paths and need the move outright.
   *
   * So: every row naming `oldKey` is re-pointed, whatever its shape. Idempotent
   * (a second run finds no `oldKey` row), and it persists only when a row moved.
   */
  const renameBibKey = useCallback(
    (oldKey: string, newKey: string) => {
      if (!oldKey || !newKey || oldKey === newKey) return;
      setState((prev) => {
        if (!prev.requests.some((r) => r.bibKey === oldKey)) return prev;
        const next = {
          ...prev,
          requests: prev.requests.map((r) =>
            r.bibKey === oldKey ? { ...r, bibKey: newKey } : r,
          ),
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return useMemo(
    () => ({
      requests: state.requests,
      requestReview,
      cancelRequest,
      getRequestStatus,
      clearRequest,
      refresh,
      renameBibKey,
    }),
    [
      state.requests,
      requestReview,
      cancelRequest,
      getRequestStatus,
      clearRequest,
      refresh,
      renameBibKey,
    ],
  );
}
