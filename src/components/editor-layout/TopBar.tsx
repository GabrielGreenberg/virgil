"use client";

import { memo } from "react";
import { TabStrip, type TabStripProps } from "./TabStrip";
import { StatusCluster, type StatusClusterProps } from "./StatusCluster";

export type TopBarProps = {
  /** Zen mode hides the tab group + drops the bar background/border. */
  zenModeOn: boolean;
  tabStrip: TabStripProps;
  statusCluster: StatusClusterProps;
};

/**
 * The Virgil top bar: logo/tab group on the left, the right-side
 * status/action cluster on the right. Extracted out of EditorLayout and
 * memoized so paneState background ticks (compile spinner / AI dot /
 * pdfStale flips from warm panes) no longer re-execute the bar's JSX tree.
 * The bar re-renders only when one of its stable, state-backed prop groups
 * actually changes.
 *
 * INVARIANTS preserved verbatim from the inline original:
 *   - `data-prefs` / `data-bar-h` attributes (color-picker integration).
 *   - The `virgil-bar` class + zen-mode background/border gating.
 *   - The tab strip's `ref` + drag/drop handlers (threaded via tabStrip props).
 *   - The MenuBar docking sentinel comment at the end of the tab group.
 */
function TopBarImpl({ zenModeOn, tabStrip, statusCluster }: TopBarProps) {
  return (
    <div
      // Preference-mode: the VIRGIL top bar. topbarBackground is locked to the
      // PWA/browser theme-color, so changing it updates both the in-app bar and
      // the browser chrome. min-height gives the docked MenuBar breathing room
      // inside the bar without pushing the tabs taller. In zen mode the bar's
      // background and bottom border drop out so it visually melts into the
      // canvas, but the height stays so the Zen toggle keeps the same Y
      // position in both modes.
      data-prefs="topbarBackground,topbarBackgroundBottom,virgilBarText"
      data-bar-h="32"
      className={`virgil-bar flex items-center min-h-[32px] sticky top-0 z-30 ${zenModeOn ? '' : 'border-b border-[var(--topbar-border,#d5d3ce)]'}`}
      style={{
        color: "var(--virgil-bar-text)",
        background: zenModeOn
          ? "transparent"
          : "linear-gradient(to bottom, var(--topbar-bg), var(--topbar-bg-bottom))",
      }}
    >
      {/* Logo + file buttons + tabs — all bottom-aligned. The MenuBar's
          "home" position clamps against the topbar-left sentinel at the end of
          this group (after the "Open folder" "+" button), so the toolbar never
          overlaps tabs even when they crowd the middle. Zen mode hides this
          whole group; the MenuBar is also gated off in zen, so dropping the
          sentinel is safe. The flex spacer below keeps the right-group buttons
          (incl. Zen toggle) right-aligned. */}
      {zenModeOn ? <div className="flex-1" /> : <TabStrip {...tabStrip} />}

      <StatusCluster {...statusCluster} />
    </div>
  );
}

export const TopBar = memo(TopBarImpl);
