import HorizontalRule from "@tiptap/extension-horizontal-rule";

/**
 * StarterKit's `horizontalRule` node with its markdown INPUT RULE removed
 * (task 1176). Upstream turns `---` / `___ ` / `*** ` typed at a block start
 * into a rule; in LaTeX `---` is an EM-DASH, so a writer opening a paragraph
 * with one lost their text to a rule. The node, its parse (`\hrulefill`) and
 * serialize are unchanged; the one insert door is the registry's
 * `horizontal-rule` row (`\hrule` / the lightning grid cell).
 *
 * Mounted wherever a rule can appear — the MAIN editor and the EXCERPT card
 * body — each with StarterKit's own `horizontalRule: false`, so no surface can
 * keep the upstream rule by inheriting the stock node.
 */
export const VirgilHorizontalRule = HorizontalRule.extend({
  addInputRules() {
    return [];
  },
});
