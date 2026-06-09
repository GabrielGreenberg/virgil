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
 *     return <PanelCard {...ac.props} selected={ac.selected} expanded={ac.expanded} ... />;
 *
 * N1 (selection ⟂ expansion): `selected` (the halo) and `expanded` (the body)
 * are independent. A body click runs `onActivate` (the ratified select+expand
 * composition); the header's expand chevron toggles expansion *only*; the
 * popout button pops *without* selecting or expanding. Per-card overrides
 * compose by wrapping the returned handlers; the shared hook stays branch-free.
 */

import { useCallback, useMemo, type MouseEvent } from "react";
import { cardPopKey } from "@/panels/panel-registry";
import {
  cardStore,
  useIsExpanded,
  useIsHovered,
  useIsSelected,
  type AnchoredCardRef,
} from "./anchored-card-store";

export interface UseAnchoredCardResult {
  /** Spread on the card's outermost element. */
  props: {
    "data-card-key": string;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onClick: (e: MouseEvent) => void;
    "aria-expanded": boolean;
    "aria-selected"?: true;
  };
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
  ref: AnchoredCardRef;
}

export function useAnchoredCard(ref: AnchoredCardRef): UseAnchoredCardResult {
  const selected = useIsSelected(ref);
  const expanded = useIsExpanded(ref);
  const hovered = useIsHovered(ref);

  // `EntityKind = CardKind` (A2-B1), so no cast is needed. Build via the SSOT
  // (`cardPopKey` → `float:card:<kind>:<id>`) so the documented `{...ac.props}`
  // pattern stamps the canonical key, never a legacy one.
  const cardKey = cardPopKey(ref.kind, ref.id);

  const onActivate = useCallback(() => {
    cardStore.select(ref);
    cardStore.expand(ref);
  }, [ref.kind, ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const props = useMemo(
    () => ({
      "data-card-key": cardKey,
      onMouseEnter: () => cardStore.setHover(ref),
      onMouseLeave: () => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ref.kind && h.id === ref.id) {
          cardStore.setHover(null);
        }
      },
      onClick: (_e: MouseEvent) => onActivate(),
      "aria-expanded": expanded,
      ...(selected ? { "aria-selected": true as const } : {}),
    }),
    // ref.kind/ref.id are the only inputs that matter; cardKey is derived.
    // selected/expanded gate the aria-* attrs; onActivate is stable.
    [cardKey, ref.kind, ref.id, selected, expanded, onActivate],
  );

  return { props, selected, expanded, hovered, onActivate, ref };
}
