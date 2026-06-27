"use client";

/**
 * Per-doc store for the "anchored card" interaction state. The three surfaces
 * of every anchored card (linked text in the editor, marginalia icon in the
 * margin, panel card in the rail) all subscribe to ONE store *per doc*;
 * whatever the user touches paints all three — but only within that doc.
 *
 * PER-DOC SCOPING (the context seam). Under multi-doc keep-alive several papers
 * are mounted at once (one visible, the rest warm/hidden). A single module-
 * global store would co-mingle selection/expansion/hover across docs: selecting
 * a card in doc B would clear doc A's selection, and any future code that
 * rendered a hidden pane's cards would bleed a halo across docs. So the store is
 * an INSTANCE (`createCardStore()`), one per docId, resolved through a registry
 * (`getCardStore(docId)`) and surfaced to the React tree via `CardStoreContext`
 * + `<CardStoreProvider>` (mounted once per pane inside `EditorPane`, the per-
 * doc card-surface root that owns the panel mount, marginalia, popouts, and the
 * `PoppedCardsContext`). React context propagates through portals by React-tree
 * position, so popped-out floating cards rendered inside `EditorPane`'s subtree
 * still observe the right doc's store. Each doc therefore also preserves its own
 * selection/expansion across warm paper-switches.
 *
 * READ HOOKS read the CONTEXT store, so the ~90% of consumers that only call
 * `useSelection`/`useExpandedSet`/`useHover`/`useIs*` stay unchanged. The few
 * IMPERATIVE callers that mutate the store get the per-doc instance threaded in
 * at wiring time: a React descendant grabs `useCardStore()`; an `EditorPane`-
 * body hook or the `EditorLayout` shell resolves `getCardStore(docId)` directly
 * (it has docId in scope) and threads the instance to non-React helpers.
 *
 * A `defaultCardStore` fallback backs the context default, so any consumer
 * mounted OUTSIDE a provider (tests, app-level dialogs) still works — mirrors
 * the `KeepAliveVisibilityContext` default-true pattern.
 *
 * `useSyncExternalStore` (React 18+) gives the observability with zero new
 * dependencies.
 *
 * TWO INDEPENDENT AXES — N1: selection ⟂ expansion (a full 2×2):
 *  - `expandedSet` — multi; "how much body shows" (compressed ↔ full body).
 *    Sticky: survives click-away; toggled only by the expand control or the
 *    body-click composition. A card being expanded says NOTHING about selection.
 *  - `selected` — ≤1; the halo / scroll-on-select / keyboard target / operand.
 *    Cleared by click-away. A card being selected says NOTHING about expansion.
 *
 * The axes are mutated by axis-pure primitives (each touches exactly ONE axis),
 * so "select without expanding" (a marker click) and "expand without selecting"
 * (the expand chevron) are both first-class. The combined "open + focus" is an
 * explicit *composition* the body-click handler chooses (`select` + `expand`),
 * not something the store forces.
 *
 * KEYSTROKE SANCTITY: this is React context + `useSyncExternalStore` over a
 * module Map — it adds NO `editor.on(...)` subscription and does no per-keystroke
 * work. The store mutates only on user gestures (click / hover). Typing leaves
 * `__virgilBusStats().emitCount` flat.
 */

import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EntityKind } from "./entity-hover";

export interface AnchoredCardRef {
  kind: EntityKind;
  id: string;
}

interface CardInteractionState {
  expandedSet: AnchoredCardRef[];
  selected: AnchoredCardRef | null;
  hover: AnchoredCardRef | null;
}

function refsEqual(a: AnchoredCardRef | null, b: AnchoredCardRef | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * The store instance shape. One per doc. The three `get*Snapshot` getters carry
 * the per-instance stable-identity caches `useSyncExternalStore` requires (a
 * snapshot must return a referentially-stable value when nothing changed).
 */
export interface CardStore {
  getState(): CardInteractionState;
  // EXPANSION axis — `expandedSet` only, never touches `selected`.
  expand(ref: AnchoredCardRef): void;
  collapse(ref: AnchoredCardRef): void;
  toggleExpanded(ref: AnchoredCardRef): void;
  isExpanded(ref: AnchoredCardRef): boolean;
  // SELECTION axis — `selected` slot only, never touches `expandedSet`.
  select(ref: AnchoredCardRef): void;
  clearSelection(): void;
  isSelected(ref: AnchoredCardRef): boolean;
  // HOVER.
  setHover(next: AnchoredCardRef | null): void;
  subscribe(fn: () => void): () => void;
  /** Stable-identity snapshot of the selection slot (≤1). */
  getSelectedSnapshot(): AnchoredCardRef | null;
  /** Snapshot of the expansion set (multi). */
  getExpandedSnapshot(): AnchoredCardRef[];
  /** Snapshot of the hover slot. */
  getHoverSnapshot(): AnchoredCardRef | null;
}

/** Build a fresh, isolated interaction store. Each instance closes over its own
 *  state, listener set, and snapshot caches — no cross-instance bleed. */
export function createCardStore(): CardStore {
  let state: CardInteractionState = { expandedSet: [], selected: null, hover: null };
  const listeners = new Set<() => void>();
  // Stable identity for the selection snapshot — `useSyncExternalStore` requires
  // the getter to return the SAME reference while the value is unchanged.
  let lastSelected: AnchoredCardRef | null = null;

  function emit(): void {
    for (const fn of listeners) fn();
  }

  function expandedIndex(ref: AnchoredCardRef): number {
    for (let i = 0; i < state.expandedSet.length; i++) {
      const s = state.expandedSet[i];
      if (s.kind === ref.kind && s.id === ref.id) return i;
    }
    return -1;
  }

  // ── EXPANSION axis ────────────────────────────────────────────────────────
  /** Add `ref` to the expansion set (open its body). No-op if already open. */
  function expand(ref: AnchoredCardRef): void {
    if (expandedIndex(ref) !== -1) return;
    state = { ...state, expandedSet: [...state.expandedSet, { ...ref }] };
    emit();
  }
  /** Remove `ref` from the expansion set (collapse its body). */
  function collapse(ref: AnchoredCardRef): void {
    const idx = expandedIndex(ref);
    if (idx === -1) return;
    const next = state.expandedSet.slice();
    next.splice(idx, 1);
    state = { ...state, expandedSet: next };
    emit();
  }
  /** Toggle the expansion of `ref`. Selection is untouched. */
  function toggleExpanded(ref: AnchoredCardRef): void {
    if (expandedIndex(ref) !== -1) collapse(ref);
    else expand(ref);
  }
  /** True iff `ref`'s body is expanded. Many cards can be expanded at once. */
  function isExpanded(ref: AnchoredCardRef): boolean {
    return expandedIndex(ref) !== -1;
  }

  // ── SELECTION axis ────────────────────────────────────────────────────────
  /** Make `ref` the selected card (halo / scroll / keyboard target). ≤1. */
  function select(ref: AnchoredCardRef): void {
    if (refsEqual(state.selected, ref)) return;
    state = { ...state, selected: { ...ref } };
    emit();
  }
  /** Clear the selection (halo). Expansion is untouched. */
  function clearSelection(): void {
    if (!state.selected) return;
    state = { ...state, selected: null };
    emit();
  }
  /** True iff `ref` is the selected card. At most one per doc. */
  function isSelected(ref: AnchoredCardRef): boolean {
    return refsEqual(state.selected, ref);
  }

  // ── HOVER ─────────────────────────────────────────────────────────────────
  function setHover(next: AnchoredCardRef | null): void {
    if (refsEqual(state.hover, next)) return;
    state = { ...state, hover: next ? { ...next } : null };
    emit();
  }

  function subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  function getSelectedSnapshot(): AnchoredCardRef | null {
    const next = state.selected;
    if (refsEqual(lastSelected, next)) return lastSelected;
    lastSelected = next ? { ...next } : null;
    return lastSelected;
  }
  // `expandedSet` / `hover` are already replaced immutably (and only when they
  // actually change), so the stored reference is itself a stable snapshot.
  function getExpandedSnapshot(): AnchoredCardRef[] {
    return state.expandedSet;
  }
  function getHoverSnapshot(): AnchoredCardRef | null {
    return state.hover;
  }

  return {
    getState: () => state,
    expand,
    collapse,
    toggleExpanded,
    isExpanded,
    select,
    clearSelection,
    isSelected,
    setHover,
    subscribe,
    getSelectedSnapshot,
    getExpandedSnapshot,
    getHoverSnapshot,
  };
}

// ── Per-doc registry ──────────────────────────────────────────────────────────
// Lazy Map<docId, store>. The SHELL (EditorLayout) and the per-pane provider
// both resolve a doc's store through here, so there is exactly one instance per
// docId. Pruned on a TRUE doc unmount (LRU evict / tab close) via the same
// `pruneDocMaps` hook that prunes the per-doc editorInstance/paneState maps.

const _stores = new Map<string, CardStore>();

/** Resolve (creating on first touch) the interaction store for a doc. */
export function getCardStore(docId: string): CardStore {
  let store = _stores.get(docId);
  if (!store) {
    store = createCardStore();
    _stores.set(docId, store);
  }
  return store;
}

/** Drop a doc's store on a real unmount (LRU evict / tab close). A subsequent
 *  cold re-open gets a fresh store — interaction state legitimately resets on a
 *  cold reload; warm (still-mounted) docs keep their instance. */
export function disposeCardStore(docId: string): void {
  _stores.delete(docId);
}

// ── Fallback + context ────────────────────────────────────────────────────────
// `defaultCardStore` backs the context default so any consumer mounted OUTSIDE a
// provider (tests, app-level dialogs) still works — the KeepAliveVisibility
// default-true pattern. App code MUST NOT reach for this directly; it resolves
// the per-doc store via `useCardStore()` (descendants) or `getCardStore(docId)`
// (EditorPane body / EditorLayout shell).
export const defaultCardStore: CardStore = createCardStore();

const CardStoreContext = createContext<CardStore>(defaultCardStore);

/**
 * Provide the per-doc store to a subtree. Pass an explicit `store` instance
 * (EditorPane resolves `getCardStore(docId)` in its body and passes it, so the
 * body hooks and the descendants observe the SAME instance) or a `docId` (the
 * shell mounts `docId={currentDocId}` so shell consumers see the active doc).
 */
export function CardStoreProvider({
  store,
  docId,
  children,
}: {
  store?: CardStore;
  docId?: string | null;
  children: ReactNode;
}) {
  const resolved = store ?? (docId != null ? getCardStore(docId) : defaultCardStore);
  return createElement(CardStoreContext.Provider, { value: resolved }, children);
}

/** The current doc's interaction store, from context (default fallback when no
 *  provider ancestor). */
export function useCardStore(): CardStore {
  return useContext(CardStoreContext);
}

// React hooks ───────────────────────────────────────────────────────────────

const getServerSnapshot = () => null;

// Explicit-store read hooks. Body hooks that run ABOVE their own pane's provider
// (EditorPane-body `usePlacement` / `useAnchorHighlightReconciler`) read these
// with the store they were threaded, instead of the context sugar below.

/** Subscribe to the selection slot (≤1) of an explicit store. */
export function useStoreSelection(store: CardStore): AnchoredCardRef | null {
  return useSyncExternalStore(store.subscribe, store.getSelectedSnapshot, getServerSnapshot);
}
/** Subscribe to the expansion set (multi) of an explicit store. */
export function useStoreExpandedSet(store: CardStore): AnchoredCardRef[] {
  return useSyncExternalStore(store.subscribe, store.getExpandedSnapshot, getServerSnapshot) ?? [];
}
/** Subscribe to the hover slot of an explicit store. */
export function useStoreHover(store: CardStore): AnchoredCardRef | null {
  return useSyncExternalStore(store.subscribe, store.getHoverSnapshot, getServerSnapshot);
}

// Context sugar — the unchanged ~90% of call sites. Each reads the current doc's
// store from context.

/** The selection slot (≤1): halo / scroll-on-select / keyboard target. */
export function useSelection(): AnchoredCardRef | null {
  return useStoreSelection(useCardStore());
}

/** The expansion set (multi-card). */
export function useExpandedSet(): AnchoredCardRef[] {
  return useStoreExpandedSet(useCardStore());
}

export function useHover(): AnchoredCardRef | null {
  return useStoreHover(useCardStore());
}

/** True iff `ref` is the selected card. Single-card halo. */
export function useIsSelected(ref: AnchoredCardRef | null | undefined): boolean {
  const selected = useSelection();
  if (!ref || !selected) return false;
  return selected.kind === ref.kind && selected.id === ref.id;
}

/** True iff `ref`'s body is expanded. Multi-card. */
export function useIsExpanded(ref: AnchoredCardRef | null | undefined): boolean {
  const expanded = useExpandedSet();
  if (!ref) return false;
  for (const s of expanded) {
    if (s.kind === ref.kind && s.id === ref.id) return true;
  }
  return false;
}

export function useIsHovered(ref: AnchoredCardRef | null | undefined): boolean {
  const h = useHover();
  if (!ref || !h) return false;
  return h.kind === ref.kind && h.id === ref.id;
}
