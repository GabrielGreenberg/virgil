/**
 * Whole-paragraph snapshot normalization — the SAME canonical form used at
 * BOTH ends of the anchor-recovery snapshot match (CHIP-D):
 *
 *   - capture side: `captureParagraphSnapshot` (`links.ts`) stores snapshots
 *     in this form;
 *   - match side: `buildResolveIndex` (`resolve-card-anchor.ts`) normalizes
 *     live `textContent` into its snapshot map and normalizes a card's stored
 *     snapshot before lookup.
 *
 * Lives in this leaf module (no imports from `links.ts` / `resolve-card-anchor.ts`)
 * so both can depend on it without a circular import. `resolve-card-anchor.ts`
 * re-exports `normalizeParagraphText` to keep its public-API contract.
 */

/** Zero-width characters stripped before comparison: ZWSP (U+200B),
 *  ZWNJ (U+200C), ZWJ (U+200D), word-joiner (U+2060), and the BOM /
 *  zero-width no-break space (U+FEFF). Written as explicit code-point
 *  escapes so the source has no invisible characters. */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

/**
 * Canonical form for whole-paragraph snapshot comparison: trim the ends,
 * collapse every internal whitespace run to a single space, and strip
 * zero-width characters. This is the SAME normalization the resolve index
 * applies to live `textContent`, so a snapshot captured through the same
 * function compares equal across LaTeX round-trip whitespace drift.
 */
export function normalizeParagraphText(s: string): string {
  return s.replace(ZERO_WIDTH_RE, "").replace(/\s+/g, " ").trim();
}
