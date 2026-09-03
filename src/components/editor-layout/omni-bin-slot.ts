/**
 * The omni BIN SLOT — where a card that cannot cascade is surfaced (task 421).
 *
 * An omni bin ("N unanchored", "N outside focus") is an affordance for a fact
 * that is NOT positional: a card with no live anchor has no Y in the document.
 * Task 410 stated the rule for the margin's orphan dock — such an affordance
 * "is surfaced in chrome that is visible from anywhere in the document" — and
 * the omni bins carried the pre-410 posture: `position: absolute; top: 4`
 * inside a DOCUMENT-TALL cascade pod, i.e. 4px from the top of the whole
 * paper, scrolled away on any real document and painted UNDER a docked band
 * at scroll 0 (the band frame is `z-index: 30`; the bins were `20` in a
 * subtree with no stacking context of its own).
 *
 * `PanelColumn` owns the column's ONE sticky layer — the band frame (Layer C),
 * a flex column that already lays the docked bands out top→bottom and stays
 * pinned in the viewport. It renders an empty slot element as the LAST flex
 * child of that frame and publishes it through this context; `OmniViewPanel`
 * portals its `OmniBinStack` into the slot. So the bins:
 *
 *   - stack BELOW whatever bands are docked, by DECLARATION (flex order), not
 *     by a z-index race — a band can grow, shrink or be undocked and the bins
 *     follow with no measurement;
 *   - are sticky for free, because the frame is;
 *   - still take ZERO flow space in the cascade pod (A5's structural fix —
 *     the slot lives in the column's absolute pass-through overlay, so the
 *     pod's top is exactly where it was without them);
 *   - still carry no `data-omni-entry-wrapper`, so the cascade ResizeObserver
 *     never measures them (keystroke/measure sanctity).
 *
 * The z ladder, stated once: a pinned cascade card is `10`; the bin slot is
 * `20` (above any card anchored to the first paragraph, as before); a docked
 * band frame is `30` — and the bins sit INSIDE that frame when one is docked,
 * so the ladder never has to decide between them.
 *
 * The context is `null` where no column hosts the omni view (unit fixtures,
 * any future bare mount). `OmniViewPanel` then keeps the bins inside the pod,
 * in the in-pod STICKY posture (`OmniBinStack host="pod"`), which answers the
 * scroll half of the defect on its own; only the column can answer the
 * docked-band half, and only the column has one.
 */
import { createContext, useContext } from "react";
import type { CascadeFloor } from "@/hooks/useInTextPositions";

export const OmniBinSlotContext = createContext<HTMLElement | null>(null);

/** The element the omni bins portal into, or `null` to render in-pod. */
export function useOmniBinSlot(): HTMLElement | null {
  return useContext(OmniBinSlotContext);
}

/** DOM marker on the slot element (one per column side). */
export const DATA_OMNI_BIN_SLOT = "data-omni-bin-slot";

/** DOM marker on the column's sticky band frame — the slot's `offsetParent`
 *  and the element the cascade floor is measured against. Spelled here so the
 *  omni view resolves the frame FROM the slot it was handed rather than by a
 *  document-global query (the task-438 rule: a per-pane marker is resolved
 *  relative to the pane, never find-first). */
export const DATA_STACK_FRAME = "data-stack-frame";

/**
 * The cascade FLOOR under a sticky occupant (task 544) — how far into the
 * cascade pod, AT SCROLL ZERO, the column's sticky chrome reaches.
 *
 * `sticky` is the element pinned in the viewport (the band frame, or the
 * in-pod fallback's sticky inner); `occupant` is the element whose BOTTOM is
 * the chrome's last painted pixel (the bin slot — it is the frame's last flex
 * child, so its bottom edge is below every docked band by construction, and
 * an empty slot beneath a docked band still reports the band's bottom plus
 * its separator). The answer is `stuckTop + occupied + gap`, in pod
 * coordinates at scroll zero:
 *
 *  - `occupied = occupant.bottom − sticky.top`, a viewport-frame difference
 *    that scroll cannot move (both are inside the same pinned frame);
 *  - `stuckTop = sticky.top − podRect.top − scrollTop`: the frame's pinned
 *    viewport Y, re-expressed against where the pod's top WAS at scroll zero
 *    (`podRect.top + scrollTop`). While the frame is stuck this is a
 *    constant; a frame that has not yet reached its pin sits at its natural
 *    position ABOVE the pod's first pixel, where the difference goes
 *    negative and is clamped to 0 — the CONSERVATIVE direction, since it
 *    floors the deck at the full occupancy instead of a few pixels less.
 *
 * `0` when nothing occupies the frame (`occupied ≤ 0`): no chrome, no floor,
 * the pre-544 cascade byte for byte. The breathing room between that pixel
 * and the first card is the CASCADE's to add (its own inter-card gap), not
 * this reader's. Two rect reads plus one scroll read, inside the measure pass
 * that already forces a layout — never per scroll frame, never per keystroke.
 */
export function readStickyOccupancyFloor(
  sticky: HTMLElement,
  occupant: HTMLElement,
  podRect: DOMRect,
  scrollTop: number,
): number {
  const s = sticky.getBoundingClientRect();
  const o = occupant.getBoundingClientRect();
  const occupied = o.bottom - s.top;
  if (!(occupied > 0)) return 0;
  const stuckTop = Math.max(0, s.top - podRect.top - scrollTop);
  return stuckTop + occupied;
}

/**
 * The floor source for a column-hosted bin stack: the slot the column
 * published, measured against the sticky frame it lives in. `null` when the
 * slot is not inside a frame (a fixture that mounts a bare slot), which
 * reads as "no floor" downstream.
 */
export function cascadeFloorForBinSlot(slot: HTMLElement): CascadeFloor | null {
  const frame = slot.closest<HTMLElement>(`[${DATA_STACK_FRAME}]`);
  if (!frame) return null;
  return {
    el: slot,
    read: (podRect, scrollTop) =>
      readStickyOccupancyFloor(frame, slot, podRect, scrollTop),
  };
}

/**
 * The floor source for the in-pod fallback (no column published a slot): the
 * stack's own sticky inner is both the pinned element and the occupant.
 */
export function cascadeFloorForStickyOccupant(occupant: HTMLElement): CascadeFloor {
  return {
    el: occupant,
    read: (podRect, scrollTop) =>
      readStickyOccupancyFloor(occupant, occupant, podRect, scrollTop),
  };
}
