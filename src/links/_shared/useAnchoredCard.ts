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
  useCardStore,
  useIsExpanded,
  useIsHovered,
  useIsSelected,
  type AnchoredCardRef,
} from "./anchored-card-store";

/**
 * Side effects a card composes on top of the store-backed select+expand when
 * its body is clicked (C15 — the single select/jump composition).
 *
 * - `onSelect`: the host's MONOTONIC select slot (`onSelect(id)`, never the
 *   toggling `selectedId === id ? null : id`). It mirrors the store's selection
 *   into the per-panel slot used for collab claims / cross-panel open. Passing
 *   the toggling form is the C15 bug — it diverges from the store on a re-click.
 * - `jump`: scroll the editor to the card's anchor. Called ONLY when the card
 *   was NOT already selected, so a re-click of a selected card keeps its halo
 *   and does NOT double-jump (FN-F2-01 et al.).
 */
export interface BodyActivateEffects {
  onSelect?: () => void;
  jump?: () => void;
}

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
   * C15 — the ONE shared select/jump composition every anchored card body
   * routes through. It (1) reads the LIVE store to learn whether this card was
   * already selected (captured BEFORE the select mutates it), (2) runs the
   * monotonic select+expand (`onActivate`), (3) mirrors the selection into the
   * host's monotonic `onSelect` slot, and (4) jumps to the anchor ONLY if the
   * card was not already selected. The "already selected → skip jump" rule
   * makes a re-click idempotent: the halo stays and the editor does not
   * double-jump. Selection stays single-sourced from the store (the halo is
   * `ac.selected`), so docked / omni / float compose identically.
   */
  onBodyActivate: (effects?: BodyActivateEffects) => void;
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
  // This card's per-doc store, from context (the CardStoreProvider EditorPane
  // mounts around the rail / marginalia / popouts). Reads (useIs*) and writes
  // (store.*) target the SAME per-doc instance.
  const store = useCardStore();
  const selected = useIsSelected(ref);
  const expanded = useIsExpanded(ref);
  const hovered = useIsHovered(ref);

  const onActivate = useCallback(() => {
    store.select(ref);
    store.expand(ref);
  }, [store, ref.kind, ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // C15: the single body-click composition. Read the store-selected state
  // BEFORE the select mutates it — that snapshot decides whether this is a
  // re-click (skip the jump) or a fresh select (jump). Reading the store live
  // (not the render-time `selected` closure) keeps the decision correct even if
  // a sibling re-selected between renders.
  const onBodyActivate = useCallback(
    (effects?: BodyActivateEffects) => {
      const wasSelected = store.isSelected(ref);
      store.select(ref);
      store.expand(ref);
      effects?.onSelect?.();
      if (!wasSelected) effects?.jump?.();
    },
    [store, ref.kind, ref.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Axis-pure: toggles ONLY the body, never the halo.
  const onToggleExpanded = useCallback(() => {
    store.toggleExpanded(ref);
  }, [store, ref.kind, ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Header-click composition: select + toggle expansion, NO jump.
  const onHeaderActivate = useCallback(() => {
    store.select(ref);
    store.toggleExpanded(ref);
  }, [store, ref.kind, ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { selected, expanded, hovered, onActivate, onBodyActivate, onToggleExpanded, onHeaderActivate, ref };
}
