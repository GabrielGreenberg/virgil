"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { AiRequest, AiRequestKind, AiRequestsState } from "@/lib/types";

const EMPTY: AiRequestsState = { requests: [] };

export function useAiRequests(docId: string | null) {
  const [state, setState] = useState<AiRequestsState>(EMPTY);
  const docIdRef = useRef(docId);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    fetch(`/api/ai-requests?docId=${docId}`)
      .then((r) => r.json())
      .then((data: AiRequestsState) => {
        if (docIdRef.current === docId && Array.isArray(data.requests)) {
          setState(data);
        }
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (s: AiRequestsState) => {
    const id = docIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/ai-requests?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
    } catch (err) {
      console.error("Failed to save ai requests:", err);
    }
  }, []);

  const addRequest = useCallback((kind: AiRequestKind, text = ""): AiRequest => {
    const req: AiRequest = {
      id: uuid(),
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

  return {
    requests: state.requests,
    addRequest,
    updateRequestText,
    deleteRequest,
  };
}
