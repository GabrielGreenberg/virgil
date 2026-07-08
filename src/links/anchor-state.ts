// The single, canonical anchor-state derivation for inline-atom / card panels.
//
// This is the SSOT the LHS-panel audit's C19 cluster was missing (design
// PLAN.md D2; T2-anchor-orphan.md §3a). Every omni/panel builder used to
// re-derive anchor-state locally from position resolution ALONE —
//
//     anchorState: pos == null ? "orphaned" : "anchored"
//
// — which silently conflates two structurally distinct no-marker states:
//   • a card the user deliberately made in the panel and hasn't placed yet
//     (a *free* card — `CitationRef.unanchored`), and
//   • a card whose in-text marker was genuinely deleted (an *orphan*).
//
// The `OmniItem.anchorState` union (`"anchored" | "free" | "orphaned"`,
// src/panels/_shared/types.ts) and its three-way binning/badging in
// `OmniViewPanel` already exist — only the single derivation was missing and
// duplicated across builders. This module supplies it.
//
// PURE + ADDITIVE: no `@/`-aliased imports, no editor/React dependency. It
// takes the already-resolved live position and the card's already-known
// intent so it can be unit-tested as a string function and reused by any
// surface (citations, examples, the future inline kinds, T1's float/selection
// re-point, T5's omni fold/focus filter) without re-implementing the rule.
//
// Adoption (task 056): all 10 omni builders now call `resolveAnchorState`
// instead of an inline formula — the three formula families (the 2-way
// `pos == null ? "orphaned" : "anchored"`, Errors' inline 3-way, and the
// hardcoded free/orphan literals) collapsed into this one SSOT. Kinds with a
// deliberate-free concept (citation/footnote `unanchored`, the unlinked
// note/todo/cutter/report/revision/archive card, an error with no source
// paragraph) pass `{ unanchored }`; kinds that are intrinsically in-text
// (examples, live/orphaned footnotes) pass `null`. The A5 contract test
// (`anchor-state-classify-contract.test.ts`) pins the free/orphaned split per
// builder. Any new builder MUST derive `anchorState` from this function — the
// grep-guard in that test's sibling enforces no inline `anchorState:` ternary.

/**
 * The three states a card's anchor can be in.
 *
 *  - `anchored` — a live in-text marker exists (the resolved doc position is
 *    non-null).
 *  - `free`     — no live marker AND the card declares deliberate-free intent
 *    (`unanchored`): it was created in the panel and hasn't been placed yet.
 *    This is a normal, non-error state (plain card, no red badge).
 *  - `orphaned` — no live marker AND no free intent: the marker was lost
 *    (genuinely deleted in-text). This is the recoverable-error state
 *    (red `BadgeOrphaned`).
 */
export type AnchorState = "anchored" | "free" | "orphaned";

/**
 * The card's declared anchor *intent*, independent of its live position.
 *
 * `unanchored: true` records "the user made this deliberately free and hasn't
 * placed it." It is the same flag `isUnanchored` reads, modelled here as a
 * narrow structural shape so this resolver stays dependency-free and any
 * caller can pass the card record (`CitationRef`, a footnote ref, …) directly.
 */
export interface AnchorIntent {
  /** Deliberately-free: created in the panel, never placed in-text. */
  unanchored?: boolean;
}

/**
 * The SSOT anchor-state derivation (PLAN.md D2).
 *
 * Resolves a card's {@link AnchorState} from its live doc position and its own
 * declared intent — the single replacement for every inline
 * `pos == null ? "orphaned" : "anchored"` site, which lacked the intent input
 * and so collapsed deliberately-free cards into the orphaned-error bin.
 *
 * Truth table (`pos` × `intent.unanchored`):
 *
 * | pos        | unanchored | result      |
 * |------------|------------|-------------|
 * | non-null   | (any)      | `anchored`  |
 * | null/undef | `true`     | `free`      |
 * | null/undef | falsy      | `orphaned`  |
 *
 * A live position wins unconditionally: a card with a marker IS anchored, even
 * if it also (stale-y) carries `unanchored: true`. Only when there is no live
 * marker does intent decide free-vs-orphaned.
 *
 * @param pos    the resolved live document position of the card's marker, or
 *               `null`/`undefined` if no live marker exists.
 * @param intent the card's declared intent (`{ unanchored?: boolean }`), or
 *               `null`/`undefined` if the card has no free-intent concept
 *               (e.g. examples — always-in-text, so a missing marker is an
 *               orphan, never free).
 */
export function resolveAnchorState(
  pos: number | null | undefined,
  intent: AnchorIntent | null | undefined,
): AnchorState {
  if (pos != null) return "anchored";
  return intent?.unanchored ? "free" : "orphaned";
}
