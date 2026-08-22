/**
 * Drop-context classifier shared by the between-blocks drop specs, and the
 * editor-level face of the container-fit SSOT (`fitNodesAtInsert`, bottom of
 * this file) that EVERY between-blocks insert now passes through — the whole-
 * node move, the text-range move, the block-move factory, and the stack pull.
 *
 * `classifyParentAt` resolves the nearest enclosing TextObject kind at a doc
 * position: it walks depths innermost→outermost from the resolved position
 * and returns the first node whose type name is a registered TextObjectKind,
 * or null when the position sits at the top level (a sibling of top-level
 * blocks). A spec uses it to FIT inserted content to its context — a block
 * dropped into a list gap becomes a list item, into a blockquote a paragraph
 * inside the quote, at top level a bare paragraph.
 *
 * Canonical home (extracted for L3f-3's `text-range-move` between-paragraphs
 * drop). `textobject.ts` (the element block-move spec) carries a private twin
 * with the identical body, left untouched this session per the L3f-3
 * constraint not to modify the element-move spec; unify by pointing it here
 * the next time that file is edited.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { adoptNodeIntoSchema } from "../schema-adopt";
import { fitNodeInContainer } from "@/text-objects/drop-adapters";
import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";

export function classifyParentAt(
  editor: Editor,
  insertPos: number,
): TextObjectKind | null {
  const $pos = editor.state.doc.resolve(insertPos);
  // Walk depths from innermost outward; first TextObjectKind wins.
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name in TEXT_OBJECT_REGISTRY) {
      return name as TextObjectKind;
    }
  }
  return null;
}

/**
 * Schema-driven test: would inserting a bare node of `nodeType` at `insertPos`
 * leave the IMMEDIATE insert parent's content valid? (`$pos.parent.canReplaceWith`
 * at the resolved index.) This is the SSOT for the drop spec's wrap-vs-direct
 * decision — distinct from `classifyParentAt`, which collapses two structurally
 * different positions onto the same enclosing TextObjectKind.
 *
 * Concretely (Feature A2): a single example's widened body (parent
 * `exampleBlock`) and the multi between-items gap (parent `exampleItemList`)
 * BOTH classify as `exampleBlock` via `classifyParentAt` (which skips the
 * unregistered `exampleItemList`), yet the first must drop-direct and the second
 * must wrap. The immediate parent's schema separates them: `exampleBlock`
 * (post-widen) / `exampleItem` accept the bare block → true; `exampleItemList`
 * (content `exampleItem+`) rejects it → false. No magic parent-kind string.
 */
export function canDropDirectAt(
  editor: Editor,
  insertPos: number,
  nodeType: NodeType,
): boolean {
  const doc = editor.state.doc;
  if (insertPos < 0 || insertPos > doc.content.size) return false;
  const $pos = doc.resolve(insertPos);
  const index = $pos.index();
  return $pos.parent.canReplaceWith(index, index, nodeType);
}

/**
 * The editor-level face of `fitNodeInContainer` (drop-adapters.ts) — the ONE
 * gate every between-blocks insert passes through, whatever produced the
 * payload: a whole-node move (`textobject.ts`, `util/block-move.ts`), a text
 * SLICE converted to blocks (`text-range-move.ts`), or a stack pull
 * (`stack-pull.ts`). Resolves the insert position ONCE, then fits each node to
 * the immediate parent: bare where the parent accepts it, wrapped in a fresh
 * `listItem` / `exampleItem` / list / example where it doesn't but a wrapper
 * does, and REJECTED where neither works.
 *
 * The rejection is ATOMIC over the whole payload — one unfittable node rejects
 * the drop entirely. A between-blocks move deletes its source in the same
 * transaction as the insert, so a partial landing is content loss; the caller's
 * contract is "reject ⇒ dispatch nothing", which leaves the document untouched.
 *
 * Fitted against the LIVE doc at `insertPos` — the same doc the placement was
 * hit-tested against, and the same one `classifyParentAt` / `canDropDirectAt`
 * read — so the answer describes the container the user actually released over.
 */
export type InsertFit =
  | { kind: "ok"; nodes: ReadonlyArray<PMNode> }
  | { kind: "reject"; nodeType: string };

export function fitNodesAtInsert(
  editor: Editor,
  insertPos: number,
  nodes: ReadonlyArray<PMNode>,
  opts?: { prefer?: TextObjectKind },
): InsertFit {
  if (nodes.length === 0) return { kind: "ok", nodes };
  const doc = editor.state.doc;
  if (insertPos < 0 || insertPos > doc.content.size) {
    return { kind: "reject", nodeType: nodes[0].type.name };
  }
  const $pos = doc.resolve(insertPos);
  const parent = $pos.parent;
  const index = $pos.index();
  const schema = editor.state.schema;
  const fitted: PMNode[] = [];
  for (const raw of nodes) {
    // A cross-editor drop (`targetScope: "any-editor"` — a main-doc selection
    // released in a card body) builds its payload from the SOURCE editor's
    // schema, and every rung below compares NodeTypes by IDENTITY: two editors
    // built from the same extension list still hold two distinct `Schema`
    // objects, so a foreign node fails `canReplaceWith`, fails every wrap, and
    // reaches the fitter as content the target cannot describe. Re-hydrate it
    // through the TARGET schema first — which also makes the refusal the right
    // one when the target's vocabulary is genuinely narrower (a card body has
    // no `heading`), instead of a mis-fit nobody checked.
    //
    // The adoption itself now lives in `schema-adopt.ts` (task 328): it is an
    // obligation SEPARATE from fitting, and keeping it private here is what let
    // the two `container-fit-exempt:` inline splices skip it — an exemption
    // scoped to containers silently bought an exemption from vocabularies.
    // Nothing on the fitting path changed; this call is the same code, reachable
    // now by the splices that legitimately need it and nothing else.
    const node = adoptNodeIntoSchema(raw, schema);
    if (!node) return { kind: "reject", nodeType: raw.type.name };
    const fit = fitNodeInContainer(parent, index, node, schema, {
      prefer: opts?.prefer,
      bareInsertIsSafe: (n) => !bareInsertTearsContainer(editor, insertPos, n),
    });
    if (fit.kind === "reject") return { kind: "reject", nodeType: node.type.name };
    fitted.push(fit.kind === "wrap" ? fit.node : node);
  }
  return { kind: "ok", nodes: fitted };
}

/**
 * The container-fit ladder's last rung (rule 3 in `fitNodeInContainer`), asked
 * EMPIRICALLY rather than by predicting ProseMirror: build the real
 * `tr.insert(insertPos, node)` on a throwaway transaction and look at what the
 * fitter did to the enclosing containers.
 *
 * "The schema rejects a bare node at this index" has two very different
 * outcomes, and only one of them is damage:
 *
 *   • PAD — the fitter inserts whatever the parent's content expression
 *     requires and the node lands INSIDE the same container (a `displayMath`
 *     released at a `listItem`'s index 0 gets an empty paragraph before it and
 *     stays in that item — the shipped A1/065 behavior, which a blanket refusal
 *     would turn into a dead drop);
 *   • TEAR — the fitter can only place it by CLOSING the container, splitting
 *     one node into two that both keep the original `uuid`, with the payload
 *     stranded between the halves. That is the task-257 corruption, identical in
 *     the expex and list directions.
 *
 * The signature that separates them is exact: a tear changes the number of
 * nodes of an ANCESTOR's type by something other than what the PAYLOAD ITSELF
 * brings; padding never does (it adds children of other types, inside the
 * ancestors that already exist). So for each ancestor type, the delta must
 * equal the count of that type in the payload's own subtree — a `bulletList`
 * dropped inside a `bulletList` legitimately adds one, and it brings its own
 * `listItem` children with it. Counting the payload's ROOT type alone was not
 * enough: it refused exactly that nested-list drop.
 *
 * Two further outcomes count as a tear, because both destroy the moved content
 * as thoroughly as a split: a throw, and a trial whose doc is EQUAL to the
 * original or grew by less than the payload (the fitter dropped it). The
 * equality test is `doc.eq`, not `tr.docChanged` — the latter counts STEPS, so
 * a step that produces an identical document reports "changed".
 *
 * The test errs toward refusing: padding that happens to add a node of an
 * ancestor's type reads as a tear and the drop declines. That is the safe
 * direction — nothing is deleted — and it is only ever consulted for payloads
 * no wrapper in the vocabulary could fit.
 *
 * At a TOP-LEVEL gap (`$pos.depth === 0`) the ancestor loop is empty by
 * construction: `doc` is the only enclosing node and nothing can tear it. The
 * payload-landed test above is the whole guard there, and it is the right one —
 * the only harm available at doc level is the fitter swallowing the content.
 *
 * Cost: one trial transaction plus one doc walk per ancestor depth, ONCE per
 * drop commit (a user gesture) — never on the hover/hit-test path, which is the
 * per-frame one.
 */
function bareInsertTearsContainer(
  editor: Editor,
  insertPos: number,
  node: PMNode,
): boolean {
  const doc = editor.state.doc;
  let trialDoc: PMNode;
  try {
    // container-fit-exempt: this IS the container-fit probe — a throwaway trial
    // transaction that is never dispatched, built precisely to find out what the
    // fitter would do before anything is committed.
    // schema-adopt-exempt: the node reaching this probe was adopted by
    // `fitNodesAtInsert` before it was handed to `fitNodeInContainer`, so it is
    // already in `editor`'s vocabulary; and nothing here is dispatched.
    // inline-host-exempt: the container-fit PROBE — a throwaway trial
    // transaction, never dispatched, built to discover what the fitter would do
    // at a BETWEEN-BLOCKS gap (task 414).
    trialDoc = editor.state.tr.insert(insertPos, node).doc;
  } catch {
    return true;
  }
  // Did the payload actually land? `doc.eq` rather than `tr.docChanged` (a step
  // count), plus a size floor: padding only ever ADDS, so a trial that grew by
  // less than the payload swallowed part of it.
  if (trialDoc.eq(doc)) return true;
  if (trialDoc.content.size - doc.content.size < node.nodeSize) return true;

  const $pos = doc.resolve(insertPos);
  const ancestorTypes = new Set<string>();
  for (let d = $pos.depth; d >= 1; d--) ancestorTypes.add($pos.node(d).type.name);
  if (ancestorTypes.size === 0) return false; // top-level gap — nothing to tear
  // One walk of each doc (not one per depth), then compare each ancestor type's
  // delta against what the payload's own subtree contributes.
  const before = countTypes(doc, ancestorTypes);
  const after = countTypes(trialDoc, ancestorTypes);
  const payload = countTypes(node, ancestorTypes, true);
  for (const name of ancestorTypes) {
    const delta = (after.get(name) ?? 0) - (before.get(name) ?? 0);
    if (delta !== (payload.get(name) ?? 0)) return true;
  }
  return false;
}

/** Count occurrences of each name in `names` within `node`'s subtree.
 *  `includeSelf` also counts the node itself (used for the payload budget). */
function countTypes(
  node: PMNode,
  names: ReadonlySet<string>,
  includeSelf = false,
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (name: string) => {
    if (names.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  if (includeSelf) bump(node.type.name);
  node.descendants((n) => {
    bump(n.type.name);
    return true;
  });
  return counts;
}
