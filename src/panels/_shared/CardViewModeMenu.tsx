"use client";

/**
 * The "View Active / View Archives / View All" radio section that every card
 * panel drops into its three-dot (`ItemMenu`) header menu. Reads + writes the
 * shared `CardArchiveViewContext` (provided by EditorPane from the single
 * `useViewPrefs` instance), so it stays in lockstep with the `CardListPanel`
 * filter for the same panel. Distinct from the text-object Archive PANEL.
 *
 * ── ROW MIGRATION (task 477) ──
 * These were three bare `<button onMouseDown={preventDefault; setView}>`s: not
 * registered, so the enclosing provider's registry was empty and the shared
 * keyboard controller consumed Enter/Space/every arrow at window capture and
 * activated nothing. They are `MenuToggleRow`s now, in the `menuitemradio`
 * spelling — picking one un-picks the others, which is what distinguishes this
 * set from an independent checkbox — so arrow-nav crosses them, Enter picks the
 * active one, and `aria-checked` says which is current.
 *
 * The visual moves once, deliberately: the checkmark was a leading glyph in a
 * `w-3` gutter and is now the accent ✓ in the row primitive's reserved trailing
 * column, which is what every other checked row in the app draws. Behaviour is
 * unchanged — picking a mode still dismisses the kebab, because the row does
 * NOT pass `keepMenuOpen` (the three are one decision, not a run of toggles).
 */

import { MenuSeparator } from "@/components/menu/MenuChrome";
import { MenuToggleRow } from "@/components/menu/MenuToggleRow";
import { useCardArchiveView, type CardArchiveView } from "./card-archive-view";
import type { PanelKind } from "./types";

const OPTIONS: { mode: CardArchiveView; label: string }[] = [
  { mode: "active", label: "View Active" },
  { mode: "archived", label: "View Archives" },
  { mode: "all", label: "View All" },
];

export function CardViewModeMenuItems({ kind }: { kind: PanelKind }) {
  const { getView, setView } = useCardArchiveView();
  const current = getView(kind);
  return (
    <>
      <MenuSeparator />
      {OPTIONS.map((o) => (
        <MenuToggleRow
          key={o.mode}
          id={`view-${o.mode}`}
          role="menuitemradio"
          label={o.label}
          checked={current === o.mode}
          onToggle={() => setView(kind, o.mode)}
        />
      ))}
    </>
  );
}
