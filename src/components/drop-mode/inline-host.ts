/**
 * The INLINE-CURSOR container question, for the drop-mode / slice family.
 *
 * `posHostsInlineAtom` (task 150, `text-objects/text-object-registry.ts`) is the
 * SSOT for *can this position host an inline atom without corrupting its
 * container?* Task 396 wired every CREATE door to it and scoped the drop-mode
 * family OUT, as a stated residual: the fix there belongs at the ONE hit-test
 * chokepoint and is an AFFORDANCE change, not a door gate. This module is that
 * fix (task 414).
 *
 * WHAT IT PREVENTS, measured against the real `buildEditorExtensions("main")`
 * stack. The MARKLESS verbatim blocks (`codeBlock`, `latexComment`) declare
 * `content: "text*"` — literal text, no inline nodes. Splicing anything else at
 * an offset inside one TRUNCATES the block there and EJECTS its tail into a
 * fresh top-level paragraph:
 *
 *     insert citation at `% todo| fix later`
 *       → latexComment("% todo") + paragraph[citation, " fix later"]
 *       → `.tex`:  % % todo %!v:m1
 *                  \vcid{x}\cite{a} fix later
 *
 * i.e. **a line the user had commented OUT becomes live printed prose.** Nothing
 * throws, the doc is schema-valid, and the save writes it through. For the
 * cross-editor MOVE it is worse still: `insertLanded` (task 332) measures a
 * growth FLOOR, and the ejected tail INFLATES the growth — measured `+3` against
 * a floor of 1 — so the net FALSE-PASSES and the unconditional source delete
 * fires, taking a footnote's body (its `content` attr, which lives nowhere else)
 * with it. **A net whose measure is a growth floor cannot see a corruption that
 * grows the document.** The honest test is this container question, asked BEFORE
 * the delete.
 *
 * TWO READINGS OF ONE QUESTION, and the difference is load-bearing:
 *
 *  - **INLINE** payload nodes take `posHostsInlineAtom` verbatim — the precise
 *    per-type answer (a container could admit `citation` and not `footnote`).
 *  - **BLOCK** payload nodes (an OPEN slice whose ends sit in different blocks —
 *    an ordinary multi-paragraph selection) take the container family's THIRD
 *    member, `posHostsBlockInsert`. They may not take the atom predicate:
 *    measured, splicing `<p>AAA</p><p>BBB</p>` at a caret inside a `paragraph`
 *    legitimately SPLITS it, which is what the user asked for, and
 *    `posHostsInlineAtom(paragraph)` is false for a paragraph type — so that
 *    reading refuses a working drop.
 *
 *    They may not take a WEAKER proxy either, and that is this module's own
 *    first-cut defect, recorded rather than quietly corrected. It asked "does
 *    this textblock host any non-text content at all?" — true of every `inline*`
 *    textblock, since `citation`/`footnote`/`inlineMath` are all `group: inline`
 *    — on the stated ground that it "refuses the verbatim blocks and nothing
 *    else". That sentence was true and was the bug: an open slice at a caret does
 *    not merely split the textblock, it puts a BLOCK between the halves, so the
 *    question is what the caret's CONTAINER can host. Measured against the real
 *    schema, the proxy waved through three more families whose eject is the same
 *    truncate-and-eject shape:
 *
 *      titleField("My Lo|ng Title") → titleField("My LoAAA") + paragraph("BBBng Title")
 *      figureCaption("Cap t|ion")   → figureBlock[figureCaption("Cap tAAA")] + paragraph("BBBion")
 *      glossCell("aa| bb")          → the interlinear row torn in two, alignment destroyed
 *
 *    `posHostsBlockInsert` asks both halves at once — the caret's own textblock
 *    must survive the split (layer 1: the `titleField` singleton, the markless
 *    verbatim family) AND its container must host the block as a sibling (layer
 *    2: `figureBlock` is `figureCaption?`, `alignedGlossRow` is `glossCell*`,
 *    neither hosts one) — and it allows `doc` / `listItem` / `blockquote` /
 *    `exampleItem`, so every ordinary prose split still lands.
 *
 * SCOPE, stated rather than implied. This answers the NODE question only. Marked
 * text spliced into a markless block is a DIFFERENT question and deliberately
 * not asked here: measured, PM drops the disallowed marks and the block is
 * intact (`codeBlock("helloXX world")`), so there is no corruption to refuse and
 * inventing one would be a false refusal — the failure mode task 396's own first
 * cut had. The BLOCK-in-container question (a block payload at a *between-blocks*
 * gap) is the container FIT's (`fitNodesAtInsert`), which every gap splice in
 * this directory already enters.
 */

import type { Editor } from "@tiptap/react";
import type {
  Fragment,
  Node as PMNode,
  NodeType,
  Slice,
} from "@tiptap/pm/model";
import {
  posHostsBlockInsert,
  posHostsInlineAtom,
} from "@/text-objects/text-object-registry";
import { refuseOnThrow } from "./planned-spec";
import type { DropCtx, DropSpec } from "./types";

/**
 * What a drop will place at an inline cursor, as SCHEMA NODE NAMES — resolved
 * ONCE per session (see {@link resolveSessionInlinePayload}) so the hit-test
 * pays nothing per throttled pointermove.
 *
 * Names rather than `NodeType`s because a payload may be resolved from a source
 * editor, from persisted JSON, or from a spec's static configuration, while the
 * question is asked against the TARGET editor's schema — and two schemas built
 * from one extension list hold DISTINCT `NodeType` objects (the identity fact
 * behind task 328). A name is the one currency both ends share.
 *
 * EMPTY means "plain text only": nothing here can tear a container, so nothing
 * is refused. It is an ANSWER, never a "don't know" — an unresolvable payload
 * has already been refused a placement by `placementsFor`.
 */
export type InlineDropPayload = readonly string[];

/** The shared empty answer — a payload of plain text, which every textblock
 *  hosts. */
export const TEXT_ONLY_PAYLOAD: InlineDropPayload = [];

/**
 * Resolve the session's inline payload ONCE, at `beginDropSession` — the twin
 * of `resolveSessionPlacements`, and for the same reasons: the resolution is
 * free to read persisted state (stack-pull parses its whole localStorage
 * envelope) or walk a document range, costs a throttled pointermove nothing, and
 * freezing the answer at mousedown keeps the affordance stable for the gesture.
 *
 * A spec that declares no resolver answers TEXT-ONLY, which refuses nothing.
 * That is safe for the specs that never produce an `inline-cursor` placement (a
 * paragraph-side re-anchor has no payload to splice), and it is a hole for one
 * that DOES — so the census in `placement-reachability.test.ts` asks the LIVE
 * spec objects for the implication `declares inline-cursor ⇒ declares
 * inlinePayloadFor`, allowlist EMPTY.
 *
 * A THROW is TEXT-ONLY, contained at the DOOR rather than at the call site — the
 * rule `inlineAtomMoveSpec` states about its own resolution ("the guard wraps the
 * RESOLUTION rather than each door, so a third door cannot forget it"). It is
 * reachable: the in-text grab's resolver ends at `doc.nodeAt(src.pos)`, and
 * `Fragment.findIndex` throws `RangeError` on a position past the fragment — a
 * captured position can be stale if a collab edit shrank the doc between the
 * grab and the mousedown. `beginDropSession` is called from a producer's
 * mousedown with no catch, so an escaped throw would abort the gesture before
 * `installListeners`, leaving the crosshair and the lift overlay with no session
 * to end them. Answering TEXT-ONLY costs nothing: the same resolver failing is
 * what makes `resolveDrop` refuse the whole drop a moment later.
 */
export function resolveSessionInlinePayload(
  spec: DropSpec,
  cardKey: string,
  ctx: DropCtx,
): InlineDropPayload {
  if (!spec.inlinePayloadFor) return TEXT_ONLY_PAYLOAD;
  return (
    refuseOnThrow("resolveSessionInlinePayload", () =>
      spec.inlinePayloadFor?.(cardKey, ctx),
    ) ?? TEXT_ONLY_PAYLOAD
  );
}

// ─────────────────────────────────────────────────────────────────────
// The question
// ─────────────────────────────────────────────────────────────────────

/**
 * Can the textblock containing `pos` hold a node of `type` without being torn?
 * The ONE rule; every entry point below folds over it.
 */
function hostsType(doc: PMNode, pos: number, type: NodeType): boolean {
  if (type.isText) return true; // every textblock hosts text
  if (type.isInline) return posHostsInlineAtom(doc, pos, type);
  // A block at an inline cursor SPLITS the caret's textblock and lands between
  // the halves — so both questions the container family's block member asks are
  // exactly the right ones. See the header for the three families a weaker
  // proxy waved through.
  return posHostsBlockInsert(doc, pos, type);
}

/**
 * THE AFFORDANCE READING — can `pos` host the session's payload?
 *
 * A name the target schema does not declare is SKIPPED rather than refused: that
 * is the VOCABULARY question (task 328), answered by `schema-adopt.ts` at the
 * splice, and answering it here would be a second table for one question. Fails
 * OPEN by construction, which is the right direction — a missed refusal leaves
 * the splice's own gate to catch it, where a wrong one silently kills a working
 * drop.
 */
export function inlineCursorHostsPayload(
  editor: Editor,
  pos: number,
  payload: InlineDropPayload,
): boolean {
  const { doc, schema } = editor.state;
  for (const name of payload) {
    const type = schema.nodes[name];
    if (!type) continue; // vocabulary — not this question
    if (!hostsType(doc, pos, type)) return false;
  }
  return true;
}

/**
 * THE COMMIT READING, single node — exact, because the splice HOLDS the node.
 * Defence in depth behind the affordance: a refusal only the hover can see is
 * the task-321 defect, and the two doors must answer from one table.
 */
export function inlineCursorHostsNode(
  doc: PMNode,
  pos: number,
  node: PMNode,
): boolean {
  return hostsType(doc, pos, node.type);
}

/** THE COMMIT READING, slice — every distinct node type the slice would place. */
export function inlineCursorHostsSlice(
  doc: PMNode,
  pos: number,
  slice: Slice,
): boolean {
  for (const type of sliceNodeTypes(slice.content)) {
    if (!hostsType(doc, pos, type)) return false;
  }
  return true;
}

/**
 * Every node type the slice would place, walking CONTENT only.
 *
 * Deliberately NOT into attrs, and the omission is the precision: a footnote
 * carries its whole body in `attrs.content`, but that body is never spliced into
 * this textblock — the `footnote` ATOM is, and the atom is collected. Walking
 * attrs would report `paragraph` for every footnote in the payload and refuse a
 * drop that is perfectly legal. `payloadFromJson` mirrors this exactly, so the
 * affordance's name list and the commit's exact answer agree by construction.
 */
function sliceNodeTypes(content: Fragment, out = new Set<NodeType>()): Set<NodeType> {
  content.forEach((child) => {
    out.add(child.type);
    if (child.content.size > 0) sliceNodeTypes(child.content, out);
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Payload resolvers (the affordance's input)
// ─────────────────────────────────────────────────────────────────────

/** Distinct node type names in a live slice — the payload form for a spec whose
 *  source is a document range. */
export function payloadFromSlice(slice: Slice): InlineDropPayload {
  return [...sliceNodeTypes(slice.content)].map((t) => t.name);
}

/**
 * Distinct `type` names in a ProseMirror JSON tree (a `Slice.toJSON()` blob, a
 * node blob) — the payload form for a spec whose source is PERSISTED, where no
 * schema has been consulted yet.
 *
 * Deliberately shape-tolerant: the input is untrusted persisted data from
 * another build, and a name this build cannot resolve is skipped by
 * {@link inlineCursorHostsPayload} anyway.
 */
export function payloadFromJson(json: unknown): InlineDropPayload {
  const out = new Set<string>();
  collectJsonTypes(json, out, 0);
  return [...out];
}

function collectJsonTypes(json: unknown, out: Set<string>, depth: number): void {
  if (depth > 50 || json == null || typeof json !== "object") return;
  if (Array.isArray(json)) {
    for (const item of json) collectJsonTypes(item, out, depth + 1);
    return;
  }
  const rec = json as Record<string, unknown>;
  if (typeof rec.type === "string") out.add(rec.type);
  collectJsonTypes(rec.content, out, depth + 1);
}
