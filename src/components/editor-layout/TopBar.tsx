"use client";

import { memo } from "react";
import { TabStrip, type TabStripProps } from "./TabStrip";
import { StatusCluster, type StatusClusterProps } from "./StatusCluster";
import { useBarOccupancy } from "./useBarOccupancy";

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
 *
 * The bar OWNS its width negotiation (task 395): `useBarOccupancy` measures
 * the two occupants and resolves the priority ladder stated in
 * [bar-occupancy.ts](./bar-occupancy.ts) — protected status > tabs >
 * collapsible tools. It lives here because this is the one component that
 * renders both occupants; `EditorLayout` still owns only the user's persisted
 * `topbarRightCollapsed` pref, which the rule reads and never writes.
 */
function TopBarImpl({ zenModeOn, tabStrip, statusCluster }: TopBarProps) {
  const occupancy = useBarOccupancy({
    userCollapsed: statusCluster.topbarRightCollapsed,
    setUserCollapsed: statusCluster.setTopbarRightCollapsed,
  });
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
      {/* Logo + file buttons + tabs — all bottom-aligned, and the bar's
          TIER-2 occupant (see bar-occupancy.ts): under compression the tabs
          outrank the collapsible tool group, which auto-collapses to give them
          the room. Two things hold that invariant, and both are mechanisms
          rather than promises — the predecessor comment here claimed a clamp
          against a "topbar-left sentinel" that was a COMMENT with no element
          and no consumer, left behind when the floating MenuBar pod that once
          read it was retired (93b286c0 / bab3a399). (1) `useBarOccupancy`
          measures the tab row's natural width against the strip's assigned box
          and collapses the tools when they don't both fit. (2) The strip clips
          its OWN horizontal overflow, so even a tab row too wide to fit after
          the tools have yielded can never paint over the status cluster's
          protected data-integrity badges. Zen mode drops the whole group (the
          measure ref unbinds, and the rule falls back to no auto-collapse);
          the flex spacer below keeps the right-group buttons (incl. Zen
          toggle) right-aligned. */}
      {/* data-window-drag-zone: under WCO the bar's content clusters are
          no-drag; this empty zen spacer hands the middle back to window-drag
          so zen mode still has a native title-bar grab area. */}
      {zenModeOn ? (
        <div className="flex-1" data-window-drag-zone />
      ) : (
        <TabStrip
          {...tabStrip}
          stripMeasureRef={occupancy.tabStripMeasureRef}
          tabsMeasureRef={occupancy.tabsMeasureRef}
        />
      )}

      <StatusCluster
        {...statusCluster}
        topbarRightCollapsed={occupancy.toolsCollapsed}
        onToggleTools={occupancy.toggleTools}
        toolsMeasureRef={occupancy.toolsMeasureRef}
      />
    </div>
  );
}

export const TopBar = memo(TopBarImpl);
