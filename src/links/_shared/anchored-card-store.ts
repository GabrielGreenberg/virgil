"use client";

/**
 * Module-scope store for the global "anchored card" interaction state. The
 * three surfaces of every anchored card (linked text in the editor, marginalia
 * icon in the gutter, panel card in the rail) all subscribe here; whatever the
 * user touches paints all three.
 *
 * Module scope (not Context) so `EditorLayout` (host shell), `EditorPane` (the
 * canonical paper surface, also mounted in the Library reader), and popped-out
 * floating cards rendered in portals all observe the same state without a
 * common ancestor. `useSyncExternalStore` (React 18+) gives the observability
 * with zero new dependencies.
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
 * NOTE: a handful of deprecated shims (`setTransient`/`toggleSelection`/
 * `markSticky`/`setSelection`/`addSticky`/`removeSticky`, `useTransient`/
 * `useStickySet`) write/read the new axes so un-migrated callers keep working;
 * they are removed once every consumer migrates.
 */

import { useSyncExternalStore } from "react";
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

let _state: CardInteractionState = { expandedSet: [], selected: null, hover: null };
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

function expandedIndex(ref: AnchoredCardRef): number {
  for (let i = 0; i < _state.expandedSet.length; i++) {
    const s = _state.expandedSet[i];
    if (s.kind === ref.kind && s.id === ref.id) return i;
  }
  return -1;
}

/**
 * @deprecated Transitional compat shape: the two-axis state plus `transient`/
 * `stickySet` aliases (transient's selection role is now `selected`; the sticky
 * expansion set is now `expandedSet`). Lets un-migrated imperative readers keep
 * compiling; removed once every reader migrates.
 */
type CompatState = CardInteractionState & {
  readonly transient: AnchoredCardRef | null;
  readonly stickySet: AnchoredCardRef[];
};

export const cardStore = {
  /** The two-axis state, plus deprecated `transient`/`stickySet` aliases for
   *  un-migrated imperative readers. */
  getState: (): CompatState => ({
    expandedSet: _state.expandedSet,
    selected: _state.selected,
    hover: _state.hover,
    transient: _state.selected,
    stickySet: _state.expandedSet,
  }),

  // ── EXPANSION axis — `expandedSet` only, never touches `selected` ────────
  /** Add `ref` to the expansion set (open its body). No-op if already open. */
  expand(ref: AnchoredCardRef): void {
    if (expandedIndex(ref) !== -1) return;
    _state = { ..._state, expandedSet: [..._state.expandedSet, { ...ref }] };
    emit();
  },
  /** Remove `ref` from the expansion set (collapse its body). */
  collapse(ref: AnchoredCardRef): void {
    const idx = expandedIndex(ref);
    if (idx === -1) return;
    const next = _state.expandedSet.slice();
    next.splice(idx, 1);
    _state = { ..._state, expandedSet: next };
    emit();
  },
  /** Toggle the expansion of `ref`. Selection is untouched. */
  toggleExpanded(ref: AnchoredCardRef): void {
    if (expandedIndex(ref) !== -1) cardStore.collapse(ref);
    else cardStore.expand(ref);
  },
  /** True iff `ref`'s body is expanded. Many cards can be expanded at once. */
  isExpanded(ref: AnchoredCardRef): boolean {
    return expandedIndex(ref) !== -1;
  },

  // ── SELECTION axis — `selected` slot only, never touches `expandedSet` ───
  /** Make `ref` the selected card (halo / scroll / keyboard target). ≤1. */
  select(ref: AnchoredCardRef): void {
    if (refsEqual(_state.selected, ref)) return;
    _state = { ..._state, selected: { ...ref } };
    emit();
  },
  /** Clear the selection (halo). Expansion is untouched. */
  clearSelection(): void {
    if (!_state.selected) return;
    _state = { ..._state, selected: null };
    emit();
  },
  /** True iff `ref` is the selected card. At most one per UI. */
  isSelected(ref: AnchoredCardRef): boolean {
    return refsEqual(_state.selected, ref);
  },

  // ── HOVER ────────────────────────────────────────────────────────────────
  setHover(next: AnchoredCardRef | null): void {
    if (refsEqual(_state.hover, next)) return;
    _state = { ..._state, hover: next ? { ...next } : null };
    emit();
  },

  // ── Deprecated shims (write the new axes; removed once callers migrate) ───
  /** @deprecated → `select` / `clearSelection`. */
  setTransient(next: AnchoredCardRef | null): void {
    if (next) cardStore.select(next);
    else cardStore.clearSelection();
  },
  /** @deprecated → `expand`. */
  addSticky(ref: AnchoredCardRef): void {
    cardStore.expand(ref);
  },
  /** @deprecated → `collapse`. */
  removeSticky(ref: AnchoredCardRef): void {
    cardStore.collapse(ref);
  },
  /**
   * @deprecated The conflated body-click. The R1 default (select + expand, and
   * "click again" closes when both are set) is centralized in `useAnchoredCard`
   * (`onActivate`); this shim preserves behavior for un-migrated callers.
   */
  toggleSelection(ref: AnchoredCardRef): void {
    if (cardStore.isSelected(ref) && cardStore.isExpanded(ref)) {
      cardStore.clearSelection();
      cardStore.collapse(ref);
    } else {
      cardStore.select(ref);
      cardStore.expand(ref);
    }
  },
  /** @deprecated Focus-promotion is obsolete — expansion is now sticky by
   *  construction, so there is nothing to promote. No-op. */
  markSticky(): void {},
  /** @deprecated → `select` / `clearSelection` (the `sticky` opt → `expand`). */
  setSelection(next: AnchoredCardRef | null, opts?: { sticky?: boolean }): void {
    if (next === null) {
      cardStore.clearSelection();
      return;
    }
    if (opts?.sticky) {
      cardStore.expand(next);
      return;
    }
    cardStore.select(next);
  },

  subscribe,
};

// React hooks ───────────────────────────────────────────────────────────────

const getServerSnapshot = () => null;

/** The selection slot (≤1): halo / scroll-on-select / keyboard target. */
let _lastSelected: AnchoredCardRef | null = null;
function selectedSnapshot(): AnchoredCardRef | null {
  const next = _state.selected;
  // Stable identity when unchanged — useSyncExternalStore requires it.
  if (refsEqual(_lastSelected, next)) return _lastSelected;
  _lastSelected = next ? { ...next } : null;
  return _lastSelected;
}

export function useSelection(): AnchoredCardRef | null {
  return useSyncExternalStore(subscribe, selectedSnapshot, getServerSnapshot);
}

/** The expansion set (multi-card). */
export function useExpandedSet(): AnchoredCardRef[] {
  return (
    useSyncExternalStore(subscribe, () => _state.expandedSet, getServerSnapshot) ?? []
  );
}

export function useHover(): AnchoredCardRef | null {
  return useSyncExternalStore(subscribe, () => _state.hover, getServerSnapshot);
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

// ── Deprecated shim hooks (removed once consumers migrate) ───────────────────

/** @deprecated → `useSelection` (transient's selection role is now `selected`). */
export function useTransient(): AnchoredCardRef | null {
  return useSelection();
}

/** @deprecated → `useExpandedSet`. */
export function useStickySet(): AnchoredCardRef[] {
  return useExpandedSet();
}
