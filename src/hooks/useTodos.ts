"use client";

import { useAnchorOrphaned, useTextObjectOrphaned } from "@/lib/tiptap/orphan-events";
import { useCallback, useMemo } from "react";
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
import {
  bridgeFlagForCard,
  type AiRequestSyncMode,
  type BridgeContext,
} from "@/lib/ai-request-bridge";
import { resolveLoadedTitle, resolveTitleAuto } from "@/panels/panel-registry";
import { cardHasContent } from "@/cards/has-content";
import type { PullSeed } from "@/lib/stack/pull-seed";
import { carryUnknownKeys } from "@/lib/sidecar-migrate";
import { reinstateCard } from "./reinstate-card";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import { useReconcileModeAAnchors } from "./useReconcileModeAAnchors";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY: TodoState = { items: [] };

function migrateTodo(raw: unknown): TodoItem {
  const i = raw as Partial<TodoItem>;
  // Task 712: unknown keys ride through the load (`carryUnknownKeys`).
  return carryUnknownKeys(raw, {
    id: i.id!,
    archived: i.archived,
    // T6/C12: the legacy seed put a generated "Task N" in the BODY, so for a
    // todo the "title" provenance governs `text`. Recorded provenance, not
    // shape: keep a user-typed body (even "Task 9"), drop a recorded/legacy
    // generated one, and self-stamp the resolved bit so the heuristic never
    // runs again.
    text: resolveLoadedTitle("todo", i.text, i.titleAuto),
    titleAuto: resolveTitleAuto("todo", i.text, i.titleAuto),
    notes: i.notes ?? "",
    done: !!i.done,
    aiRequest: !!i.aiRequest,
    createdAt: i.createdAt!,
    links: migrateCardLinks("todo", raw),
  });
}

function migrateTodos(raw: unknown): TodoState {
  const s = raw as Partial<TodoState>;
  return { items: Array.isArray(s.items) ? s.items.map(migrateTodo) : [] };
}

/** The `ai-requests.json` payload a todo contributes — named so both bridge
 *  doors read one shape (task 697). A todo carries no Mode-B capture, so it
 *  contributes no `selectedText`. */
function todoContext(todo: TodoItem): BridgeContext {
  return {
    text: todo.text || "<todo>",
    paragraphIds: getLinkedTextObjectIds(todo),
  };
}

export function useTodos(docId: string | null, externalPristine?: PristineKindApi | null) {
  const { state, update, stateRef, loaded, loadError } = usePersistentState<TodoState>(
    docId,
    "todos.json",
    EMPTY,
    {
      migrate: migrateTodos,
      // T6/C12: write the self-stamped `titleAuto` provenance back on first
      // load so the shape heuristic is consulted at most once per record.
      persistMigrationOnLoad: true,
      errorLabel: "todos",
    },
  );
  const localPristine = usePristineTracker();
  const pristine = externalPristine ?? localPristine;

  const addItem = useCallback((): TodoItem => {
    const item: TodoItem = {
      id: generateEntityId(),
      // T6/C12 (FORK-1): blank body + machine-default provenance — an empty body
      // shows a render-time placeholder and keeps the todo genuinely pristine
      // (so deleting an untouched todo doesn't trip the has-content confirm).
      // `updateItem` flips `titleAuto` false the moment the user types.
      text: "",
      titleAuto: true,
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

  /**
   * Stack-pull door (task 330): create a todo FROM a snapshot seed.
   *
   * This kind is where the hand-picking was sealed at the TYPE rather than at
   * the call site: `StackPullApi.addTodo`'s seed was `{ text?: string }`, so a
   * todo's `notes` — a declared content field (`textFields: ["text","notes"]`)
   * and a plain textarea the user types into — could not be delivered by any
   * host however careful. `done` and `titleAuto` travel for the same reason
   * everything else does: the pull is a faithful copy, and nobody stated a
   * reason for them to stay behind.
   */
  const addItemFromSeed = useCallback(
    (seed: PullSeed<"todo">): TodoItem => {
      const fresh = {
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        links: [] as TodoItem["links"],
      };
      const item: TodoItem = {
        text: "",
        titleAuto: true,
        notes: "",
        done: false,
        aiRequest: false,
        ...fresh,
        ...seed,
        ...fresh, // identity floor — see `useNotes.addNoteFromSeed`
      };
      // The registry's content model, not "is the body empty?": a pulled todo
      // whose only content is its `notes` is real user writing.
      if (!cardHasContent("todo", item)) pristine.markNew(item.id);
      update((prev) => ({ items: [...prev.items, item] }));
      return item;
    },
    [update, pristine],
  );

  const toggleItem = useCallback((id: string) => {
    pristine.markDirty(id);
    update((prev) => ({
      items: prev.items.map((i) => i.id === id ? { ...i, done: !i.done } : i),
    }));
  }, [update, pristine]);

  const updateItem = useCallback((id: string, text: string) => {
    pristine.markDirty(id);
    update((prev) => ({
      // T6/C12: a user edit makes the body user-owned forever — clear the
      // auto-provenance so the next load never strips it (a body the user
      // typed as "Task 9" survives reload).
      items: prev.items.map((i) =>
        i.id === id ? { ...i, text, titleAuto: false } : i,
      ),
    }));
  }, [update, pristine]);

  const updateNotes = useCallback((id: string, notes: string) => {
    pristine.markDirty(id);
    update((prev) => ({
      items: prev.items.map((i) => i.id === id ? { ...i, notes } : i),
    }));
  }, [update, pristine]);

  const setAiRequest = useCallback((id: string, value: boolean, mode: AiRequestSyncMode = "toggle") => {
    pristine.markDirty(id);
    const todo = state.items.find((i) => i.id === id);
    update((prev) => ({
      items: prev.items.map((i) => i.id === id ? { ...i, aiRequest: value } : i),
    }));
    // Card-MAY-BE-ABSENT (task 697): clearing a flag needs no todo, so the
    // CONTEXT degrades and the CALL still fires.
    bridgeFlagForCard(docId, "todo", id, value, mode, todo, todoContext);
  }, [update, pristine, docId, state.items]);

  const deleteItem = useCallback((id: string) => {
    pristine.markDirty(id);
    update((prev) => ({ items: prev.items.filter((i) => i.id !== id) }));
  }, [update, pristine]);

  /** Flip a todo's archived (set-aside) flag. Orthogonal to `done` — a done
   *  todo can still be separately archived. Filtering happens at the panel; this
   *  just persists the flag through the same sidecar path. (Distinct from the
   *  pane-level clear-done door, which permanently DELETES completed todos
   *  through the unbridging executor — see the note below `reorder`.) */
  const setArchived = useCallback((id: string, archived: boolean) => {
    pristine.markDirty(id);
    update((prev) => ({
      items: prev.items.map((i) => (i.id === id ? { ...i, archived } : i)),
    }));
  }, [update, pristine]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    update((prev) => {
      const items = [...prev.items];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return { items };
    });
  }, [update]);

  // NO BULK PURGE LIVES HERE (task 681). The Todo panel's "clear done" control
  // used to reach a raw `archiveDone` on this hook — a plain
  // `prev.items.filter(...)` that hard-deleted N cards under a name that read
  // as safe. Task 219's unbridge wiring is applied at the EditorPane seam, per
  // exported door, so a second destructive door declared HERE is invisible to
  // it: every done todo whose AI box was ticked left its `ai-requests.json` row
  // open forever. The door now lives at that seam instead, composed from the
  // already-wired single delete (`makeUnbridgingBulkDelete`), and this hook
  // exposes exactly ONE way to remove a todo — `deleteItem` — so there is
  // nothing left for a seam to miss.

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
    () => stateRef.current,
    (s) => s.items,
    (_s, items) => ({ items }),
  );

  // Archive-origin restore door (task 712) — see hooks/reinstate-card.ts.
  const reinstate = useCallback(
    (raw: unknown): boolean =>
      reinstateCard<TodoState, TodoItem>(
        stateRef.current,
        update,
        (s) => s.items,
        (_s, items) => ({ items }),
        migrateTodo,
        raw,
      ),
    [update, stateRef],
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
    (id: string, paragraphId: string, anchorId: string, anchorText: string) => {
      update((prev) => {
        const todo = prev.items.find((i) => i.id === id);
        if (!todo) return prev;
        if (getTextAnchor(todo)?.anchorId === anchorId) return prev;
        return {
          items: prev.items.map((i) =>
            i.id === id
              ? setTextAnchorLink(
                  i,
                  "todo",
                  anchorId,
                  anchorText,
                  paragraphId ? [paragraphId] : undefined,
                )
              : i,
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
  // Gated on `docId` by the door (task 598) — membership decides WITHIN a
  // document, the event's docId decides ACROSS documents.
  // AnchorId-keyed Mode-B → Mode-A conversion. Shared by the orphan sweep
  // below and the drop re-anchor (`modeB.release`, task 698), matching the
  // `clearCardAnchor` every sibling panel hook exposes.
  const clearCardAnchor = useCallback(
    (anchorId: string) => {
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
    },
    [update],
  );

  useAnchorOrphaned(docId, ({ anchorId }) => {
    // No kind gate: a reloaded orphan event carries the parser-default
    // `kind:"note"`, so gating on `kind === "todo"` made this panel ignore
    // its own orphaned todo mark (BUG1). `clearCardAnchor` self-filters by
    // anchorId membership (no-match early-return) — the owning panel decides.
    if (!anchorId) return;
    clearCardAnchor(anchorId);
  });

  // Mode A orphan sweep — when a text-object block is removed from the
  // doc (e.g. by Delete or Archive on a paragraph / heading / list / etc.),
  // strip the dead uuid from any todo's Mode A links. Pairs with the
  // `TextObjectOrphanGuard` PM plugin. See ACTION-MENU-DIAGNOSIS.md C3.
  // Gated on `docId` by the door (task 598).
  useTextObjectOrphaned(docId, ({ uuid }) => {
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
  });

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

  /**
   * Append fully-formed todo items built outside the hook. Used by the BUG
   * #55b card-request migration to materialize an unlinked `todo` AI request
   * as a real Todo card (already carrying `aiRequest: true`). Append-only and
   * NOT marked pristine — a migrated card is committed content.
   */
  const appendItems = useCallback(
    (newItems: TodoItem[]) => {
      if (newItems.length === 0) return;
      update((prev) => ({ items: [...prev.items, ...newItems] }));
    },
    [update],
  );

  return useMemo(
    () => ({
      items: state.items,
      addItem,
      addItemFromSeed,
      appendItems,
      toggleItem,
      updateItem,
      updateNotes,
      setAiRequest,
      deleteItem,
      setArchived,
      reorder,
      addParagraphId,
      removeParagraphId,
      reconcileAnchors,
      reinstate,
      loaded,
      loadError,
      setTodoAnchor,
      bindAnchor,
      clearCardAnchor,
      discardPristineTodos,
    }),
    [
      state.items,
      addItem,
      addItemFromSeed,
      appendItems,
      toggleItem,
      updateItem,
      updateNotes,
      setAiRequest,
      deleteItem,
      setArchived,
      reorder,
      addParagraphId,
      removeParagraphId,
      reconcileAnchors,
      reinstate,
      loaded,
      loadError,
      setTodoAnchor,
      bindAnchor,
      clearCardAnchor,
      discardPristineTodos,
    ],
  );
}
