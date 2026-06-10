import type { Link } from "@/links/_shared/types";

/**
 * Slim collection-slot type for the linked-entity resolvers in
 * `src/links/_shared/entity-hover` (`findEntity` / `entityToAnchorId`).
 *
 * WS5 fold: the parallel `EntityCollections` interface is retired in favour of
 * this narrowed structural type, which `CardFloatCtx` (= `PoppedCardDeps`,
 * the per-doc heavy bag handed to a card's `toFloatable`) structurally
 * satisfies — so the same bag flows to both the float renderer and the entity
 * resolvers without a second parallel literal. The slot NAMES match
 * `CardFloatCtx`'s (`todoItems` / `reportCards`, not the old `todos` / `reports`),
 * and `examples` reads `exampleId ?? id` so `ExampleInfo[]` resolves directly.
 *
 * Lives in `src/cards/` — the cycle-safe layer both `links/` and `components/`
 * already import — rather than referencing the heavy `CardFloatCtx` from
 * `links/` (which would reverse layering AND tie the resolvers to the bag's
 * per-render identity, breaking the reconciler's per-array effect stability).
 * `findEntity` only reads `{ id, kind?, links? }` per slot, so the structural
 * shape is intentionally minimal. The `Link` import is type-only (erased), so
 * it adds no runtime edge.
 */
export interface EntityCollectionSlots {
  notes: ReadonlyArray<{ id: string; links?: Link[] }>;
  /** Highlights live alongside notes in the Notes panel. Optional so legacy
   *  callers (e.g. Reader paths without a highlights hook, or the bag-less
   *  EditorLayout anchor literals) still compile. */
  highlights?: ReadonlyArray<{ id: string; links?: Link[] }>;
  cutterCards: ReadonlyArray<{ id: string; kind?: string; links?: Link[] }>;
  comments: ReadonlyArray<{ id: string; kind?: string; links?: Link[] }>;
  /** Renamed from the old `EntityCollections.todos` to match `CardFloatCtx`. */
  todoItems: ReadonlyArray<{ id: string; links?: Link[] }>;
  archiveSnippets: ReadonlyArray<{ id: string; links?: Link[] }>;
  /** Reports panel hosts both `report` + `report-request`; split on `kind`.
   *  Renamed from the old `EntityCollections.reports`. Optional so bag-less
   *  callers still compile. */
  reportCards?: ReadonlyArray<{ id: string; kind?: string; links?: Link[] }>;
  /** `ExampleInfo` keys on `exampleId`, not `id` (the documented one-example
   *  carve-out); `findEntity` reads `e.exampleId ?? e.id` so both shapes
   *  resolve without a boundary adapter. */
  examples: ReadonlyArray<{ id?: string; exampleId?: string }>;
}
