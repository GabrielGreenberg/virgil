"use client";

/**
 * `<MenuSeparator>` / `<MenuSectionLabel>` — the two non-interactive pieces of
 * menu chrome, stated once.
 *
 * Both were literal class strings copied across every menu that groups its rows
 * — `my-1 border-t border-edge-subtle` ×10 and the canonical uppercase caption
 * ×5 (MenuBar's ViewMenu, the omni filter menu, the Bibliography and Citations
 * kebabs, CardViewModeMenu), all folded here. They carry no state and no
 * behavior, which is exactly why they drifted unnoticed: nothing failed when one
 * copy's padding differed.
 *
 * Two near-identical captions are deliberately NOT swapped, and they are the
 * evidence for the drift: `FontPicker`'s (`px-3 pt-2 pb-1`) and the Citations
 * bib-key caption (a bare `<span>`, no padding at all) both sit outside a menu,
 * and adopting menu-row padding there would move real pixels. Fold them in when
 * those surfaces themselves become menus.
 *
 * `aria-hidden` on the separator and `role="presentation"` on the caption keep
 * them out of the menu's item semantics — a screen reader walks `menuitem`s,
 * and a decorative divider announcing itself as a row is noise. (A caption that
 * genuinely names a group of rows would be `role="group"` + `aria-labelledby`;
 * these captions label a visual cluster, not a registered subtree, so they stay
 * presentational.)
 */

import type { ReactNode } from "react";

/** Hairline rule between row clusters. */
export function MenuSeparator() {
  return <div aria-hidden className="my-1 border-t border-edge-subtle" />;
}

export interface MenuSectionLabelProps {
  children: ReactNode;
}

/** Small uppercase caption above a cluster of rows ("Display", "Sort by"). */
export function MenuSectionLabel({ children }: MenuSectionLabelProps) {
  return (
    <div
      role="presentation"
      className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide"
    >
      {children}
    </div>
  );
}
