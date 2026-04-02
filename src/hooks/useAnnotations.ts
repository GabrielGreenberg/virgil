"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { AnnotationsState } from "@/lib/types";

const EMPTY: AnnotationsState = {};

export function useAnnotations(docId: string | null) {
  const [annotations, setAnnotations] = useState<AnnotationsState>(EMPTY);
  const docIdRef = useRef(docId);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) { setAnnotations(EMPTY); return; }
    fetch(`/api/annotations?docId=${docId}`)
      .then((r) => r.json())
      .then((data: AnnotationsState) => {
        if (docIdRef.current === docId) setAnnotations(data ?? EMPTY);
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (s: AnnotationsState) => {
    const id = docIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/annotations?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
    } catch (err) {
      console.error("Failed to save annotations:", err);
    }
  }, []);

  const getAnnotation = useCallback((key: string): string => {
    return annotations[key] || "";
  }, [annotations]);

  const setAnnotation = useCallback((key: string, text: string) => {
    setAnnotations((prev) => {
      const next = { ...prev, [key]: text };
      if (!text) delete next[key];
      persist(next);
      return next;
    });
  }, [persist]);

  return { annotations, getAnnotation, setAnnotation };
}
