"use client";

import type { MarginaliaMarker } from "@/lib/marginalia";
import { BadgeOrphaned, CARD_THEMES } from "@/components/panel-primitives";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { MarkerMenuRow } from "@/components/Marginalia";

/**
 * "N unanchored" — the pane-chrome FALLBACK for cards whose anchor died
 * (`resolveCardAnchor` → `source:'orphan'`, surfaced as `marker.unanchored`).
 *
 * ## Fallback, not owner (task 544)
 *
 * The ONE owner of the no-anchor affordance is the gutter's "N unanchored"
 * bin (`OmniUnanchoredBin`, in the column's sticky bin slot — task 421 made
 * it reachable at every scroll position, which retired this chip's whole
 * reason for being a second surface). `EditorPane` hands this chip only the
 * markers whose RESOLVED side has no bin surface — zen, a collapsed column,
 * the code split, the folded Reader gutters — read off the edge each
 * `PanelColumn` publishes (`onBinSurfaceChange`). Where every side has a
 * gutter this renders nothing, so one fact is never drawn twice on screen
 * (Gabriel: "should be just the gutter bar").
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
 * (docs/agents/laws/the-write-path.md, "The honesty half"). Archived cards ARE excluded, because an
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
 * {@link MarkerMenuRow}), so the shared keyboard controller can reach it.
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
              <MarkerMenuRow
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

export default UnanchoredCardsChip;
