/**
 * Citation document operations shared by the main editor handle.
 *
 * These are the citation collectors / mutators that must agree about where
 * citations live in the doc — including the ones NESTED inside a footnote's
 * `attrs.content` (an atomic node ProseMirror's `descendants` won't enter).
 * Kept in a dedicated, import-light module (TipTap types only, no storage /
 * extension chain) so the data-integrity invariant — "every place that
 * COLLECTS a footnote-nested cite must have a matching place that REMOVES it"
 * — can be unit-tested against a real Editor without mounting the whole
 * `Editor.tsx` component (backlog #38).
 *
 * The two pure walkers (`walkJsonContentForCitations` /
 * `removeCitationFromJsonContent`) now delegate to the single atom-aware reader
 * in `@/lib/inline-content` (T3 / C10) so the COLLECT and REMOVE sides can no
 * longer drift apart, and so the next atom kind nested in a footnote is visible
 * to every consumer the day it ships. The named exports + their tests are
 * preserved; `stripFootnoteNestedCitation` is unchanged (the doc-mutation half).
 */

import type { Editor, JSONContent } from "@tiptap/react";
import {
  removeCitationFromJsonContent,
  walkJsonContentForCitations,
} from "@/lib/inline-content";

// Re-export the pure walkers from their new home so existing import sites
// (`from "../citation-doc-ops"`) keep working unchanged.
export { walkJsonContentForCitations, removeCitationFromJsonContent };

/**
 * Strip every footnote-NESTED `\cite` matching `citationId` from the doc, by
 * rewriting each host footnote's `attrs.content` (backlog #38). One transaction
 * touches every host footnote; if none holds the cite it's a no-op (no
 * dispatch). Uses plain `setNodeMarkup` with NO `ignoreReadOnly` meta — exactly
 * like `updateFootnoteContent` — so this real doc tx is filtered out by the
 * readOnlyEnforcer in collaborator read-only mode (the nested cite is left in
 * place in a read-only / partner-claimed doc, as required). `setNodeMarkup` is
 * attr-only and never shifts positions, so the accumulated ops stay valid
 * against the original positions (the renumberFootnotes pattern). Returns the
 * number of host footnotes rewritten (0 when nothing matched or the doc is
 * read-only and the tx was filtered).
 */
export function stripFootnoteNestedCitation(
  editor: Editor,
  citationId: string,
): number {
  let tr = editor.state.tr;
  let touched = 0;
  // Safe to walk the ORIGINAL doc while accumulating into `tr`: setNodeMarkup
  // is an attr-only op that never shifts positions, so `pos` stays valid
  // across iterations (mirrors renumberFootnotes). Do NOT add a size-changing
  // op to this loop without re-reading positions from the running tr.
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "footnote" || !node.attrs.content) return true;
    const { content, removed } = removeCitationFromJsonContent(
      node.attrs.content as JSONContent,
      citationId,
    );
    if (removed) {
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, content });
      touched += 1;
    }
    return true;
  });
  if (touched > 0) editor.view.dispatch(tr);
  return touched;
}
