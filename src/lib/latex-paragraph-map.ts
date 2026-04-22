/**
 * Maps between LaTeX source lines and paragraph UUIDs embedded as
 * `%!v:<4-hex>` sidecar comments after each content block. Shared
 * between the code editor (scroll-to-paragraph) and consumers that
 * need to map error line numbers onto anchored paragraphs (error
 * margin markers).
 *
 * A UUID block starts at the first non-empty content line before the
 * `%!v:<hex>` marker and ends at the marker line itself. Pure comment
 * lines (`%` without a uuid tag) are skipped.
 */

export interface ParagraphUuidRange {
  uuid: string;
  /** 1-based first content line of the block. */
  startLine: number;
  /** 1-based line that carries the `%!v:<hex>` marker. */
  endLine: number;
}

export function findParagraphUuids(text: string): ParagraphUuidRange[] {
  const lines = text.split("\n");
  const out: ParagraphUuidRange[] = [];
  let contentStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") {
      contentStart = -1;
      continue;
    }
    const hasUuid = /%!v:[0-9a-f]{4}/.test(line);
    const isPureComment = line.startsWith("%") && !hasUuid;
    if (!isPureComment && contentStart === -1) contentStart = i;
    if (hasUuid) {
      const match = line.match(/%!v:([0-9a-f]{4})/)!;
      const start = contentStart === -1 ? i : contentStart;
      out.push({ uuid: match[1], startLine: start + 1, endLine: i + 1 });
      contentStart = -1;
    }
  }
  return out;
}

/** Returns the paragraph UUID whose `[startLine, endLine]` range covers
 *  the given 1-based line number, or `null` when no paragraph matches. */
export function paragraphForLine(
  ranges: ParagraphUuidRange[],
  line: number,
): string | null {
  if (line <= 0) return null;
  for (const r of ranges) {
    if (line >= r.startLine && line <= r.endLine) return r.uuid;
  }
  return null;
}
