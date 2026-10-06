"use client";

/**
 * FaithfulBorrowedText — a READ-ONLY borrowed body that is static whenever the
 * static render is faithful, and live only when it is not (task 978).
 *
 * `StaticBorrowedText` (T1) paints every node through its `renderHTML`, which
 * is visually identical to the live `BorrowedMainText` EXCEPT for nodes whose
 * look comes from a NodeView with no static twin — an expex example's `(N)`
 * numbering, a figure, a `%` comment. Task 823 made that a declared, derived
 * property of the BODY (`bodyNeedsLiveRender`, borrowed-render.ts) and taught
 * the tiered switch in `EditableCard` to promote such a body past T1. An
 * UNTIERED read-only surface (a captured passage) asks the same question here,
 * so no such door can paint the unfaithful static form by forgetting to ask.
 *
 * The tiered switch keeps its own copy of the answer because it has more than
 * two outcomes (a ceiling below T2 shows the T0 summary instead); this
 * component is the two-outcome door for everything else.
 *
 * O(body) walk, memoized on the body — a card body, never the main document,
 * so it is off the keystroke path.
 */

import { useMemo, type CSSProperties } from "react";
import { bodyNeedsLiveRender } from "@/lib/borrowed-render";
import type { CardBodySchemaScope } from "@/lib/tiptap/borrowed-schema";
import { BorrowedMainText } from "@/components/BorrowedMainText";
import { StaticBorrowedText } from "@/components/StaticBorrowedText";

export interface FaithfulBorrowedTextProps {
  value: unknown;
  /** Remount key for the live surface (unused while static). */
  instanceKey: string;
  variant?: "footnote" | "note";
  bodyStyle?: CSSProperties;
  schemaScope?: CardBodySchemaScope;
}

export function FaithfulBorrowedText({
  value,
  instanceKey,
  variant = "footnote",
  bodyStyle,
  schemaScope = "card",
}: FaithfulBorrowedTextProps) {
  const needsLive = useMemo(
    () => bodyNeedsLiveRender(value, schemaScope),
    [value, schemaScope],
  );
  return needsLive ? (
    <BorrowedMainText
      value={value}
      instanceKey={instanceKey}
      variant={variant}
      bodyStyle={bodyStyle}
      schemaScope={schemaScope}
    />
  ) : (
    <StaticBorrowedText
      value={value}
      variant={variant}
      bodyStyle={bodyStyle}
      schemaScope={schemaScope}
    />
  );
}

export default FaithfulBorrowedText;
