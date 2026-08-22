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
 *    IS the hit-test's priority switch (minus the geometry builders), so the
 *    reachability guard below reads exactly the rule that switch follows and
 *    cannot drift from it. A guard that re-states the loop is a second copy of
 *    the thing that was wrong. **Scope, stated because the guard is only as
 *    honest as its reach:** the switch is step 6 of the hit-test, and TWO
 *    things run before it — the A1 `resolveBlockIntoExpex` path, and (task 416)
 *    the CANDIDATE LADDER, which produces a `between-blocks` placement for a
 *    cursor INSIDE a block's rect whenever the session declares a BLOCK payload
 *    (`DropSpec.blockPayloadFor`). That declaration is the honest form of what
 *    used to be the R3 `resolveSubItemPeerBlock` resolver's source-key gate, and
 *    it is why the ladder is a deliberate exception to the partition rather than
 *    a leak: a whole-block payload has no inline reading at all, and a list has
 *    no top-level gaps between its items, so the partition's gap-only reading
 *    meant NO BAR anywhere over a list's body. So `between-blocks` is reachable
 *    over text for a block payload, and {@link unreachablePlacements} — which
 *    models the switch alone — would wrongly condemn it in a hypothetical
 *    `["paragraph-side", "between-blocks"]` spec. No such spec exists (every
 *    spec that declares a block payload declares `between-blocks` first), so the
 *    guard is exact today; a future one would need this residual folded in
 *    rather than the assertion relaxed.
 *  - **A static priority order cannot answer a PER-PAYLOAD question.** When one
 *    spec key covers several payload shapes (stack-pull: a text slice, a
 *    paragraph, a heading, a card), the placement a payload wants over the same
 *    pixel differs — a text slice wants the inline caret, a card wants the
 *    paragraph side. So a spec may narrow its list per payload through
 *    `DropSpec.placementsFor`, resolved ONCE per session by
 *    {@link resolveSessionPlacements}: the resolution may read persisted state,
 *    so it must never run per pointermove, and freezing the CHOICE at mousedown
 *    also keeps the affordance stable for the gesture. That is not a claim the
 *    payload is immortal — a stack item can be removed mid-drag, which is why
 *    the commit re-reads and re-validates instead of trusting the frozen list.
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
 * **The fallback is a fork, not a coalesce.** A `placementsFor` that produced
 * nothing (it cannot, per its type, but its input is untrusted persisted data)
 * must NOT fall through to the envelope: for the one spec that has one, the
 * envelope is precisely the union in which `paragraph-side` is unreachable, so
 * a coalesce would silently restore the defect for exactly the payload nobody
 * understood. It fails CLOSED instead — offer nothing.
 *
 * Called ONCE per session, from `beginDropSession`; never per pointermove,
 * since `placementsFor` may read persisted state (stack-pull parses its whole
 * localStorage envelope).
 */
export function resolveSessionPlacements(
  spec: DropSpec,
  cardKey: string,
): ReadonlyArray<PlacementKind> {
  if (!spec.placementsFor) return spec.allowedPlacements;
  return spec.placementsFor(cardKey) ?? NO_PLACEMENTS;
}

/** The shared empty answer — "this payload can be dropped nowhere". */
const NO_PLACEMENTS: ReadonlyArray<PlacementKind> = [];
