import StarterKit from "@tiptap/starter-kit";
import type { AnyExtension } from "@tiptap/core";

/**
 * THE door a Virgil editor mounts StarterKit through (task 1198) — StarterKit
 * with every LaTeX-hostile MARKDOWN input/paste rule removed from its children.
 *
 * ## The class
 *
 * StarterKit is a markdown editor's kit: its marks and nodes ship input rules
 * that rewrite what you TYPE (`` `x` `` → code, `*x*` → italic, `**x**` → bold,
 * `~~x~~` → strike, `# ` → heading, `---` → rule, ```` ``` ```` → code block) and
 * paste rules that rewrite what you PASTE. Virgil has no markdown dialect — in
 * LaTeX every one of those characters is literal, and the backtick is how a
 * writer OPENS A QUOTE: typing `` `a' and `b' `` deleted both backticks and
 * wrapped the text between them in `\texttt`. The class was killed one member
 * at a time — the heading rules (dead surface + the level-0 `^\s$` bug), the
 * `---` rule (task 1176, an em-dash), the backtick inside `%` comments only
 * (task 512) — each fix on ONE stack, so the next inherited rule shipped.
 *
 * So the strip lives on the KIT: every surface mounts `VirgilStarterKit`, and no
 * surface can inherit a stock markdown rule by leaving a key on. A node a stack
 * turns OFF here and re-registers itself (the main editor's heading / code block
 * / horizontal rule, `Highlight`) goes through {@link withoutMarkdownRules} — the
 * same strip, one helper. Keyboard chords (Mod-B / Mod-I / Mod-E …) are
 * untouched: those are explicit commands, not rewrites of typed text.
 *
 * What stays: the three list/quote WRAPPER rules (`- ` / `1. ` / `> `), which
 * every stack mounts through `withWrapperGate` instead of StarterKit; `link`'s
 * autolink PASTE rule (a pasted URL becomes a link — not markdown); and Virgil's
 * own typographic rules (`smart-quotes.ts`, `autocorrect.ts`). The census
 * `input-rule-provider-census.test.ts` MOUNTS every production stack and
 * enumerates the rules each one actually runs — an inherited rule fails CI by
 * shipping, which a source grep could never see.
 */

/** StarterKit children whose upstream input/paste rules are markdown syntax
 *  that collides with literal LaTeX. */
export const MARKDOWN_RULE_EXTENSIONS: ReadonlySet<string> = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "codeBlock",
  "heading",
  "horizontalRule",
  "highlight",
]);

/** The same extension with no input rules and no paste rules — name, spec,
 *  commands, keyboard shortcuts and options unchanged. Composable: a caller may
 *  `.extend()` the result, and a later `addInputRules` override still wins. */
export function withoutMarkdownRules<E extends AnyExtension>(extension: E): E {
  return extension.extend({
    addInputRules() {
      return [];
    },
    addPasteRules() {
      return [];
    },
  }) as E;
}

export const VirgilStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((ext) =>
      MARKDOWN_RULE_EXTENSIONS.has(ext.name) ? withoutMarkdownRules(ext) : ext,
    );
  },
});
