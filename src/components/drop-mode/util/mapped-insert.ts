/**
 * The delete-then-insert splice, spelled once (task 331).
 *
 * > **ASK the transaction where a position went; never predict it — and advance
 * > a multi-node cursor by what ACTUALLY landed, never by `n.nodeSize`.**
 *
 * Both halves of that rule were already written down (`AGENTS.md`, "The move
 * half" and "The identity half") and both were re-derived per call site, so the
 * repo shipped four copies of the arithmetic and two copies of the mapping —
 * correct in `specs/textobject.ts` since task 234 and stale in its three twins.
 *
 * ── Why the prediction is wrong ─────────────────────────────────────────────
 *
 * `insertPos > to ? insertPos - (to - from) : insertPos` assumes `tr.delete`
 * removes exactly the range's declared width. It does not when ProseMirror must
 * keep a **minimal valid residue** in a parent whose content expression forbids
 * emptiness. Measured against the REAL editor schema:
 *
 *   • an `exampleBlock` that is the sole child of a `blockquote` (`block+`):
 *     declared 15, removed 13 → the insert lands **2 early**;
 *   • an `exampleItem` that is the sole child of an `exampleItemList`
 *     (`exampleItem+`, the shape expex's own Tab keymap creates): declared 7,
 *     removed 3 → **4 early**, the drift task 234 measured.
 *
 * "Early" means inside the preceding block's text, which the fitter can only
 * accommodate by CLOSING that block — one node torn into two that both keep the
 * original uuid, on a document that still `check()`s clean. Every guard upstream
 * is blind to it by construction: `canDropDirectAt` and `fitNodesAtInsert`
 * (including its trial-insert probe) resolve against the PRE-delete doc, where
 * the position is correct and the fit honestly reports `direct`. Nothing
 * re-validates after the delete. The mapping does, for free, and it is also
 * correct for the untouched direction — a position BEFORE the cut maps to
 * itself, so a converted call site is byte-identical wherever the prediction was
 * already right.
 *
 * ── Why the ORIGIN is a required, named union ───────────────────────────────
 *
 * A defaulted answer is a decision nobody made. `mapThrough` and `liveAt` are
 * different claims about the SAME integer — "this is a pre-delete coordinate,
 * ask the mapping" versus "this is already in the transaction's current
 * coordinates" — and only the caller knows which. `text-range-move`'s
 * between-blocks branch is the reason the second exists: it interposes
 * `dropEmptiedSourceBlock` between the cut and the insert, which maps the
 * position itself and can then RE-map it when it sheds the residue, so what it
 * holds at insert time is already live. Folding that into an implicit "map if a
 * delete happened" would silently double-map it.
 *
 * ── This module does NOT fit, and does not pretend to ───────────────────────
 *
 * `insertNodesAdvancing` is the splice DOOR, not the safety gate: the container
 * fit (`fitNodesAtInsert`) and the schema adoption (`schema-adopt.ts`) are the
 * caller's obligations and stay at the caller, where the refusal can still
 * return `null` before anything is deleted. So `container-fit-guardrail`
 * deliberately counts `insertNodesAdvancing(` as a splice site of its own and
 * asks both questions at every call site — the wrapper buys no exemption from
 * either. That is what makes this file's own two allowlist entries honest rather
 * than a hole (task 204's rule: an exemption is scoped to the shape it
 * justifies).
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Where an insert position comes from. Exactly one of:
 *
 *  • `mapThrough` — a coordinate in the doc as it was BEFORE the steps this
 *    transaction already holds (the delete). Resolved through `tr.mapping`.
 *  • `liveAt` — a coordinate already expressed in the transaction's CURRENT
 *    doc (a caller that has mapped, or re-mapped, it itself; or a transaction
 *    with no prior steps, where the two answers coincide and saying so is more
 *    honest than mapping through an empty mapping).
 */
export type InsertOrigin =
  | { readonly mapThrough: number }
  | { readonly liveAt: number };

/** The range the insert occupied, in the transaction's post-insert doc. */
export interface InsertedSpan {
  readonly start: number;
  readonly end: number;
}

/** Resolve an `InsertOrigin` against the transaction's steps so far. */
export function resolveInsertPos(tr: Transaction, origin: InsertOrigin): number {
  return "mapThrough" in origin ? tr.mapping.map(origin.mapThrough) : origin.liveAt;
}

/**
 * Insert `nodes` at `origin`, advancing the cursor by the transaction's ACTUAL
 * size delta per node — never by `n.nodeSize`. Rule 3 of the container fit
 * sanctions an insert the fitter PADS (it adds whatever the content expression
 * requires around the payload), which adds more than the node itself; advancing
 * by the node's own size would then put the next block inside or before this one.
 *
 * Returns the span the payload occupies, so the caller's selection is derived
 * from what landed rather than re-predicted from the same wrong arithmetic.
 */
export function insertNodesAdvancing(
  tr: Transaction,
  origin: InsertOrigin,
  nodes: ReadonlyArray<PMNode>,
): InsertedSpan {
  const start = resolveInsertPos(tr, origin);
  let cursor = start;
  for (const n of nodes) {
    const before = tr.doc.content.size;
    // container-fit-exempt: the shared splice PRIMITIVE. It fits nothing and
    // claims nothing — `container-fit-guardrail` treats every
    // `insertNodesAdvancing(` call as a splice site, so the fit obligation is
    // asked at each CALLER, which is also the only place a refusal can return
    // before the source is deleted.
    // schema-adopt-exempt: same reason, other axis — the adoption is the
    // caller's obligation and is asked of the caller by the same census. A
    // wrapper that absorbed either question would hand every converted site a
    // silent exemption, which is the drift both halves of that guard exist to
    // catch.
    // inline-host-exempt: the shared splice DOOR. It claims nothing and fits
    // nothing; the inline CONTAINER question is asked of every CALLER through
    // the `insertNodesAdvancing(` splice-call form, which is also the only
    // place a refusal can return before a source is deleted (task 414).
    tr.insert(cursor, n);
    cursor += tr.doc.content.size - before;
  }
  return { start, end: cursor };
}

/**
 * Place a COLLAPSED caret at the start of what landed.
 *
 * > **A move's exit state is read by the NEXT gesture as user intent, so it is
 * > stated in the vocabulary of what MOVED — and a whole-node splice never
 * > leaves a content-spanning TextSelection behind.**
 *
 * This used to select the landed span (`span.start + 1` … `span.end - 1`) "so
 * the user sees where the payload landed", and that was a *view* signal written
 * into the one piece of editor state every other gesture consults — the
 * transient-state law one file over (`AGENTS.md`, "Transient state is never
 * document content"). The cost was a payload flip at the SAME PIXEL (task 482):
 *
 *   1. a between-blocks block move ends here, leaving a non-empty TextSelection
 *      over the moved block's own content;
 *   2. the grab-handle resolver gives a live non-empty TextSelection absolute
 *      priority over the hovered block (`resolveActiveRefs` rule 1), so the one
 *      handle at that row is a SelectionRef and the BLOCK's handle is GONE —
 *      replaced within ~6px of where it was;
 *   3. lifting it hydrates a transient `linkedRange` and routes to
 *      `textRangeMoveDropSpec`, whose placements include `inline-cursor`, so a
 *      release over another block's text takes the INLINE branch;
 *   4. that branch splices the text MID-WORD and (deliberately, :192-199) sheds
 *      no shell, so the source `listItem` survives as an EMPTY husk still
 *      carrying its uuid — every card and marker anchored to it now points at an
 *      invisible blank bullet, and undo needs two steps.
 *
 * Every piece behaved as designed. What was wrong is that **the second drag in a
 * sequence had different semantics from the first**, decided by an exit state
 * the user never chose. A caret cannot be mistaken for a text-lift gesture (the
 * resolver's rule 1 requires `from !== to`), so the moved block's own handle is
 * back at that pixel and sequences compose.
 *
 * Deliberately NOT a `NodeSelection` on the landed node, although rule 2 of that
 * same resolver would then answer with the block: prosemirror-view's base
 * stylesheet is not loaded here, so `.ProseMirror-selectednode` is unstyled for
 * every kind but `latex-comment`/`expex-block` — a node selection would be
 * visually INVISIBLE *and* would add `ProseMirror-hideselection`, which is
 * strictly worse feedback than a blinking caret. `texBlock`/`forestBlock` also
 * declare `selectable: false`, so it could not have been uniform anyway. If the
 * "here is what landed" flash is wanted back it belongs in a DECORATION with its
 * own clear (task 120), not in the selection.
 *
 * The inline-cursor branch of `text-range-move` keeps its own `selectInserted`
 * text selection, and that contrast is the rule rather than an exception: what
 * landed there IS text inside an existing block, so a text selection states it
 * truthfully. Everything routed through `insertNodesAdvancing` landed whole
 * NODES.
 *
 * Guarded: a boundary that cannot host a text position leaves the document's own
 * selection alone. That try/catch is not decoration — since task 321 these
 * transactions are built inside `planDrop`, which `classifyDrop` calls BARE
 * inside the controller's `async commitDropSession`; an escaped throw there
 * becomes a rejected promise that never reaches `endDropSession()`, leaking the
 * window listeners, the `data-drop-mode-active` body attr and the lift overlay
 * past mouseup. Two of the three call sites this replaced had the guard and one
 * did not.
 */
export function placeCaretAtLanding(tr: Transaction, span: InsertedSpan): void {
  try {
    // `between($at, $at)` is the TOTAL form: where the landing point is already
    // inline content it is a plain collapsed caret, and where it is not (an atom
    // pod, a container's own boundary) it searches TEXT-ONLY for the nearest
    // real text position rather than throwing or minting a node selection. The
    // one shape it cannot answer is a document with no text position anywhere,
    // where it degrades to `Selection.near` — which has no uuid-bearing ancestor
    // to resolve against, so it cannot produce a SelectionRef either.
    const $at = tr.doc.resolve(Math.min(span.start + 1, tr.doc.content.size));
    tr.setSelection(TextSelection.between($at, $at));
  } catch {
    /* boundary can't host a caret — leave the doc's selection */
  }
}
