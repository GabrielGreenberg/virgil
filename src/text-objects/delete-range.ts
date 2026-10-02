/**
 * Sidecar-cleanup walker for the drag-handle Delete / Archive actions. Walks a
 * doc range and, for every sidecar-bearing element inside it, calls the
 * registered lifecycle's `delete` op. The actual `tr.delete` of the
 * range is the dispatcher's job — this helper just makes sure no
 * sidecar entry survives the deletion as an orphan.
 *
 * TWO PHASES, AND THE ORDER IS THE WHOLE POINT (task 636).
 *
 *   1. ASK — `settleRangeCardObligations`. Async, declinable, mutates only what
 *      the user explicitly answers for. Every declinable obligation a card in
 *      the range carries is discharged HERE, before anything is destroyed, and
 *      a decline aborts the entire gesture with the document untouched.
 *   2. DO — `commitRangeDelete`: the range's `tr.delete`, MEASURED, and only
 *      once it has landed `cleanupLinksInRange`. Synchronous; nothing in the
 *      card half can refuse, because phase one already asked — and nothing in
 *      it runs at all when the DOCUMENT half was refused (task 735).
 *
 * Both phases enumerate through ONE walker, `collectRangeCardTargets`, so the
 * gesture can never ask about one set of cards and destroy another — but they
 * ask it two different questions (task 897). The ASK settles every card the
 * range TOUCHES (an applied splice the delete would clip must be kept or
 * reverted first, because a half-deleted splice can be neither); the DO
 * destroys only the cards the range CONTAINS. A note whose highlighted span the
 * selection merely clips survives with its mark shrunk by the `tr.delete` — it
 * used to be deleted whole, its surviving mark left pointing at nothing.
 *
 * Same registry-driven discipline as [duplicate-slice.ts](./duplicate-slice.ts):
 *
 *   • Inline atoms (`footnote`, `citation`) — resolved through
 *     `cardAtomMetaForNodeName`, the ATOM_REGISTRY's own Card-bearing
 *     narrowing (task 645). Adding a new inline-atom kind is one registry
 *     row; this walker needs no edit. (It used to be a hand-copied
 *     `INLINE_ATOM_CARDS` map literal, twinned with the duplicator's — the
 *     duplication its own comment conceded.)
 *
 *   • `linkedAnchor` marks — the mark's `linkCard` attr names the
 *     `CardKind:cardId`; we delegate to `getCardLifecycle(kind).delete(id)`
 *     uniformly. No per-kind branching in the walker.
 *
 * Limitation: Mode A paragraph-anchor links on todos/examples/
 * archive cards that pointed at deleted paragraphs are NOT proactively
 * cleaned up — those are visible-but-stale "remembered" anchors. The
 * existing orphan listener (`virgil-anchor-orphaned`) handles Mode B
 * anchor death; Mode A paragraph-link death is not currently swept.
 * Acceptable for MVP; address in a follow-up if it turns up in testing.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import type { CardKind } from "@/panels/_shared/types";
import { parseLinkCardKey } from "@/links/link-dom-contract";
import type { AppliedSpliceOps } from "@/cards/lifecycle/applied-splice";
import { settleAppliedSpliceForCard } from "@/cards/lifecycle/run-event";
import { cardAtomMetaForNodeName } from "@/lib/tiptap/atom-registry";
import { LIFECYCLE_DELETE_META } from "@/lib/tiptap/linked-anchor";
import { commitDocThenCards } from "@/components/drop-mode/commit-seam";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import { StepMap } from "@tiptap/pm/transform";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "./text-object-registry";

// ---------------------------------------------------------------------------
// Cascade — when the deletion would leave a structural wrapper empty,
// extend the deletion range to include the wrapper. See
// ACTION-MENU-DIAGNOSIS.md cluster C6.
//
// Two sources of truth for "remove when empty":
//   • Registry flag `removeOnEmptyChildren: true` — declared per kind in
//     `text-object-registry.ts`. Currently set on `bulletList`,
//     `orderedList`, `exampleBlock`. Not set on `blockquote` (an empty
//     blockquote can be intentional).
//   • `INVISIBLE_WRAPPERS` below — schema-internal wrapper node types
//     that aren't TextObjects but ARE structural noise when empty
//     (`exampleItemList`).
//
// Both sources funnel through `shouldRemoveWhenEmpty(typeName)` so the
// cascade helper has a single decision predicate.
// ---------------------------------------------------------------------------

const INVISIBLE_WRAPPERS: ReadonlySet<string> = new Set(["exampleItemList"]);

function shouldRemoveWhenEmpty(typeName: string): boolean {
  if (INVISIBLE_WRAPPERS.has(typeName)) return true;
  if (!isTextObjectKind(typeName)) return false;
  return TEXT_OBJECT_REGISTRY[typeName].removeOnEmptyChildren === true;
}

/**
 * Given a deletion range `outer`, walk up the parent chain and expand
 * the range to include any ancestor wrapper that would be left empty
 * after the deletion. The cascade stops at the first ancestor that
 * either (a) would still have surviving siblings or (b) doesn't carry
 * the remove-on-empty intent.
 *
 * Runs once per action (Delete or Archive), with `outer` produced by
 * `outerRangeFor`. Pure — no transactions dispatched, no side effects.
 *
 * Sequencing matters: the expanded range MUST be passed to BOTH
 * `cleanupLinksInRange` and the `tr.delete` step in the same
 * transaction, otherwise PM's content-rule auto-fill would inject a
 * placeholder child (e.g. `\item %!v:<new>`) before the cascade gets
 * its chance.
 */
export function expandCascadeRange(
  doc: PMNode,
  outer: { from: number; to: number },
): { from: number; to: number } {
  let from = outer.from;
  let to = outer.to;
  // Walk up; each iteration checks whether the immediate wrapper would
  // be empty after removing [from, to). If so, swallow the wrapper and
  // continue up one level.
  for (let safety = 0; safety < 8; safety++) {
    if (from <= 0 || to >= doc.content.size) break;
    let resolved;
    try {
      resolved = doc.resolve(from);
    } catch {
      break;
    }
    const depth = resolved.depth;
    if (depth <= 0) break;
    const wrapper = resolved.node(depth);
    const wrapperFrom = resolved.before(depth);
    const wrapperTo = resolved.after(depth);
    // The wrapper's content spans (wrapperFrom + 1, wrapperTo - 1).
    // If the deletion covers exactly that, the wrapper is left empty.
    if (from !== wrapperFrom + 1 || to !== wrapperTo - 1) break;
    if (!shouldRemoveWhenEmpty(wrapper.type.name)) break;
    from = wrapperFrom;
    to = wrapperTo;
  }
  return { from, to };
}

// ---------------------------------------------------------------------------
// Phase two: the DOCUMENT first, then the cards (task 735).
//
// F2, AND WHY IT IS NOW UNREPRESENTABLE. Phase two used to run the card
// cleanup FIRST: `cleanupLinksInRange` fired each kind's lifecycle `delete`,
// and for an inline atom (a `\cite`) that delete SYNCHRONOUSLY dispatched its
// own transaction stripping the atom — shrinking the block while the caller's
// pre-computed `to` stayed put, so the stale range over-reached into the next
// sibling (a size-1 `graphicsBlock` vanished whole). The fix was an arithmetic
// correction (`cleanupAndComputeDeleteRange`).
//
// Task 735 found the deeper defect in that same ordering: the card half is the
// IRREVERSIBLE half, and it ran before anyone knew whether the document half
// would land. `view.dispatch` returns nothing, and a transaction refused by a
// `filterTransaction` (the `readOnlyEnforcer`) is dropped silently — so a
// refused delete left the passage in place with its footnote / citation /
// Mode-B cards already destroyed.
//
// Reversing the order fixes both at once. The range's `tr.delete` is dispatched
// FIRST, against the settled range — it removes every inline atom inside the
// range along with the text, so no strip ever moves `to` — and it is MEASURED.
// Only a landed delete lets the card half run, and the card half deletes the
// population collected from the PRE-delete document (an atom's lifecycle
// delete finds no node left to strip and removes only its sidecar record).
// ---------------------------------------------------------------------------

/**
 * Carry a deletion range across ONE settlement the gesture itself performed
 * (task 897). Since task 735 a settle's `revert` is the only such step: it
 * splices the pre-suggestion original back over the applied text (task 636) —
 * a rewrite of either sign, since the original may be longer than what
 * replaced it.
 *
 * It used to be a scalar correction (`correctRangeForInnerDelta`: `from` fixed,
 * `to += delta`) resting on the claim that a settle rewrites text "strictly
 * INSIDE `[from, to)`". That holds only when the range CONTAINS the applied
 * span. A selection that merely CLIPS it — span `[10,30)`, selection `[20,40)` —
 * has its `from` inside the rewrite, so the scalar shift cut mid-way through the
 * restored original by an amount unrelated to what the user selected.
 *
 * The honest answer is a MAPPING. The rewritten region is the bounding range of
 * (a) the settled card's anchor extent before the settle and (b) the textual
 * diff between the two documents — the anchored span was replaced AS A UNIT,
 * so no position inside it has a counterpart in the restored original. The range
 * is then mapped through that one replacement step, its ends biased INWARD:
 *
 *   • an end OUTSIDE the rewrite keeps its text (a range that contains the
 *     whole span deletes the whole restored original — unchanged behaviour);
 *   • an end exactly AT the rewrite's edge includes it (a selection that starts
 *     or ends with the span still takes it all);
 *   • an end strictly INSIDE the rewrite is pushed OUT of it — the user's
 *     Revert answer decided that region, and the delete may take only what the
 *     user selected that still exists. It never deletes text they did not
 *     select (the widening alternative would).
 *
 * A settlement that changed no TEXT (a Keep that only drops a pending mark)
 * leaves the range exactly as it was. Pure; clamped so the result is a valid,
 * possibly empty, range of `after`.
 */
export function mapRangeThroughSettlement(
  before: PMNode,
  after: PMNode,
  range: { from: number; to: number },
  extent: { from: number; to: number } | null,
): { from: number; to: number } {
  if (before === after) return range;
  const diffStart = before.content.findDiffStart(after.content);
  if (diffStart == null) return range;
  const diffEnd = before.content.findDiffEnd(after.content);
  const delta = after.content.size - before.content.size;
  // `findDiffEnd` can overlap `findDiffStart` on repetitive text; normalise so
  // the old region is never shorter than what the size delta requires.
  let start = diffStart;
  let oldEnd = Math.max(diffEnd?.a ?? diffStart, start, start - delta);
  if (extent) {
    start = Math.min(start, extent.from);
    oldEnd = Math.max(oldEnd, extent.to);
  }
  start = Math.max(0, start);
  oldEnd = Math.min(before.content.size, oldEnd);
  const newEnd = oldEnd + delta;
  const textBefore = before.textBetween(start, oldEnd, "\n", "\ufffc");
  const textAfter = after.textBetween(start, newEnd, "\n", "\ufffc");
  if (textBefore === textAfter && delta === 0) return range;
  const map = new StepMap([start, oldEnd - start, newEnd - start]);
  const size = after.content.size;
  const from = Math.min(Math.max(map.map(range.from, 1), 0), size);
  const to = Math.min(Math.max(map.map(range.to, -1), 0), size);
  return { from, to: Math.max(from, to) };
}

/**
 * PHASE TWO of a destructive range gesture: delete `[from, to)` from the
 * document, and — only if that transaction LANDED — fire each card's lifecycle
 * `delete` for every sidecar-bearing element the range held.
 *
 * `from`/`to` must be the SETTLED range (`settleRangeCardObligations`), so no
 * declinable question remains. `beforeCards` runs after the landing and before
 * the card deletes: the archive leg re-homes its displaced Mode-A anchors and
 * mints its snippet there, so those sidecar writes share the document's fate
 * too. (Both precede the `setTimeout(0)` orphan sweeps the delete schedules, so
 * they still win the race they used to win by running before the dispatch.)
 *
 * Returns `false` when the compound was refused as a unit — the surface was not
 * editable at the seam, or the transaction was filtered. Then NOTHING ran: no
 * card delete, no `beforeCards`. The caller owns telling the user.
 */
export function commitRangeDelete(
  editor: Editor,
  from: number,
  to: number,
  lifecycle: CardLifecycleApi,
  beforeCards?: () => void,
): boolean {
  const before = editor.state.doc;
  // Tag the removal as deliberate so `MarginaliaAnchorGuard` does not resurrect
  // an anchored block as an empty same-uuid placeholder.
  const tr = editor.state.tr
    .delete(from, to)
    .setMeta(LIFECYCLE_DELETE_META, true);
  return commitDocThenCards(editor, tr, () => {
    beforeCards?.();
    cleanupLinksInRange(before, from, to, lifecycle);
  });
}

/** One sidecar-bearing card the walk found inside a range. */
export interface RangeCardTarget {
  kind: CardKind;
  id: string;
}

/**
 * Which cards a range walk reports (task 897).
 *
 *   • `"contained"` — the cards the range DESTROYS: every inline atom in it, and
 *     every `linkedAnchor` whose WHOLE extent lies inside `[from, to)`. The
 *     default, and the only population `cleanupLinksInRange` may delete.
 *   • `"touched"` — every card the range so much as overlaps: the population
 *     the ASK phase settles, because an applied splice the delete would clip is
 *     still an obligation even though its card is not destroyed.
 */
export type RangeCardReach = "contained" | "touched";

/** A walk hit, with the anchor's full extent where it has one. */
interface RangeCardHit extends RangeCardTarget {
  contained: boolean;
  /** The `linkedAnchor`'s id and bounding extent (null for an inline atom). */
  anchorId: string | null;
  extent: { from: number; to: number } | null;
}

function walkRangeCards(doc: PMNode, from: number, to: number): RangeCardHit[] {
  const hits: RangeCardHit[] = [];
  if (to <= from) return hits;
  // linkedAnchor marks met inside the range, by anchorId, in document order —
  // one mark can cover several text nodes (and several blocks).
  const anchors = new Map<string, RangeCardHit>();
  doc.nodesBetween(from, to, (node) => {
    // Inline-atom card cleanup — an atom the walk visits is wholly inside.
    const atom = cardAtomMetaForNodeName(node.type.name);
    if (atom) {
      const id = node.attrs?.[atom.idAttr];
      if (typeof id === "string" && id) {
        hits.push({
          kind: atom.kind,
          id,
          contained: true,
          anchorId: null,
          extent: null,
        });
      }
    }
    for (const mark of node.marks) {
      if (mark.type.name !== "linkedAnchor") continue;
      const anchorId =
        typeof mark.attrs.anchorId === "string" ? mark.attrs.anchorId : "";
      if (!anchorId || anchors.has(anchorId)) continue;
      const linkCard =
        typeof mark.attrs.linkCard === "string" ? mark.attrs.linkCard : "";
      const parsed = parseLinkCardKey(linkCard);
      if (!parsed) continue;
      const hit: RangeCardHit = {
        kind: parsed.kind,
        id: parsed.id,
        contained: false,
        anchorId,
        extent: null,
      };
      anchors.set(anchorId, hit);
      hits.push(hit);
    }
    return true;
  });
  if (anchors.size === 0) return hits;
  // CONTAINMENT, not overlap: the question is whether the mark's FULL extent
  // lies inside the range. The extent is the same bounding rule
  // `findLinkedAnchorRange` states (interior gaps — an atom, a paragraph break
  // — included), computed for every anchor met in ONE walk rather than one doc
  // walk per anchor. A gesture, not a keystroke: O(doc) once is the budget.
  const extents = new Map<string, { from: number; to: number }>();
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== "linkedAnchor") continue;
      const anchorId = mark.attrs.anchorId;
      if (typeof anchorId !== "string" || !anchors.has(anchorId)) continue;
      const end = pos + node.nodeSize;
      const prev = extents.get(anchorId);
      if (prev) prev.to = end;
      else extents.set(anchorId, { from: pos, to: end });
    }
    return true;
  });
  for (const [anchorId, hit] of anchors) {
    const extent = extents.get(anchorId) ?? null;
    hit.extent = extent;
    hit.contained = !!extent && extent.from >= from && extent.to <= to;
  }
  return hits;
}

/**
 * The READ-ONLY half of the walk: the sidecar-bearing cards a range holds, in
 * document order, deduplicated. Dispatches nothing and mutates nothing.
 *
 * It exists because the walk has two callers with opposite obligations, and
 * they must read ONE enumeration or the gesture asks about one set of cards and
 * destroys another: `settleRangeCardObligations` ASKS about every card the
 * range touches before anything moves, and `cleanupLinksInRange` DELETES the
 * ones it contains after (`reach`, task 897).
 */
export function collectRangeCardTargets(
  doc: PMNode,
  from: number,
  to: number,
  reach: RangeCardReach = "contained",
): RangeCardTarget[] {
  return walkRangeCards(doc, from, to)
    .filter((hit) => reach === "touched" || hit.contained)
    .map(({ kind, id }) => ({ kind, id }));
}

/**
 * The answer `settleRangeCardObligations` gives a destructive range gesture:
 * every declinable question over this passage has been asked and answered, and
 * `{from, to}` is the range corrected for whatever those answers moved.
 *
 * It is a PRECONDITION IN VALUE FORM. A caller can only reach the unconditional
 * second phase (`commitRangeDelete`) by holding one
 * of these, and the only way to hold one is to have awaited the ask.
 */
export interface RangeSettlement {
  /** Every sidecar-bearing card the range TOUCHES, as the ask saw it (the
   *  delete itself destroys only the contained subset — task 897). */
  readonly targets: readonly RangeCardTarget[];
  /** The deletion range, MAPPED through any settlement that moved the
   *  document. May be empty: a selection wholly inside an applied span the user
   *  reverted has nothing of theirs left to delete. */
  readonly from: number;
  readonly to: number;
  /** True iff at least one settlement actually landed — i.e. the document has
   *  moved since the caller computed its range, and anything the caller derived
   *  from the pre-settle doc (an archive capture, a displaced-anchor sweep) must
   *  be re-derived. */
  readonly docMoved: boolean;
}

/**
 * PHASE ONE of a destructive range gesture: ask, before anything is destroyed.
 *
 * THE BUG THIS EXISTS FOR (task 636). A card delete is ASYNCHRONOUS and
 * DECLINABLE — `makeUnbridgingDelete` routes through the lifecycle executor,
 * whose SETTLE obligation raises a three-way keep/revert/cancel prompt whenever
 * the card owns a live in-document splice. The Delete / Archive dispatch called
 * it bare from inside the synchronous cleanup walk and deleted the text on the
 * very next statement, so the two raced: the paragraph was gone before the user
 * answered, `Cancel` left a card whose text had already vanished, and — worst —
 * `Revert` could no longer resolve the range it was meant to restore, so the
 * pre-suggestion original was lost silently and irrecoverably.
 *
 * THE SHAPE OF THE FIX IS THE ONE THIS GESTURE ALREADY USES ELSEWHERE. Archive
 * runs `prepareCardBodyCapture` BEFORE any mutation precisely so "an abort
 * leaves the document and every sidecar completely untouched" (the
 * capture/schema-symmetry law). This is that same law's other half: a second
 * declinable question was being asked AFTER the point of no return instead of
 * before it. So the question is hoisted — every applied splice inside the
 * passage is settled first, the whole gesture aborts if any answer declines, and
 * only then does the unconditional half run.
 *
 * Returns `null` when the gesture must abort. The document is then exactly as
 * the user left it for a cancel; for a decline that follows an earlier
 * settlement in the same range, those earlier answers stand — they were
 * explicit user decisions about the document, not steps of the deletion.
 *
 * KIND-AGNOSTIC BY CONSTRUCTION: it asks `settleAppliedSpliceForCard` about
 * EVERY card in the range, and that door gates on `ownsAppliedSplice`. There is
 * no per-kind wiring here to forget when a kind later joins the pending-change
 * family.
 */
export async function settleRangeCardObligations(
  editor: Editor,
  from: number,
  to: number,
  ops: AppliedSpliceOps | undefined,
): Promise<RangeSettlement | null> {
  const hits = walkRangeCards(editor.state.doc, from, to);
  const targets = hits.map(({ kind, id }) => ({ kind, id }));
  const unmoved: RangeSettlement = { targets, from, to, docMoved: false };
  if (!ops || hits.length === 0) return unmoved;
  let range = { from, to };
  let settledAny = false;
  for (const hit of hits) {
    const before = editor.state.doc;
    // The anchor's extent, re-read against the CURRENT doc: an earlier
    // settlement in this same range may have moved it.
    const extent =
      settledAny && hit.anchorId
        ? findLinkedAnchorRange(before, hit.anchorId)
        : hit.extent;
    const outcome = await settleAppliedSpliceForCard(
      "delete",
      hit.kind,
      hit.id,
      ops,
    );
    if (outcome === "declined") return null;
    if (outcome !== "settled") continue;
    settledAny = true;
    // Carry the range across exactly this settlement (task 897) — a mapping
    // through the rewrite, never a scalar shift that assumes the range
    // CONTAINED it.
    range = mapRangeThroughSettlement(before, editor.state.doc, range, extent);
  }
  if (!settledAny) return unmoved;
  return { targets, from: range.from, to: range.to, docMoved: true };
}

/**
 * PHASE TWO's card half — fire each kind's lifecycle `delete` for every card in
 * the range. Unconditional: by the time this runs, `settleRangeCardObligations`
 * has discharged every declinable obligation over the same target list, so no
 * delete here can refuse. A delete that refuses anyway is a contract breach (a
 * new declinable obligation the ask does not know about), and says so in dev
 * rather than silently mutilating a card the user chose to keep.
 *
 * `doc` is the PRE-delete document: `commitRangeDelete` calls this only after
 * the range's own transaction has landed (task 735), so the population is read
 * from the snapshot it held before dispatching.
 */
export function cleanupLinksInRange(
  doc: PMNode,
  from: number,
  to: number,
  lifecycle: CardLifecycleApi,
): void {
  for (const target of collectRangeCardTargets(doc, from, to)) {
    const committed = lifecycle.get(target.kind)?.delete(target.id);
    if (process.env.NODE_ENV === "production") continue;
    void Promise.resolve(committed).then((ok) => {
      if (ok === false) {
        console.error(
          `[delete-range] the lifecycle delete for ${target.kind}:${target.id} ` +
            `DECLINED after the range gesture had already committed. Every ` +
            `declinable obligation must be discharged by ` +
            `settleRangeCardObligations before this walk runs (task 636).`,
        );
      }
    });
  }
}
