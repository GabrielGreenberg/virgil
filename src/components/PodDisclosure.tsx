import type { ReactNode } from "react";
import { Chevron } from "./Chevron";
import { withFocusIndicator } from "./focus-indicator";

/**
 * The ONE labelled disclosure button for a card sub-pod ("BibTeX Fields",
 * "Annotations", "Original text"): `<button type="button" aria-expanded>`
 * + `<Chevron>` + label, with the focus indicator, stopping click AND
 * mousedown so the card body underneath does not select / start a drag
 * (task 1187). Each card used to hand-roll this and the copies drifted —
 * two announced no expanded state, three had no focus ring.
 * `pod-disclosure-census.test.ts` keeps a `<Chevron expanded=` from
 * appearing outside this primitive (bar named icon-only toggles).
 * `className` carries only the label's ink/type; the shape is fixed here.
 */
export function PodDisclosure({
  expanded,
  onToggle,
  children,
  className = "",
  chevron = "leading",
}: {
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  /** Chevron before (default) or after the label. */
  chevron?: "leading" | "trailing";
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={withFocusIndicator(`flex items-center gap-1.5 cursor-pointer ${className}`)}
    >
      {chevron === "leading" && <Chevron expanded={expanded} />}
      <span>{children}</span>
      {chevron === "trailing" && <Chevron expanded={expanded} />}
    </button>
  );
}
