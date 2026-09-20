/**
 * The HIGHLIGHT vocabulary — which card kinds' linked-anchor highlights the
 * Highlights menu can turn off.
 *
 * A zero-import leaf, and that is the whole reason it is its own module: the
 * view-pref REGISTRY needs this list at runtime (it is the declared value
 * DOMAIN of `hiddenHighlightTypes` — see `coerceRegistryPrefs`), and
 * `registry.ts` may not runtime-import `useViewPrefs`, which imports it. The
 * list used to live in `useViewPrefs.ts`, so the registry could only have
 * re-spelled it by hand — a fourth hand list of a union, which is exactly the
 * shape task 672 deleted one field over.
 *
 * `useViewPrefs` re-exports both names, so every existing
 * `from "@/hooks/useViewPrefs"` import keeps working.
 */

/** Card kinds whose linked-anchor highlights are togglable from the Highlights
 *  menu. Values match the prefix of `data-link-card`.
 *
 *  The ARRAY is the SSOT and `HighlightType` is DERIVED from it, so the two can
 *  never drift: adding a kind here flows straight into the union. The inverse
 *  shape (a hand-typed union + a `HighlightType[]`-annotated array) could not be
 *  made safe — the annotation permits a *proper subset*, so a kind added to the
 *  union while the array stayed stale would compile clean yet silently never
 *  render its highlights at the `ALL_HIGHLIGHT_TYPES` consumer (EditorLayout's
 *  `visibleHighlightKinds`). Deriving closes that omission direction for good. */
export const ALL_HIGHLIGHT_TYPES = [
  "note",
  "todo",
  "comment",
  "cut",
  "report",
] as const;
export type HighlightType = (typeof ALL_HIGHLIGHT_TYPES)[number];
