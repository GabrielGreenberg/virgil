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
  for (const node of nodes) {
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
 * The signature that separates them is exact: a tear increases the number of
 * nodes of an ANCESTOR's type beyond what the payload itself contributes;
 * padding never does (it adds a child of some other type, inside the ancestor
 * that already exists). So count each ancestor type before and after, allowing
 * exactly the one the node IS (a `bulletList` landing inside a `bulletList`
 * legitimately adds one). Anything above that budget means a container was
 * closed and reopened. A throw, or a transaction that changed nothing (the
 * fitter silently dropped the payload), counts as a tear too — both destroy the
 * moved content just as thoroughly.
 *
 * The test errs toward refusing: padding that happens to add a node of an
 * ancestor's type reads as a tear and the drop declines. That is the safe
 * direction — nothing is deleted — and it is only ever consulted for payloads
 * no wrapper in the vocabulary could fit.
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
    const tr = editor.state.tr.insert(insertPos, node);
    if (!tr.docChanged) return true;
    trialDoc = tr.doc;
  } catch {
    return true;
  }
  const $pos = doc.resolve(insertPos);
  for (let d = $pos.depth; d >= 1; d--) {
    const name = $pos.node(d).type.name;
    const budget = name === node.type.name ? 1 : 0;
    const delta = countNodesOfType(trialDoc, name) - countNodesOfType(doc, name);
    if (delta !== budget) return true;
  }
  return false;
}

function countNodesOfType(doc: PMNode, typeName: string): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === typeName) n++;
    return true;
  });
  return n;
}
