"use client";

import { useCallback } from "react";
import { generateEntityId } from "@/lib/uuid";
import type { TodoState, TodoItem } from "@/lib/types";
import { addParagraphLink, removeParagraphLink } from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY: TodoState = { items: [] };

function migrateTodo(raw: unknown): TodoItem {
  const i = raw as Partial<TodoItem>;
  return {
    id: i.id!,
    text: i.text ?? "",
    notes: i.notes ?? "",
    done: !!i.done,
    aiRequest: !!i.aiRequest,
    createdAt: i.createdAt!,
    links: migrateCardLinks("todo", raw),
  };
}

function migrateTodos(raw: unknown): TodoState {
  const s = raw as Partial<TodoState>;
  return { items: Array.isArray(s.items) ? s.items.map(migrateTodo) : [] };
}

export function useTodos(docId: string | null, externalPristine?: PristineKindApi | null) {
  const { state, update } = usePersistentState<TodoState>(
    docId,
    "todos.json",
    EMPTY,
    { migrate: migrateTodos, errorLabel: "todos" },
  );
  const localPristine = usePristineTracker();
  const pristine = externalPristine ?? localPristine;

  const addItem = useCallback((): TodoItem => {
    const item: TodoItem = {
      id: generateEntityId(),
      text: `Task ${state.items.length + 1}`,
      notes: "",
      done: false,
      aiRequest: false,
      createdAt: new Date().toISOString(),
      links: [],
    };
    pristine.markNew(item.id);
    update((prev) => ({ items: [...prev.items, item] }));
    return item;
  }, [update, state.items.length, pristine]);

  const toggleItem = useCallback((id: string) => {
    pristine.markDirty(id);
    update((prev) => ({
      items: prev.items.map((i) => i.id === id ? { ...i, done: !i.done } : i),
    }));
  }, [update, pristine]);

  const updateItem = useCallback((id: string, text: string) => {
    pristine.markDirty(id);
    update((prev) => ({
      items: prev.items.map((i) => i.id === id ? { ...i, text } : i),
    }));
  }, [update, pristine]);

  const updateNotes = useCallback((id: string, notes: string) => {
    pristine.markDirty(id);
    update((prev) => ({
      items: prev.items.map((i) => i.id === id ? { ...i, notes } : i),
    }));
  }, [update, pristine]);

  const setAiRequest = useCallback((id: string, value: boolean) => {
    pristine.markDirty(id);
    update((prev) => ({
      items: prev.items.map((i) => i.id === id ? { ...i, aiRequest: value } : i),
    }));
  }, [update, pristine]);

  const deleteItem = useCallback((id: string) => {
    pristine.markDirty(id);
    update((prev) => ({ items: prev.items.filter((i) => i.id !== id) }));
  }, [update, pristine]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    update((prev) => {
      const items = [...prev.items];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return { items };
    });
  }, [update]);

  const archiveDone = useCallback(() => {
    update((prev) => ({ items: prev.items.filter((i) => !i.done) }));
  }, [update]);

  const addParagraphId = useCallback((todoId: string, paragraphId: string) => {
    update((prev) => ({
      items: prev.items.map((i) =>
        i.id === todoId ? addParagraphLink(i, "todo", paragraphId) : i,
      ),
    }));
  }, [update]);

  const removeParagraphId = useCallback((todoId: string, paragraphId: string) => {
    update((prev) => ({
      items: prev.items.map((i) =>
        i.id === todoId ? removeParagraphLink(i, paragraphId) : i,
      ),
    }));
  }, [update]);

  /**
   * Drop todos that were created via `addItem()` but never edited. Call
   * from panel-close so "press +, do nothing, leave" doesn't leave a
   * blank "Task N" behind. When the external pristine manager is in use,
   * it owns discard via the registered delete callback.
   */
  const discardPristineTodos = useCallback(() => {
    if (externalPristine) {
      externalPristine.discardAll();
      return;
    }
    const ids = localPristine.takePristine();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    update((prev) => ({ items: prev.items.filter((i) => !idSet.has(i.id)) }));
  }, [update, externalPristine, localPristine]);

  return {
    items: state.items,
    addItem,
    toggleItem,
    updateItem,
    updateNotes,
    setAiRequest,
    deleteItem,
    reorder,
    archiveDone,
    addParagraphId,
    removeParagraphId,
    discardPristineTodos,
  };
}
