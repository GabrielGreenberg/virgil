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

export const OmniBinSlotContext = createContext<HTMLElement | null>(null);

/** The element the omni bins portal into, or `null` to render in-pod. */
export function useOmniBinSlot(): HTMLElement | null {
  return useContext(OmniBinSlotContext);
}

/** DOM marker on the slot element (one per column side). */
export const DATA_OMNI_BIN_SLOT = "data-omni-bin-slot";
