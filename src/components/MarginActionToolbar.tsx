"use client";

import {
  ActionChipButton,
  ACTION_BUTTON_DEFS,
  type ActionToolbarCallbacks,
} from "./MenuBar";
import type { PanelPlacement } from "@/hooks/useViewPrefs";
import { useEditorChrome } from "./editor-layout/chrome-context";
import { isActionCallbackVisible } from "./editor-layout/chrome-config";
import { MARGINALIA_COL_GAP } from "@/lib/marginalia";

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
 *
 * Chrome consumption: hides entirely when `showActionToolbar` is false,
 * and filters per-button on `actionToolbarKinds` (so the Reader's
 * `["note"]` whitelist surfaces only the Note button even if other
 * callbacks are wired upstream).
 */
export function MarginActionToolbar({ side, actions, placements }: Props) {
  // Temporarily suppressed: omni-view gutter action chips aren't working
  // reliably yet. Body below is preserved so re-enabling is a one-line revert.
  return null;
  const chrome = useEditorChrome();
  if (!chrome.showActionToolbar) return null;
  const defs = ACTION_BUTTON_DEFS.filter((def) => {
    if (!actions[def.callbackKey]) return false;
    if (!isActionCallbackVisible(chrome, def.callbackKey)) return false;
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
      <div
        className="flex items-center"
        style={{ gap: MARGINALIA_COL_GAP }}
      >
        {defs.map((def) => {
          const cb = actions[def.callbackKey]!;
          return (
            <ActionChipButton
              key={def.callbackKey}
              onClick={(rect) => cb(rect)}
              title={def.title}
              themeKey={def.themeKey}
              icon={def.icon}
            />
          );
        })}
      </div>
    </div>
  );
}
