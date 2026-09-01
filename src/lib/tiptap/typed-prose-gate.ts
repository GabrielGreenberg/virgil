/**
 * "Are the bytes at this position the user's PROSE?" — asked at TYPE TIME,
 * before a rule REWRITES them (task 519).
 *
 * ## Why a type-time rule needs its own answer
 *
 * The typographic rules (`smart-quotes.ts`) rewrite a GLYPH, and a glyph has a
 * reverse map: `typographyToLatex` turns `–` back into `--` on every save, so a
 * smart quote that lands somewhere it should not have is cosmetic-in-source and
 * round-trips. A WORD replacement has no reverse map at all. `\label{teh}`
 * rewritten to `\label{the}` is a broken cross-reference, silently, forever —
 * which is why `smart-quotes.ts` may ride the framework's gate alone and
 * anything that swaps a WORD may not.
 *
 * ## The gate is TipTap's, plus the one hole its vocabulary cannot see
 *
 * TipTap's `inputRulesPlugin` already declines inside a `code`-spec NODE or on
 * text carrying a `code`-spec MARK. After task 512 that covers every
 * byte-literal CONTAINER (`prose-index.test.ts` pins that a markless textblock
 * and a `code` textblock are ONE SET, so a future verbatim node kind is gated
 * by declaring itself) and two of the three raw-LaTeX carrier MARKS
 * (`latexVerbatim`, `latexCommentTail`).
 *
 * The third — `latexCommand` — is DELIBERATELY not `code`
 * (`latex-command.ts` says why in place: smartening a quote typed into a stray
 * inherited command span is what keeps it emitting valid `.tex`, and that net
 * stays). So a `\label{teh}` run is, to the framework, ordinary prose.
 *
 * ## Two rungs, because a construct is raw LaTeX BEFORE it is finished
 *
 * The document's answer to "is this prose?" must not depend on how far through
 * a construct the user has typed. MEASURED against the real stack:
 *
 *   - SETTLED — a parsed or completed `\textsc{teh}` / `\label{teh}` is ONE
 *     text node wearing `latexCommand`. Rung 1 (the mark) sees it.
 *   - IN FLIGHT — typing `\textsc{teh` leaves the document as
 *     `["\textsc" latexCommand] ["{teh" NO MARKS]`, because `scanRawLatexSpans`
 *     fails CLOSED on an unbalanced group and so claims the command NAME only.
 *     Rung 1 sees nothing. One keystroke later the brace closes and the whole
 *     run is raw LaTeX — so a gate with only rung 1 answers PROSE and then
 *     RAW LATEX for the same bytes, and a rule whose verdict depends on typing
 *     order is not a rule.
 *
 * Rung 2 is therefore the LOOSE scanner the grey `.latex-cmd` decoration and
 * the `p-cmd-only` stamp already share — `matchCommandLength`, whose own
 * comment says it "include[s] unclosed braces (user still typing)". What the
 * user is being SHOWN as a command is not prose. Both rungs read an existing
 * SSOT; neither spells a mark name or a command vocabulary of its own.
 *
 * ## Failure direction
 *
 * Fails toward DECLINING. A missed correction costs the user nothing — the
 * spellchecker (task 518) still squiggles the word — while a correction inside
 * a citekey, a label or a filename is a silent rewrite of the user's `.tex`.
 * So an unreadable position, a non-textblock parent and a byte-literal
 * container all answer `false`.
 *
 * ## Cost
 *
 * O(the block's text), and only on a MATCH: an `InputRule` handler runs after
 * its `find` has already matched, so this never touches the ordinary keystroke
 * path (AGENTS.md → "Keystroke sanctity"). Nothing here walks the document.
 */

import type { ResolvedPos } from "@tiptap/pm/model";
import { isRawLatexMarkName } from "@/lib/latex-lexer";
import { blockCarriesProse } from "@/lib/prose-index";
import { forEachBareCommand } from "./cmd-only-paragraph";

/**
 * Rung 1 — the SETTLED answer. Does the text immediately BEFORE `$pos` wear a
 * mark that says "raw LaTeX, not prose"?
 *
 * `nodeBefore` only, deliberately, where TipTap's own `code` gate asks about
 * both sides. The framework's question is "what context am I typing INTO",
 * which a following run legitimately answers; ours is "what bytes am I about
 * to OVERWRITE", and those lie entirely before the trigger. Asking `nodeAfter`
 * too would decline a correction of ordinary prose that merely abuts a
 * citation chip.
 */
function precedingRunIsRawLatex($pos: ResolvedPos): boolean {
  const before = $pos.nodeBefore;
  if (!before?.isText) return false;
  return before.marks.some((m) => isRawLatexMarkName(m.type.name));
}

/**
 * Rung 2 — the IN-FLIGHT answer. Does a bare-text command run (as the grey
 * decoration paints them, unclosed braces included) COVER this position?
 *
 * Asked of the BLOCK's text rather than of the one text node the caret sits
 * in, because that is exactly where the in-flight case splits: `\textsc` takes
 * the carrier mark the instant it is typed, so the argument the user is still
 * writing lands in a SEPARATE, unmarked text node with no backslash of its own.
 * A per-text-node scan — which is right for the decoration, whose job is to
 * paint each node once — cannot see the command that node belongs to.
 *
 * Positions are taken through `textBetween`, so an inline ATOM (which occupies
 * a PM slot and contributes no characters) cannot skew the offset. An atom
 * BETWEEN a command and the caret joins two non-adjacent runs, which can only
 * make this answer `true` — the safe direction.
 */
function bareCommandCovers($pos: ResolvedPos): boolean {
  const parent = $pos.parent;
  const before = parent.textBetween(0, $pos.parentOffset);
  const text = before + parent.textBetween($pos.parentOffset, parent.content.size);
  if (!text.includes("\\")) return false;
  const at = before.length;
  let covered = false;
  forEachBareCommand(text, (offset, len) => {
    // Strictly after the run's first character: a position AT the backslash is
    // outside the run it opens. Inclusive at the end, so the caret sitting just
    // past an unclosed `\textsc{teh` — which is where the trigger character
    // lands — is inside it.
    if (offset < at && at <= offset + len) covered = true;
  });
  return covered;
}

/**
 * The door. `true` only when the characters ending at `$pos` are the user's
 * own prose, by BOTH the settled model and what the editor is showing.
 *
 * The ONE predicate for "may a type-time rule rewrite these bytes?" — a
 * consumer asks it rather than re-deriving either rung
 * (`autocorrect-gate-census.test.ts` pins that).
 */
export function typedTextIsProse($pos: ResolvedPos): boolean {
  const parent = $pos.parent;
  if (!parent.isTextblock) return false;
  // The container half. Redundant with TipTap's own `code` gate for every node
  // kind that exists today (512 pinned the two spellings as one set) and asked
  // anyway, so the predicate is TOTAL rather than true-by-coincidence.
  if (!blockCarriesProse(parent)) return false;
  if (precedingRunIsRawLatex($pos)) return false;
  if (bareCommandCovers($pos)) return false;
  return true;
}
