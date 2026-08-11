/**
 * **The Stack's card vocabulary — the ONE place "which card kinds the Stack
 * carries" is stated, and the `CardKind ↔ StackCardKind` bridge.**
 *
 * Before task 259 that membership was hand-restated in six parallel places that
 * had to stay in lockstep with nothing pinning them together: the
 * `CARD_REGISTRY[k].stackable` boolean, the `StackCardKind` union, the
 * `StackCardSnapshot` union, each float's `snapshotForStack` being a real
 * `snapshotCard(...)` vs `() => null`, `CARD_PLACEMENTS` + the `applyCardDrop`
 * switch, and the `snapshotCard`/`summarizeStackItem` switches — plus a
 * hand-kept array in `float-snapshot.test.ts`. Every one of the switches failed
 * SILENTLY on a missing member (the card lands on the Stack fine and vanishes on
 * pull), and the facet had already visibly drifted: `example` was
 * `stackable: true` with a `() => null` snapshot, a `NOWHERE` placement list and
 * a documented no-op pull branch, so it read as stackable end-to-end and could
 * not round-trip at any point in the chain.
 *
 * The array below is the DECLARATION; the union is derived from it, so the two
 * can no longer disagree. Everything else is pinned to it — by the compiler
 * where that is possible (`CARD_PLACEMENTS` is a `Record` over the union; the
 * switches carry `never` checks; `StackCardSnapshot` is pinned by the `Exact`
 * assertion in `./types`), by `assertStackCoverage()` at boot for the registry
 * facet, and by `cards/__tests__/stack-coverage.test.ts` for the mechanisms only
 * a built `Floatable` / a real `applyDrop` can answer for.
 *
 * **Zero runtime imports, deliberately.** `card-registry.tsx` is a documented
 * runtime LEAF (a heavier import there closes the
 * `panel-registry → predicates → card-registry → …` cycle), and it is the module
 * that must read this to pin its `stackable` facet — so this file takes only a
 * type-only `CardKind`, which is erased. Same reasoning as
 * `src/lib/latex-markers.ts`: a table the layer that needs it cannot reach will
 * be re-copied, every time.
 *
 * **There is no allowlist here, and that is the point.** A kind that cannot make
 * the round trip is not stackable — it is declared `stackable: false` and left
 * out of this vocabulary until the mechanism exists, exactly as the export
 * census in `src/links/` requires a symbol to be re-added *with* its first real
 * reader. `example` is the standing case: its pull branch was a documented
 * placeholder ("Future: synthesize an exampleBlock node"), so it was removed
 * from the vocabulary in 259 rather than carved out of the guard. Re-adding it
 * is one entry here, after which the compiler names every other site that must
 * learn about it.
 */
import type { CardKind } from "@/cards/types";

/**
 * Every card kind the Stack can carry, as runtime data — the source the
 * {@link StackCardKind} union is derived from.
 *
 * Note the vocabulary is NOT `CardKind`: the Stack spells the bibliography kind
 * `"bibliography"` where the card spine spells it `"bib"` (a frozen wire name on
 * both sides — the snapshot payloads persist in `localStorage`). That one
 * disagreement is what {@link CARD_KIND_BY_STACK_CARD_KIND} exists to state
 * once.
 */
export const STACK_CARD_KINDS = [
  "note",
  "highlight",
  "footnote",
  "citation",
  "bibliography",
  "todo",
  "archive",
  "revision-comment", // RevisionRequestCard (disk kind: "comment")
  "revision-suggestion",
  "cutter-comment",
  "cutter-suggestion",
] as const;

/** Card kinds the Stack can carry as a snapshot. Derived from
 *  {@link STACK_CARD_KINDS} — never hand-listed beside it. */
export type StackCardKind = (typeof STACK_CARD_KINDS)[number];

/**
 * Which `CardKind` each vocabulary member snapshots from. **Total over
 * `StackCardKind`**, so a new member is a COMPILE ERROR until someone states the
 * card kind behind it — and the inverse map below is derived rather than
 * declared, so the bridge cannot be half-updated.
 */
export const CARD_KIND_BY_STACK_CARD_KIND: Record<StackCardKind, CardKind> = {
  note: "note",
  highlight: "highlight",
  footnote: "footnote",
  citation: "citation",
  bibliography: "bib", // the one name the two vocabularies disagree on
  todo: "todo",
  archive: "archive",
  "revision-comment": "revision-comment",
  "revision-suggestion": "revision-suggestion",
  "cutter-comment": "cutter-comment",
  "cutter-suggestion": "cutter-suggestion",
};

const STACK_CARD_KIND_BY_CARD_KIND: ReadonlyMap<CardKind, StackCardKind> =
  new Map(
    STACK_CARD_KINDS.map(
      (s) => [CARD_KIND_BY_STACK_CARD_KIND[s], s] as const,
    ),
  );

/**
 * The Stack vocabulary name for a card kind, or `null` when the Stack does not
 * carry it. The ONE translation door: nothing else maps between the two
 * vocabularies (a hand-written `kind === "bib" ? "bibliography" : kind` is the
 * drift this replaces).
 */
export function stackCardKindFor(kind: CardKind): StackCardKind | null {
  return STACK_CARD_KIND_BY_CARD_KIND.get(kind) ?? null;
}

/** Whether the Stack carries this card kind — the derived twin of the
 *  `CARD_REGISTRY[kind].stackable` declaration, which `assertStackCoverage()`
 *  pins to it at boot. */
export function isStackableCardKind(kind: CardKind): boolean {
  return STACK_CARD_KIND_BY_CARD_KIND.has(kind);
}
