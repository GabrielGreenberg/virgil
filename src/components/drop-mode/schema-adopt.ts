/**
 * **The cross-editor payload contract** (task 328) — the two obligations a
 * payload has when it crosses from one editor into another, and the reason
 * neither can be left to the container fit.
 *
 * `AGENTS.md` ("The move half", rule 4) states the first: *"A payload arrives
 * in the target's vocabulary or not at all."* Until this module that law was
 * enforced in exactly ONE place — a private helper inside `fitNodesAtInsert`
 * — reachable only by going through the container FIT. Two splices are
 * deliberately exempted from the fit with a `container-fit-exempt:` marker
 * ("an open slice merging with the text around a caret… no container is being
 * entered"), which is a true statement about *containers* and a false one
 * about *vocabularies*; because the adoption lived inside the same function,
 * the exemption silently took it too. So a main-doc selection — or a
 * footnote/citation atom — released at an inline caret inside a card body was
 * spliced with nodes built from the SOURCE schema, and every rung of
 * ProseMirror's fitter compares `NodeType`s by IDENTITY. Two editors built
 * from the same extension list still hold two distinct `Schema` objects, so
 * the fitter `dropNode()`s the payload, `replaceStep` returns null, and
 * `Transform.replace` appends **no step at all**: `steps: 0`,
 * `docChanged: false`, no throw. The move's *second* transaction — the
 * unconditional source delete — then ran anyway.
 *
 * Hence the second obligation, and the reason it is a separate net rather than
 * a corollary: **the report is the permission.** (The same rule
 * `restoreExcerptAtCaret` earned in "The return half", for the same reason —
 * `replace` / `insert` / `insertContent` all swallow a mismatch, so `void`
 * looks identical for "landed" and "destroyed".) Adoption alone is not enough:
 * `Node.fromJSON` / `Slice.fromJSON` validate the *vocabulary* (an unknown
 * node type or mark throws) and NOT the *content expression*, so a node the
 * target can name but cannot legally hold at this position still reaches the
 * fitter. A relocation therefore dispatches its source delete only on evidence
 * the insert LANDED — which catches the next swallowed splice even if someone
 * adds one without adopting.
 *
 * Kinship, stated rather than merged: `bareInsertTearsContainer`
 * (drop-context.ts) asks the same landed question of its trial transaction,
 * with a `doc.eq` alongside the size floor and an ancestor-count pass on top.
 * It is deliberately left alone — it is a shipped guard with a wider question,
 * and folding it into this primitive would trade a real invariant for tidiness.
 *
 * Zero imports beyond the two PM type leaves, so every low-level splice site
 * can reach it (the rule the marker vocabulary and the stack-kind vocabulary
 * both earned: put the SSOT where the layer that needs it can import it).
 */

import { Slice } from "@tiptap/pm/model";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/**
 * Re-hydrate a single node through `schema`, or `null` when that schema cannot
 * represent it (a card body has no `heading`).
 *
 * Same schema → the node itself, by IDENTITY, which is the overwhelmingly
 * common path and costs nothing. A refusal is the RIGHT answer here and not
 * merely the safe one: it is the same thing `canMountInCardBody` already says
 * on the capture side of the identical question.
 */
export function adoptNodeIntoSchema(node: PMNode, schema: Schema): PMNode | null {
  if (node.type.schema === schema) return node;
  try {
    return schema.nodeFromJSON(node.toJSON());
  } catch {
    return null;
  }
}

/**
 * The slice twin — `openStart` / `openEnd` preserved, since a text-range move
 * relies on the open ends merging with the text around the caret.
 *
 * Foreignness is read off the slice's first child rather than a `schema` field
 * (a `Slice` carries none). An EMPTY slice has no child to ask and is native to
 * every schema by construction, so it passes through: `Slice.toJSON()` returns
 * `null` for one, which would otherwise round-trip to `Slice.empty` and lose
 * nothing — but saying so explicitly keeps the fast path total.
 */
export function adoptSliceIntoSchema(slice: Slice, schema: Schema): Slice | null {
  const first = slice.content.firstChild;
  if (!first || first.type.schema === schema) return slice;
  try {
    return Slice.fromJSON(schema, slice.toJSON() as Parameters<typeof Slice.fromJSON>[1]);
  } catch {
    return null;
  }
}

/**
 * Did this splice actually land? — the evidence a relocation needs before it
 * dispatches its source delete.
 *
 * `tr.steps.length > 0` catches the total swallow (the fitter dropped the
 * payload and `Transform.replace` appended nothing), and the size floor catches
 * the partial one (the fitter kept some of it). `>=` rather than `===` is
 * deliberate: an open slice whose ends have to be CLOSED to fit grows the doc
 * by more than `slice.size`, and padding a container likewise adds more than
 * the payload — both are honest landings. Anything that grows it by LESS lost
 * content on the way in.
 *
 * `tr.before` is the doc the transaction started from, so the caller cannot
 * hand in the wrong baseline.
 *
 * **Limit, stated:** this reads a NET growth, so it is meaningful only for an
 * insert-ONLY transaction. A same-editor move (delete + insert in one
 * transaction) nets out negative and must not be asked — which is exactly the
 * case that needs no asking, since a same-editor payload is native by
 * construction and there is no second document to strand it in.
 */
export function insertLanded(tr: Transaction, minGrowth: number): boolean {
  if (tr.steps.length === 0) return false;
  return tr.doc.content.size - tr.before.content.size >= minGrowth;
}
