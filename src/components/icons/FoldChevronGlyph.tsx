/**
 * The fold chevron's glyph for React renderers — the source pod's collapse
 * chevron and the Outline panel's row/pod twisties. It spreads the ONE glyph
 * table in `src/lib/fold-chevron.ts` (`FOLD_CHEVRON_GLYPH`), which the vanilla
 * heading NodeView reads through `buildFoldChevronSvg` — so both renderers
 * draw one declaration (task 1260). Purely presentational.
 */
import { FOLD_CHEVRON_GLYPH } from "@/lib/fold-chevron";

export function FoldChevronGlyph({
  size = FOLD_CHEVRON_GLYPH.size,
  className,
}: {
  /** Edge length in px (square). Defaults to 12. */
  size?: number;
  className?: string;
}) {
  // React wants camelCase SVG props; the table is keyed by DOM names for the
  // vanilla builder, so map each one here (no hyphenated-prop dev warning).
  const a = FOLD_CHEVRON_GLYPH.attrs;
  return (
    <svg
      width={size}
      height={size}
      viewBox={FOLD_CHEVRON_GLYPH.viewBox}
      fill={a.fill}
      stroke={a.stroke}
      strokeWidth={a["stroke-width"]}
      strokeLinecap={a["stroke-linecap"]}
      strokeLinejoin={a["stroke-linejoin"]}
      aria-hidden={a["aria-hidden"]}
      className={className}
    >
      <path d={FOLD_CHEVRON_GLYPH.path} />
    </svg>
  );
}
