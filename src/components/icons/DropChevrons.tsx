/**
 * Neutral double-chevron-down glyph — the "drop here" / (re)anchor mark.
 *
 * Two stacked lucide `ChevronsDown` polylines in a `0 0 24 24` viewBox,
 * sized + stroked to match `CardJumpChevron` (panel-primitives.tsx) so the
 * drop control reads as a sibling of the jump chevron in any header row.
 *
 * Purely presentational — NO card / drop-mode imports. This is a runtime
 * LEAF so the THREE drop-button surfaces can all share ONE glyph without a
 * cycle or a card-code dependency:
 *   - the docked card header (`CardDropButton`, chip B/C),
 *   - the float chrome button (chip D's `FloatChrome`),
 *   - the margin pin (chip H).
 * Keeping it here (not in card code) lets the domain-neutral FloatChrome and
 * the margin pin import it without pulling in `panel-primitives` / card kinds.
 */

/** Default glyph edge in px — matches `CardJumpChevron`'s 10×10 chevron so the
 *  drop control sits flush beside it in the card header. */
const DEFAULT_SIZE = 10;

export function DropChevrons({
  size = DEFAULT_SIZE,
  className,
}: {
  /** Edge length in px (square). Defaults to 10 to match `CardJumpChevron`. */
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
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <polyline points="7 6 12 11 17 6" />
      <polyline points="7 13 12 18 17 13" />
    </svg>
  );
}
