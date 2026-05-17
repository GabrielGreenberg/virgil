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
 * Two selection slots:
 *  - `stickySet`: cards the user hand-clicked (or whose transient was
 *    promoted by focus). Multiple coexist. Survive click-away and any
 *    subsequent selection. Cleared one at a time by clicking the card
 *    again.
 *  - `transient`: at most one ephemeral selection, set by marker clicks
 *    in the main text. Cleared by click-away, by another marker click,
 *    or by being promoted into `stickySet`.
 *
 * "Selected" vs "expanded" are distinct:
 *  - `useIsExpanded(ref)` — true for *any* card in stickySet ∪ {transient};
 *    drives the card's compressed/open state. Many cards can be expanded.
 *  - `useIsSelected(ref)` — true only for the *primary* (transient ?? newest
 *    sticky); drives the halo / focus styling. At most one card per UI.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { EntityKind } from "./entity-hover";

export interface AnchoredCardRef {
  kind: EntityKind;
  id: string;
}

interface CardInteractionState {
  stickySet: AnchoredCardRef[];
  transient: AnchoredCardRef | null;
  hover: AnchoredCardRef | null;
}

let _state: CardInteractionState = { stickySet: [], transient: null, hover: null };
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

function stickyIndex(ref: AnchoredCardRef): number {
  for (let i = 0; i < _state.stickySet.length; i++) {
    const s = _state.stickySet[i];
    if (s.kind === ref.kind && s.id === ref.id) return i;
  }
  return -1;
}

function isExpandedRef(ref: AnchoredCardRef): boolean {
  if (refsEqual(_state.transient, ref)) return true;
  return stickyIndex(ref) !== -1;
}

function primaryRef(): AnchoredCardRef | null {
  return _state.transient ?? _state.stickySet[_state.stickySet.length - 1] ?? null;
}

export const cardStore = {
  getState: (): CardInteractionState => _state,

  /** Replace the transient selection. No-op if same ref. */
  setTransient(next: AnchoredCardRef | null): void {
    if (refsEqual(_state.transient, next)) return;
    _state = { ..._state, transient: next ? { ...next } : null };
    emit();
  },

  /** Add a ref to the sticky set if not already there. */
  addSticky(ref: AnchoredCardRef): void {
    if (stickyIndex(ref) !== -1) return;
    _state = { ..._state, stickySet: [..._state.stickySet, { ...ref }] };
    emit();
  },

  /** Remove a ref from the sticky set if present. */
  removeSticky(ref: AnchoredCardRef): void {
    const idx = stickyIndex(ref);
    if (idx === -1) return;
    const next = _state.stickySet.slice();
    next.splice(idx, 1);
    _state = { ..._state, stickySet: next };
    emit();
  },

  setHover(next: AnchoredCardRef | null): void {
    if (refsEqual(_state.hover, next)) return;
    _state = { ..._state, hover: next ? { ...next } : null };
    emit();
  },

  /**
   * Click-to-toggle from a user card click. Two cases:
   *  - Primary AND in sticky → close (remove from sticky, clear
   *    transient if equal). This is the "click again to close" path.
   *  - Otherwise → refocus / promote / add: ensure ref is in sticky
   *    AND set transient = ref. Handles three flows in one branch:
   *    - Clicking a brand-new card (not in either slot) → adds to
   *      sticky and sets it as the primary.
   *    - Clicking a non-primary sticky card → keeps it in sticky and
   *      moves the halo to it (transient = ref).
   *    - Clicking a transient-only card (which IS primary because
   *      transient defines primary, but NOT in sticky) → falls here
   *      via the !inSticky guard: addSticky pins it open.
   */
  toggleSelection(ref: AnchoredCardRef): void {
    const inSticky = stickyIndex(ref) !== -1;
    const isPrimary = refsEqual(primaryRef(), ref);

    if (isPrimary && inSticky) {
      const next = _state.stickySet.filter(
        (s) => !(s.kind === ref.kind && s.id === ref.id),
      );
      const clearTransient = refsEqual(_state.transient, ref);
      _state = {
        ..._state,
        stickySet: next,
        transient: clearTransient ? null : _state.transient,
      };
      emit();
      return;
    }
    _state = {
      ..._state,
      stickySet: inSticky ? _state.stickySet : [..._state.stickySet, { ...ref }],
      transient: { ...ref },
    };
    emit();
  },

  /** Promote the current transient into sticky. No-op if no transient
   *  or transient ref is already sticky. Called when focus moves into
   *  a card body. */
  markSticky(): void {
    const t = _state.transient;
    if (!t) return;
    const alreadySticky = stickyIndex(t) !== -1;
    if (alreadySticky) {
      // Just drop transient; it's redundant with the sticky entry.
      _state = { ..._state, transient: null };
      emit();
      return;
    }
    _state = {
      ..._state,
      stickySet: [..._state.stickySet, { ...t }],
      transient: null,
    };
    emit();
  },

  /** True iff ref is the primary focus (transient ?? newest sticky).
   *  At most one card is selected at any time. */
  isSelected(ref: AnchoredCardRef): boolean {
    return refsEqual(primaryRef(), ref);
  },

  /** True iff ref is in sticky set OR equals transient. Many cards can
   *  be expanded simultaneously. */
  isExpanded(ref: AnchoredCardRef): boolean {
    return isExpandedRef(ref);
  },

  /**
   * Back-compat shim for callers that haven't migrated. `opts.sticky`
   * routes to addSticky; otherwise we treat it as setTransient. Passing
   * `null` clears transient only (sticky is unaffected — call removeSticky
   * for that).
   */
  setSelection(next: AnchoredCardRef | null, opts?: { sticky?: boolean }): void {
    if (next === null) {
      cardStore.setTransient(null);
      return;
    }
    if (opts?.sticky) {
      cardStore.addSticky(next);
      return;
    }
    cardStore.setTransient(next);
  },

  subscribe,
};

// React hooks ─────────────────────────────────────────────────────────────

const getServerSnapshot = () => null;

/** Primary focus ref: the transient if any, else the most-recently-added
 *  sticky. Used by callers that want a single "what's the current focus"
 *  value (e.g. legacy slot setters derived from this). */
export function useSelection(): AnchoredCardRef | null {
  return useSyncExternalStore(
    subscribe,
    primarySelectionSnapshot,
    getServerSnapshot,
  );
}

let _lastPrimary: AnchoredCardRef | null = null;
function primarySelectionSnapshot(): AnchoredCardRef | null {
  const s = _state;
  const next = s.transient ?? s.stickySet[s.stickySet.length - 1] ?? null;
  // Stable identity when value is unchanged — useSyncExternalStore requires it.
  if (refsEqual(_lastPrimary, next)) return _lastPrimary;
  _lastPrimary = next ? { ...next } : null;
  return _lastPrimary;
}

export function useTransient(): AnchoredCardRef | null {
  return useSyncExternalStore(
    subscribe,
    () => cardStore.getState().transient,
    getServerSnapshot,
  );
}

export function useStickySet(): AnchoredCardRef[] {
  return useSyncExternalStore(
    subscribe,
    () => cardStore.getState().stickySet,
    getServerSnapshot,
  ) ?? [];
}

export function useHover(): AnchoredCardRef | null {
  return useSyncExternalStore(
    subscribe,
    () => cardStore.getState().hover,
    getServerSnapshot,
  );
}

/** True iff ref is the primary (transient ?? newest sticky). Subscribes
 *  to both slots so cards re-render when the primary changes. */
export function useIsSelected(ref: AnchoredCardRef | null | undefined): boolean {
  const primary = useSelection();
  if (!ref || !primary) return false;
  return primary.kind === ref.kind && primary.id === ref.id;
}

/** True iff ref is in stickySet OR equals transient. Multi-card. Subscribes
 *  to both slots. */
export function useIsExpanded(ref: AnchoredCardRef | null | undefined): boolean {
  const transient = useTransient();
  const sticky = useStickySet();
  if (!ref) return false;
  if (transient && transient.kind === ref.kind && transient.id === ref.id) return true;
  for (const s of sticky) {
    if (s.kind === ref.kind && s.id === ref.id) return true;
  }
  return false;
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
