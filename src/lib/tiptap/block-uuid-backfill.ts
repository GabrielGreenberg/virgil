import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isAnchorableNode } from "@/lib/marginalia";
import { isDeferredInnerParagraph } from "@/lib/anchor-uuid";
import { readDocStructure } from "@/lib/tiptap/doc-structure";
import { generateShortId } from "@/lib/uuid";

// ─────────────────────────────────────────────────────────────────────────────
// BlockUuidBackfill — universal, keystroke-safe block identity.
//
// THE BUG IT FIXES
// Blocks created by `rangeSliceToBlocks` (the lifted-range / between-paragraphs
// drop), by paste, and by any other slice insertion are bare nodes whose
// `uuid` defaults to null (UUID_ATTR_SPEC). The grab handle finds graspable
// blocks via `querySelectorAll("[data-uuid]")` (resolveTextObjectsAtMouse),
// and `UuidAttrDecorator` only emits `data-uuid` for a NON-null uuid. uuids are
// otherwise minted lazily on interaction (`ensureAnchorUuid`) — but a block
// with no handle can't be interacted with to trigger that mint. So a dropped /
// pasted block stays handle-less: it has lost its text-object identity.
//
// THE FIX — ONE transaction-time backfill (not a per-call-site patch)
// This plugin guarantees that every anchorable block carries a unique, non-null
// `uuid` by the END of the transaction that inserted it. Drops, pastes, splits
// and any future programmatic insertion are therefore immediately graspable.
// `ensureAnchorUuid` stays as the lazy belt-and-suspenders path. The load-time
// sibling is `assignUuids` (latex-serializer): this is its live-insertion
// complement, centralizing block identity for ALL insertions in one place.
//
// KEYSTROKE SANCTITY (binding — see AGENTS.md)
// Runs in `appendTransaction`, registered right AFTER `DocStructureObserver`.
//   • O(1) bail on `!tr.docChanged`.
//   • Work is proportional to the INSERTED step ranges only (the same ranges
//     the observer's own `collectRange` walks every keystroke), NEVER a
//     full-doc walk. Plain typing inserts inline content with no block-start in
//     range → zero candidates → returns null before reading any doc-sized set.
//   • The one O(live-block-count) read (the observer's known-uuid set, to mint
//     collision-free + detect genuine duplicates) happens ONLY once at least
//     one inserted block needs an id — i.e. on a real structural insert, never
//     on a structurally-null keystroke.
// Note: we cannot consume `diff.addedBlocks` here — the step-inspector only
// records a block in `addedBlocks` when it ALREADY has a non-null, non-
// duplicate uuid (inspectNodeAt: `if (uuid && isAnchorableNode)` + the
// prevStructure dedup filter). A freshly-inserted null/duplicate-uuid block is
// invisible to the diff, which is exactly the gap this plugin closes — so it
// reads the inserted ranges directly instead.
//
// LOOP SAFETY
// The backfill is one size-stable `setNodeMarkup` per fixed block,
// `addToHistory:false`, tagged with `BACKFILL_META`. The plugin skips any
// transaction carrying that meta, and returns null when nothing needs fixing
// (mirrors MarginaliaAnchorGuard). After the backfill every touched block holds
// a unique id, so a re-walk finds no genuine duplicate either way → no loop.
//
// IDENTITY PRESERVATION (moves + float sync)
// A uuid is re-minted only when it is a GENUINE duplicate: still live in the
// doc from before this batch AND not the subject of a removal in the same batch
// (and not already kept earlier this pass). So a block MOVE (lifted-overlay's
// own gesture: delete-here + insert-there) keeps its uuid — the source removal
// exempts it — and a float↔main `setContent` re-sync (every synced block is
// both removed and re-inserted with its main uuid) keeps every uuid too. Only
// real copies (e.g. an Enter-split's cloned half) get a fresh id.
//
// A NET, NOT A MECHANISM (task 320)
// This plugin can see that two blocks collide; it cannot see which one the user
// meant to keep. Left to decide alone it keeps the FIRST occurrence in document
// order — which for a range move is the empty residue the cut left behind, so
// the moved text is re-minted and every card anchored to those words silently
// detaches from them. A gesture that RELOCATES content therefore states its own
// identity before dispatch (`@/lib/tiptap/node-identity`, the collision rule
// read off the post-cut doc), and this net catches only what no mechanism
// declared. Same division of labour as the container fit: the caller decides,
// the guard refuses to let a mistake through.
//
// SCOPED by "RE-PARENTING CONSERVES IDENTITY" below (task 499): that blindness
// is a fact about a delete-HERE / insert-THERE pair in two SEPARATE steps,
// where nothing links them. A `ReplaceAroundStep` links them in ONE, so for the
// re-parenting family this net states the identity itself.
//
// COORDINATES ARE PER-STEP (task 320)
// Step `si`'s positions live in `trk.docs[si]`, and reach the final doc through
// `trk.mapping.slice(si)` — its own map and the ones after it. Reading every
// step against `trk.before` and the FULL `trk.mapping` re-applies the earlier
// steps' maps to positions that already reflect them; for the delete-then-insert
// shape every relocation uses, that collapses the inserted range to nothing and
// the whole net goes silent while a duplicate lands in the document. (The same
// law the DocStructureObserver learned — see its multi-step step-inspector.)
// The RANGE stays the step's own span, never the ranges its StepMap reports: a
// ReplaceAroundStep's map omits the GAP, and a block lifted out of a
// listItem/blockquote becomes anchorable entirely inside that gap.
//
// RE-PARENTING CONSERVES IDENTITY (task 499)
// Shift-Tab out of a list, Backspace at an item's start, toggle-list-off,
// blockquote-off, toggle-list-ON, bullet ⇄ numbered — every one of them changes
// which container owns a block, and none of them declared an identity. So the
// listItem's uuid (the text object every card / todo / report / marginalia
// marker / sidecar entry was keyed on) left the document, the lifted paragraph
// got a stranger from this net, the orphan guard stripped every link, and the
// resurrection guard put an EMPTY husk carrying the old id above the user's own
// text. Two directions of ONE law close the whole class, and each is read where
// it is actually visible:
//
//   1. A CONTAINER THAT DISSOLVED HANDS ITS IDENTITY TO ITS SUCCESSOR.
//      Step-shaped, and only a `ReplaceAroundStep` can say it: its GAP is
//      content that is preserved and merely re-PARENTED, and its prefix
//      `[from, gapFrom)` is the container tokens stripped off the front of that
//      content. Ask what happened to the gap content's PARENT
//      (`planReparentTransfer`) and there are three answers —
//        stripped + a FRESH parent inserted → RETYPE (bullet list → numbered
//             list): the same list, differently rendered, so the new container
//             inherits;
//        stripped + NO new parent          → UNWRAP (Shift-Tab, the Backspace
//             lift branch, toggle-list-off, blockquote-off): the content was
//             promoted, so its FIRST block inherits;
//        neither                            → nothing (a mid-container SPLIT
//             lift — the container survives as the head half and keeps its id).
//
//   2. A BLOCK THAT STOPPED BEING A TEXT OBJECT HANDS ITS IDENTITY UP.
//      Result-shaped, so it needs no step at all: a `paragraph` that is now a
//      DEFERRED inner paragraph still carrying a uuid has an identity nothing
//      can reach — `anchorableUuidAt` and `resolveAnchorableNode` both skip it
//      and `assignUuids` strips it on the next save. If its container is BARE,
//      the container is the text object now and takes the id, and the block is
//      cleared so there is never a second live holder. Being result-shaped is
//      what makes it cover more than the wrap that motivated it: the extra
//      `listItem`s a multi-paragraph `wrapInList` mints with a plain `tr.split`
//      are the same shape and are covered by the same line.
//
// Reading the STRUCTURE rather than the gesture is what makes this one rule
// cover every surface — the Shift-Tab keymap, the Backspace lift branch, the
// lightning grid, the slash command, the `Mod-Shift` chords, a card-body
// toolbar and anything added later — because the net sees the transaction, not
// the command.
//
// WHY THE NET MAY ANSWER THIS AT ALL. `node-identity.ts` states that a net "can
// only tell that two blocks collide, not which one the user meant to keep", and
// that is true of a delete-HERE / insert-THERE pair in two SEPARATE steps,
// where nothing links them. A `ReplaceAroundStep` links them BY CONSTRUCTION,
// and a deferred inner paragraph's uuid is unreachable BY DEFINITION. Neither
// answer is a guess, which is why both are scoped to exactly those shapes and
// nothing wider. Every verification is fail-OPEN: a receiver that is not a bare
// anchorable node, a donor that no longer holds the id, a mapped position that
// drifted — each falls back to the fresh mint that shipped before this.
//
// CONTROLS, pinned rather than assumed: `sinkListItem` (Tab) re-parents a
// `listItem`, which is never a deferred paragraph, so it takes nothing; a
// blockquote wrapped around a HEADING leaves the heading anchorable in its own
// right; a mid-container split-lift leaves the head half holding the id; an
// Enter split still mints for the tail.
//
// KNOWN RESIDUALS, stated rather than implied. A MULTI-item lift merges the
// items into one before lifting (`liftOutOfList`'s own `tr.delete(pos-1,pos+1)`
// preamble), so only the FIRST item's identity is still available when the lift
// runs: the first lifted block conserves and the rest mint — the honest
// composition of a join (N text objects became one) and a split (one became N).
// And a block dropped INTO a container that ALREADY has an identity is absorbed
// by it: nothing bare is there to hand the id to, so the block's cards orphan,
// which is what being absorbed means.
// ─────────────────────────────────────────────────────────────────────────────

const BACKFILL_META = "blockUuidBackfill";

// A `paragraph` nested directly inside a DEFERRING_PARENTS container defers its
// anchor identity to the parent (the real text-object), and its uuid is
// stripped at serialization — so we never mint on it. The set + the predicate
// (`isDeferredInnerParagraph`) are the SSOT in `@/lib/anchor-uuid`, imported
// rather than re-declared so the "grabbable text-object" boundary can't drift
// between the mint resolve, this backfill, and the decoration walk. Every other
// anchorable kind (incl. nested lists, and a single example's graphicsBlock /
// displayMath / list body) is minted, matching `resolveAnchorableNode`'s policy.

interface BackfillFix {
  pos: number;
  attrs: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The re-parent transfer (task 499)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How an identity came to need a new holder — see the module header.
 *   `retype`/`unwrap` — direction 1, read off a `ReplaceAroundStep`'s gap.
 *   `defer`           — direction 2, read off the RESULT: a block that stopped
 *                       being a text object hands its id to its bare container.
 */
export type ReparentKind = "retype" | "unwrap" | "defer";

export interface ReparentTransfer {
  kind: ReparentKind;
  /** POST-STEP position of the node that must receive `uuid`. */
  receiverPos: number;
  /** The identity being conserved. */
  uuid: string;
  /**
   * Position of a node whose uuid must be CLEARED, so the transfer never
   * leaves two live holders. Only the `defer` case has one: the block that
   * became a deferred inner paragraph still carries the id in memory, and the
   * serializer would strip it on the next save anyway.
   */
  clearPos?: number;
}

/**
 * The node whose CONTENT holds `pos`, plus that node's own start position.
 * `null` at the document root (there is no container to speak of).
 */
function containerAt(
  doc: PMNode,
  pos: number,
): { node: PMNode; pos: number } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $p = doc.resolve(pos);
  if ($p.depth === 0) return null;
  return { node: $p.parent, pos: $p.before() };
}

function ownUuid(node: PMNode | null | undefined): string {
  const u = node?.attrs?.uuid;
  return typeof u === "string" && u.length > 0 ? u : "";
}

/**
 * Read a `ReplaceAroundStep` for the ONE question this rule asks: **what
 * happened to the parent of the content in the gap?** See the module header for
 * the four answers. Returns POST-STEP positions — the caller maps them into
 * final-doc coordinates through the maps that follow this step.
 *
 * Pure, O(depth): two `resolve`s and at most one `nodeAt`. Never reached on a
 * plain keystroke, which produces `ReplaceStep`s only.
 *
 * Exported so the rule can be exercised directly against hand-built steps.
 */
export function planReparentTransfer(
  step: ReplaceAroundStep,
  preDoc: PMNode,
  postDoc: PMNode,
): ReparentTransfer | null {
  // Where the preserved content sits BEFORE the step, and where it sits after:
  // `insert` is the offset INSIDE the slice at which the gap is spliced, and
  // the slice begins at `step.from`, so the gap's new start is exactly
  // `from + insert` (ReplaceAroundStep#apply: `slice.insertAt(insert, gap)`).
  const gapOld = step.gapFrom;
  const gapNew = step.from + step.insert;
  if (gapOld > preDoc.content.size || gapNew > postDoc.content.size) return null;

  const oldParent = containerAt(preDoc, gapOld);
  const newParent = containerAt(postDoc, gapNew);

  // STRIPPED: the old parent's own opening token lay in the removed prefix
  // `[from, gapFrom)`, so that node is gone (whatever the slice put in its
  // place is a different node).
  const stripped =
    oldParent !== null &&
    oldParent.pos >= step.from &&
    oldParent.pos < step.gapFrom &&
    isAnchorableNode(oldParent.node.type);

  // FRESH: the new parent's own opening token lies in the INSERTED prefix
  // `[from, from + insert)`, so it is a node this step created.
  const fresh =
    newParent !== null &&
    newParent.pos >= step.from &&
    newParent.pos < gapNew &&
    isAnchorableNode(newParent.node.type);

  if (stripped && fresh) {
    // RETYPE — one container replaced by another around the same content
    // (`toggleList` bullet ⇄ numbered). The list is the same list; only its
    // rendering changed, so its identity must not.
    //
    // The TYPE must differ, and that gate is load-bearing rather than tidy:
    // `tr.setNodeMarkup` is itself a `ReplaceAroundStep` of exactly this shape
    // (`gapFrom = from + 1`, `insert = 1`), so without it every in-place
    // attribute write would read as a re-parenting — and a deliberate write of
    // `uuid: null` would be silently undone by handing the old id straight
    // back. A same-type in-place write is the caller's own statement about that
    // node, never a container swap.
    const uuid = ownUuid(oldParent!.node);
    if (!uuid || ownUuid(newParent!.node)) return null;
    if (oldParent!.node.type === newParent!.node.type) return null;
    return { kind: "retype", receiverPos: newParent!.pos, uuid };
  }

  if (stripped) {
    // UNWRAP — the content was promoted out of a container that is now gone.
    // Its FIRST block is the successor text object, so it inherits. A first
    // block that already carries an id (a nested list lifted to an outer one)
    // has its own identity and is left alone.
    const uuid = ownUuid(oldParent!.node);
    if (!uuid) return null;
    const first = postDoc.nodeAt(gapNew);
    if (!first || !isAnchorableNode(first.type) || ownUuid(first)) return null;
    return { kind: "unwrap", receiverPos: gapNew, uuid };
  }

  // The WRAP direction is deliberately NOT answered here. A new container
  // closing around content is only an identity question when the content STOPS
  // being a text object, and that is a fact about the RESULT — so it is asked
  // once, of every inserted block, by direction 2 in `planBackfill`. Asking it
  // from the step would have covered `wrapInList`'s first item and missed the
  // extra items its `tr.split` mints, which are the same shape.
  return null;
}

/**
 * Walk every step in `transactions` that could re-parent content, and hand each
 * planned transfer to `visit` along with the coordinates needed to map it into
 * the final document. The ONE place that decides which steps the rule is asked
 * of, so the net and the resurrection guard cannot come to disagree about it.
 */
function forEachReparentPlan(
  transactions: readonly Transaction[],
  visit: (plan: ReparentTransfer, tx: Transaction, txIndex: number, stepIndex: number) => void,
): void {
  for (let k = 0; k < transactions.length; k++) {
    const trk = transactions[k];
    if (!trk.docChanged) continue;
    // Our own backfill re-writes nodes with `setNodeMarkup`, which IS a
    // ReplaceAroundStep — re-reading it would ask the rule about the answer it
    // just gave.
    if (trk.getMeta(BACKFILL_META)) continue;
    for (let si = 0; si < trk.steps.length; si++) {
      const step = trk.steps[si];
      if (!(step instanceof ReplaceAroundStep)) continue;
      const plan = planReparentTransfer(
        step,
        trk.docs[si] ?? trk.before,
        trk.docs[si + 1] ?? trk.doc,
      );
      if (plan) visit(plan, trk, k, si);
    }
  }
}

/**
 * Every block identity this batch hands to a SUCCESSOR because the container
 * that owned it dissolved — direction 1 of the law in the module header.
 *
 * Read by `MarginaliaAnchorGuard`, whose whole job is to put a vanished
 * anchored block's uuid back and which must NOT do so for an identity that is
 * not lost. It is the sibling of task 367's `resurrectionWouldBeANoOp`
 * stand-down: there the resurrection reproduced the removal (a silent veto of
 * the user's own gesture), here it would fight a transfer for an id that
 * already has a live successor — leaving the reported husk above the user's
 * text and forcing this net to mint the stranger beside it.
 *
 * Computed from the transactions' OWN steps, so it is independent of plugin
 * order: the guard and the backfill get the same answer whichever runs first.
 * O(re-parenting steps × depth); a plain keystroke produces none.
 */
export function reparentedUuids(
  transactions: readonly Transaction[],
): ReadonlySet<string> {
  const out = new Set<string>();
  forEachReparentPlan(transactions, (plan) => {
    // `defer` removes no block, so it can never trigger a resurrection.
    if (plan.kind !== "defer") out.add(plan.uuid);
  });
  return out;
}

/**
 * Invoke `visit` for every anchorable block whose OPENING token lies in
 * `[from, to)` of `doc`. Mirrors the step-inspector's `collectRange`: a node is
 * counted iff its start is inside the range, so ancestor blocks that merely
 * overlap (e.g. the enclosing paragraph while typing) are excluded. Cost is
 * proportional to the range, never the document.
 */
function forEachAnchorableStart(
  doc: PMNode,
  from: number,
  to: number,
  visit: (node: PMNode, pos: number, parent: PMNode | null) => void,
): void {
  const lo = Math.max(0, from);
  const hi = Math.min(to, doc.content.size);
  if (hi <= lo) return;
  doc.nodesBetween(lo, hi, (node, pos, parent) => {
    if (pos >= lo && pos < hi && isAnchorableNode(node.type)) {
      visit(node, pos, parent ?? null);
    }
    return true;
  });
}

/**
 * Compute the set of `setNodeMarkup` backfills needed so every anchorable block
 * inserted by `transactions` carries a unique, non-null uuid. Returns `[]` for a
 * structurally-null edit (the keystroke fast path) before touching any
 * doc-sized structure.
 */
function planBackfill(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): BackfillFix[] {
  const newDoc = newState.doc;
  // uuids whose owning block left the doc somewhere in this batch. A re-inserted
  // copy of such a uuid is a move / re-sync, not a duplicate → keep it.
  const removedUuids = new Set<string>();
  // Every anchorable uuid this batch INSERTED (any depth, deferred paragraphs
  // included). A freed identity is only safe to hand on if nothing this batch
  // re-created still answers to it — see the transfer's liveness gate below.
  const insertedUuids = new Set<string>();
  // Inserted anchorable blocks (deduped by position), in final-doc coordinates.
  const candidates: Array<{ pos: number; node: PMNode }> = [];
  const seenPos = new Set<number>();
  // Re-parent transfers, in FINAL-doc coordinates (task 499).
  const transfers: Array<ReparentTransfer> = [];

  for (let k = 0; k < transactions.length; k++) {
    const trk = transactions[k];
    if (!trk.docChanged) continue;
    // Never re-process our own backfill (its setNodeMarkup steps would otherwise
    // be re-walked; harmless since the ids are unique, but skipping is cheaper
    // and makes loop-freedom explicit).
    if (trk.getMeta(BACKFILL_META)) continue;
    for (let si = 0; si < trk.steps.length; si++) {
      const step = trk.steps[si];
      // The step's own SPAN `[from, to)`, not the ranges its StepMap reports.
      // The two differ on exactly the case that matters: a `ReplaceAroundStep`'s
      // map covers only its two SIDE ranges, deliberately omitting the GAP — the
      // preserved content that changes PARENT. Anchorability here is a function
      // of the parent (`isDeferredInnerParagraph`), so a paragraph LIFTED out of
      // a listItem/blockquote to top level becomes a first-class text object
      // entirely inside that gap; taking ranges from the map alone made every
      // toggle-list-off / toggle-blockquote-off / Backspace-at-list-start leave
      // the lifted block with a null uuid, hence no `data-uuid`, hence no grab
      // handle and no anchorable target — verbatim the bug this plugin exists to
      // fix (review-caught). Steps that expose no span move no content and can
      // insert no block, so skipping them loses nothing.
      if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) {
        continue;
      }
      // Coordinates are PER-STEP, not per-transaction (task 320 — the same law
      // the DocStructureObserver learned): step `si`'s positions live in the doc
      // BEFORE step si (`trk.docs[si]`), and reach the final doc through the maps
      // FROM si onward (`trk.mapping.slice(si)`). Reading every step against
      // `trk.before` + the FULL `trk.mapping` re-applies the earlier steps' maps
      // to positions that already reflect them, which for a delete-then-insert
      // transaction collapses the inserted range to nothing — so a multi-block
      // range move's duplicated uuids reached the document with the net silent.
      const preDoc = trk.docs[si] ?? trk.before;
      const stepOnward = trk.mapping.slice(si);
      // Removed range, in this STEP's pre-doc coordinates.
      forEachAnchorableStart(preDoc, step.from, step.to, (node) => {
        const u = node.attrs?.uuid;
        if (typeof u === "string" && u) removedUuids.add(u);
      });
      // Inserted range, mapped into final-doc coordinates: this step's own map
      // and the rest of the transaction's, then any later transaction's.
      let from = stepOnward.map(step.from, -1);
      let to = stepOnward.map(step.to, 1);
      for (let j = k + 1; j < transactions.length; j++) {
        from = transactions[j].mapping.map(from, -1);
        to = transactions[j].mapping.map(to, 1);
      }
      forEachAnchorableStart(newDoc, from, to, (node, pos, parent) => {
        const inserted = node.attrs?.uuid;
        if (typeof inserted === "string" && inserted) insertedUuids.add(inserted);
        // A container-nested body paragraph (list / blockquote / code /
        // exampleItem / exampleBlock) defers to its parent — don't give it its
        // own identity (matches resolveAnchorableNode and keeps inner-paragraph
        // uuids out of the serialized .tex).
        if (isDeferredInnerParagraph(node, parent)) {
          // …and if it still CARRIES one, that identity is already unreachable
          // (`anchorableUuidAt` skips it, `assignUuids` strips it on the next
          // save). Direction 2 of the law: hand it to the container that just
          // took over as the text object, when that container is bare. The
          // O(depth) resolve runs only on this rare shape — a paragraph is
          // deferred AND uuid-bearing only just after something wrapped it.
          if (typeof inserted === "string" && inserted) {
            const $p = newDoc.resolve(pos);
            if ($p.depth > 0 && !ownUuid($p.parent) && isAnchorableNode($p.parent.type)) {
              transfers.push({
                kind: "defer",
                receiverPos: $p.before(),
                uuid: inserted,
                clearPos: pos,
              });
            }
          }
          return;
        }
        if (seenPos.has(pos)) return;
        seenPos.add(pos);
        candidates.push({ pos, node });
      });
    }
  }

  // Keystroke fast path: nothing structural was inserted → no doc-sized read.
  if (candidates.length === 0) return [];

  // ── direction 1: a container that DISSOLVED hands its id to its successor ──
  // One pass over the re-parenting steps, through the shared door, so the net
  // and the resurrection guard read the same rule. Only a ReplaceAroundStep can
  // re-parent content and only it carries the gap that says WHICH content
  // survived; a plain keystroke produces none, so this costs nothing on the
  // typing path.
  forEachReparentPlan(transactions, (plan, trk, k, si) => {
    // Post-step → final-doc coordinates, through the maps AFTER this step and
    // every later transaction's. A node START moves with the content after it,
    // hence assoc 1. A mapping that lands somewhere unexpected simply fails to
    // match a candidate, and the mint happens exactly as it did before.
    const rest = trk.mapping.slice(si + 1);
    const toFinal = (pos: number): number => {
      let out = rest.map(pos, 1);
      for (let j = k + 1; j < transactions.length; j++) {
        out = transactions[j].mapping.map(out, 1);
      }
      return out;
    };
    transfers.push({
      ...plan,
      receiverPos: toFinal(plan.receiverPos),
      clearPos: plan.clearPos === undefined ? undefined : toFinal(plan.clearPos),
    });
  });

  // Resolve the re-parent transfers against the FINAL doc before minting
  // anything. Each is verified at its own landing site — the receiver must
  // really be a bare anchorable node, and a WRAP's cleared block must really
  // still hold the id — so a mapping that drifted, or a later step that
  // reshaped the result, simply falls back to a fresh mint. Fail-open, always:
  // a missed transfer is the pre-499 behaviour, a wrong one is a duplicate.
  const transferByPos = new Map<number, ReparentTransfer>();
  const transferredUuids = new Set<string>();
  for (const plan of transfers) {
    if (transferByPos.has(plan.receiverPos)) continue; // first step wins
    if (transferredUuids.has(plan.uuid)) continue; // one successor per identity
    // A freed identity is only free if nothing this batch re-created answers
    // to it. The `defer` case is exempt: its one other holder is `clearPos`,
    // which this same pass clears in the same transaction.
    if (plan.kind !== "defer" && insertedUuids.has(plan.uuid)) continue;
    const receiver = newDoc.nodeAt(plan.receiverPos);
    if (!receiver || !isAnchorableNode(receiver.type) || receiver.attrs?.uuid) continue;
    if (plan.clearPos !== undefined) {
      const donor = newDoc.nodeAt(plan.clearPos);
      if (!donor || donor.attrs?.uuid !== plan.uuid) continue;
    }
    transferByPos.set(plan.receiverPos, plan);
    transferredUuids.add(plan.uuid);
  }

  // A real insertion. NOW consult the observer's incrementally-maintained
  // known-uuid set (O(live blocks), but only on actual inserts — human-paced,
  // never per keystroke). It is the complete set of live anchorable uuids, so
  // minting against it is globally collision-free.
  const known = readDocStructure(oldState).blocks;
  const usedIds = new Set<string>(known.keys());
  const keptThisPass = new Set<string>();
  // Document order so "keep the first occurrence" matches assignUuids.
  candidates.sort((a, b) => a.pos - b.pos);

  const fixes: BackfillFix[] = [];
  for (const { pos, node } of candidates) {
    const u = node.attrs?.uuid;
    const hasId = typeof u === "string" && u.length > 0;
    const isDuplicate =
      hasId &&
      (keptThisPass.has(u as string) ||
        (usedIds.has(u as string) && !removedUuids.has(u as string)));
    if (hasId && !isDuplicate) {
      // Legitimate identity (pre-existing-and-moved, freshly minted upstream, or
      // the first occurrence of a uuid this pass). Register and keep.
      keptThisPass.add(u as string);
      usedIds.add(u as string);
      continue;
    }
    // A CONSERVED identity beats a fresh one: this block is the successor of a
    // container the same transaction dissolved (or the container that just
    // closed around a block whose identity is about to be stripped), so every
    // card, marginalia marker and sidecar entry keyed on that id follows the
    // text instead of orphaning.
    const transfer = transferByPos.get(pos);
    if (transfer) {
      usedIds.add(transfer.uuid);
      keptThisPass.add(transfer.uuid);
      fixes.push({ pos, attrs: { ...node.attrs, uuid: transfer.uuid } });
      if (transfer.clearPos !== undefined) {
        const donor = newDoc.nodeAt(transfer.clearPos);
        if (donor) {
          fixes.push({
            pos: transfer.clearPos,
            attrs: { ...donor.attrs, uuid: null },
          });
        }
      }
      continue;
    }
    const fresh = generateShortId(usedIds);
    usedIds.add(fresh);
    keptThisPass.add(fresh);
    fixes.push({ pos, attrs: { ...node.attrs, uuid: fresh } });
  }
  return fixes;
}

/**
 * The raw ProseMirror plugin. Exported so it can be exercised in a plain
 * `EditorState` (no TipTap Editor) in tests.
 */
export function blockUuidBackfillPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("blockUuidBackfill"),
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const fixes = planBackfill(transactions, oldState, newState);
      if (fixes.length === 0) return null;
      const tr = newState.tr;
      for (const { pos, attrs } of fixes) {
        tr.setNodeMarkup(pos, undefined, attrs);
      }
      tr.setMeta(BACKFILL_META, true);
      tr.setMeta("addToHistory", false);
      return tr.steps.length > 0 ? tr : null;
    },
  });
}

/**
 * TipTap extension wrapper. Register right after `DocStructureObserver` in
 * `buildEditorExtensions` so the typed diff machinery is loaded first and both
 * the main editor and every float surface get universal block identity.
 */
export const BlockUuidBackfill = Extension.create({
  name: "blockUuidBackfill",
  addProseMirrorPlugins() {
    return [blockUuidBackfillPlugin()];
  },
});
