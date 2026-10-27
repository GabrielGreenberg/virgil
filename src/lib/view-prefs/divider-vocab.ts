/**
 * The DIVIDER vocabulary — which heading depths can draw a divider, how wide
 * one is drawn, and the one rule for "which levels does this document have,
 * and which of those are on?"
 *
 * A zero-import leaf for the same reason `highlight-types.ts` is one (task
 * 677): the view-pref REGISTRY needs these lists at runtime (they are the
 * `members` of `dividerLevels` and the `values` of `dividerWidth`), and
 * `registry.ts` may not runtime-import `useViewPrefs`, which imports it. The
 * two unions used to be hand-typed in `useViewPrefs.ts` beside literal lists in
 * the registry, and "levels present" was derived twice — in `EditorLayout`
 * and the Reader's `reader-view-prefs` — each with its own literal `0..6`
 * bounds check (task 1318).
 *
 * The ARRAYS are the SSOT and the unions are DERIVED from them, so they can
 * never drift. `useViewPrefs` re-exports the types, so every existing
 * `from "@/hooks/useViewPrefs"` import keeps working.
 */

/** Heading depths 0–6, matching LaTeX (part … subparagraph). */
export const DIVIDER_LEVELS = [0, 1, 2, 3, 4, 5, 6] as const;
export type DividerLevel = (typeof DIVIDER_LEVELS)[number];

/** Heading-divider drawing widths. */
export const DIVIDER_WIDTHS = ["full", "mid", "text"] as const;
export type DividerWidth = (typeof DIVIDER_WIDTHS)[number];

const LEVEL_SET: ReadonlySet<number> = new Set(DIVIDER_LEVELS);

/** Whether `n` is a heading depth that can carry a divider. */
export function isDividerLevel(n: unknown): n is DividerLevel {
  return typeof n === "number" && LEVEL_SET.has(n);
}

/** The divider levels a document actually has, from its heading levels.
 *  Anything outside the vocabulary is dropped. Callers pass whatever heading
 *  source they already hold (the outline, a top-level walk) — the RULE is
 *  this one function. */
export function dividerLevelsPresent(levels: Iterable<unknown>): Set<DividerLevel> {
  const s = new Set<DividerLevel>();
  for (const l of levels) if (isDividerLevel(l)) s.add(l);
  return s;
}

/** The levels whose dividers are ON: the selected pref ∩ the levels present.
 *  Feeds the `show-dividers-N` root tokens (`chrome-config.ts`). */
export function activeDividerLevels(
  selected: Iterable<unknown>,
  present: ReadonlySet<DividerLevel>,
): Set<DividerLevel> {
  const s = new Set<DividerLevel>();
  for (const l of selected) if (isDividerLevel(l) && present.has(l)) s.add(l);
  return s;
}
