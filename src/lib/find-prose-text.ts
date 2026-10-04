/**
 * "Where is this quoted string in the document?" — answered over the PROSE
 * INDEX (task 841), so the character offset of a match and its PM position
 * come from ONE walk and cannot drift apart.
 *
 * The locator this replaces (`findTextRange` in `Editor.tsx`) searched
 * `editor.getText()` — which puts "\n\n" between blocks and emits atom text
 * (citations, `\ref`, …) through `renderText` — and then converted the hit
 * with a text-node-only walk. The two offset spaces agreed only inside the
 * first block before any atom, so a quote in paragraph 5 painted the band on
 * unrelated words further down, or on nothing.
 *
 * ## The matching rule (explicit, because the quote is a lossy capture)
 *
 * The quoted text is captured as `doc.textBetween(from, to, " ")` (the
 * revision / cutter quote capture), so:
 *
 * - **Atoms contribute nothing**, both in the capture (no `leafText`) and in
 *   the prose index (an atom has no text children) — a quote spanning a
 *   citation pill matches with the pill skipped, and the returned range
 *   covers it.
 * - **Whitespace is elastic.** Any whitespace run in the needle matches any
 *   whitespace run in the prose text, INCLUDING the index's "\n" block
 *   separator — so a quote captured across a paragraph break (" " in the
 *   capture) still resolves, while a quote with no whitespace can never be
 *   matched across a block boundary.
 * - **Raw-LaTeX runs are not prose.** A quote whose words include source the
 *   parser left as a carrier (an unmodeled `\command{…}`, a `\verb`) finds no
 *   prose match and returns null — no band, never a band on the wrong words.
 *
 * Cost: O(doc) (one `buildProseIndex`). Call it on a user-initiated change of
 * the quoted text, never on the keystroke path.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { buildProseIndex, proseOffsetToPos, spanAtOffset } from "@/lib/prose-index";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The PM range `{from, to}` of the FIRST prose occurrence of `quote` in
 * `doc`, or null when there is none (see the module header for the rule).
 */
export function findProseTextRange(
  doc: PMNode,
  quote: string,
): { from: number; to: number } | null {
  const needle = quote.trim();
  if (!needle) return null;

  const pattern = needle.split(/\s+/).map(escapeRegExp).join("\\s+");
  const index = buildProseIndex(doc);
  const match = new RegExp(pattern).exec(index.text);
  if (!match) return null;

  const start = match.index;
  const end = start + match[0].length;
  const startSpan = spanAtOffset(index.spans, start);
  // `end` is exclusive — its span is the one holding the match's LAST char.
  const endSpan = spanAtOffset(index.spans, end - 1);
  if (!startSpan || !endSpan) return null;

  const from = proseOffsetToPos(startSpan, start, "start");
  const to = proseOffsetToPos(endSpan, end, "end");
  return to > from ? { from, to } : null;
}
