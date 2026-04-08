"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { BibReviewState, BibReviewRequest } from "@/lib/types";

const EMPTY: BibReviewState = { requests: [] };

export function useBibReview(docId: string | null) {
  const [state, setState] = useState<BibReviewState>(EMPTY);
  const docIdRef = useRef(docId);

  const fetchState = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/bib-review?docId=${id}`);
      const data: BibReviewState = await r.json();
      if (docIdRef.current === id) setState(data ?? EMPTY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    fetchState(docId);
  }, [docId, fetchState]);

  // Poll every 10s for status changes, but only when there are pending requests
  const hasPending = state.requests.some((r) => r.status === "pending");
  useEffect(() => {
    if (!docId || !hasPending) return;
    const interval = setInterval(() => {
      if (docIdRef.current) fetchState(docIdRef.current);
    }, 10000);
    return () => clearInterval(interval);
  }, [docId, hasPending, fetchState]);

  const persist = useCallback(async (s: BibReviewState) => {
    const id = docIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/bib-review?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
    } catch (err) {
      console.error("Failed to save bib review requests:", err);
    }
  }, []);

  const requestReview = useCallback((bibKey: string, type: "fields" | "notes", requestNotes?: string) => {
    setState((prev) => {
      // Don't duplicate an existing pending request for same key+type
      const existing = prev.requests.find(
        (r) => r.bibKey === bibKey && r.type === type && r.status === "pending"
      );
      if (existing) return prev;
      const req: BibReviewRequest = {
        bibKey,
        type,
        requestedAt: new Date().toISOString(),
        status: "pending",
        requestNotes: requestNotes || undefined,
      };
      const next = { requests: [...prev.requests, req] };
      persist(next);
      return next;
    });
  }, [persist]);

  const cancelRequest = useCallback((bibKey: string, type: "fields" | "notes") => {
    setState((prev) => {
      const next = {
        requests: prev.requests.filter(
          (r) => !(r.bibKey === bibKey && r.type === type && r.status === "pending")
        ),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const getRequestStatus = useCallback(
    (bibKey: string, type: "fields" | "notes"): "none" | "pending" | "complete" => {
      const req = state.requests.find(
        (r) => r.bibKey === bibKey && r.type === type
      );
      return req?.status ?? "none";
    },
    [state.requests]
  );

  const clearRequest = useCallback((bibKey: string, type: "fields" | "notes") => {
    setState((prev) => {
      const next = {
        requests: prev.requests.filter(
          (r) => !(r.bibKey === bibKey && r.type === type)
        ),
      };
      persist(next);
      return next;
    });
  }, [persist]);

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
