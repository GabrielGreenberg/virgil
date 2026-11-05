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
 *  render its highlights at the `ALL_HIGHLIGHT_TYPES` consumer
 *  (`visibleHighlightKinds` / `LINK_ANCHOR_KINDS` in
 *  `src/links/_shared/useLinkHighlight.ts`, which derive the root-attribute
 *  vocabulary from this array — task 1316). Deriving closes that omission
 *  direction for good. */
export const ALL_HIGHLIGHT_TYPES = [
  "note",
  "todo",
  "comment",
  "cut",
  "report",
] as const;
export type HighlightType = (typeof ALL_HIGHLIGHT_TYPES)[number];

/**
 * The highlight types the Highlights menu deliberately offers NO hide row for —
 * the DECLARED opt-out, mirroring `NON_HIDEABLE_MARKER_TYPES` (task 1476). The
 * menu's rows are `ALL_HIGHLIGHT_TYPES` minus this set, derived, so a new
 * highlight type gets a row by default and leaving one out is a visible edit
 * here rather than a silent omission from a hand-typed member list.
 *
 * `report`: the Reports panel's anchors highlight, but the menu has offered no
 * row for them since the Quotations → Reports swap (21c9ef9e); the reason was
 * never recorded. Stating it here keeps today's menu byte-identical — the
 * stored pref still accepts `report` (`ALL_HIGHLIGHT_TYPES` is the value
 * domain), only the menu row is withheld.
 */
export const NON_MENU_HIGHLIGHT_TYPES = [
  "report",
] as const satisfies readonly HighlightType[];

/** A highlight type the Highlights menu renders a hide row for. */
export type MenuHighlightType = Exclude<
  HighlightType,
  (typeof NON_MENU_HIGHLIGHT_TYPES)[number]
>;

/** `ALL_HIGHLIGHT_TYPES` minus the declared opt-out, in array order — the SSOT
 *  `VIEW_PREF_REGISTRY.hiddenHighlightTypes.members` is derived from. */
export const MENU_HIGHLIGHT_TYPES: readonly MenuHighlightType[] =
  ALL_HIGHLIGHT_TYPES.filter(
    (t): t is MenuHighlightType =>
      !(NON_MENU_HIGHLIGHT_TYPES as readonly HighlightType[]).includes(t),
  );
