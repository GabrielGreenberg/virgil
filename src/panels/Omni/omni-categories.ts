/**
 * The omni CATEGORY vocabulary — which panels have omni cards, which COLUMN
 * each renders in, and which are currently VISIBLE.
 *
 * An import-free-ish leaf (`panel-registry` + `panel-side`, both runtime-light)
 * so `useViewPrefs`, the Reader's derivation module and the parity suites can
 * read it without pulling the `OmniViewPanel` React component — and its
 * `@tiptap`, cascade and card-spine graph — into their own. `OmniViewPanel`
 * re-exports every name for the consumers that already import from it.
 *
 * ## The side is DERIVED (task 381)
 *
 * A category's column is not a stored fact: it is the LIVE strip side of the
 * panel that owns it (`resolvePanelSide` over `prefs.placements`), which is the
 * same ladder the margin markers and the strip icons read. Before this,
 * `prefs.omniCategories` was a per-SIDE pair of enabled-category lists seeded
 * once from a `registry.omniSide` column — user state that never re-derived, so
 * dragging a panel's strip icon across moved its markers and left its omni
 * cards in the old column. `deriveCategorySides` already existed and answered
 * the right question for the FILTER MENU's chip list alone; the card columns
 * read the stored table.
 *
 * So `omniCategories` became side-free VISIBILITY —
 * `prefs.omniHiddenCategories`, a hidden SET — and the two facts are combined
 * here, once, by `omniCategoriesForSide`. Hidden-as-the-stored-value rather
 * than enabled: a newly omni-eligible panel is then visible by declaration,
 * with no migration and no default list to keep in step.
 */

import { OMNI_PANELS, getPanelByCardKind } from "@/panels/panel-registry";
import type { PanelKind, CardKind } from "@/panels/_shared/types";
import type { Side } from "@/hooks/useViewPrefs";
import { APPLIED_SPLICE_KIND_LIST } from "@/cards/lifecycle/applied-splice";
import {
  defaultPanelSide,
  panelSidesFromPlacements,
  resolvePanelSide,
  type SidedPlacement,
} from "@/lib/panel-side";

/** Category keys are PanelKinds. The omni filter menu shows one row per
 *  omni-eligible panel. */
export type OmniCategory = PanelKind;

export const OMNI_CATEGORIES: OmniCategory[] = OMNI_PANELS.map((p) => p.kind);

export const CATEGORY_LABELS: Partial<Record<PanelKind, string>> = Object.fromEntries(
  OMNI_PANELS.map((p) => [p.kind, p.label]),
);

/** Identity map kept for back-compat with callers that still import it.
 *  PanelKind is now the category key, so the "panel→category" mapping is
 *  trivially the panel's own kind. */
export const PANEL_TO_CATEGORY: Record<string, OmniCategory> = Object.fromEntries(
  OMNI_PANELS.map((p) => [p.kind, p.kind]),
);

/** Maps legacy omni filter values (2-char prefixes from the very first
 *  build, then full CardKind strings from a later build) to the current
 *  PanelKind taxonomy. Run on first load to migrate persisted localStorage
 *  state. */
const LEGACY_PREFIX_TO_PANEL: Record<string, PanelKind> = {
  // Earliest build — 2-char prefixes
  fn: "footnotes",
  ci: "citations",
  nt: "notes",
  ar: "archive",
  td: "todo",
};

/** Translate a possibly-legacy omni filter list to current PanelKinds.
 *  Drops any entries that don't resolve to a known omni-eligible panel.
 *  Idempotent: passing already-current PanelKind values returns them
 *  unchanged. */
export function migrateOmniCategories(list: unknown): OmniCategory[] {
  if (!Array.isArray(list)) return [];
  const out: OmniCategory[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    let panel: PanelKind | null = null;
    // Already a PanelKind?
    if (OMNI_CATEGORIES.includes(raw as PanelKind)) {
      panel = raw as PanelKind;
    } else if (raw in LEGACY_PREFIX_TO_PANEL) {
      panel = LEGACY_PREFIX_TO_PANEL[raw];
    } else {
      // Try as a CardKind from the previous taxonomy
      const owner = getPanelByCardKind(raw as CardKind);
      if (owner && owner.omniEligible) panel = owner.kind;
    }
    if (panel && !out.includes(panel)) out.push(panel);
  }
  return out;
}

/**
 * Derive each omni-eligible panel's current strip side from
 * `useViewPrefs.placements` — the ONE ladder (`@/lib/panel-side`), so the omni
 * column, the strip icon and the margin marker cannot disagree about where a
 * panel is. A category with no placement falls back to the panel's registry
 * `defaultStripSide`.
 */
export function deriveCategorySides(
  placements: readonly SidedPlacement[],
): Record<OmniCategory, Side> {
  const sides = panelSidesFromPlacements(placements);
  const result = {} as Record<OmniCategory, Side>;
  for (const p of OMNI_PANELS) {
    result[p.kind] = resolvePanelSide(p.kind, sides);
  }
  return result;
}

/**
 * The ONE side that hosts the applied-pending NAVIGATOR (task 420) — the sticky
 * prev/next + Keep-all / Dismiss-all header over every applied pending AI
 * change in the document.
 *
 * ## Placement decides WHERE; visibility decides NOTHING
 *
 * The count of unreviewed applied changes is a fact about the DOCUMENT (live
 * light-blue ranges in the user's `.tex`), not a card-filter preference — the
 * same class of fact as an unanchored card (task 410's chip reads the
 * UNFILTERED marker set) or a save refusal (task 357's notice renders before
 * the collapse gate). So this resolver reads only the derived category SIDES
 * (`deriveCategorySides`, the task-381 ladder) and never the hidden set: hiding
 * Revisions and Cutter in the filter menu cannot move or remove the header.
 * Pre-420 the host gated on `enabledForSide.has("revisions") ||
 * enabledForSide.has("cutter")` — a per-side VIEW-FILTER predicate, so the
 * header rendered TWICE when the two panels sat on opposite strips (both sides
 * passed the `||`, one shared cursor driven from two navigators) and NOWHERE
 * when either strip's filter hid both, taking the only document-wide review
 * affordance with it.
 *
 * ## Derived from the family SSOT, with a STATED tie-break
 *
 * The panels that can hold an applied change are exactly the owners of
 * `PendingChangeFamily` (`APPLIED_SPLICE_KIND_LIST`, task 238 — a third family
 * member is a compile error there, and is covered here by declaration). When
 * those panels sit on different strips the header follows the FIRST family in
 * that list (`revision-suggestion` → Revisions), because the revision family
 * is the larger producer of applied changes. A decision, not an accident of
 * `||` order; a panel with no omni column falls back to its registry default.
 */
export function appliedPendingSide(categorySides: Partial<Record<OmniCategory, Side>>): Side {
  for (const kind of APPLIED_SPLICE_KIND_LIST) {
    const panel = getPanelByCardKind(kind);
    if (!panel) continue;
    return categorySides[panel.kind] ?? defaultPanelSide(panel.kind);
  }
  // Unreachable while the family is non-empty (pinned by applied-splice's
  // own coverage suite); the registry default keeps the type total.
  return "right";
}

/**
 * The categories whose cards render in `side`'s omni column right now: the
 * ones this side OWNS (derived) minus the ones the user has HIDDEN
 * (side-free).
 *
 * This is the single combination point — both hosts (`EditorLayout` and the
 * Reader's `reader-view-prefs`) call it, so a card's column and its filter
 * chip are answered from one place. The Set is what `OmniViewPanel` filters
 * its items by and what the filter menu shows as checked, so a category
 * "enabled" on a side is exactly "visible AND placed here".
 */
export function omniCategoriesForSide(
  categorySides: Record<OmniCategory, Side>,
  hidden: readonly OmniCategory[],
  side: Side,
): Set<OmniCategory> {
  const hiddenSet = new Set<string>(hidden);
  const out = new Set<OmniCategory>();
  for (const c of OMNI_CATEGORIES) {
    if (hiddenSet.has(c)) continue;
    if ((categorySides[c] ?? defaultPanelSide(c)) === side) out.add(c);
  }
  return out;
}

/** The categories this side owns, ignoring visibility — the filter menu's row
 *  list, and the set "reset to default" makes visible again. */
export function omniCategoriesOnSide(
  categorySides: Record<OmniCategory, Side>,
  side: Side,
): OmniCategory[] {
  return OMNI_CATEGORIES.filter((c) => (categorySides[c] ?? defaultPanelSide(c)) === side);
}

/**
 * Fold a pre-381 per-side enabled-list blob (`{ left: [...], right: [...] }`)
 * to the side-free HIDDEN set: a category absent from BOTH stored sides was
 * switched off by the user, and everything else was visible somewhere.
 *
 * Runs both legacy values through `migrateOmniCategories`, so a blob carrying
 * the even older 2-char prefixes or CardKind strings folds correctly rather
 * than reading as "everything hidden". Non-object input ⇒ nothing hidden, which
 * is the fail-open direction: a category wrongly hidden is invisible user data,
 * a category wrongly shown is one click to hide.
 */
export function hiddenFromLegacySides(legacy: unknown): OmniCategory[] {
  // An ARRAY is a malformed shape, not an empty pair of sides — and reading it
  // as one would hide every category. Fail OPEN: hidden data is invisible, a
  // shown category is one click away.
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return [];
  const src = legacy as { left?: unknown; right?: unknown };
  const enabled = new Set<string>([
    ...migrateOmniCategories(src.left),
    ...migrateOmniCategories(src.right),
  ]);
  return OMNI_CATEGORIES.filter((c) => !enabled.has(c));
}
