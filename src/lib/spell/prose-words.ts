/**
 * WHICH WORDS did the user write, and where are they? (task 518)
 *
 * Task 517 answered "which CHARACTERS are prose, and where" once, for
 * everybody. A spellchecker needs one question further in: characters are not
 * what a dictionary knows about. This module is that step, and it is
 * deliberately the ONLY place in the app that decides what a WORD is — the
 * prose it checks, the bibliography it excuses, and the terms the user adds
 * to a dictionary all pass through the same rule, so a name typed in a paper
 * and the same name read out of `references.bib` can never come back as two
 * different strings.
 *
 * ## The run gap IS the word boundary
 *
 * A `ProseRun` is one text node's worth of prose. Two consecutive runs are
 * char-contiguous but NOT PM-contiguous (517's own header states this), and
 * the gap between them is exactly one of two things:
 *
 *   - **nothing** — the runs abut in the document too, and PM merely split the
 *     text node at a MARK boundary. Bolding half a word must not make it two
 *     words, so these are MERGED into one segment.
 *   - **something the index withheld** — an inline ATOM (a footnote marker, a
 *     citation chip, inline math) or an excluded raw-LaTeX run. A word cannot
 *     span one, which is the memo's own rule ("an underline never spans one; a
 *     word interrupted by a footnote marker is two words"), so these CUT.
 *
 * Merging first is what makes the arithmetic exact: within a segment the
 * character offset and the PM offset advance together, so a token's document
 * position is `segment.pmStart + offset` with nothing to correct for.
 *
 * ## A cut is not always a word boundary — so the two kinds are told apart
 *
 * An ATOM is a whole object: `Smith`+`[1]` ends the word `Smith`, and refusing
 * to check a word merely because a footnote marker follows it would give up
 * most of the checkable text in a real paper. An excluded TEXT run is
 * different: it is characters the user typed which this index deliberately did
 * not read, so `un` + `\textsc{clear}` leaves `un` looking like a two-letter
 * misspelling when it is half a word. So a segment records, per edge, whether
 * the child immediately across the gap was TEXT, and a token touching such an
 * edge is a FRAGMENT and is not checked. (`hardBreak` is a non-text node and
 * therefore correctly ends a word.)
 *
 * ## What is a word — stated, because every exclusion here is a decision
 *
 * A token is a maximal run of Unicode letters/marks/digits with interior
 * apostrophes (`'` or `’`, the two spellings the parser's own smart-quote pass
 * can produce). It is then DROPPED when it is
 *
 *   - a single character — `x`, `n` and `a` are variables as often as words;
 *   - digit-bearing — `3rd`, `H2O`, `v2`. Digits are consumed INTO the token
 *     precisely so this test can see them: a rule that treated a digit as a
 *     boundary would tokenize `3rd` as `rd` and flag it;
 *   - all-uppercase — `NP`, `DP`, `LF`, `PDF`. Academic prose is dense with
 *     acronyms and a stock dictionary knows almost none of them. The cost is
 *     that a shouted typo is not caught, which is the right side of the trade;
 *   - inside a URL or an email address. Those are masked out of the segment
 *     text SPACE-FOR-SPACE before tokenizing, so every surviving token keeps
 *     its exact offset.
 *
 * Nothing here is language-specific: the dictionary decides what is a word OF
 * ENGLISH; this decides what is a word AT ALL.
 *
 * ## Cost class
 *
 * `proseSegmentsOf` / `tokenizeBlock` are O(one block's inline children) and
 * O(that block's characters) — the per-BLOCK unit 517 built `collectProseRuns`
 * for. Neither ever runs on the keystroke path: the decoration plugin
 * re-derives only the textblocks a transaction TOUCHED, and only after its
 * debounce.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { blockCarriesProse, inlineIsProse } from "@/lib/prose-index";

/**
 * A maximal PM-CONTIGUOUS stretch of prose inside one block.
 *
 * `text` and the document advance in lockstep across a segment, so a character
 * offset `i` sits at document position `pmStart + i`.
 */
export interface ProseSegment {
  text: string;
  /** Document position of `text[0]`. */
  pmStart: number;
  /** An excluded TEXT node abuts the segment's start (a word may continue into it). */
  cutLeft: boolean;
  /** An excluded TEXT node abuts the segment's end. */
  cutRight: boolean;
}

/** One checkable word, with its document range. */
export interface SpellToken {
  word: string;
  /** Document position of the word's first character. */
  from: number;
  /** Document position just past the word's last character. */
  to: number;
}

/**
 * The prose segments of ONE block, in document order.
 *
 * Reads 517's exported vocabulary (`inlineIsProse`) rather than restating it,
 * so a new carrier mark or atom kind is covered by declaration. Returns `[]`
 * for a block that is not a prose container at all.
 */
export function proseSegmentsOf(block: PMNode, contentStart: number): ProseSegment[] {
  if (!blockCarriesProse(block)) return [];
  const segments: ProseSegment[] = [];
  let pmCursor = contentStart;
  let open: ProseSegment | null = null;
  // Whether the child immediately before the NEXT prose child was a text node.
  let pendingCutIsText = false;

  block.forEach((child) => {
    if (inlineIsProse(child)) {
      const t = child.text ?? "";
      if (t.length > 0) {
        if (open) open.text += t;
        else {
          open = { text: t, pmStart: pmCursor, cutLeft: pendingCutIsText, cutRight: false };
          segments.push(open);
        }
        pendingCutIsText = false;
      }
    } else {
      if (open) {
        open.cutRight = child.isText;
        open = null;
      }
      pendingCutIsText = child.isText;
    }
    pmCursor += child.nodeSize;
  });

  return segments;
}

/**
 * Mask URL and email spans SPACE-FOR-SPACE.
 *
 * Offset-preserving on purpose: every surviving token's index into the masked
 * string is still its index into the real one, so no correction is needed
 * anywhere downstream.
 */
const URL_RE = /\b(?:[a-z][\w+.-]*:\/\/|www\.)\S+/gi;
const EMAIL_RE = /\S+@\S+\.\S+/g;

function maskUnwordly(text: string): string {
  let out = text;
  for (const re of [URL_RE, EMAIL_RE]) {
    out = out.replace(re, (m) => " ".repeat(m.length));
  }
  return out;
}

const WORD_RE = /[\p{L}\p{M}\p{Nd}]+(?:['’][\p{L}\p{M}\p{Nd}]+)*/gu;
const HAS_DIGIT_RE = /\p{Nd}/u;

/** Is this string a token the checker will look up? See the header's list. */
export function isCheckableWord(word: string): boolean {
  if ([...word].length < 2) return false;
  if (HAS_DIGIT_RE.test(word)) return false;
  // All-uppercase acronym. `toLowerCase` differing is what separates a cased
  // script from one with no case at all (Greek, Han) — a Han token must not be
  // read as an acronym just because it equals its own uppercase.
  if (word === word.toUpperCase() && word !== word.toLowerCase()) return false;
  return true;
}

/** The checkable words of an arbitrary string, in order. Shared by the
 *  bibliography-name derivation and the user's own dictionary entries so those
 *  and the prose can never disagree about what a word is. */
export function wordsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of maskUnwordly(text).matchAll(WORD_RE)) {
    if (isCheckableWord(m[0])) out.push(m[0]);
  }
  return out;
}

/** The checkable tokens of one segment, with document positions. */
export function tokenizeSegment(seg: ProseSegment): SpellToken[] {
  const out: SpellToken[] = [];
  const masked = maskUnwordly(seg.text);
  for (const m of masked.matchAll(WORD_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    // A token touching an edge the index CUT with withheld characters is a
    // fragment of a word we cannot see whole.
    if (seg.cutLeft && start === 0) continue;
    if (seg.cutRight && end === seg.text.length) continue;
    if (!isCheckableWord(m[0])) continue;
    out.push({ word: m[0], from: seg.pmStart + start, to: seg.pmStart + end });
  }
  return out;
}

/** Every checkable token of one block, in document order. O(the block). */
export function tokenizeBlock(block: PMNode, contentStart: number): SpellToken[] {
  const out: SpellToken[] = [];
  for (const seg of proseSegmentsOf(block, contentStart)) {
    out.push(...tokenizeSegment(seg));
  }
  return out;
}
