/**
 * Neutral single-chevron-right glyph — the ">" "jump to source" mark.
 *
 * A hand-rolled `9 6 15 12 9 18` polyline in a `0 0 24 24` viewBox, sized +
 * stroked to match `DropChevrons` so the jump control reads as a sibling of
 * the drop chevron in any header row.
 *
 * Purely presentational — NO card / jump-target imports. This is a runtime
 * LEAF so every jump-button surface can share ONE glyph without a cycle or a
 * card-code dependency (it previously lived hand-triplicated, verbatim, at each
 * site with a drifting strokeWidth):
 *   - the docked card header (`CardJumpChevron`, panel-primitives.tsx),
 *   - the popped-float chrome button (`FloatChrome`) — which since task 437 is
 *     also the lift ghost's preview header, the third site having been the
 *     text-object `FloatHeaderContent` that mount retired.
 * Keeping it here (not in card code) lets the domain-neutral FloatChrome
 * import it without pulling in `panel-primitives` / card kinds.
 */

/** Default glyph edge in px — matches `DropChevrons`'s DEFAULT_SIZE so the
 *  jump control sits flush beside it in the card header. */
const DEFAULT_SIZE = 14;

export function JumpChevron({
  size = DEFAULT_SIZE,
  className,
}: {
  /** Edge length in px (square). Defaults to 14 to match `DropChevrons`. */
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
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
