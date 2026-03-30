"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SuggestionsState, Suggestion } from "@/lib/types";

const EMPTY_STATE: SuggestionsState = {
  suggestions: [],
  currentIndex: 0,
  reviewedAt: "",
  documentHash: "",
};

export function useSuggestions(docId: string | null) {
  const [state, setState] = useState<SuggestionsState>(EMPTY_STATE);
  const currentDocIdRef = useRef(docId);

  useEffect(() => {
    currentDocIdRef.current = docId;
    if (!docId) {
      setState(EMPTY_STATE);
      return;
    }

    fetch(`/api/suggestions?docId=${docId}`)
      .then((r) => r.json())
      .then((data: SuggestionsState) => {
        if (currentDocIdRef.current === docId && data.suggestions && data.suggestions.length > 0) {
          setState(data);
        } else {
          setState(EMPTY_STATE);
        }
      })
      .catch(() => {});
  }, [docId]);

  const currentSuggestion: Suggestion | null =
    state.suggestions.length > 0 && state.currentIndex < state.suggestions.length
      ? state.suggestions[state.currentIndex]
      : null;

  const persistState = useCallback(async (newState: SuggestionsState) => {
    const id = currentDocIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/suggestions?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newState),
      });
    } catch (err) {
      console.error("Failed to save suggestions:", err);
    }
  }, []);

  const actOnSuggestion = useCallback(
    (id: string, action: "accepted" | "rejected" | "skipped") => {
      setState((prev) => {
        const suggestions = prev.suggestions.map((s) =>
          s.id === id ? { ...s, status: action } : s
        );
        let nextIndex = prev.currentIndex + 1;
        while (nextIndex < suggestions.length && suggestions[nextIndex].status !== "pending") {
          nextIndex++;
        }
        const newState: SuggestionsState = {
          ...prev,
          suggestions,
          currentIndex: Math.min(nextIndex, suggestions.length),
        };
        persistState(newState);
        return newState;
      });
    },
    [persistState]
  );

  const updateSuggestionField = useCallback(
    (id: string, field: "revision" | "note", value: string) => {
      setState((prev) => {
        const suggestions = prev.suggestions.map((s) =>
          s.id === id ? { ...s, [field]: value } : s
        );
        const newState = { ...prev, suggestions };
        persistState(newState);
        return newState;
      });
    },
    [persistState]
  );

  const jumpToSuggestion = useCallback(
    (index: number) => {
      setState((prev) => {
        const newState = { ...prev, currentIndex: index };
        persistState(newState);
        return newState;
      });
    },
    [persistState]
  );

  const clearSuggestions = useCallback(() => {
    setState(EMPTY_STATE);
    persistState(EMPTY_STATE);
  }, [persistState]);

  const isComplete =
    state.suggestions.length > 0 &&
    state.suggestions.every((s) => s.status !== "pending");

  return {
    state,
    currentSuggestion,
    isComplete,
    actOnSuggestion,
    updateSuggestionField,
    jumpToSuggestion,
    clearSuggestions,
  };
}
