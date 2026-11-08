/**
 * Task 1532 — a field that renders from a SNAPSHOT and writes on a later
 * gesture commits the user's EDIT, never the user's whole string.
 *
 * An inline rename box is seeded once, when it opens. While the user types,
 * the live value can move under it — another pane, an AI writeback, an undo
 * elsewhere. Writing the draft over the live value then silently reverts that
 * foreign change ("Intro" → user types "Introduction"; meanwhile the heading
 * became "Intro to X"; the commit writes "Introduction" and " to X" is gone).
 *
 * The honest commit is a three-way one, on text: the user's edit is the one
 * hunk `seed → draft`; the foreign edit is the one hunk `seed → live`. When
 * the two touch disjoint spans of the seed, the user's hunk is replayed onto
 * the live text, which keeps the foreign change. When they overlap (or meet at
 * one point — whose text goes first is a guess), there is no honest merge, and
 * the answer is `null`: the caller REFUSES and says so (`announceEditRefused`,
 * reason "changed") rather than choosing a winner.
 *
 * Hunks are the common-prefix / common-suffix middle, which is exactly the
 * span a single typing session in a one-line box replaces.
 */

interface Hunk {
  /** Start of the replaced span, in SEED coordinates. */
  from: number;
  /** End (exclusive) of the replaced span, in SEED coordinates. */
  to: number;
  /** The text that replaces it. */
  text: string;
}

function hunkOf(seed: string, next: string): Hunk {
  let p = 0;
  while (p < seed.length && p < next.length && seed[p] === next[p]) p++;
  let s = 0;
  while (
    s < seed.length - p &&
    s < next.length - p &&
    seed[seed.length - 1 - s] === next[next.length - 1 - s]
  ) s++;
  return { from: p, to: seed.length - s, text: next.slice(p, next.length - s) };
}

/**
 * The text to write so that `live` receives the user's `seed → draft` edit.
 * `live` itself when the user changed nothing; `draft` when nothing else
 * moved; `null` when the user's edit and a foreign one overlap.
 */
export function rebaseTextEdit(seed: string, draft: string, live: string): string | null {
  if (draft === seed) return live;
  if (live === seed || live === draft) return draft;
  const mine = hunkOf(seed, draft);
  const theirs = hunkOf(seed, live);
  // Closed-interval test: a shared boundary is a conflict too (two insertions
  // at one point have no stated order).
  if (mine.from <= theirs.to && theirs.from <= mine.to) return null;
  // Below the foreign hunk, seed and live coincide; above it, they differ by
  // a constant offset.
  const shift = mine.from > theirs.to ? live.length - seed.length : 0;
  return live.slice(0, mine.from + shift) + mine.text + live.slice(mine.to + shift);
}
