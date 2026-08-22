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
 *    an ordinary multi-paragraph selection) may NOT take it. Measured: splicing
 *    `<p>AAA</p><p>BBB</p>` at a caret inside a `paragraph` legitimately SPLITS
 *    it, which is what the user asked for; `posHostsInlineAtom(paragraph)` is
 *    false for a paragraph type, so that reading would refuse a working drop.
 *    What such a payload may NOT do is enter a textblock that hosts *nothing but
 *    text*, where the fitter truncates and ejects exactly as it does for an atom
 *    (measured: `codeBlock("hello|world")` → `codeBlock("helloAAA")` +
 *    `paragraph("BBB world")`). So the block reading asks the WEAKER question —
 *    "does this textblock host any non-text content at all?" — which refuses the
 *    verbatim blocks and nothing else.
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
import { posHostsInlineAtom } from "@/text-objects/text-object-registry";
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
 */
export function resolveSessionInlinePayload(
  spec: DropSpec,
  cardKey: string,
  ctx: DropCtx,
): InlineDropPayload {
  if (!spec.inlinePayloadFor) return TEXT_ONLY_PAYLOAD;
  return spec.inlinePayloadFor(cardKey, ctx) ?? TEXT_ONLY_PAYLOAD;
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
  return hostsNonText(doc, pos);
}

/**
 * The WEAKER question the block reading needs: does the textblock containing
 * `pos` admit any non-text content at all? False for exactly the markless
 * verbatim family (`content: "text*"`), true for every `inline*` textblock — so
 * an open multi-block slice still splits ordinary prose, which is the drop the
 * user asked for.
 *
 * Answered by asking the schema for a witness rather than by reading a content
 * expression as a STRING: the expression is the schema's business, and a
 * `"text*"` literal check would miss `text{0,}` and every equivalent spelling.
 * Memoized per `NodeType`, so the sweep runs once per container type per
 * process, never per pointermove.
 */
const NON_TEXT_HOSTS = new WeakMap<NodeType, boolean>();

function hostsNonText(doc: PMNode, pos: number): boolean {
  const parent = doc.resolve(clamp(doc, pos)).parent;
  if (!parent.isTextblock) return true; // a gap — PM wraps, nothing to tear
  const cached = NON_TEXT_HOSTS.get(parent.type);
  if (cached !== undefined) return cached;
  // The witness comes from the PARENT's own schema, never the payload type's:
  // `matchType` compares `NodeType`s by IDENTITY, so a candidate drawn from a
  // foreign schema could only ever answer "no" and would turn a vocabulary
  // question (settled by `schema-adopt.ts` before any of these callers) into a
  // silent refusal here.
  const schema = parent.type.schema;
  let answer = false;
  for (const name of Object.keys(schema.nodes)) {
    const candidate = schema.nodes[name];
    if (candidate.isText || !candidate.isInline) continue;
    if (parent.type.contentMatch.matchType(candidate) != null) {
      answer = true;
      break;
    }
  }
  NON_TEXT_HOSTS.set(parent.type, answer);
  return answer;
}

function clamp(doc: PMNode, pos: number): number {
  return Math.max(0, Math.min(pos, doc.content.size));
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
