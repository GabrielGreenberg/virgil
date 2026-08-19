/**
 * THE one answer to "which margin side does this card's chrome live on?"
 *
 * Every piece of margin chrome a card owns — its marginalia marker, the
 * kind-colored anchor rail painted beside its anchored paragraph, the re-pin
 * dock an orphan falls into — sits on ONE side, and that side is a property of
 * the card's owning PANEL: wherever the panel is docked right now, falling back
 * to the panel's registry default when it isn't docked at all.
 *
 * Before this module there were three hand-maintained answers and they were
 * only *coincidentally* equal:
 *
 *   1. `MARKER_META[type].defaultSide` — a per-row literal in `lib/marginalia`
 *      (deleted with this module's arrival: it was written and, once the grid
 *      called here instead, read by nothing).
 *   2. `inferMarginSide(cardKind)` in `links.ts` — a hardcoded
 *      `report|report-request → left, default → right` switch whose own
 *      docstring falsely claimed to read the panel registry.
 *   3. `PANEL_REGISTRY[panel].defaultStripSide` — the actual authority, which
 *      mirrors `useViewPrefs.DEFAULT_PREFS.placements`.
 *
 * …and only ONE of the two consumers was dock-aware. The marker grid resolved
 * `m.side ?? panelSides[panelId] ?? <row default>` and therefore FOLLOWED the
 * dock; the anchor rail read a `link.anchor.margin.side` frozen into the
 * sidecar at create time by (2) and therefore did not. Dock a right-default
 * panel to the LEFT and the marker moved while the rail stayed put — the two
 * "which side is this card's margin on?" answers visibly disagreeing on screen,
 * against a `globals.css` comment that states the rail paints "on the same side
 * as the margin marker."
 *
 * So: the resolution lives in ONE place, the DEFAULT is derived from the
 * registry rather than restated, and both consumers call the same function with
 * the same live dock map. Since task 381 that one place is `@/lib/panel-side`
 * — the margin was not the only surface asking "which side is this panel on?"
 * (the strip filter and the omni COLUMN ask it too), so the ladder moved to a
 * leaf all three can read and this module became the CARD-CHROME door onto it:
 * it keeps the marker-type and card-kind keying, which is what margin chrome
 * needs and what the layout surfaces do not.
 *
 * The frozen `link.anchor.margin` field is gone — a stored, dock-blind copy of
 * a live answer is the drift-bomb this module exists to defuse, and a field
 * nothing reads is worse than no field at all (AGENTS.md, "A registry earns its
 * name by being read").
 *
 * **Cycle-safe by construction**: the three runtime imports are `panel-side`
 * (whose own only runtime edge is `PANEL_REGISTRY` → `card-registry` +
 * `float-key`, both type-only leaves), `CARD_REGISTRY` (type-only imports
 * throughout), and `panelForMarkerType` (`cards/marker-meta` →
 * `card-registry`). It imports nothing from `@/lib/marginalia` (whose grid
 * imports THIS module) and nothing from `@/links/**` (which imports it for the
 * rail). `panel-registry` must stay runtime-light: its `CARD_THEMES` import is
 * deliberately type-only, and turning that into a value import would drag the
 * whole card-UI module in here and into both consumers.
 */

import type { PanelKind } from "@/panels/_shared/types";
import type { CardKind, MarkerType } from "@/cards/types";
import { panelForMarkerType } from "@/cards/marker-meta";
import { CARD_REGISTRY } from "@/cards/card-registry";
import {
  defaultPanelSide,
  resolvePanelSide,
  type PanelSideMap,
} from "@/lib/panel-side";

/** Which side each panel is placed on right now. Re-exported from the
 *  `panel-side` leaf so the many `@/lib/margin-side` importers keep one import
 *  site; the TYPE is owned there, beside the resolution that reads it. */
export type { PanelSideMap };

/** The side a card's chrome takes when its panel isn't docked anywhere.
 *
 *  Derived from `PANEL_REGISTRY[panel].defaultStripSide` — the same field the
 *  strips themselves default to — so a panel that changes its home side moves
 *  its markers and rails with it.
 *
 *  The leaf's `?? "right"` last rung is UNREACHABLE from card chrome and pinned
 *  as such: `omni` is the only
 *  registry entry with a `null` strip side (it is a backdrop, not a strip) and
 *  no `CardKind` names it — asserted per kind and per marker type in
 *  `margin-side-ssot.test.tsx`, so a future kind whose panel has no strip side
 *  fails there rather than being quietly railed right while its panel sits
 *  left. Without that leg this line would be a silent guess, which is the shape
 *  of defect this module exists to remove. */
export function defaultMarginSideForPanel(panel: PanelKind): "left" | "right" {
  return defaultPanelSide(panel);
}

/**
 * The core resolution, in precedence order: an explicit per-item override wins,
 * else the panel's LIVE dock, else the registry default.
 *
 * This is exactly the ladder the marginalia grid has always run — it is lifted
 * here verbatim so the anchor rail can run the same one instead of reading a
 * frozen copy.
 */
export function resolveMarginSide(
  panel: PanelKind,
  panelSides: PanelSideMap,
  override?: "left" | "right" | null,
): "left" | "right" {
  return resolvePanelSide(panel, panelSides, override);
}

/** The margin side for a marginalia marker namespace (`MarkerType`). The panel
 *  is registry-derived (`panelForMarkerType`), so a marker and the card kinds
 *  sharing its namespace can never land on different sides. */
export function marginSideForMarkerType(
  type: MarkerType,
  panelSides: PanelSideMap,
  override?: "left" | "right" | null,
): "left" | "right" {
  return resolveMarginSide(panelForMarkerType(type), panelSides, override);
}

/**
 * The margin side for a card kind — the answer the anchor rail needs, and the
 * replacement for `inferMarginSide`.
 *
 * Keyed on the card's own `CARD_REGISTRY.panel` rather than on its marker type,
 * so it is total over `CardKind`: the five kinds with NO marker at all
 * (`highlight`, `footnote`, `citation`, `bib`, `example`) still have a panel,
 * and therefore still have a well-defined side for the chrome they DO paint.
 * For every kind that has a marker the two routes agree by construction —
 * `panelForMarkerType` is derived from this same registry column and asserted
 * unique per type (`assertMarkerCoverage`).
 */
export function marginSideForCardKind(
  kind: CardKind,
  panelSides: PanelSideMap,
): "left" | "right" {
  const panel = CARD_REGISTRY[kind]?.panel;
  // A kind with no panel has no margin home; "right" matches the app-wide
  // fallback rather than inventing a side.
  if (!panel) return "right";
  return resolveMarginSide(panel, panelSides);
}
