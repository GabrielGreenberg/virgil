"use client";

import {
  ActionButton,
  ACTION_BUTTON_DEFS,
  type ActionToolbarCallbacks,
} from "./MenuBar";
import type { PanelPlacement } from "@/hooks/useViewPrefs";

interface Props {
  side: "left" | "right";
  actions: ActionToolbarCallbacks;
  placements: PanelPlacement[];
}

/**
 * Per-column Actions toolbar — rendered as the `topOverlay` of a
 * PanelColumn while Omni-view is docked on that side. Contains only the
 * "create new" buttons for kinds whose source panels are placed on this
 * side, so the left toolbar surfaces the left-side kinds (e.g. footnote,
 * citation, quotation) and the right surfaces the rest. Reflexive:
 * moving a panel to the other side moves its button too.
 *
 * Positioning is handled by PanelColumn (absolute top-center of the
 * column); this component is a pure content row.
 */
export function MarginActionToolbar({ side, actions, placements }: Props) {
  const defs = ACTION_BUTTON_DEFS.filter((def) => {
    if (!actions[def.callbackKey]) return false;
    const placement = placements.find((p) => p.id === def.panelId);
    return placement?.side === side;
  });
  if (defs.length === 0) return null;

  return (
    <div
      data-action-pod
      data-margin-toolbar-side={side}
      className="flex items-center px-5"
    >
      <div className="flex items-center gap-0.5">
        {defs.map((def) => {
          const cb = actions[def.callbackKey]!;
          return (
            <ActionButton
              key={def.callbackKey}
              onClick={(rect) => cb(rect)}
              title={def.title}
              color={def.color}
              hoverBg={def.hoverBg}
              hoverColor={def.hoverColor}
              icon={def.icon}
            />
          );
        })}
      </div>
    </div>
  );
}
