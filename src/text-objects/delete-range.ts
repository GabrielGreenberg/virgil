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
import { LIFECYCLE_DELETE_META } from "@/lib/tiptap/linked-anchor";
import { commitDocThenCards } from "@/components/drop-mode/commit-seam";
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
 * Correct a range for a mutation the gesture ITSELF performed strictly inside
 * that range. Since task 735 there is ONE such step: a
 * SETTLE's `revert`, which splices the pre-suggestion original back over the
 * applied text (task 636) — `delta` of either sign, since the original may be
 * longer than what replaced it. (The F2 inline-atom strip that used to share
 * it is gone — see `commitRangeDelete`.)
 *
 * It is, by construction, strictly INSIDE `[from, to)`: a settle only ever
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
 * second phase (`commitRangeDelete`) by holding one
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
