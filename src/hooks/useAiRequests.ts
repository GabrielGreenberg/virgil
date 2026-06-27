"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type {
  AiRequest,
  AiRequestKind,
  AiRequestPayload,
  AiRequestsState,
} from "@/lib/types";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";

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
  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!docId) { setState(EMPTY); return; }
    readSidecar<AiRequestsState>(docId, "ai-requests.json", EMPTY)
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.requests)) setState(data);
        setLoadedDocId(docId);
      })
      .catch(() => { if (!cancelled) setLoadedDocId(docId); });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const persist = useCallback(
    async (s: AiRequestsState) => {
      if (!handle) return;
      try {
        await writeSidecar(handle, "ai-requests.json", s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save ai requests:", err);
      }
    },
    [handle],
  );

  const addRequest = useCallback((kind: AiRequestKind, text = ""): AiRequest => {
    const req: AiRequest = {
      id: generateEntityId(),
      kind,
      text,
      createdAt: new Date().toISOString(),
      status: "draft",
    };
    setState((prev) => {
      const next = { requests: [...prev.requests, req] };
      persist(next);
      return next;
    });
    return req;
  }, [persist]);

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
      setState((prev) => {
        const next = { requests: [...prev.requests, req] };
        persist(next);
        return next;
      });
      return req;
    },
    [persist],
  );

  const updateRequestText = useCallback((id: string, text: string) => {
    setState((prev) => {
      const next = {
        requests: prev.requests.map((r) => (r.id === id ? { ...r, text } : r)),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const deleteRequest = useCallback((id: string) => {
    setState((prev) => {
      const next = { requests: prev.requests.filter((r) => r.id !== id) };
      persist(next);
      return next;
    });
  }, [persist]);

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
    setState((prev) => {
      const next = {
        requests: prev.requests.map((r) => byId.get(r.id) ?? r),
      };
      persist(next);
      return next;
    });
  }, [persist]);

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
