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
  /**
   * "Sticky" selection survives an omni click-away. Meaningful only when
   * `selection !== null`; reset to false whenever selection is cleared or
   * a new ref is selected. Set true via `toggleSelection` (direct card
   * click) and `markSticky` (focus moved into a card body).
   */
  selectionSticky: boolean;
  hover: AnchoredCardRef | null;
}

let _state: CardInteractionState = { selection: null, selectionSticky: false, hover: null };
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

  /**
   * Set the selected card. `opts.sticky` is honored explicitly; otherwise
   * a same-ref re-set preserves the current sticky flag (so a direct
   * card click that runs `toggleSelection` followed by a slot-setter
   * affirmation doesn't lose its sticky bit), and a new-ref selection
   * defaults to transient (sticky=false), matching the marker-click path.
   */
  setSelection(next: AnchoredCardRef | null, opts?: { sticky?: boolean }): void {
    if (next === null) {
      if (_state.selection === null) return;
      _state = { ..._state, selection: null, selectionSticky: false };
      emit();
      return;
    }
    const same = refsEqual(_state.selection, next);
    const nextSticky =
      opts?.sticky !== undefined ? opts.sticky : same ? _state.selectionSticky : false;
    if (same && _state.selectionSticky === nextSticky) return;
    _state = { ..._state, selection: { ...next }, selectionSticky: nextSticky };
    emit();
  },

  setHover(next: AnchoredCardRef | null): void {
    if (refsEqual(_state.hover, next)) return;
    _state = { ..._state, hover: next ? { ...next } : null };
    emit();
  },

  /**
   * Click-to-toggle from a user card click. Three-way:
   *  - Not selected → select sticky.
   *  - Selected & transient (from a marker click) → promote to sticky.
   *    Promote is invisible at the selection-ref level but flips
   *    `selectionSticky` so omni click-away no longer dismisses.
   *  - Selected & sticky → clear (the "click again to close" path).
   */
  toggleSelection(ref: AnchoredCardRef): void {
    const cur = _state.selection;
    const same = !!cur && cur.kind === ref.kind && cur.id === ref.id;
    if (same && _state.selectionSticky) {
      cardStore.setSelection(null);
    } else {
      cardStore.setSelection(ref, { sticky: true });
    }
  },

  /** Promote the current selection to sticky. No-op if no selection or
   *  already sticky. Called when focus moves into a card body. */
  markSticky(): void {
    if (!_state.selection || _state.selectionSticky) return;
    _state = { ..._state, selectionSticky: true };
    emit();
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
