/**
 * The type-time REWRITE gates (tasks 519, 578, 1097).
 *
 * This file used to hold two doors. The first — `typedTextIsProse`, "are the
 * bytes at this position the user's PROSE?" — was a second owner of a question
 * the prose index already answers, and the two drifted: the corrector refused
 * `\textsf{teh` while the checker squiggled it, and rewrote inside bare URLs the
 * checker masked (task 1097). It is RETIRED. Its in-flight rung (a bare-text
 * command run, unclosed braces included, is not prose) now lives in
 * `prose-index.ts`'s one walk, where search, the spellchecker and autocorrect
 * all read it; a word-swapping rule asks the checker's tokenizer
 * (`typedWordEndingAt`, `prose-words.ts`) which word just ended.
 *
 * What remains is the structural door below, which is about NODES, not prose.
 */

import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * "Does `[from, to)` hold nothing but TEXT?" — the refusal door for any
 * type-time rule that REPLACES a range it matched (task 578).
 *
 * ## The invariant it enforces
 *
 * A type-time rule may rewrite TEXT it matched; it never deletes a non-text
 * node. A rule computes its replace range from a STRING (the text before the
 * caret), and an inline atom — a footnote, a citation, inline math, a hard
 * break — occupies a PM slot while contributing a placeholder (or nothing) to
 * that string. So a pattern whose body class spans the placeholder
 * (`\$([^$]+)$`, `\footnote\{([^}]*)\}$`) matches straight across an atom, and
 * the handler's `replaceWith` deletes it: a footnote's body lives nowhere else.
 * The core half of this task aligns TipTap's matcher string with PM positions
 * (`patches/@tiptap+core+3.20.5.patch`); this door is what makes a matched
 * range that REACHES an atom a refusal rather than a deletion, whatever string
 * the rule matched against.
 *
 * A range crossing a textblock boundary answers `false` too — no type-time rule
 * matches across one, so such a range is a skew by definition.
 *
 * ## Cost
 *
 * O(the match window): a `nodesBetween` over `[from, to)`, reached only after a
 * rule has already matched. Never on the ordinary keystroke path.
 */
export function rangeHoldsOnlyText(doc: PMNode, from: number, to: number): boolean {
  if (from > to || from < 0 || to > doc.content.size) return false;
  if (from === to) return true;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;
  let onlyText = true;
  doc.nodesBetween(from, to, (node) => {
    if (!onlyText) return false;
    if (node.isInline && !node.isText) onlyText = false;
    return onlyText;
  });
  return onlyText;
}
