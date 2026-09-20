/**
 * The STRUCTURAL half of the view-prefs global vocabulary.
 *
 * "Which prefs are global, and which of those promote into the shipped
 * defaults?" is one question with two halves. The registry half
 * (`./registry.ts`) has always answered it by DERIVATION: `scope: "global"`
 * says a key rides the global blob, `promote: false` says its shipped default
 * is frozen, and `REGISTRY_PROMOTED_GLOBAL_KEYS` falls out of the two. The
 * other half — page geometry, strip placements, omni filters, print options —
 * lived as a flat string array with no promotion fact at all, so whether a
 * structural key reached `dev-prefs-registry.json`'s whitelist was decided by
 * hand and guarded by nothing. `codePaneRatio` was simply forgotten there for
 * as long as it has existed (task 676).
 *
 * So this table carries the SAME fact the registry's `promote` flag carries,
 * in the same shape, and both halves feed one two-way guard
 * (`view-menu-registry-source.test.ts`): the whitelist must equal
 * `REGISTRY_PROMOTED_GLOBAL_KEYS ∪ STRUCTURAL_PROMOTED_GLOBAL_KEYS`, no more
 * and no less. A structural global added below without a `promote` decision
 * fails to compile; one added with `promote: true` and left off the whitelist
 * fails the guard. "Forgotten" is no longer representable — an omission is now
 * a declared exemption with a stated reason.
 *
 * Dependency-light by construction (zero imports), like its registry sibling:
 * `useViewPrefs` imports it, never the other way round, and a Node-environment
 * guard can read it without standing up jsdom or mocking `@/lib/storage`.
 */

/** A structural global's promotion fact. `why` is REQUIRED on an exemption —
 *  the difference between "deliberately excluded" and "forgotten" is exactly
 *  what this table exists to make visible. */
type StructuralGlobalDef =
  | { promote: true }
  | { promote: false; why: string };

/**
 * Structural (non-registry) global keys — page geometry, strip placements,
 * omni filters, print options — each with whether it participates in the
 * personal-prefs promotion pipeline.
 *
 * The registry-owned global keys (`showMarginalia`, `dividerLevels`,
 * highlights, …) are NOT here: they are appended from `REGISTRY_GLOBAL_KEYS`
 * so "is this pref global?" is decided in ONE place per half, never
 * re-asserted by hand.
 */
export const STRUCTURAL_GLOBAL_PREFS = {
  printOptions: {
    promote: false,
    why: "promoted through its own `print-options` entry in dev-prefs-registry.json (a whole sub-blob, not a top-level key), so whitelisting it too would fold it twice",
  },
  placements: { promote: true },
  pageWidth: { promote: true },
  editorLeftMargin: { promote: true },
  editorRightMargin: { promote: true },
  editorTopMargin: { promote: true },
  editorBottomMargin: { promote: true },
  // The Code-pane splitter ratio: the same "tune once, want it everywhere"
  // measure as `pageWidth` and the four margins beside it, and persisted
  // globally for exactly that reason (`ViewPrefs.codePaneRatio`).
  codePaneRatio: { promote: true },
  omniHiddenCategories: { promote: true },
  omniHideAllCards: { promote: true },
  appliedPrefMigrations: {
    promote: false,
    why: "a fresh profile has applied nothing; baking a migration id into the shipped defaults would mark it done for every new user",
  },
} as const satisfies Record<string, StructuralGlobalDef>;

export type StructuralGlobalPrefKey = keyof typeof STRUCTURAL_GLOBAL_PREFS;

/** Every structural global key, in declaration order. */
export const STRUCTURAL_GLOBAL_PREF_KEYS = Object.keys(
  STRUCTURAL_GLOBAL_PREFS,
) as StructuralGlobalPrefKey[];

/** The structural globals that participate in the promotion pipeline — the
 *  structural twin of `REGISTRY_PROMOTED_GLOBAL_KEYS`. Together the two are
 *  the SSOT the `dev-prefs-registry.json` whitelist must equal. */
export const STRUCTURAL_PROMOTED_GLOBAL_KEYS = STRUCTURAL_GLOBAL_PREF_KEYS.filter(
  (k) => STRUCTURAL_GLOBAL_PREFS[k].promote,
);

/** The declared exemptions, with their reasons — what the guard reports when
 *  an exempt key turns up on the whitelist anyway. */
export const STRUCTURAL_PROMOTION_EXEMPT: ReadonlyArray<{
  key: StructuralGlobalPrefKey;
  why: string;
}> = STRUCTURAL_GLOBAL_PREF_KEYS.flatMap((k) => {
  const def = STRUCTURAL_GLOBAL_PREFS[k] as StructuralGlobalDef;
  return def.promote ? [] : [{ key: k, why: def.why }];
});
