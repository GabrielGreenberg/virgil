"use client";

import { MARKER_META, type MarginaliaMarker } from "@/lib/marginalia";
import { BadgeOrphaned, CARD_THEMES } from "@/components/panel-primitives";
import { useCallback, useRef } from "react";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { useMenuItem } from "@/components/menu/useMenuItem";
import { MarkerButton } from "@/components/Marginalia";

/**
 * "N unanchored" — the pane-chrome affordance for cards whose anchor died
 * (`resolveCardAnchor` → `source:'orphan'`, surfaced as `marker.unanchored`).
 *
 * ## Why it lives here and not in the margin (task 410)
 *
 * Pre-410 these markers docked in the margin column itself, as a
 * `position:absolute; top:6; zIndex:12` box — a SECOND owner in a lane whose
 * packer (`computeMarkerPositions`) could not see it. Three costs, and the
 * third is the one that made this a relocation rather than a nudge:
 *
 *  1. it overlapped the first blocks' marker cells (on the right it covered
 *     col1 entirely) and, being `pointer-events-auto` above them, STOLE their
 *     clicks — the task-325 bolt-over-col1 shape, one axis over;
 *  2. it was culled with the cells whenever the lane went cramped
 *     (`laneCols[side] <= 0`), in zen, and in the read-only reader — so the
 *     one surface that exists to stop a card vanishing could itself vanish;
 *  3. it was pinned to the TOP of a naturally tall, non-scrolling pod
 *     (`.editor-pane-pod` is `overflow: clip`), so on any scrolled document
 *     the re-pin entry point was not reachable at all.
 *
 * The lane's x-axis means "beside the text this points at". An unanchored card
 * has no such text, so it has no place in the lane: the fact is about the
 * CARD, and the affordance belongs in chrome that is visible from anywhere in
 * the document. It renders in the pod's STICKY chrome header, beside the
 * MenuBar, so it survives every scroll position, both margin regimes, and a
 * side the lane is too narrow to host.
 *
 * ## What it is NOT gated on
 *
 * The per-type hide set and the master "show marginalia" toggle are VIEW
 * preferences over the lane; they do not silence this. A card that lost its
 * anchor is the same class of fact as a save refusal — the app's own rule is
 * that a data-integrity notice is not hideable by a layout preference
 * (AGENTS.md, "The honesty half"). Archived cards ARE excluded, because an
 * archived card is deliberately out of the margin and out of its panel's
 * default list; its home is the Archive panel, where it is already reachable.
 *
 * ## Behaviour
 *
 * Each entry is an ordinary {@link MarkerButton} in flow layout — the same
 * component the lane renders — so click still opens the card's panel and the
 * grab gesture still starts the drop-mode re-anchor session (the "re-pin").
 * Nothing about the gesture depends on where the button sits. Since task 477
 * the ROW around it registers with the enclosing provider (see
 * {@link UnanchoredRow}), so the shared keyboard controller can reach it.
 *
 * The dropdown is the shared `<AnchoredMenu>` primitive rather than a bespoke
 * popover: the anchored-menu doctrine (STYLE_GUIDE "Menus") is exactly the law
 * that a menu solved against a trigger does not re-derive placement, Escape,
 * click-away and ARIA per site.
 */
export function UnanchoredCardsChip({
  markers,
  dragEnabled,
}: {
  markers: readonly MarginaliaMarker[];
  dragEnabled: boolean;
}) {
  const count = markers.length;
  // The chip only exists while something is unanchored, so an empty set is a
  // render of nothing rather than a disabled control that does nothing.
  if (count === 0) return null;

  const label = `${count} unanchored card${count === 1 ? "" : "s"} — click to re-pin`;

  // On the `<Menu>` primitive (STYLE_GUIDE "Menus"), not a hand-rolled popover:
  // it brings the viewport flip, the height clamp, the re-anchor on resize,
  // Escape + click-away and the menu ARIA — none of which a bespoke
  // `absolute … shadow-lg` box would have had, and the clamp is not decorative
  // here (the header sits at the TOP of the pane, so a long list drops downward
  // and must scroll rather than run past the pod).
  return (
    <div data-unanchored-cards-chip="" className="shrink-0">
      <AnchoredMenu
        ariaLabel={label}
        align="end"
        triggerClassName="omni-bin-pill flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium"
        triggerHint={label}
        menuClassName="min-w-[180px] px-1.5"
        trigger={() => (
          <>
            <span aria-hidden="true">
              <BadgeOrphaned theme={CARD_THEMES.error} />
            </span>
            <span>{count} unanchored</span>
          </>
        )}
      >
        {({ close }) => (
          <div className="flex flex-col gap-1" data-unanchored-cards-list="">
            {markers.map((m) => (
              <UnanchoredRow
                key={`${m.type}:${m.id}`}
                m={m}
                dragEnabled={dragEnabled}
                onActivated={close}
              />
            ))}
          </div>
        )}
      </AnchoredMenu>
    </div>
  );
}

/**
 * ONE unanchored entry, registered into the enclosing `MenuProvider` (task
 * 477).
 *
 * Before this the rows were bare `MarkerButton`s, so this menu's registry was
 * EMPTY — and an empty registry is worse than no controller at all, because
 * `useMenuKeyboard`'s window-CAPTURE listener still consumed Enter/Space/every
 * arrow and activated nothing: a `role="menu"` with zero `menuitem`s, and a
 * Tab'd row whose Enter was suppressed rather than merely unhandled.
 *
 * The registration wraps rather than replaces the marker button, the shape
 * `BlockTypeGridCell` already uses for a compound cell: `MarkerButton` is
 * SHARED with the marginalia lane, where there is no provider at all and
 * `useMenuItem` would throw — and its own gesture surface (a click that opens
 * the card's panel, a press-drag that starts the drop-mode re-anchor) is what
 * must keep working. So the ROW carries the ARIA and the roving cursor, and its
 * `run` clicks the button the user would have clicked. The row is the whole
 * hit area for the cursor, which is right: the label beside the badge names the
 * card, and arrowing to "a 22px icon" would be the smaller target.
 */
function UnanchoredRow({
  m,
  dragEnabled,
  onActivated,
}: {
  m: MarginaliaMarker;
  dragEnabled: boolean;
  onActivated: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { active, getItemProps } = useMenuItem({
    id: `${m.type}:${m.id}`,
    region: "list",
    // Keyboard activation: click the marker's own button, so the one gesture
    // path stays the button's (panel open + `onActivated` close) rather than a
    // second copy of it here.
    run: useCallback(() => {
      wrapRef.current?.querySelector("button")?.click();
    }, []),
  });
  const itemProps = getItemProps();
  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        itemProps.ref(el);
      }}
      role={itemProps.role}
      id={itemProps.id}
      tabIndex={itemProps.tabIndex}
      data-active={itemProps["data-active"]}
      onMouseEnter={itemProps.onMouseEnter}
      className="flex items-center gap-2 rounded px-1"
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      <MarkerButton m={m} dragEnabled={dragEnabled} onActivated={onActivated} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
        {m.title || MARKER_META[m.type].label}
      </span>
    </div>
  );
}

export default UnanchoredCardsChip;
