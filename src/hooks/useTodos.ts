"use client";

import { useCallback, useEffect } from "react";
import { generateEntityId } from "@/lib/uuid";
import type { TodoState, TodoItem } from "@/lib/types";
import {
  addTextObjectLink,
  clearTextAnchorLink,
  getLinkedTextObjectIds,
  getTextAnchor,
  removeTextObjectLink,
  setTextAnchorLink,
} from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import { isAutoTitle } from "@/panels/panel-registry";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import { useReconcileModeAAnchors } from "./useReconcileModeAAnchors";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY: TodoState = { items: [] };

function migrateTodo(raw: unknown): TodoItem {
  const i = raw as Partial<TodoItem>;
  return {
    id: i.id!,
    // BUG #31: the legacy seed put a generated "Task N" in the BODY. Strip it
    // on load (todo's title label is "Task") so an untouched todo reads as
    // empty — the render-time placeholder shows and it stays pristine.
    text: isAutoTitle("todo", i.text) ? "" : (i.text ?? ""),
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
      // BUG #31: never seed a generated "Task N" into the BODY — an empty body
      // shows a render-time placeholder and keeps the todo genuinely pristine
      // (so deleting an untouched todo doesn't trip the has-content confirm).
      text: "",
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
    const todo = state.items.find((i) => i.id === id);
    update((prev) => ({
      items: prev.items.map((i) => i.id === id ? { ...i, aiRequest: value } : i),
    }));
    if (todo) {
      void bridgeCardAiRequestFlag(
        docId,
        "todo",
        id,
        value,
        {
          text: todo.text || "<todo>",
          paragraphIds: getLinkedTextObjectIds(todo),
        },
      );
    }
  }, [update, pristine, docId, state.items]);

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

  const addParagraphId = useCallback(
    (
      todoId: string,
      paragraphId: string,
      targetKind?: import("@/text-objects/types").TextObjectKind,
      paragraphSnapshot?: string | null,
    ) => {
      update((prev) => ({
        items: prev.items.map((i) =>
          i.id === todoId
            ? addTextObjectLink(i, "todo", paragraphId, targetKind, paragraphSnapshot)
            : i,
        ),
      }));
    },
    [update],
  );

  const removeParagraphId = useCallback((todoId: string, paragraphId: string) => {
    update((prev) => ({
      items: prev.items.map((i) =>
        i.id === todoId ? removeTextObjectLink(i, paragraphId) : i,
      ),
    }));
  }, [update]);

  // Mode-A self-healing reconcile (load-only). See useReconcileModeAAnchors.
  const reconcileAnchors = useReconcileModeAAnchors<TodoState, TodoItem>(
    update,
    (s) => s.items,
    (_s, items) => ({ items }),
  );

  /**
   * Set a Mode-B text-range anchor on a todo (symmetric with
   * `useNotes.setNoteAnchor`). Folds any existing Mode-A paragraph links
   * into the canonical anchor link via `setTextAnchorLink`. Used by the
   * selection drag-handle path so a todo created from a selection drops a
   * `linkedAnchor` mark + carries the matching anchor in its `links[]`.
   * The reconciler reads this anchor (`getTextAnchor`) to keep the mark
   * alive — see `useLinkedAnchorReconciler`. */
  const setTodoAnchor = useCallback(
    (id: string, anchorId: string, anchorText: string) => {
      pristine.markDirty(id);
      update((prev) => ({
        items: prev.items.map((i) =>
          i.id === id ? setTextAnchorLink(i, "todo", anchorId, anchorText) : i,
        ),
      }));
    },
    [update, pristine],
  );

  /**
   * Re-attach a Mode-B text-range anchor on a freshly-cloned todo.
   * Idempotent — no-op if the todo already carries this anchorId. Mirrors
   * `useNotes.bindAnchor` so a future todo-duplicate path can reuse it via
   * the card-lifecycle registry. */
  const bindAnchor = useCallback(
    (id: string, _paragraphId: string, anchorId: string, anchorText: string) => {
      update((prev) => {
        const todo = prev.items.find((i) => i.id === id);
        if (!todo) return prev;
        if (getTextAnchor(todo)?.anchorId === anchorId) return prev;
        return {
          items: prev.items.map((i) =>
            i.id === id ? setTextAnchorLink(i, "todo", anchorId, anchorText) : i,
          ),
        };
      });
    },
    [update],
  );

  // Mode-B orphan sweep — when the `linkedAnchor` mark vanishes from the
  // doc (e.g. the anchored text was deleted), clear the dead Mode-B anchor
  // on the matching todo so it doesn't keep a stale text-range link. The
  // todo stays in the panel (Mode-A paragraph links, if any, are preserved
  // by `clearTextAnchorLink`). Mirrors `useNotes`'s `virgil-anchor-orphaned`
  // listener. O(todos) per event, never per-keystroke.
  useEffect(() => {
    const handler = (e: Event) => {
      const { anchorId, kind } = (e as CustomEvent).detail || {};
      if (!anchorId || kind !== "todo") return;
      update((prev) => {
        if (!prev.items.some((i) => getTextAnchor(i)?.anchorId === anchorId)) {
          return prev;
        }
        return {
          items: prev.items.map((i) =>
            getTextAnchor(i)?.anchorId === anchorId
              ? clearTextAnchorLink(i, "todo")
              : i,
          ),
        };
      });
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [update]);

  // Mode A orphan sweep — when a text-object block is removed from the
  // doc (e.g. by Delete or Archive on a paragraph / heading / list / etc.),
  // strip the dead uuid from any todo's Mode A links. Pairs with the
  // `TextObjectOrphanGuard` PM plugin. See ACTION-MENU-DIAGNOSIS.md C3.
  useEffect(() => {
    const handler = (e: Event) => {
      const uuid = (e as CustomEvent).detail?.uuid;
      if (typeof uuid !== "string" || !uuid) return;
      update((prev) => {
        let changed = false;
        const next = prev.items.map((i) => {
          if (!getLinkedTextObjectIds(i).includes(uuid)) return i;
          changed = true;
          return removeTextObjectLink(i, uuid);
        });
        return changed ? { items: next } : prev;
      });
    };
    window.addEventListener("virgil-textobject-orphaned", handler);
    return () =>
      window.removeEventListener("virgil-textobject-orphaned", handler);
  }, [update]);

  /**
   * Drop todos that were created via `addItem()` but never edited. Call
   * from panel-close so "press +, do nothing, leave" doesn't leave a
   * blank (empty-body) todo behind. When the external pristine manager is
   * in use, it owns discard via the registered delete callback.
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
    reconcileAnchors,
    setTodoAnchor,
    bindAnchor,
    discardPristineTodos,
  };
}
