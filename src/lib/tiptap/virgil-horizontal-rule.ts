import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { withoutMarkdownRules } from "./virgil-starter-kit";

/**
 * StarterKit's `horizontalRule` node with its markdown INPUT RULE removed
 * (task 1176). Upstream turns `---` / `___ ` / `*** ` typed at a block start
 * into a rule; in LaTeX `---` is an EM-DASH, so a writer opening a paragraph
 * with one lost their text to a rule. The node, its parse (`\hrulefill`) and
 * serialize are unchanged; the one insert door is the registry's
 * `horizontal-rule` row (`\hrule` / the lightning grid cell).
 *
 * Mounted wherever a rule can appear — the MAIN editor and the EXCERPT card
 * body — each with StarterKit's own `horizontalRule: false`. Since task 1198
 * the strip is the shared markdown-rule door (`virgil-starter-kit.ts`), which
 * `VirgilStarterKit` also applies to its own `horizontalRule` child.
 */
export const VirgilHorizontalRule = withoutMarkdownRules(HorizontalRule);
