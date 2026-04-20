"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type { TodoState, TodoItem } from "@/lib/types";
import {
  addParagraphLink,
  derivedLinksForCard,
  removeParagraphLink,
} from "@/links/links";

const EMPTY: TodoState = { items: [] };

function migrateTodo(raw: unknown): TodoItem {
  const i = raw as Partial<TodoItem> & { paragraphIds?: string[] };
  if (Array.isArray(i.links) && i.links.length > 0) {
    return {
      id: i.id!,
      text: i.text ?? "",
      notes: i.notes ?? "",
      done: !!i.done,
      createdAt: i.createdAt!,
      links: i.links,
    };
  }
  return {
    id: i.id!,
    text: i.text ?? "",
    notes: i.notes ?? "",
    done: !!i.done,
    createdAt: i.createdAt!,
    links: derivedLinksForCard("todo", {
      id: i.id!,
      paragraphIds: Array.isArray(i.paragraphIds) ? i.paragraphIds : [],
    }),
  };
}

export function useTodos(docId: string | null) {
  const [state, setState] = useState<TodoState>(EMPTY);
  const docIdRef = useRef(docId);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) { setState(EMPTY); return; }
    readSidecar<TodoState>(docId, "todos.json", EMPTY)
      .then((data) => {
        if (docIdRef.current === docId && data.items) {
          setState({ items: data.items.map(migrateTodo) });
        }
      })
      .catch(() => {});
  }, [docId]);

  const persist = useCallback(async (s: TodoState) => {
    const id = docIdRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, "todos.json", s);
    } catch (err) {
      console.error("Failed to save todos:", err);
    }
  }, []);

  const addItem = useCallback((text: string) => {
    const item: TodoItem = {
      id: generateEntityId(),
      text,
      notes: "",
      done: false,
      createdAt: new Date().toISOString(),
      links: [],
    };
    setState((prev) => {
      const next = { items: [...prev.items, item] };
      persist(next);
      return next;
    });
  }, [persist]);

  const toggleItem = useCallback((id: string) => {
    setState((prev) => {
      const next = { items: prev.items.map((i) => i.id === id ? { ...i, done: !i.done } : i) };
      persist(next);
      return next;
    });
  }, [persist]);

  const updateItem = useCallback((id: string, text: string) => {
    setState((prev) => {
      const next = { items: prev.items.map((i) => i.id === id ? { ...i, text } : i) };
      persist(next);
      return next;
    });
  }, [persist]);

  const updateNotes = useCallback((id: string, notes: string) => {
    setState((prev) => {
      const next = { items: prev.items.map((i) => i.id === id ? { ...i, notes } : i) };
      persist(next);
      return next;
    });
  }, [persist]);

  const deleteItem = useCallback((id: string) => {
    setState((prev) => {
      const next = { items: prev.items.filter((i) => i.id !== id) };
      persist(next);
      return next;
    });
  }, [persist]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      const items = [...prev.items];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      const next = { items };
      persist(next);
      return next;
    });
  }, [persist]);

  const archiveDone = useCallback(() => {
    setState((prev) => {
      const next = { items: prev.items.filter((i) => !i.done) };
      persist(next);
      return next;
    });
  }, [persist]);

  const addParagraphId = useCallback((todoId: string, paragraphId: string) => {
    setState((prev) => {
      const next = {
        items: prev.items.map((i) =>
          i.id === todoId ? addParagraphLink(i, "todo", paragraphId) : i,
        ),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const removeParagraphId = useCallback((todoId: string, paragraphId: string) => {
    setState((prev) => {
      const next = {
        items: prev.items.map((i) =>
          i.id === todoId ? removeParagraphLink(i, paragraphId) : i,
        ),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  return {
    items: state.items,
    addItem,
    toggleItem,
    updateItem,
    updateNotes,
    deleteItem,
    reorder,
    archiveDone,
    addParagraphId,
    removeParagraphId,
  };
}
