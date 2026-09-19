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
 *   2. DO — `cleanupAndComputeDeleteRange` (→ `cleanupLinksInRange`) and the
 *      caller's `tr.delete`. Synchronous and unconditional; nothing in it can
 *      refuse, because phase one already asked.
 *
 * Both phases enumerate the SAME population through `collectRangeCardTargets`,
 * so the gesture can never ask about one set of cards and destroy another.
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
// Cleanup-then-delete range correction — the F2 data-loss fix.
//
// THE BUG IT FIXES
// The Archive / Delete dispatch computes a deletion range `[from, to)` against
// the live doc, THEN calls `cleanupLinksInRange`, which — for an inline atom
// inside the range (a `\cite` / `\footnote` whose card lifecycle owns a live
// doc node) — SYNCHRONOUSLY dispatches its own transaction that strips the atom
// from the doc. That shrinks the targeted block, so the editor's state advances
// while the originally-computed `to` does not. The stale `to` then over-reaches
// past the (now-shorter) block and into whatever sits immediately after it.
// When the next sibling is a size-1 block atom (`graphicsBlock`, `displayMath`,
// `texBlock`, …) the over-reach swallows it WHOLE — silent data loss (F2:
// deleting a paragraph that precedes a `graphicsBlock` removed the graphics
// too). A `figureBlock` survived only incidentally: the demo paragraph above it
// happened to carry no atom to clean up, so the range never went stale.
//
// THE FIX (whole-class, not the one node type)
// Every removal `cleanupLinksInRange` triggers is, by construction, STRICTLY
// INSIDE `[from, to)` — it only deletes inline atoms / linkedAnchor-marked text
// that the walker found within the range, never the block boundaries
// themselves. So the block's opening boundary (`from`) never moves, and `to`
// shifts left by exactly the total document-size delta. We capture the doc size
// before cleanup and subtract the delta afterward. Ref-kind-agnostic (works for
// a TextObject paragraph delete AND a selection-range delete) and atom-kind-
// agnostic (citation, footnote, or any future atom whose lifecycle removes a
// doc node). The caller dispatches `tr.delete(from, correctedTo)` against the
// post-cleanup `ed.state`, so positions are internally consistent.
// ---------------------------------------------------------------------------

/**
 * Correct a range for a mutation the gesture ITSELF performed strictly inside
 * that range. The one arithmetic, shared by the two steps that mutate inside a
 * range before deleting it:
 *
 *   • the cleanup walk's inline-atom strips (the F2 case above) — `delta < 0`;
 *   • a SETTLE's `revert`, which splices the pre-suggestion original back over
 *     the applied text (task 636) — `delta` of either sign, since the original
 *     may be longer than what replaced it.
 *
 * Both are, by construction, strictly INSIDE `[from, to)`: the walk only ever
 * touches atoms/marked text it found within the range, and a settle only ever
 * rewrites the anchor range of a card the walk found there. So `from` never
 * moves and `to` shifts by exactly the document-size delta. Clamped at both
 * ends so a degenerate input can only ever shrink the range, never grow it into
 * a neighbour.
 */
export function correctRangeForInnerDelta(
  from: number,
  to: number,
  delta: number,
  docSize: number,
): { from: number; to: number } {
  const lowered = Math.max(from, to + delta);
  const shifted = Math.min(lowered, docSize);
  return { from: Math.min(from, shifted), to: shifted };
}

/**
 * Run `cleanupLinksInRange` over `[from, to)` and return the range corrected
 * for any doc mutation the cleanup's card-lifecycle deletes performed. The
 * returned `{ from, to }` is valid against the POST-cleanup `editor.state.doc`
 * and is what the Delete / Archive `tr.delete(...)` must use.
 *
 * `from` is returned unchanged: cleanup never touches positions at or before
 * the block's opening boundary. `to` is reduced by the doc-size delta, since
 * every cleanup removal lands strictly inside the range.
 *
 * IT IS THE SECOND HALF OF A TWO-PHASE GESTURE (task 636). Everything it does
 * is UNCONDITIONAL — the lifecycle deletes it fires cannot be refused by the
 * time it runs, because `settleRangeCardObligations` has already asked every
 * declinable question over this range and the caller has already aborted on a
 * decline. Calling it without that first phase is the bug task 636 fixed: the
 * card delete was asynchronous and declinable while the text delete on the next
 * statement was synchronous and unconditional, so the paragraph vanished while
 * the user was still being asked what to do about it.
 */
export function cleanupAndComputeDeleteRange(
  editor: Editor,
  from: number,
  to: number,
  lifecycle: CardLifecycleApi,
): { from: number; to: number } {
  const sizeBefore = editor.state.doc.content.size;
  cleanupLinksInRange(editor.state.doc, from, to, lifecycle);
  const delta = editor.state.doc.content.size - sizeBefore;
  return correctRangeForInnerDelta(
    from,
    to,
    delta,
    editor.state.doc.content.size,
  );
}

/** One sidecar-bearing card the walk found inside a range. */
export interface RangeCardTarget {
  kind: CardKind;
  id: string;
}

/**
 * The READ-ONLY half of the walk: every sidecar-bearing card inside
 * `[from, to)`, in document order, deduplicated. Dispatches nothing and
 * mutates nothing.
 *
 * It exists because the walk has two callers with opposite obligations, and
 * they must see exactly the same population or the gesture asks about one set
 * of cards and destroys another: `settleRangeCardObligations` ASKS about these
 * cards before anything moves, and `cleanupLinksInRange` DELETES them after.
 * One enumeration, two phases.
 */
export function collectRangeCardTargets(
  doc: PMNode,
  from: number,
  to: number,
): RangeCardTarget[] {
  const targets: RangeCardTarget[] = [];
  if (to <= from) return targets;
  // Track ids already collected so a mark spanning multiple text nodes doesn't
  // yield the same card N times.
  const seenAnchors = new Set<string>();
  doc.nodesBetween(from, to, (node) => {
    // Inline-atom card cleanup
    const atom = cardAtomMetaForNodeName(node.type.name);
    if (atom) {
      const id = node.attrs?.[atom.idAttr];
      if (typeof id === "string" && id) {
        targets.push({ kind: atom.kind, id });
      }
    }
    // linkedAnchor mark cleanup — one mark can cover several text nodes,
    // hence the seen-set keyed by anchorId.
    for (const mark of node.marks) {
      if (mark.type.name !== "linkedAnchor") continue;
      const anchorId =
        typeof mark.attrs.anchorId === "string" ? mark.attrs.anchorId : "";
      if (!anchorId || seenAnchors.has(anchorId)) continue;
      seenAnchors.add(anchorId);
      const linkCard =
        typeof mark.attrs.linkCard === "string" ? mark.attrs.linkCard : "";
      const parsed = parseLinkCardKey(linkCard);
      if (parsed) targets.push({ kind: parsed.kind, id: parsed.id });
    }
    return true;
  });
  return targets;
}

/**
 * The answer `settleRangeCardObligations` gives a destructive range gesture:
 * every declinable question over this passage has been asked and answered, and
 * `{from, to}` is the range corrected for whatever those answers moved.
 *
 * It is a PRECONDITION IN VALUE FORM. A caller can only reach the unconditional
 * second phase (`cleanupAndComputeDeleteRange` + the `tr.delete`) by holding one
 * of these, and the only way to hold one is to have awaited the ask.
 */
export interface RangeSettlement {
  /** Every sidecar-bearing card inside the range, as the ask saw it. */
  readonly targets: readonly RangeCardTarget[];
  /** The deletion range, corrected for any settlement that moved the document. */
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
  const targets = collectRangeCardTargets(editor.state.doc, from, to);
  const unmoved: RangeSettlement = { targets, from, to, docMoved: false };
  if (!ops || targets.length === 0) return unmoved;
  const sizeBefore = editor.state.doc.content.size;
  let settledAny = false;
  for (const target of targets) {
    const outcome = await settleAppliedSpliceForCard(
      "delete",
      target.kind,
      target.id,
      ops,
    );
    if (outcome === "declined") return null;
    if (outcome === "settled") settledAny = true;
  }
  if (!settledAny) return unmoved;
  // A settlement rewrote text strictly inside the range (a revert restores the
  // original over the applied text); correct `to` by the delta, exactly as the
  // cleanup's own strips are corrected.
  const delta = editor.state.doc.content.size - sizeBefore;
  const corrected = correctRangeForInnerDelta(
    from,
    to,
    delta,
    editor.state.doc.content.size,
  );
  return { targets, from: corrected.from, to: corrected.to, docMoved: true };
}

/**
 * PHASE TWO's card half — fire each kind's lifecycle `delete` for every card in
 * the range. Unconditional: by the time this runs, `settleRangeCardObligations`
 * has discharged every declinable obligation over the same target list, so no
 * delete here can refuse. A delete that refuses anyway is a contract breach (a
 * new declinable obligation the ask does not know about), and says so in dev
 * rather than silently mutilating a card the user chose to keep.
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
