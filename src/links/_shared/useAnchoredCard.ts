"use client";

/**
 * The single hook every anchored panel card calls. It returns the
 * `data-card-key`, hover/click handlers, and the selected/hovered booleans
 * a card needs to participate in the all-for-one model — without ever
 * branching on card kind in the shared code.
 *
 * Usage in a card component:
 *
 *     const ac = useAnchoredCard({ kind: "note", id: note.id });
 *     return <PanelCard {...ac.props} selected={ac.selected} ... />;
 *
 * Per-card overrides compose by wrapping the returned handlers; the
 * shared hook stays branch-free. Adding the next anchored card kind is
 * one line in `ANCHORED_CARD_KINDS` plus this 3-line pattern in the
 * card component — no edits anywhere else.
 */

import { useMemo, type MouseEvent } from "react";
import { CARD_KEY_PREFIXES } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";
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
    "aria-selected"?: true;
  };
  /** Primary focus: true only for the single haloed card. */
  selected: boolean;
  /** Open/expanded: true for any card in stickySet ∪ {transient}. Multi-card. */
  expanded: boolean;
  hovered: boolean;
  /** Imperative ref builder for callers that need to set/toggle this
   *  exact card programmatically (e.g. from a keyboard shortcut). */
  ref: AnchoredCardRef;
}

export function useAnchoredCard(ref: AnchoredCardRef): UseAnchoredCardResult {
  const selected = useIsSelected(ref);
  const expanded = useIsExpanded(ref);
  const hovered = useIsHovered(ref);

  // The CardKind union is a superset of EntityKind; every EntityKind value
  // is a valid CardKind so this widening cast is sound.
  const cardKey = `${CARD_KEY_PREFIXES[ref.kind as CardKind]}:${ref.id}`;

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
      onClick: (_e: MouseEvent) => cardStore.toggleSelection(ref),
      ...(selected ? { "aria-selected": true as const } : {}),
    }),
    // ref.kind/ref.id are the only inputs that matter; cardKey is derived.
    // selected is in the deps so aria-selected updates correctly.
    [cardKey, ref.kind, ref.id, selected],
  );

  return { props, selected, expanded, hovered, ref };
}
