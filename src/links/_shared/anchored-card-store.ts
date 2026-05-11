"use client";

/**
 * Module-scope store for the global "anchored card" hover and selection
 * state. The three surfaces of every anchored card (linked text in the
 * editor, marginalia icon in the gutter, panel card in the rail) all
 * subscribe here; whatever the user touches paints all three.
 *
 * Why module scope and not Context: the same selection must be visible
 * to `EditorLayout` (host shell), to `EditorPane` (the canonical paper
 * surface, which also mounts in the Library reader), to popped-out
 * floating cards rendered in portals, and to anything else that wants to
 * react. A Provider tree would force a single common ancestor and would
 * break every popped-out card. `useSyncExternalStore` (React 18+) gives
 * the same observability with zero new dependencies.
 *
 * Selection is *single*: at most one card is selected across the whole
 * UI. Selecting a card in panel A clears any previous selection in panel
 * B. This matches the user's "all for one and one for all" rule.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { EntityKind } from "./entity-hover";

export interface AnchoredCardRef {
  kind: EntityKind;
  id: string;
}

interface CardInteractionState {
  selection: AnchoredCardRef | null;
  hover: AnchoredCardRef | null;
}

let _state: CardInteractionState = { selection: null, hover: null };
const _listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function emit(): void {
  for (const fn of _listeners) fn();
}

function refsEqual(a: AnchoredCardRef | null, b: AnchoredCardRef | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
}

export const cardStore = {
  getState: (): CardInteractionState => _state,

  setSelection(next: AnchoredCardRef | null): void {
    if (refsEqual(_state.selection, next)) return;
    _state = { ..._state, selection: next ? { ...next } : null };
    emit();
  },

  setHover(next: AnchoredCardRef | null): void {
    if (refsEqual(_state.hover, next)) return;
    _state = { ..._state, hover: next ? { ...next } : null };
    emit();
  },

  /** Click-to-toggle: select if not selected; clear if already selected. */
  toggleSelection(ref: AnchoredCardRef): void {
    const cur = _state.selection;
    const same = !!cur && cur.kind === ref.kind && cur.id === ref.id;
    cardStore.setSelection(same ? null : ref);
  },

  subscribe,
};

// React hooks ─────────────────────────────────────────────────────────────

const getServerSnapshot = () => null;

export function useSelection(): AnchoredCardRef | null {
  return useSyncExternalStore(
    subscribe,
    () => cardStore.getState().selection,
    getServerSnapshot,
  );
}

export function useHover(): AnchoredCardRef | null {
  return useSyncExternalStore(
    subscribe,
    () => cardStore.getState().hover,
    getServerSnapshot,
  );
}

export function useIsSelected(ref: AnchoredCardRef | null | undefined): boolean {
  const sel = useSelection();
  if (!ref || !sel) return false;
  return sel.kind === ref.kind && sel.id === ref.id;
}

export function useIsHovered(ref: AnchoredCardRef | null | undefined): boolean {
  const h = useHover();
  if (!ref || !h) return false;
  return h.kind === ref.kind && h.id === ref.id;
}

// Stable imperative setters returned as a hook for ergonomic call sites
// that want to set selection/hover without subscribing to it. The setters
// don't change between renders.
const _setSelection = cardStore.setSelection;
const _setHover = cardStore.setHover;
const _toggleSelection = cardStore.toggleSelection;

export function useCardStoreActions(): {
  setSelection: (ref: AnchoredCardRef | null) => void;
  setHover: (ref: AnchoredCardRef | null) => void;
  toggleSelection: (ref: AnchoredCardRef) => void;
} {
  // Stable identity — `cardStore.*` are static module-level functions.
  return {
    setSelection: useCallback(_setSelection, []),
    setHover: useCallback(_setHover, []),
    toggleSelection: useCallback(_toggleSelection, []),
  };
}
