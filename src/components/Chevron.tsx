import { ICON_STROKE_SMALL } from "@/components/icons/icon-stroke";

/**
 * The ONE disclosure chevron: a right-pointing caret that rotates 90° when
 * `expanded`. A leaf (task 1237) — `panel-primitives` re-exports it and
 * `PodDisclosure` renders it; `pod-disclosure-census.test.ts` keeps a text
 * glyph ("▾/▸") from standing in for it on any raw `aria-expanded` button.
 */
export function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_SMALL}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`motion-safe:transition-transform duration-150 flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
