/**
 * Container fit — how a block-shaped payload fits the container at an insert
 * position (bare, wrapped, or not at all).
 *
 * Split out of `drop-adapters.ts` (task 776) so the wrap vocabulary can be READ
 * from the text-object registry's `parentKinds` facet: the registry imports
 * `drop-adapters.ts`, so that module cannot read the registry back without an
 * import cycle, while this one sits downstream of both.
 */

import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { tryBuildWrap } from "./drop-adapters";
import { TEXT_OBJECT_REGISTRY } from "./text-object-registry";
import type { TextObjectKind, TextObjectMeta } from "./types";

// ---------------------------------------------------------------------------
// Container fit — the ONE answer to "how does this block fit THIS container?"
// ---------------------------------------------------------------------------
//
// Every between-blocks drop ends in the same question: the user released a
// block-shaped payload at an insert position, and something has to decide
// whether it goes in bare, goes in wrapped, or cannot go in at all. Before this
// existed the question was answered in two divergent places and not at all in
// two others:
//
//   • `text-range-move.ts` restated a LIST-ONLY literal (wrap each block in a
//     `listItem` iff `classifyParentAt` says bulletList/orderedList) and knew
//     nothing about expex — so a text selection released in an expex item gap
//     spliced a bare `paragraph` into `exampleItemList` (content `exampleItem+`),
//     and ProseMirror's fitter resolved the invalidity by SPLITTING the example
//     in two — both halves keeping the SAME uuid — with the moved text stranded
//     at top level between them (task 257);
//   • `textobject.ts` went through the registry adapters, which know expex and
//     the sub-object containers but NOT lists — so the mirror gesture (a
//     paragraph block-move released in a list-item gap) tore the bulletList in
//     two the same way, with the same duplicate uuid;
//   • `util/block-move.ts` and `stack-pull.ts` asked nothing at all.
//
// So the fit is derived here, from the schema, for all four:
//
//   1. the immediate insert parent accepts the bare node          → `direct`;
//   2. else some wrapper in the `buildWrap` vocabulary is BOTH valid at that
//      index AND able to hold the node                            → `wrap`;
//   3. else, iff the caller's `bareInsertIsSafe` probe says ProseMirror's own
//      fitter can place it here WITHOUT tearing a container        → `direct`;
//   4. else the drop is not representable here                    → `reject`.
//
// Rules 3 and 4 are the load-bearing pair, and 3 exists because "the schema
// rejects a bare node here" does NOT mean the insert is destructive. The fitter
// has two very different responses to an invalid position: it PADS (inserting
// whatever the content expression requires — an equation dropped at a
// `listItem`'s index 0 gets an empty paragraph before it and stays inside that
// item, which is a fine outcome and shipped behavior), or it SPLITS the
// enclosing container to close it off — which tears one node into two that BOTH
// keep the original uuid and strands the payload between the halves. Only the
// second is corruption, so only the second is refused; the probe distinguishes
// them empirically (see `fitNodesAtInsert`) rather than by predicting the
// fitter.
//
// Rule 4 then follows the same law as the capture side (AGENTS.md, "never
// delete what you cannot restore"): every between-blocks MOVE deletes its
// source in the same transaction it inserts, so an insert that can only land by
// tearing its container destroys or relocates the user's content. Refusing
// (task 065's "reject rather than fabricate a here-invalid wrap", generalized
// from the wrap decision to the whole fit) leaves the document exactly as it
// was.
//
// The candidate list is DERIVED from the registry's `parentKinds` facet — the
// one place the child→parent relation is stated (list items → bullet/ordered
// list, exampleItem → exampleBlock) — ordered item-wrappers first: the
// sub-object kinds fit a block INTO an existing container, their parent kinds
// build a fresh container around a pulled-out sub-item. A new sub-object kind
// is therefore tried as a wrapper the moment the registry declares it; the
// parity test (container-fit-vocabulary.test.ts) fails until `buildWrap` knows
// how to construct it, rather than the pull-out being silently refused.
// `prefer` lets a caller that knows the source's provenance break a tie (an
// `orderedList` item pulled to top level rebuilds an ordered list, not a
// bullet one).

function deriveWrapTargetKinds(
  registry: Readonly<Record<TextObjectKind, Pick<TextObjectMeta, "parentKinds">>>,
): readonly TextObjectKind[] {
  const items: TextObjectKind[] = [];
  const containers: TextObjectKind[] = [];
  for (const [kind, meta] of Object.entries(registry) as [
    TextObjectKind,
    Pick<TextObjectMeta, "parentKinds">,
  ][]) {
    if (!meta.parentKinds?.length) continue;
    items.push(kind);
    for (const parent of meta.parentKinds) {
      if (!containers.includes(parent)) containers.push(parent);
    }
  }
  return [...items, ...containers.filter((k) => !items.includes(k))];
}

export const WRAP_TARGET_KINDS: readonly TextObjectKind[] =
  deriveWrapTargetKinds(TEXT_OBJECT_REGISTRY);

export type ContainerFit =
  | { kind: "direct" }
  | { kind: "wrap"; parentKind: TextObjectKind; node: PMNode }
  | { kind: "reject" };

export interface ContainerFitOpts {
  /** Tie-breaker for the container wrappers — the source's own parent kind, so
   *  an `orderedList` item pulled out rebuilds an ordered list. */
  prefer?: TextObjectKind;
  /** Rule 3: can ProseMirror's fitter place this node here WITHOUT tearing a
   *  container? Supplied by the editor-level caller (which alone can trial the
   *  real transaction). Omitted → rule 3 is skipped and an unwrappable node is
   *  refused, the conservative direction. */
  bareInsertIsSafe?: (node: PMNode) => boolean;
}

export function fitNodeInContainer(
  parent: PMNode,
  index: number,
  node: PMNode,
  schema: Schema,
  opts?: ContainerFitOpts,
): ContainerFit {
  if (parent.canReplaceWith(index, index, node.type)) return { kind: "direct" };
  const prefer = opts?.prefer;
  const candidates: ReadonlyArray<TextObjectKind> =
    prefer !== undefined && WRAP_TARGET_KINDS.includes(prefer)
      ? [prefer, ...WRAP_TARGET_KINDS.filter((k) => k !== prefer)]
      : WRAP_TARGET_KINDS;
  for (const parentKind of candidates) {
    const wrapperType = schema.nodes[parentKind];
    if (!wrapperType) continue;
    // Two independent questions, both required: does a wrapper of this kind
    // BELONG here (the task-065 gate — else we'd fabricate a wrap the fitter
    // would split the container to accommodate), and can it HOLD the node.
    if (!parent.canReplaceWith(index, index, wrapperType)) continue;
    const wrapped = tryBuildWrap(schema, node, parentKind);
    if (wrapped) return { kind: "wrap", parentKind, node: wrapped };
  }
  // Nothing in the wrap vocabulary fits — but the fitter may still place the
  // bare node harmlessly by padding the parent's content (and shipped behavior
  // relies on it: A1/065's displayMath-at-a-listItem's-index-0 drop). Let the
  // probe decide; without one, refuse.
  if (opts?.bareInsertIsSafe?.(node)) return { kind: "direct" };
  return { kind: "reject" };
}
