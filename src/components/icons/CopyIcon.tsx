/**
 * Neutral "copy to clipboard" glyph — two overlapping rounded rectangles
 * (lucide `Copy`). Purely presentational, a runtime LEAF with NO card /
 * library imports so any surface that wants a copy affordance can share ONE
 * glyph. Stroke-only, currentColor, round caps/joins — matches the icon
 * doctrine in STYLE_GUIDE (Spacing & icons), mirroring `ExternalLinkIcon`.
 */

/** Default glyph edge in px. 12 reads at meta-row scale next to 10px text. */
const DEFAULT_SIZE = 12;

export function CopyIcon({
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
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export default CopyIcon;
