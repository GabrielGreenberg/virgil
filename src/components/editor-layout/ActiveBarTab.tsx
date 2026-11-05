"use client";

import { memo, type ReactNode } from "react";
import { describedHint } from "@/components/Hint";
import { SEGMENT_ON } from "@/components/SegmentedToggle";

/** The active tab's floor: a short name still reads as a tab. It is a MINIMUM;
 *  the active tab is `shrink-0` and never compresses (see tab-strip-occupancy.ts
 *  — inactive tabs yield, then the strip scrolls). */
const ACTIVE_TAB_MIN_WIDTH = 80;

type Props = {
  /** Tooltip / aria label (e.g., the doc folder name). */
  title?: string;
  /** Tab content (icon, label, close button). Width is layout-owned. */
  children: ReactNode;
};

/**
 * The ACTIVE outer Virgil-bar tab (documents, papers, libraries): a lozenge, the
 * same white tile as the view switch beside it, so the bar has one way of saying
 * what is selected. An inactive tab is plain text (InlineTabLabel) with the same
 * box and padding, so activating one leaves its text where it was.
 */
function ActiveBarTabImpl({ title, children }: Props) {
  return (
    <div
      className={`relative flex items-center gap-1.5 shrink-0 h-6 pl-2 pr-2 rounded-md cursor-default ${SEGMENT_ON}`}
      style={{
        minWidth: ACTIVE_TAB_MIN_WIDTH,
        // Whole CSS pixels: a fractional label width would soften the tile's
        // right edge at DPR 1.
        width: "calc-size(max-content, round(up, size, 1px))",
      }}
      {...describedHint(title)}
    >
      {children}
    </div>
  );
}

export const ActiveBarTab = memo(ActiveBarTabImpl);
