/**
 * THE one answer to "which side of the page is this PANEL on?"
 *
 * A panel has exactly ONE side at any moment: wherever the user has dragged its
 * strip icon (`useViewPrefs.placements[].side`), falling back to the panel's
 * registry default (`PANEL_REGISTRY[panel].defaultStripSide`) when it has no
 * placement at all. Everything a panel paints — its strip icon, its docked
 * band, its cards' margin markers, the kind-colored anchor rail, the omni
 * COLUMN its cards render in, the filter chips that list it — is downstream of
 * that one fact and must DERIVE from it.
 *
 * ## Why this module exists (task 381)
 *
 * Task 205 retired three hand-maintained answers for the MARGIN chrome and put
 * them behind `resolveMarginSide` (`@/lib/margin-side`, which now delegates
 * here). It did not reach the other two surfaces, and each kept spelling the
 * ladder itself:
 *
 *   1. The strip-item filter (`EditorPane`) inlined
 *      `placed?.side ?? PANEL_REGISTRY[k]?.defaultStripSide ?? "right"`.
 *   2. The omni COLUMN did not derive at all. Which column a category's cards
 *      rendered in came from `prefs.omniCategories[side]` — stored per-side
 *      enabled-category lists, seeded once from a `registry.omniSide` column
 *      and never re-derived. So dragging a panel's strip icon across moved its
 *      markers (205's ladder) and left its omni cards behind (a stored list),
 *      the two-renderers fork this codebase keeps retiring one lane at a time
 *      (362 pin half, 369 resolution half).
 *
 * The derivation that answers the right question ALREADY EXISTED —
 * `deriveCategorySides(placements)` — and its only consumer was the filter
 * menu's chip list: a half-consumed SSOT decorating the filter UI while the
 * card columns read the stored table (the task-273 "a helper only SOME siblings
 * call is not an SSOT" shape).
 *
 * So: the ladder lives here once, the DEFAULT is derived from the registry
 * rather than restated, and every surface reads it. `registry.omniSide` and the
 * per-side halves of `omniCategories` retired with it — a second side table is
 * a stored, drag-blind copy of a live answer, which is the drift-bomb this
 * module exists to defuse.
 *
 * **Import-light leaf by construction.** The only runtime import is
 * `PANEL_REGISTRY` (`panel-registry` → `card-registry` + `float-key`, both
 * type-only leaves). It imports nothing from `@/lib/margin-side` (which imports
 * THIS), nothing from `@/hooks/useViewPrefs` beyond types, and nothing from the
 * panel components — so the omni vocabulary, the marginalia grid, the links
 * layer and the prefs hook can all take it without dragging React or storage
 * into their graphs. A facet the layer that needs it cannot import will be
 * re-copied, every time (the `latex-markers` / `node-attr-sets` placement rule).
 */

import type { PanelId, Side } from "@/hooks/useViewPrefs";
import type { PanelKind } from "@/panels/_shared/types";
import { PANEL_REGISTRY } from "@/panels/panel-registry";

/** Which side each panel is placed on right now. A missing entry (or `null`)
 *  means "no placement" → the registry default decides. */
export type PanelSideMap = Partial<Record<PanelId, Side | null>>;

/** The minimal placement shape this module reads. Structurally satisfied by
 *  `useViewPrefs.PanelPlacement`; stated locally so a test (or the Reader's
 *  synthetic list) can pass a plain literal without importing the hook. */
export interface SidedPlacement {
  id: string;
  side: Side;
}

/** The side a panel takes when it has no placement.
 *
 *  Derived from `PANEL_REGISTRY[panel].defaultStripSide` — the same field the
 *  strips themselves default to — so a panel that changes its home side moves
 *  its icon, its markers, its rails AND its omni cards together.
 *
 *  The `?? "right"` covers the registry's one `null` strip side (`omni`, a
 *  backdrop rather than a strip); `margin-side-ssot.test.tsx` pins that no
 *  `CardKind` and no `MarkerType` can reach it, so for card chrome it is
 *  unreachable rather than a silent guess. */
export function defaultPanelSide(panel: PanelKind): Side {
  return PANEL_REGISTRY[panel]?.defaultStripSide ?? "right";
}

/** Build the live side map from `useViewPrefs.placements`.
 *
 *  Kept separate from `resolvePanelSide` so a consumer that answers the
 *  question for MANY panels (the marginalia grid, the omni category map) pays
 *  the O(placements) walk once and then reads O(1), and so the two callers
 *  cannot disagree about how a placement list becomes a map. */
export function panelSidesFromPlacements(
  placements: readonly SidedPlacement[],
): PanelSideMap {
  const out: Record<string, Side | null> = {};
  for (const p of placements) out[p.id] = p.side;
  return out as PanelSideMap;
}

/**
 * The core resolution, in precedence order: an explicit per-item override
 * wins, else the panel's LIVE placement, else the registry default.
 *
 * The `override` rung exists for the one consumer that has a per-ITEM opinion
 * — a marginalia marker may carry its own `side` — and is `undefined` for the
 * layout surfaces, which have no item to override with.
 */
export function resolvePanelSide(
  panel: PanelKind,
  panelSides: PanelSideMap,
  override?: Side | null,
): Side {
  return override ?? panelSides[panel] ?? defaultPanelSide(panel);
}
