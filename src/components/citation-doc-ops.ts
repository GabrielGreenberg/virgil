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
 */

import type { Editor, JSONContent } from "@tiptap/react";

/**
 * Walk a JSONContent tree and invoke `visit` for every citation node.
 *
 * Atomic nodes (footnote, examples) keep their inner content as a JSONContent
 * literal in `attrs.content`; ProseMirror's `descendants` doesn't traverse into
 * that. Citations stored inside such inner content are otherwise invisible to
 * the editor's citation collectors, which means the Citations and Bibliography
 * panels under-count the doc's actual citations. This helper walks the literal
 * to surface them.
 */
export function walkJsonContentForCitations(
  json: JSONContent | null | undefined,
  visit: (cit: { citationId: string; command: string; displayText: string }) => void,
): void {
  if (!json) return;
  if (json.type === "citation" && json.attrs) {
    const a = json.attrs as Record<string, unknown>;
    visit({
      citationId: (a.citationId as string) || "",
      command: (a.command as string) || "",
      displayText: (a.displayText as string) || "",
    });
  }
  if (Array.isArray(json.content)) {
    for (const child of json.content) walkJsonContentForCitations(child, visit);
  }
}

/**
 * Return a deep copy of a footnote's `attrs.content` JSON with every nested
 * `citation` node whose id matches `citationId` removed, plus whether any was
 * removed. Mirror image of `walkJsonContentForCitations`: that collector
 * surfaces footnote-nested cites into the panels, so deleting such a card must
 * also strip the nested atom — otherwise the surviving nested `\cite`
 * re-derives the deleted card on reload (backlog #38). Matches on either the
 * `citationId` or the unified `linkId` attr (the inline atom carries both).
 * Pure (no mutation of the input); returns the original reference untouched
 * when nothing matched so callers can skip a no-op transaction.
 */
export function removeCitationFromJsonContent(
  json: JSONContent,
  citationId: string,
): { content: JSONContent; removed: boolean } {
  let removed = false;
  const prune = (node: JSONContent): JSONContent | null => {
    if (node.type === "citation" && node.attrs) {
      const a = node.attrs as Record<string, unknown>;
      if (a.citationId === citationId || a.linkId === citationId) {
        removed = true;
        return null; // drop this node
      }
    }
    if (Array.isArray(node.content)) {
      const kept = node.content
        .map((child) => prune(child))
        .filter((c): c is JSONContent => c !== null);
      return { ...node, content: kept };
    }
    return { ...node };
  };
  const next = prune(json) ?? json;
  return { content: next, removed };
}

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
