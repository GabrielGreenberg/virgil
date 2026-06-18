"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { readSidecar, writeSidecar } from "@/lib/storage";
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
      const raw = data ?? EMPTY;
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

  const persist = useCallback(
    async (s: BibReviewState) => {
      if (!handle) return;
      try {
        await writeSidecar(handle, "bib-review-requests.json", s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save bib review requests:", err);
      }
    },
    [handle],
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

  return {
    requests: state.requests,
    requestReview,
    cancelRequest,
    getRequestStatus,
    clearRequest,
    refresh,
  };
}
