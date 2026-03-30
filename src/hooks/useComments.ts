"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { CommentsState, UserComment } from "@/lib/types";

const EMPTY_STATE: CommentsState = { comments: [] };

export function useComments(docId: string | null) {
  const [state, setState] = useState<CommentsState>(EMPTY_STATE);
  const currentDocIdRef = useRef(docId);

  useEffect(() => {
    currentDocIdRef.current = docId;
    if (!docId) {
      setState(EMPTY_STATE);
      return;
    }

    fetch(`/api/comments?docId=${docId}`)
      .then((r) => r.json())
      .then((data: CommentsState) => {
        if (currentDocIdRef.current === docId && data.comments) {
          setState(data);
        }
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (newState: CommentsState) => {
    const id = currentDocIdRef.current;
    if (!id) return;
    try {
      await fetch(`/api/comments?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newState),
      });
    } catch (err) {
      console.error("Failed to save comments:", err);
    }
  }, []);

  const addComment = useCallback(
    (selectedText: string, comment: string) => {
      const newComment: UserComment = {
        id: uuid(),
        selectedText,
        comment,
        createdAt: new Date().toISOString(),
        resolved: false,
      };
      setState((prev) => {
        const newState = { comments: [...prev.comments, newComment] };
        persist(newState);
        return newState;
      });
      return newComment;
    },
    [persist]
  );

  const updateComment = useCallback(
    (id: string, comment: string) => {
      setState((prev) => {
        const newState = {
          comments: prev.comments.map((c) =>
            c.id === id ? { ...c, comment } : c
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const resolveComment = useCallback(
    (id: string) => {
      setState((prev) => {
        const newState = {
          comments: prev.comments.map((c) =>
            c.id === id ? { ...c, resolved: true } : c
          ),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
  );

  const deleteComment = useCallback(
    (id: string) => {
      setState((prev) => {
        const newState = {
          comments: prev.comments.filter((c) => c.id !== id),
        };
        persist(newState);
        return newState;
      });
    },
    [persist]
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
