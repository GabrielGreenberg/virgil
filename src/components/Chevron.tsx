import { ICON_STROKE_SMALL } from "@/components/icons/icon-stroke";

/**
 * The ONE disclosure chevron: a right-pointing caret that rotates 90° when
 * `expanded`. A leaf (task 1237) — `panel-primitives` re-exports it and
 * `PodDisclosure` renders it; `pod-disclosure-census.test.ts` keeps a text
 * glyph ("▾/▸") from standing in for it on any raw `aria-expanded` button.
 */
export function Chevron({
  expanded,
  size = 14,
  className = "",
}: {
  expanded: boolean;
  /** Edge in px. Stamped as the `width` attribute, which is what the small
   *  stroke rung keys on (globals.css "One line weight"). */
  size?: number;
  className?: string;
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
      className={`motion-safe:transition-transform duration-(--motion-base) flex-shrink-0 ${expanded ? "rotate-90" : ""} ${className}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
