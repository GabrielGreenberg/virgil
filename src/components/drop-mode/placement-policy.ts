/**
 * Placement policy — WHICH of a spec's declared placements wins at a given
 * cursor geometry, and (the same question read backwards) which of them can
 * ever win at all.
 *
 * This module exists because the answer used to live INSIDE the hit-test's
 * priority loop, where nothing could check it (task 258). `stackPullDropSpec`
 * declared `["between-blocks", "inline-cursor", "paragraph-side"]` and the loop
 * returned the first geometry-matching entry — but `inGap` / `inText` are an
 * EXACT partition of every cursor position, so index 0 or index 1 always
 * matched first and **`paragraph-side` was structurally unreachable**. Pulling a
 * note/todo/archive card out of the Stack onto a paragraph therefore painted an
 * inline caret (index 1's placement) and then silently no-op'd at commit, where
 * the spec's own per-payload validity check refused `inline-cursor` for a card.
 * The `paragraph-side` arm of that check and the whole `paragraphId` anchoring
 * branch behind it were dead code: the card could never anchor to a paragraph,
 * the capability the spec advertised.
 *
 * Two structural rules fall out, and both live here:
 *
 *  - **The priority semantics are ONE function.** {@link winningPlacementKind}
 *    IS the hit-test's loop (minus the geometry builders), so the reachability
 *    guard below reads exactly the rule the runtime follows and cannot drift
 *    from it. A guard that re-states the loop is a second copy of the thing
 *    that was wrong.
 *  - **A static priority order cannot answer a PER-PAYLOAD question.** When one
 *    spec key covers several payload shapes (stack-pull: a text slice, a
 *    paragraph, a heading, a card), the placement a payload wants over the same
 *    pixel differs — a text slice wants the inline caret, a card wants the
 *    paragraph side. So a spec may narrow its list per payload through
 *    `DropSpec.placementsFor`, resolved ONCE per session by
 *    {@link resolveSessionPlacements} (the payload cannot change mid-drag, and
 *    the resolution may read persisted state — it must never run per
 *    pointermove).
 */

import type { DropSpec, PlacementKind } from "./types";

/**
 * The cursor's relationship to the resolved anchorable block, as the hit-test
 * classifies it: inside the block's text rect (`"text"`) or in the gap between
 * blocks (`"gap"`). These are an EXACT partition — `inGap === !inText` — which
 * is precisely why a list's ORDER decides reachability.
 */
export type PlacementGeometry = "gap" | "text";

/**
 * The placement kind the hit-test's priority loop picks for `geometry`, or null
 * when nothing in the list matches there.
 *
 * The geometry model, stated once:
 *   • `between-blocks` matches the GAP only.
 *   • `inline-cursor`  matches TEXT only.
 *   • `paragraph-side` matches EITHER — it is a side-of-the-block placement, so
 *     any cursor that resolved a block can produce one. That unconditional
 *     match is what makes list order load-bearing: a `paragraph-side` listed
 *     after both partition members can never be reached.
 */
export function winningPlacementKind(
  placements: ReadonlyArray<PlacementKind>,
  geometry: PlacementGeometry,
): PlacementKind | null {
  for (const kind of placements) {
    if (kind === "between-blocks" && geometry === "gap") return kind;
    if (kind === "inline-cursor" && geometry === "text") return kind;
    if (kind === "paragraph-side") return kind;
  }
  return null;
}

/**
 * The declared placements that can NEVER win — the ones a spec advertises and
 * the loop can never return, in either geometry. Empty is the healthy answer.
 *
 * Derived from {@link winningPlacementKind} over both worlds rather than from a
 * hand-written rule, so it stays true to the loop by construction.
 */
export function unreachablePlacements(
  placements: ReadonlyArray<PlacementKind>,
): PlacementKind[] {
  const winners = new Set<PlacementKind>();
  for (const geometry of ["gap", "text"] as const) {
    const won = winningPlacementKind(placements, geometry);
    if (won) winners.add(won);
  }
  return [...new Set(placements)].filter((k) => !winners.has(k));
}

/**
 * The ordered placement list ONE drop session may use, resolved from the spec
 * and the dragged key.
 *
 * A spec with no `placementsFor` uses its static `allowedPlacements` (every
 * single-payload spec: one kind, one geometry preference — the list IS the
 * policy). A spec that declares `placementsFor` is answering per payload, and
 * its answer WINS unconditionally, including the empty array: a payload the
 * spec cannot resolve (a stale stack key) can be dropped nowhere, so the
 * hit-test paints no indicator at all rather than an inviting bar over a
 * gesture the commit will refuse. `allowedPlacements` stays the declared
 * envelope (the union of what any payload may use) and is NOT a priority order
 * for such a spec — see `stack-pull.ts`.
 *
 * Called ONCE per session, from `beginDropSession`. Never per pointermove:
 * `placementsFor` may read persisted state (stack-pull parses its localStorage
 * envelope), and the payload behind a cardKey cannot change mid-gesture.
 */
export function resolveSessionPlacements(
  spec: DropSpec,
  cardKey: string,
): ReadonlyArray<PlacementKind> {
  return spec.placementsFor?.(cardKey) ?? spec.allowedPlacements;
}
