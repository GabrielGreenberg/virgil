import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, NodeType, Schema } from "@tiptap/pm/model";
import { rangeHoldsOnlyText } from "./typed-prose-gate";

/**
 * THE paragraph → `latexComment` conversion — one creator, every surface
 * (task 639).
 *
 * A `latexComment` is reachable by TYPING (`% ` at the start of a paragraph,
 * `latex-comment.ts`'s input rule) and, since task 639 gave the kind a registry
 * row, by `latexCommentRun` (`action-registry.ts`) — the door a menu / slash /
 * keyboard surface would call. The registry exists to end the "two creators for
 * one action" condition, so the MUTATION lives here, in a plain-PM leaf both
 * import, rather than being re-spelled on the second surface. What legitimately
 * differs per surface is the TEXT HARVEST (the typed rule folds in the character
 * being typed, which has not landed yet; a `run()` reads the settled paragraph),
 * so each caller computes `commentText` and hands it in.
 *
 * ## The guard travels WITH the mutation
 *
 * A `latexComment` is markless `text*` (`marks: ""`, `code: true`), so rebuilding
 * a paragraph as one DELETES any inline atom it held — a footnote, a citation,
 * inline math, a hard break — with nothing captured anywhere (task 578, and the
 * capture/schema-symmetry law: never delete what the destination cannot carry).
 * That refusal is asked HERE rather than at each call site, so a surface cannot
 * be added without it: `commentifyParagraph` returns `null` and the caller leaves
 * the paragraph alone.
 *
 * No React, no TipTap barrel — a plain `@tiptap/pm` leaf, so `action-registry`
 * can import it without pulling the React graph into node-env vitest.
 */

/** Build a `latexComment` node holding `text` as native inline content (empty
 *  content when text is ""). The text lives IN the node, not an attr. */
export function makeComment(
  nodeType: NodeType,
  schema: Schema,
  text: string,
): PMNode {
  return nodeType.create(null, text ? schema.text(text) : null);
}

/** Drop the source-level `%` marker (and its one optional space) from a line of
 *  comment text. The comment node stores the BODY; the `% ` prefix is chrome the
 *  NodeView paints and the serializer re-emits. */
export function stripCommentPrefix(text: string): string {
  return text.replace(/^% ?/, "");
}

/**
 * Convert the paragraph node at `paragraphPos` into a `latexComment` holding
 * `commentText`, landing the caret at the start of the new comment's content.
 *
 * Returns the built transaction, or `null` when the conversion must be REFUSED:
 * no `latexComment` in this schema, the node at `paragraphPos` is not a
 * paragraph, or the paragraph holds something a markless `text*` node cannot
 * carry (see the capture note above). Callers dispatch; nobody dispatches a
 * `null`.
 */
export function commentifyParagraph(
  state: {
    doc: PMNode;
    schema: Schema;
    tr: Transaction;
  },
  paragraphPos: number,
  commentText: string,
): Transaction | null {
  const nodeType = state.schema.nodes.latexComment;
  if (!nodeType) return null;
  const node = state.doc.nodeAt(paragraphPos);
  if (!node || node.type.name !== "paragraph") return null;
  // The capture/schema-symmetry refusal, asked of the paragraph's CONTENT range
  // (its interior, excluding the node's own open/close tokens).
  if (
    !rangeHoldsOnlyText(
      state.doc,
      paragraphPos + 1,
      paragraphPos + node.nodeSize - 1,
    )
  ) {
    return null;
  }
  const tr = state.tr.replaceWith(
    paragraphPos,
    paragraphPos + node.nodeSize,
    makeComment(nodeType, state.schema, commentText),
  );
  // Land the caret INSIDE the new comment (native TextSelection), at the start
  // of its content — no auto-focus hack, no lost keystroke. The comment node
  // now sits at `paragraphPos`; its content interior starts one position in.
  tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1));
  return tr;
}
