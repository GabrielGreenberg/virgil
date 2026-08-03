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
      // the browser chrome. The bar's min-height + window-inset padding now
      // live in the `.virgil-bar` rule (globals.css) so it can grow to fill the
      // OS-reserved title-bar strip under Window Controls Overlay; the floor is
      // --bar-base-h (32px). In zen mode the bar's background and bottom border
      // drop out so it visually melts into the canvas, but the height stays so
      // the Zen toggle keeps the same Y position in both modes.
      // data-bar-h mirrors the base-height FLOOR (32) for the color-picker
      // integration; the live box can be taller under WCO.
      data-prefs="topbarBackground,topbarBackgroundBottom,virgilBarText"
      data-bar-h="32"
      // items-END, not items-center: the whole bar row shares ONE seam (bottom)
      // anchor so the tabs, the "+", and the StatusCluster icons all track the
      // bar's bottom edge at ANY bar height. Under WCO the `.virgil-bar` grows
      // (min-height only, no vertical padding) and `items-center` would push
      // every center-anchored child UP by H/2 as the bar got taller, dropping
      // them ABOVE the seam-anchored tab titles (task 094 seam-anchored only the
      // titles). With items-end every group bottom-anchors; the 24px-tall
      // content groups add `mb-[3px]` (StatusCluster, the "+") to land their
      // optical center at seam−15, matching the tab titles' 094 anchor. TabStrip
      // is `self-stretch` so it fills H and keeps its tabs at the seam (task 289).
      className={`virgil-bar flex items-end sticky top-0 z-30 ${zenModeOn ? '' : 'border-b border-[var(--topbar-border,#d5d3ce)]'}`}
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
      {/* data-window-drag-zone: under WCO the bar's content clusters are
          no-drag; this empty zen spacer hands the middle back to window-drag
          so zen mode still has a native title-bar grab area. */}
      {zenModeOn ? <div className="flex-1" data-window-drag-zone /> : <TabStrip {...tabStrip} />}

      <StatusCluster {...statusCluster} />
    </div>
  );
}

export const TopBar = memo(TopBarImpl);
