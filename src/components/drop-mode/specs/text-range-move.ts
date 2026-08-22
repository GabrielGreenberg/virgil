/**
 * Drop spec for a plain text SELECTION lifted as a `linkedRange` (L3f-2).
 *
 * A plain selection grab hydrates a transient `linkedAnchor` over the range
 * and drives the lifted overlay (TextObjectGrabHandle). On a ghost-mode
 * release over text this spec MOVES the marked run to the inline caret —
 * the range analogue of `textobject.ts`'s block move, but the payload is a
 * text SLICE (possibly partial-paragraph), not a whole node, and it inserts
 * at an inline-cursor position rather than between blocks.
 *
 * SCOPE: two targets, mirroring the user's "within-text caret + between-
 * paragraphs line" framing. `allowedPlacements: ["inline-cursor",
 * "between-blocks"]`. Over text the hit-test yields an inline caret and the
 * run MOVES to it (L3f-2). In a block gap it yields a between-blocks
 * placement and the run drops as BLOCK content, fit to the gap's context
 * (L3f-3) through the shared container-fit SSOT: a top-level gap → a new
 * paragraph, a list gap → a list item, an expex item gap → a new example item,
 * a single example's widened body / a blockquote → a paragraph inside it, and a
 * gap that can hold none of those → a refusal. A within-one-paragraph fragment
 * becomes its OWN paragraph (NOT merged into a neighbour — that is the
 * inline-cursor move's job); a multi-block range preserves its blocks, each
 * fitted individually (N blocks into a list / example gap → N items, matching
 * every other wrap site).
 *
 * The moved slice has every `linkedAnchor` mark STRIPPED
 * (`stripLinkedAnchorMarks`, mirroring `LinkedAnchorGuard.transformPasted`):
 * the relocated text carries no anchor identity — no transient handle litter,
 * consistent with paste semantics. The source-side transient mark is removed
 * separately by the grab handle's `removeTransientAnchor` after commit.
 *
 * IDENTITY (task 320) — "a move conserves identity; a split mints it."
 * The cut is TEXT-bounded (`findLinkedAnchorRange` returns text positions), so
 * it can never remove the FIRST source block: `tr.delete(from, to)` opens it and
 * joins what follows into it. The payload, meanwhile, comes from
 * `doc.slice(from, to)`, whose block children carry the SOURCE blocks' `uuid`
 * attrs verbatim. Left alone, a multi-block move therefore leaves two live
 * blocks answering to one uuid — the moved copy and the source residue — and a
 * uuid is the anchor identity every card/sidecar resolves against. So this spec
 * states the identity itself, through the ONE relocation SSOT
 * (`@/lib/tiptap/node-identity`): stage the deletion, drop the residue the cut
 * EMPTIED (a blank paragraph left where the text was is litter, not authored
 * content), then re-mint only the payload ids still live at the destination. A
 * whole-block move collides with nothing and the identity travels with the text;
 * a partial-first-block move collides on exactly that block, which keeps its id
 * at the source while the moved fragment — a new presence — mints a fresh one.
 * `BlockUuidBackfill` remains the net behind this, never the mechanism: it can
 * see that two blocks collide but not which one the user meant to keep, and
 * left to it the empty residue wins and every anchor silently detaches.
 *
 * The range's home is the main editor (the plain grab is on the main doc), so
 * the source is resolved from `ctx.mainEditor`. Same-editor drops delete +
 * adjusted-insert in one transaction (like block-move); a drop into a card
 * body inserts there then deletes from the source.
 *
 * VOCABULARY (task 328) — "a payload arrives in the target's vocabulary or not
 * at all", the law `AGENTS.md` states one paragraph after the identity one and
 * which this spec's INLINE branch used to break. The slice is adopted through
 * the target's schema ONCE, above the same/cross-editor fork, and every splice
 * that could cross an editor boundary is gated on evidence it LANDED before the
 * source delete is allowed to dispatch — see `schema-adopt.ts` for why those are
 * two obligations rather than one, and why the container fit could not carry
 * either of them to a branch deliberately exempted from the fit.
 */

import { TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { parseTextObjectPopoutKey } from "@/text-objects/text-object-registry";
import {
  findLinkedAnchorRange,
  rangeSliceToBlocks,
  stripLinkedAnchorMarks,
} from "@/lib/linked-anchor-range";
import {
  collectAtomIds,
  collectBlockUuids,
  inheritBlockUuid,
  remintCollidingIdentity,
} from "@/lib/tiptap/node-identity";
import { fitNodesAtInsert } from "./drop-context";
import { adoptSliceIntoSchema, insertLanded } from "../schema-adopt";
import {
  insertNodesAdvancing,
  resolveInsertPos,
  selectInsertedSpan,
} from "../util/mapped-insert";
import { plannedDropSpec } from "../planned-spec";
import {
  inlineCursorHostsSlice,
  payloadFromSlice,
  type InlineDropPayload,
} from "../inline-host";
import type { DropPlan, DropSpec, Placement } from "../types";

interface RangeSource {
  editor: Editor;
  from: number;
  to: number;
}

/** Resolve the marked range in the main doc (where the plain grab stamps it). */
function locateRange(cardKey: string, mainEditor: Editor | null): RangeSource | null {
  if (!mainEditor) return null;
  const ref = parseTextObjectPopoutKey(cardKey);
  if (!ref || ref.kind !== "linkedRange") return null;
  const range = findLinkedAnchorRange(mainEditor.state.doc, ref.id);
  if (!range) return null;
  return { editor: mainEditor, from: range.from, to: range.to };
}

/**
 * What the moved run would splice at an inline caret (task 414) — the node types
 * of the marked range itself, resolved from the SOURCE document once at
 * `beginDropSession`. A range that no longer resolves answers TEXT-ONLY: the
 * drop is already a refusal (`planDrop` returns null), so there is nothing for
 * this question to protect.
 */
function textRangeInlinePayloadFor(
  cardKey: string,
  ctx: import("../types").DropCtx,
): InlineDropPayload {
  const src = locateRange(cardKey, ctx.mainEditor);
  if (!src) return [];
  return payloadFromSlice(src.editor.state.doc.slice(src.from, src.to));
}

export const textRangeMoveDropSpec: DropSpec = plannedDropSpec({
  allowedPlacements: ["inline-cursor", "between-blocks"],
  inlinePayloadFor: textRangeInlinePayloadFor,
  targetScope: "any-editor",
  postDrop: "close",
  /**
   * ONE resolution, two doors (task 321). The placement guard and the self-drop
   * test used to live in `classifyDrop` while the payload refusals — an empty
   * slice, a range that converts to no blocks, a container fit that rejects —
   * lived only in `applyDrop`. So a range released in a gap that can hold none
   * of it classified as `apply`, the float closed, and the text stayed put.
   */
  planDrop(placement, cardKey, ctx): DropPlan | null {
    if (placement.kind !== "inline-cursor" && placement.kind !== "between-blocks") {
      return null;
    }
    const src = locateRange(cardKey, ctx.mainEditor);
    if (!src) return null;
    // Self-drop: releasing inside the source range leaves the text where it
    // was (no move). Both placements carry a doc position — the inline caret
    // (`pos`) or the block gap (`insertPos`).
    const dropPos =
      placement.kind === "inline-cursor" ? placement.pos : placement.insertPos;
    if (placement.editor === src.editor && dropPos >= src.from && dropPos <= src.to) {
      return null;
    }
    // Between-paragraphs (block-gap) drop — the run becomes block content,
    // fit to the gap's context. Kept in a sibling function so the L3f-2
    // inline-cursor move below stays byte-for-byte unchanged.
    if (placement.kind === "between-blocks") {
      return planRangeBetweenBlocks(placement, src);
    }
    const { editor: targetEditor, pos: insertPos } = placement;
    const { editor: sourceEditor, from, to } = src;

    // The payload: the marked slice with every linkedAnchor mark stripped, so
    // the relocated text sheds the transient (or any) anchor identity.
    const raw = stripLinkedAnchorMarks(sourceEditor.state.doc.slice(from, to));
    if (raw.size === 0) return null;

    // ADOPT before the branch, not inside it (task 328). The two obligations
    // are separate: the `container-fit-exempt:` markers below are true about
    // CONTAINERS — an open slice merging with the text around a caret enters no
    // container — and were silently read as covering VOCABULARY too, because
    // the adoption lived inside `fitNodesAtInsert`. It did not: a slice built
    // from the main doc's schema, spliced into a card body's, is content that
    // schema's `NodeType`s cannot name, so PM's fitter drops it and
    // `Transform.replace` appends NO step — and the source delete below ran
    // regardless. Hoisting the adoption above the same/cross fork makes it
    // unconditional rather than a branch someone has to remember: for a
    // same-editor move it returns the identical slice by identity (zero cost),
    // and for a cross-editor one it either re-hydrates the payload or REFUSES,
    // which leaves both documents untouched.
    const slice = adoptSliceIntoSchema(raw, targetEditor.state.schema);
    if (!slice || slice.size === 0) return null;

    // The INLINE-CURSOR move is deliberately left exactly as L3f-2 shipped it —
    // no shell removal, no re-mint — and the reason is the same law, not an
    // exemption from it. This branch dissolves the run INTO an existing block
    // rather than materializing new ones, so there is no payload block to hand a
    // freed identity to: shedding the emptied source block here would destroy its
    // uuid outright (the between-blocks branch can only shed it because a moved
    // block is there to inherit it). An empty shell that still answers to its id
    // is the better of the two, and it is what shipped.
    //
    // Re-mint: none needed today. The reason is NOT "the open slice's boundary
    // blocks never materialize" — with a range whose ends share a container
    // (`openStart`/`openEnd` ≥ 2) the trailing boundary node DOES materialize
    // with its source uuid. What keeps it collision-free is that a text-bounded
    // `tr.delete` joins BACKWARDS, so the block whose id survives at the source
    // is the leading one, which is precisely the one that merges away here. That
    // is a property of the delete rather than of this code, so the guarantee
    // rests on `BlockUuidBackfill` — which is what a net is for.
    // CONTAINER (task 414), asked ONCE above the same/cross fork — the same
    // placement as the ADOPTION two paragraphs up, and for the same reason: an
    // obligation both branches owe is a branch neither may forget. A markless
    // verbatim block (`codeBlock` / `latexComment`, `text*`) is TRUNCATED and
    // its tail EJECTED by an atom carried in the run, and by the run's own block
    // boundaries when the selection spans paragraphs. In the CROSS-editor branch
    // this is the load-bearing net: `insertLanded` below measures a growth FLOOR
    // and the ejected tail INFLATES the growth, so it false-passes and the
    // unconditional source delete takes the user's prose.
    if (!inlineCursorHostsSlice(targetEditor.state.doc, insertPos, slice)) return null;

    if (targetEditor === sourceEditor) {
      // Single transaction: delete the source, then ASK the transaction where
      // the caret went (task 331). This was `insertPos - (to - from)`; the cut
      // here is TEXT-bounded (`findLinkedAnchorRange` returns text positions),
      // and no shape has been measured where that prediction and the mapping
      // disagree — so this conversion is a HARDENING, not a bug fix, and its
      // honest claim is uniformity: the mapping is right wherever the
      // prediction was, and right where a residue would make it wrong. Its
      // three siblings ARE measurably wrong (see `mapped-insert.ts`), and a
      // rule that holds at three of four call sites is how this class recurs.
      const tr = targetEditor.state.tr.delete(from, to);
      const at = resolveInsertPos(tr, { mapThrough: insertPos });
      // container-fit-exempt: the INLINE-CURSOR move — an open slice merging with
      // the text around a caret is exactly what ProseMirror's fitter is for, and
      // no container is being entered. The between-blocks branch below fits.
      tr.replace(at, at, slice);
      selectInserted(tr, at, slice.size);
      return {
        commit: () => {
          targetEditor.view.dispatch(tr);
          targetEditor.view.focus();
        },
      };
    }

    // Cross-editor: insert into the target first, then delete from the source.
    // container-fit-exempt: the same inline-cursor move, cross-editor.
    const insertTr = targetEditor.state.tr.replace(insertPos, insertPos, slice);
    // THE REPORT IS THE PERMISSION (task 328) — the second, independent net.
    // Adoption settles the vocabulary; it does not settle the CONTENT
    // EXPRESSION, because `Slice.fromJSON` validates types and marks and not
    // where they may legally sit. So a payload the target can NAME but cannot
    // HOLD at this caret still reaches the fitter, which drops it silently.
    // This move's `commit` deletes the source unconditionally, so the delete is
    // gated on evidence the insert landed rather than on the absence of a throw.
    if (!insertLanded(insertTr, slice.size)) return null;
    selectInserted(insertTr, insertPos, slice.size);
    return {
      commit: () => {
        targetEditor.view.dispatch(insertTr);
        targetEditor.view.focus();
        // Built HERE, after the target insert has landed: a transaction is bound
        // to the doc it was built from, and this one is dispatched second (the
        // pre-321 order). This is the one genuinely cross-editor spec — a
        // main-doc selection released in a card body — so it is the one where
        // the ordering is not merely theoretical.
        sourceEditor.view.dispatch(sourceEditor.state.tr.delete(from, to));
      },
    };
  },
});

/** Select the inserted run so the user sees where the text landed. Guarded —
 *  a near-boundary position that can't host a text selection is skipped. */
function selectInserted(
  tr: import("@tiptap/pm/state").Transaction,
  pos: number,
  size: number,
): void {
  try {
    const end = Math.min(tr.doc.content.size, pos + size);
    tr.setSelection(
      TextSelection.between(tr.doc.resolve(pos), tr.doc.resolve(end)),
    );
  } catch {
    /* position couldn't host a text selection — leave the doc's selection */
  }
}

/**
 * Between-paragraphs move: drop the marked run into a block gap as BLOCK
 * content, fit to the gap's context. Mirrors `textobject.ts`'s element
 * block-move — `classifyParentAt` decides the context, then delete-source +
 * shed-the-emptied-shell + mapped-insert in one transaction (same-editor) /
 * insert-then-delete (cross-editor), advancing a cursor by each node's size.
 * The payload's identity is settled between the cut and the insert — see the
 * IDENTITY note at the top of this file. The difference from a node move: the
 * payload is the range's slice converted to blocks (`rangeSliceToBlocks` — an
 * inline run → one paragraph, a multi-block range → its blocks), not a whole
 * node, with the `linkedAnchor` mark stripped so the run sheds the transient
 * handle (consistent with the inline move + paste).
 *
 * Returns a PLAN, not a dispatch (task 321): every branch that can refuse
 * returns `null`, and `planDrop` hands that straight to `classifyDrop` as a
 * `no-op` so the session cancels instead of closing the float over an untouched
 * document. The transactions are built here and dispatched by `commit`.
 */
function planRangeBetweenBlocks(
  placement: Extract<Placement, { kind: "between-blocks" }>,
  src: RangeSource,
): DropPlan | null {
  const { editor: sourceEditor, from, to } = src;
  const targetEditor = placement.editor;
  const insertPos = placement.insertPos;

  const slice = stripLinkedAnchorMarks(sourceEditor.state.doc.slice(from, to));
  if (slice.size === 0) return null;
  const schema = sourceEditor.state.schema;
  const blocks = rangeSliceToBlocks(slice, schema);
  if (blocks.length === 0) return null;

  // Fit the drop context through the ONE container-fit SSOT (`fitNodesAtInsert`
  // → `fitNodeInContainer`), the same gate the whole-node moves pass through: a
  // top-level / blockquote gap takes the paragraph(s) bare, a list gap wraps
  // each block in a fresh `listItem` so the run JOINS the list, an expex
  // between-items gap wraps each in a fresh `exampleItem` so it joins the
  // EXAMPLE, and a single example's widened body takes it bare. This replaced a
  // list-only literal that restated exactly one of those facts: at an expex gap
  // it inserted a bare paragraph into `exampleItemList` and ProseMirror's fitter
  // split the example in two — both halves keeping the same uuid, the moved text
  // stranded at top level between them (task 257).
  //
  // A payload that fits NOWHERE here refuses outright rather than letting the
  // fitter improvise: this move deletes the source in the same transaction, so
  // an unrepresentable insert would destroy or relocate the user's text. A
  // refusal leaves the selection exactly where it was.
  const fit = fitNodesAtInsert(targetEditor, insertPos, blocks);
  if (fit.kind === "reject") return null;
  const nodes = fit.nodes;

  if (targetEditor === sourceEditor) {
    // Stage the cut FIRST, then read identity off the post-cut doc — that is
    // what makes "did the source presence survive?" the question being asked
    // (see `node-identity.ts`). Reading it from the pre-delete doc would re-mint
    // on every move and strand every anchor on the block left behind.
    const tr = targetEditor.state.tr.delete(from, to);
    const shed = dropEmptiedSourceBlock(tr, from, tr.mapping.map(insertPos));
    const start = shed.protect;
    // The identity the shell removal freed goes to the moved run — without this
    // a whole-paragraph range (the commonest form of this gesture) would shed
    // the source block and carry NO id on the payload, so the uuid would leave
    // the document entirely and every card anchored to it would orphan.
    const claimed = shed.freedUuid
      ? inheritBlockUuid(nodes, shed.freedUuid, targetEditor.state.schema)
      : nodes;
    const owned = remintCollidingIdentity(
      claimed,
      targetEditor.state.schema,
      collectBlockUuids(tr.doc),
      collectAtomIds(tr.doc),
    );
    // `liveAt`, not `mapThrough` (task 331): `dropEmptiedSourceBlock` above
    // already mapped `insertPos` through the cut and may have RE-mapped it when
    // it shed the residue, so `shed.protect` is in the transaction's current
    // coordinates. Mapping it again would double-count the delete.
    const span = insertNodesAdvancing(tr, { liveAt: start }, owned);
    selectInsertedSpan(tr, span);
    return {
      commit: () => {
        targetEditor.view.dispatch(tr);
        targetEditor.view.focus();
      },
    };
  }

  // Cross-editor: insert into the target first, then delete from the source.
  // The collision set is the TARGET doc's — uniqueness is a per-document
  // invariant, and the source presence is leaving anyway.
  const insertTr = targetEditor.state.tr;
  const owned = remintCollidingIdentity(
    nodes,
    targetEditor.state.schema,
    collectBlockUuids(insertTr.doc),
    collectAtomIds(insertTr.doc),
  );
  // `liveAt`: this transaction holds no prior steps (the source delete happens
  // in the OTHER editor, in `commit`), so `insertPos` is already live and saying
  // so is more honest than mapping it through an empty mapping.
  const span = insertNodesAdvancing(insertTr, { liveAt: insertPos }, owned);
  // The same landed net as the inline-cursor twin (task 328). This branch DOES
  // adopt — it goes through `fitNodesAtInsert` — so nothing known today can
  // reach it; that is precisely why it belongs here. The fit answers "can this
  // container hold it", the adoption answers "can this schema name it", and
  // neither answers "did ProseMirror actually keep it", which is the only
  // question the unconditional source delete in `commit` below depends on.
  if (!insertLanded(insertTr, owned.reduce((s, n) => s + n.nodeSize, 0))) {
    return null;
  }
  selectInsertedSpan(insertTr, span);
  return {
    commit: () => {
      targetEditor.view.dispatch(insertTr);
      targetEditor.view.focus();
      // The source delete is built HERE, after the target insert landed — a
      // transaction is bound to the doc it was built from and this one is
      // dispatched second (the pre-321 order; see the inline-cursor twin).
      // The source sheds its emptied shell too — but the freed uuid is NOT
      // transferred: the payload landed in a different document, where a
      // main-doc block id means nothing. Identity uniqueness is a per-document
      // invariant.
      const deleteTr = sourceEditor.state.tr.delete(from, to);
      dropEmptiedSourceBlock(deleteTr, from);
      sourceEditor.view.dispatch(deleteTr);
    },
  };
}

/**
 * Remove the PLAIN PARAGRAPH the cut emptied at the source. Returns the
 * (possibly re-mapped) `protect` position and the uuid the removal freed, so the
 * caller can hand that identity to the moved run.
 *
 * A text-bounded cut can never remove its FIRST block: `tr.delete(from, to)`
 * opens that block and joins what follows into it, so a range covering a
 * paragraph's whole content leaves a blank paragraph sitting where the text used
 * to be — the residue of a gesture, not authored content. That shell is also
 * what makes the identity question ambiguous at all: it is a live block still
 * answering to the uuid the moved text carries.
 *
 * PARAGRAPH ONLY, and this is the load-bearing narrowing. `Node.canReplace`
 * answers "is the PARENT still schema-valid without this child?", which is a
 * different question from "was this block the residue of the gesture?" — and for
 * a whole family of textblocks the answer to the first is yes while the answer
 * to the second is emphatically no, because their EXISTENCE carries meaning
 * their text does not:
 *
 *  • `glossCell` — `alignedGlossRow` is `glossCell*`, so the schema permits the
 *    removal, and removing one shifts every column to its right against the
 *    other tiers. Column position IS the semantics of an interlinear gloss, so
 *    emptying one cell's text and dropping the cell silently destroys the
 *    alignment (review-caught, measured: a 3-cell `\gla` became 2 against a
 *    3-cell `\glb`);
 *  • `proseGlossRow` (the `\glft` line), `titleField` (`\title{}`), `heading`
 *    (the `\section`, its outline entry and its fold), `codeBlock` — each would
 *    vanish outright where before an empty one survived, visible and fixable.
 *
 * No schema-derived predicate separates those from prose (a `glossCell` is even
 * its parent's default type), so this asks the narrow question it can answer
 * honestly: is the shell the schema's plain paragraph, carrying no attribute of
 * its own beyond the identity being transferred? A wrongly-kept empty paragraph
 * is visible and one keystroke to fix; a wrongly-removed gloss cell is silent
 * content corruption. The fail-safe direction picks itself.
 *
 * Two further guards: the parent must stay VALID without it (`Node.canReplace`,
 * which is also what keeps the doc's last remaining block and a `listItem`'s
 * only paragraph in place), and a `protect` position INSIDE the shell (the
 * drop's own insert point) vetoes the removal — deleting the block we are about
 * to insert into would lose the moved text. `protect` defaults to `-1` for the
 * caller with no insert point in this transaction (the cross-editor source
 * delete), which no shell can contain.
 */
interface ShellRemoval {
  /** `protect`, carried across the removal. */
  protect: number;
  /** The uuid the removed shell was holding, now free to travel. */
  freedUuid: string | null;
}

function dropEmptiedSourceBlock(
  tr: Transaction,
  cutFrom: number,
  protect = -1,
): ShellRemoval {
  const kept: ShellRemoval = { protect, freedUuid: null };
  let $cut;
  try {
    $cut = tr.doc.resolve(cutFrom);
  } catch {
    return kept; // the cut collapsed past a resolvable position — leave it
  }
  const depth = $cut.depth;
  if (depth < 1) return kept;
  const block = $cut.parent;
  if (block.content.size > 0) return kept;
  if (block.type !== tr.doc.type.schema.nodes.paragraph) return kept;
  // Any non-default attr beyond `uuid` is authored information the emptied text
  // didn't carry (a `parTitle`, i.e. a `\paragraph{…}` run-in heading) — the
  // block is then not residue either.
  for (const [key, value] of Object.entries(block.attrs)) {
    if (key === "uuid") continue;
    if (value !== (block.type.spec.attrs?.[key]?.default ?? null)) return kept;
  }
  const start = $cut.before(depth);
  const end = $cut.after(depth);
  if (protect > start && protect < end) return kept;
  const parent = $cut.node(depth - 1);
  const index = $cut.index(depth - 1);
  if (!parent.canReplace(index, index + 1)) return kept;
  const freed = block.attrs?.uuid;
  // Map `protect` through THIS removal only — `tr.mapping` starts at the
  // transaction's original doc, and `protect` has already been carried through
  // the steps before it.
  const mapFrom = tr.steps.length;
  tr.delete(start, end);
  return {
    protect: protect < 0 ? protect : tr.mapping.slice(mapFrom).map(protect),
    freedUuid: typeof freed === "string" && freed ? freed : null,
  };
}

