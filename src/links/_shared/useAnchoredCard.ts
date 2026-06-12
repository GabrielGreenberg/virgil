"use client";

/**
 * The single hook every anchored panel card calls. It returns the
 * `data-card-key`, hover/click handlers, the `selected`/`expanded`/`hovered`
 * booleans, and the `onActivate` body-click composition a card needs to
 * participate in the all-for-one model — without ever branching on card kind
 * in the shared code.
 *
 * Usage in a card component:
 *
 *     const ac = useAnchoredCard({ kind: "note", id: note.id });
 *     return <PanelCard selected={ac.selected} expanded={ac.expanded} ... />;
 *
 * N1 (selection ⟂ expansion): `selected` (the halo) and `expanded` (the body)
 * are independent. A body click runs `onActivate` (the ratified select+expand
 * composition); the header's expand chevron toggles expansion *only*; the
 * popout button pops *without* selecting or expanding. Per-card overrides
 * compose by wrapping the returned handlers; the shared hook stays branch-free.
 */

import { useCallback } from "react";
import {
  cardStore,
  useIsExpanded,
  useIsHovered,
  useIsSelected,
  type AnchoredCardRef,
} from "./anchored-card-store";

export interface UseAnchoredCardResult {
  /** Single-card halo / scroll-on-select / keyboard target. */
  selected: boolean;
  /** Body open/expanded — multi-card, independent of selection. */
  expanded: boolean;
  hovered: boolean;
  /**
   * The R1 body-click composition: SELECT + EXPAND together (the two axis-pure
   * primitives). Cards call this from their body `onClick`, then run their own
   * side effects (`onSelect`/`onJump`). Collapse is the header chevron
   * (`toggleExpanded`), NOT a body re-click — the axes are independent.
   */
  onActivate: () => void;
  /**
   * The axis-pure expand override: toggles ONLY `expandedSet` membership —
   * never selection. Threaded to `PanelCard` as `onToggleExpanded`. Stable
   * across renders.
   */
  onToggleExpanded: () => void;
  /**
   * The header-click composition (ratified 2026-06-11): SELECT + TOGGLE
   * expansion together — NO jump-to-anchor. Threaded to `PanelCard` as
   * `onHeaderActivate` so a click anywhere on the docked header flips the
   * body and moves the halo, while the body click keeps the select+expand+
   * jump contract (`onActivate` + per-card side effects).
   */
  onHeaderActivate: () => void;
  ref: AnchoredCardRef;
}

export function useAnchoredCard(ref: AnchoredCardRef): UseAnchoredCardResult {
  const selected = useIsSelected(ref);
  const expanded = useIsExpanded(ref);
  const hovered = useIsHovered(ref);

  const onActivate = useCallback(() => {
    cardStore.select(ref);
    cardStore.expand(ref);
  }, [ref.kind, ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Axis-pure: toggles ONLY the body, never the halo.
  const onToggleExpanded = useCallback(() => {
    cardStore.toggleExpanded(ref);
  }, [ref.kind, ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Header-click composition: select + toggle expansion, NO jump.
  const onHeaderActivate = useCallback(() => {
    cardStore.select(ref);
    cardStore.toggleExpanded(ref);
  }, [ref.kind, ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { selected, expanded, hovered, onActivate, onToggleExpanded, onHeaderActivate, ref };
}
