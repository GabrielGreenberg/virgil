"use client";

import { useCallback, useMemo } from "react";
import type { SuggestionsState, Suggestion } from "@/lib/types";
import { usePersistentState } from "./usePersistentState";

const EMPTY_STATE: SuggestionsState = {
  suggestions: [],
  currentIndex: 0,
  reviewedAt: "",
  documentHash: "",
};

function migrate(raw: unknown): SuggestionsState {
  const s = raw as Partial<SuggestionsState>;
  if (!Array.isArray(s.suggestions) || s.suggestions.length === 0) {
    return EMPTY_STATE;
  }
  return {
    suggestions: s.suggestions,
    currentIndex: s.currentIndex ?? 0,
    reviewedAt: s.reviewedAt ?? "",
    documentHash: s.documentHash ?? "",
  };
}

export function useSuggestions(docId: string | null) {
  const { state, setState, update, persist } = usePersistentState<SuggestionsState>(
    docId,
    "suggestions.json",
    EMPTY_STATE,
    { migrate, errorLabel: "suggestions" },
  );

  const currentSuggestion: Suggestion | null =
    state.suggestions.length > 0 && state.currentIndex < state.suggestions.length
      ? state.suggestions[state.currentIndex]
      : null;

  const actOnSuggestion = useCallback(
    (id: string, action: "accepted" | "rejected" | "skipped") => {
      update((prev) => {
        const suggestions = prev.suggestions.map((s) =>
          s.id === id ? { ...s, status: action } : s,
        );
        let nextIndex = prev.currentIndex + 1;
        while (nextIndex < suggestions.length && suggestions[nextIndex].status !== "pending") {
          nextIndex++;
        }
        return {
          ...prev,
          suggestions,
          currentIndex: Math.min(nextIndex, suggestions.length),
        };
      });
    },
    [update],
  );

  const updateSuggestionField = useCallback(
    (id: string, field: "revision" | "note", value: string) => {
      update((prev) => ({
        ...prev,
        suggestions: prev.suggestions.map((s) =>
          s.id === id ? { ...s, [field]: value } : s,
        ),
      }));
    },
    [update],
  );

  const jumpToSuggestion = useCallback(
    (index: number) => {
      update((prev) => ({ ...prev, currentIndex: index }));
    },
    [update],
  );

  const clearSuggestions = useCallback(() => {
    setState(EMPTY_STATE);
    void persist(EMPTY_STATE);
  }, [setState, persist]);

  const isComplete =
    state.suggestions.length > 0 &&
    state.suggestions.every((s) => s.status !== "pending");

  return useMemo(
    () => ({
      state,
      currentSuggestion,
      isComplete,
      actOnSuggestion,
      updateSuggestionField,
      jumpToSuggestion,
      clearSuggestions,
    }),
    [
      state,
      currentSuggestion,
      isComplete,
      actOnSuggestion,
      updateSuggestionField,
      jumpToSuggestion,
      clearSuggestions,
    ],
  );
}
