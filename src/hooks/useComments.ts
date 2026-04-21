"use client";

import { useCallback } from "react";
import { generateEntityId } from "@/lib/uuid";
import type { CommentsState, UserComment } from "@/lib/types";
import { usePersistentState } from "./usePersistentState";

const EMPTY_STATE: CommentsState = { comments: [] };

function migrate(raw: unknown): CommentsState {
  const s = raw as Partial<CommentsState>;
  return { comments: Array.isArray(s.comments) ? s.comments : [] };
}

export function useComments(docId: string | null) {
  const { state, update } = usePersistentState<CommentsState>(
    docId,
    "comments.json",
    EMPTY_STATE,
    { migrate, errorLabel: "comments" },
  );

  const addComment = useCallback(
    (selectedText: string, comment: string) => {
      const newComment: UserComment = {
        id: generateEntityId(),
        selectedText,
        comment,
        createdAt: new Date().toISOString(),
        resolved: false,
      };
      update((prev) => ({ comments: [...prev.comments, newComment] }));
      return newComment;
    },
    [update],
  );

  const updateComment = useCallback(
    (id: string, comment: string) => {
      update((prev) => ({
        comments: prev.comments.map((c) => (c.id === id ? { ...c, comment } : c)),
      }));
    },
    [update],
  );

  const resolveComment = useCallback(
    (id: string) => {
      update((prev) => ({
        comments: prev.comments.map((c) =>
          c.id === id ? { ...c, resolved: true } : c,
        ),
      }));
    },
    [update],
  );

  const deleteComment = useCallback(
    (id: string) => {
      update((prev) => ({ comments: prev.comments.filter((c) => c.id !== id) }));
    },
    [update],
  );

  const activeComments = state.comments.filter((c) => !c.resolved);
  const resolvedComments = state.comments.filter((c) => c.resolved);

  return {
    comments: state.comments,
    activeComments,
    resolvedComments,
    addComment,
    updateComment,
    resolveComment,
    deleteComment,
  };
}
