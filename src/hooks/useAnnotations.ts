"use client";

import { useCallback } from "react";
import type { AnnotationsState } from "@/lib/types";
import { usePersistentState } from "./usePersistentState";

const EMPTY: AnnotationsState = {};

function migrate(raw: unknown): AnnotationsState {
  return raw && typeof raw === "object" ? (raw as AnnotationsState) : EMPTY;
}

export function useAnnotations(docId: string | null) {
  const { state: annotations, update } = usePersistentState<AnnotationsState>(
    docId,
    "annotations.json",
    EMPTY,
    { migrate, errorLabel: "annotations" },
  );

  const getAnnotation = useCallback(
    (key: string): string => annotations[key] || "",
    [annotations],
  );

  const setAnnotation = useCallback(
    (key: string, text: string) => {
      update((prev) => {
        const next = { ...prev, [key]: text };
        if (!text) delete next[key];
        return next;
      });
    },
    [update],
  );

  return { annotations, getAnnotation, setAnnotation };
}
