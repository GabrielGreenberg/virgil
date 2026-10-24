import type { CSSProperties } from "react";
import { ICON_STROKE_SMALL } from "./icon-stroke";

/**
 * The ONE menu-trigger caret: a downward (or, for a toggle, upward) "v" on the
 * small-glyph stroke rung (task 2026-10-24-1276). Before it, the same
 * `<polyline points="6 9 12 15 18 9">` was hand-copied into the card-kind
 * dropdown, the Omni sort toggle and the bib-picker details toggle — each with
 * its own weight. A domain-neutral leaf like `DropChevrons`, so any surface can
 * use it without importing card code.
 *
 * `size` is free because an INLINE caret sizes to the text it trails (the
 * card-kind trigger's 9px caret beside a 10px META label); a caret that is a
 * button's only content sits inside an `iconbtn-*`, whose glyph ladder sizes
 * it regardless. `icon-stroke-rung-census.test.ts` keeps the polyline here.
 */
export function MenuCaret({
  size = 12,
  direction = "down",
  className,
  style,
}: {
  size?: number;
  direction?: "down" | "up";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_SMALL}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <polyline points={direction === "up" ? "6 15 12 9 18 15" : "6 9 12 15 18 9"} />
    </svg>
  );
}
