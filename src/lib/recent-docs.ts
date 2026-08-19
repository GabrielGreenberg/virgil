/**
 * "Recent papers, most recent first" — the ONE derivation every recents
 * surface reads.
 *
 * Two surfaces show the same list and had each hand-written the same
 * filter → sort → slice pipeline: the start screen's `RecentPapersList`
 * and the tab strip's `TabPlusMenu` dropdown. They were byte-identical
 * apart from the row count, so the two could only agree about the rule
 * for as long as nobody changed one of them — the twin-fork shape
 * AGENTS.md keeps recording. What genuinely differs per surface is HOW
 * MANY rows fit, so that is what each surface states (below), and
 * nothing else.
 *
 * `limit` is REQUIRED: a defaulted row count is a decision nobody made,
 * and the two callers legitimately want different ones.
 */

import type { FsaDocMeta } from "@/lib/doc-index";

/**
 * Start screen (the empty state). A full-height centred column, so it can
 * afford ten rows without crowding the action lozenges beneath it.
 */
export const RECENT_PAPERS_START_SCREEN_LIMIT = 10;

/**
 * The tab-strip "+" dropdown. Deliberately shorter than the start screen:
 * it is a menu the user is arrow-keying through, not a landing page.
 */
export const RECENT_PAPERS_MENU_LIMIT = 5;

/** Invalid / missing timestamps sort LAST rather than shuffling. */
function accessedAt(doc: FsaDocMeta): number {
  const t = Date.parse(doc.lastAccessedAt);
  return Number.isFinite(t) ? t : -Infinity;
}

export function selectRecentDocs(
  docs: readonly FsaDocMeta[],
  { excludeIds, limit }: { excludeIds?: readonly string[]; limit: number },
): FsaDocMeta[] {
  const exclude = new Set(excludeIds ?? []);
  return [...docs]
    .filter((d) => !exclude.has(d.id))
    .sort((a, b) => accessedAt(b) - accessedAt(a))
    .slice(0, limit);
}
