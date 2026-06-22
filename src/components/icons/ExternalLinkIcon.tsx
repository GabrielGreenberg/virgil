/**
 * Neutral "open in a new tab" / external-link glyph — a box with an arrow
 * leaving its top-right corner (lucide `ExternalLink`).
 *
 * Purely presentational — NO card / library imports. A runtime LEAF so any
 * surface that wants an "open the entry elsewhere" affordance (bibliography
 * cards, citation cards, …) can share ONE glyph without a dependency cycle.
 * Stroke-only, currentColor, round caps/joins — matches the icon doctrine in
 * STYLE_GUIDE (Spacing & icons).
 */

/** Default glyph edge in px. 12 reads a touch larger than the 10px chevrons
 *  so the box + arrow stay legible at meta-row scale. */
const DEFAULT_SIZE = 12;

export function ExternalLinkIcon({
  size = DEFAULT_SIZE,
  className,
}: {
  /** Edge length in px (square). */
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
