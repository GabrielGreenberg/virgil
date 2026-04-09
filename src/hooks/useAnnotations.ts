"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { readSidecar, writeSidecar } from "@/lib/storage-fsa";
import type { AnnotationsState } from "@/lib/types";

const EMPTY: AnnotationsState = {};

export function useAnnotations(docId: string | null) {
  const [annotations, setAnnotations] = useState<AnnotationsState>(EMPTY);
  const docIdRef = useRef(docId);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) { setAnnotations(EMPTY); return; }
    readSidecar<AnnotationsState>(docId, "annotations.json", EMPTY)
      .then((data) => {
        if (docIdRef.current === docId) setAnnotations(data ?? EMPTY);
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (s: AnnotationsState) => {
    const id = docIdRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, "annotations.json", s);
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
