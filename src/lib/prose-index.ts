/**
 * The PROSE INDEX — "which characters in this document are PROSE the user
 * wrote, and where are they?", answered ONCE (task 517).
 *
 * Three parts of Virgil each held HALF of this answer, and none of them knew
 * both halves (the autocorrect analysis, §3):
 *
 *   - the WORD COUNTER (`word-count-core.ts`) sorts characters into
 *     categories — main text / headings / footnotes / captions / math /
 *     comments — and throws every POSITION away;
 *   - the RAW-LATEX HIGHLIGHTER (`scanRawLatexSpans` + the carrier marks)
 *     keeps positions exactly, because it has to paint over them — but it
 *     only ever tracks LATEX, never prose;
 *   - the SEARCH index kept positions and knew nothing about LaTeX at all, so
 *     searching `emph` matched command names and searching matched inside `%`
 *     comment blocks.
 *
 * A spellchecker needs both halves, so this module is the thing all three
 * should have been sharing. It yields the prose CHARACTER RUNS with their
 * ProseMirror positions, and the Search panel is its first consumer.
 *
 * ## What counts as prose — DERIVED, never a hand list
 *
 * Three rules, each read off an existing SSOT or off the live schema, so a new
 * carrier / atom / verbatim node kind is covered by DECLARATION rather than by
 * someone remembering to extend a list here:
 *
 *   1. A TEXT node is prose unless it wears a raw-LaTeX mark —
 *      `hasRawLatexMark` over `RAW_LATEX_MARK_NAMES` (`latex-lexer.ts`), which
 *      is itself derived from `CARRIER_ROWS` plus the command mark. That
 *      covers a typed or parsed `\command`, an inline `\verb` run, a
 *      verbatim-family carrier, and a `%` comment TAIL.
 *   2. A BLOCK carries prose only if it is a textblock that ADMITS MARKS.
 *      A node declaring `marks: ""` can never wear a carrier, so Virgil could
 *      never label part of it raw LaTeX — which is precisely the shape of
 *      byte-literal content (`latexComment`, `codeBlock`). Read from the live
 *      schema (`type.markSet`), which is the derivation
 *      `text-object-registry.ts` asks for in place next to its own
 *      `MARKLESS_BLOCK_ACTIONS` hand-assignment.
 *   3. Anything that is NOT a text node contributes no prose characters —
 *      which covers every inline atom in `ATOM_REGISTRY` (footnote, citation,
 *      `\ref`, inline math) and every block atom (`texBlock`, `forestBlock`,
 *      `graphicsBlock`, `displayMath`) by construction, since an atom has no
 *      text children to walk. `prose-index.test.ts` sweeps `ATOM_REGISTRY`
 *      so a new atom kind arrives with no fixture and fails the coverage leg
 *      before it can ship.
 *
 * Nothing here is a node-name list. The one shape that needed a decision
 * rather than a rule is `figureBlock`: it is not a schema atom, it holds a
 * `figureCaption` child, and that caption IS prose — so it falls out of rules
 * 2 and 3 correctly, with the caption walked like any other textblock.
 *
 * ## Two things it deliberately does NOT do
 *
 * - It does NOT extract `\caption{…}` payloads out of a raw-LaTeX run the way
 *   the word counter does. That extraction is a REGEX REWRITE of a string —
 *   it strips commands and braces — so it cannot say WHERE the surviving
 *   characters are, and this index's whole contract is positions. A payload
 *   the index cannot place is one it must not claim.
 * - It does NOT replace the word counter. `word-count-core` keeps its own
 *   walk: its bucketing laws (tasks 112 / 121 / 122) are settled, its
 *   `\caption{…}` extraction has no position-bearing form here, and churning
 *   it was a stated non-goal of task 517. It remains the third half-answer,
 *   and MAY migrate onto this index later — deliberately, not in passing.
 *
 * ## Cost class
 *
 * `buildProseIndex` is **O(doc)** — one `descendants` walk plus one pass over
 * each prose block's inline children. It is a DERIVED PRODUCT and must never
 * run on the keystroke path (AGENTS.md → "Keystroke sanctity"). A consumer
 * re-derives EVENT-DRIVEN: gated on the per-category counters from
 * `useStructuralRevisions` (the `DocStructureBus`), or in a `doc-products`
 * tier, or — like the Search panel today — once per user-initiated query.
 * `collectProseRuns` is the per-BLOCK entry point for a consumer that has a
 * touched block from the typed structural diff and wants to re-derive only
 * that block: O(that block's inline children), the shape a squiggle
 * decoration wants (task 518).
 */

import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { isRawLatexMarkName } from "@/lib/latex-lexer";

/**
 * One contiguous run of PROSE characters inside a single block.
 *
 * `charStart` indexes the index's joined `text`; `pmStart` is the document
 * position of the run's first character. The two are NOT parallel: an inline
 * atom — or an excluded raw-LaTeX run — contributes ZERO characters while
 * occupying PM slots, so consecutive runs are char-contiguous and PM-DISJOINT.
 * That gap is the whole reason the run table exists: it is what makes
 * char → PM conversion atom-accurate, and it is how a consumer that must not
 * span an excluded thing (a spell squiggle) knows where it may not.
 */
export interface ProseRun {
  /** Offset of this run's first character in the joined prose text. */
  charStart: number;
  /** PM position of this run's first character. */
  pmStart: number;
  /** Number of characters in the run. */
  len: number;
}

/** One prose-bearing block, with its runs in ascending character order. */
export interface ProseBlockSpan {
  /** The block's `uuid` attr, when it carries one (durable hit identity). */
  uuid: string | null;
  /** PM position of the block's first inline slot (`nodePos + 1`). */
  contentStart: number;
  /** Half-open offsets into the joined prose text spanned by this block. */
  textStart: number;
  textEnd: number;
  /** Per-text-node prose runs, ascending. Excluded runs are absent. */
  runs: ProseRun[];
}

/** The document's prose, as one joined string plus the aligned span table. */
export interface ProseIndex {
  /** Prose-bearing blocks joined by a single "\n", in document order. */
  text: string;
  /** Ascending, non-overlapping. */
  spans: ProseBlockSpan[];
}

/**
 * Does this node type admit marks at all?
 *
 * `markSet === null` means "every mark" (the ProseMirror default); a node that
 * declares `marks: ""` gets an EMPTY set. For a textblock the two are exactly
 * "ordinary prose container" vs "byte-literal container", because a container
 * that admits no marks can never wear a carrier — so Virgil has no way to say
 * which of its characters are raw LaTeX, which is the definition of verbatim.
 *
 * (ProseMirror also assigns an empty set to a node with no inline content, so
 * this is only meaningful for a textblock — which is the only place it is
 * asked.)
 */
function admitsMarks(type: NodeType): boolean {
  return type.markSet === null || type.markSet.length > 0;
}

/**
 * Is this block a PROSE container — a textblock whose characters are the
 * user's writing rather than source bytes?
 *
 * Exported because it is the block-level half of the vocabulary, and a
 * consumer walking blocks itself (a per-block squiggle refresh) must ask the
 * same question this walk asks rather than re-deriving one.
 */
export function blockCarriesProse(node: PMNode): boolean {
  return node.isTextblock && !node.type.isAtom && admitsMarks(node.type);
}

/**
 * Is this inline child PROSE characters?
 *
 * Text that wears no raw-LaTeX mark. Everything else — an atom, a hard break,
 * a carrier run — is not, and contributes nothing but PM width.
 */
export function inlineIsProse(node: PMNode): boolean {
  return node.isText && !node.marks.some((m) => isRawLatexMarkName(m.type.name));
}

/**
 * The prose runs of ONE block, in ascending character order.
 *
 * `charBase` is the offset the block's first prose character takes in the
 * caller's joined text; `contentStart` is the PM position of the block's first
 * inline slot. Returns the runs plus the block's prose text, so a per-block
 * consumer needs no second pass.
 *
 * Cost: O(the block's inline children).
 */
export function collectProseRuns(
  block: PMNode,
  contentStart: number,
  charBase = 0,
): { runs: ProseRun[]; text: string } {
  const runs: ProseRun[] = [];
  let text = "";
  let pmCursor = contentStart;
  block.forEach((child) => {
    if (inlineIsProse(child)) {
      const t = child.text ?? "";
      if (t.length > 0) {
        runs.push({ charStart: charBase + text.length, pmStart: pmCursor, len: t.length });
        text += t;
      }
    }
    pmCursor += child.nodeSize;
  });
  return { runs, text };
}

/**
 * Build the joined prose string AND the aligned per-block span/run table in
 * ONE walk, so a consumer's character offsets and its PM positions can never
 * drift apart.
 *
 * Consecutive PROSE blocks are joined by a single "\n", mirroring
 * `doc.textBetween(0, size, "\n")` — so a query containing a newline behaves
 * exactly as it did before this index existed. A block that carries no prose
 * (a `%` comment block, a code block, a source pod) produces no span, no text
 * and no separator: it is not there at all, rather than there and empty.
 *
 * Cost: O(doc). Never call this from a keystroke handler — see the module
 * header's cost note.
 */
export function buildProseIndex(doc: PMNode): ProseIndex {
  const spans: ProseBlockSpan[] = [];
  let text = "";
  let seenFirst = false;

  doc.descendants((node, nodePos) => {
    if (!node.isTextblock) return true;
    // A textblock that is not a prose container is skipped WHOLE — and its
    // children are text nodes, so there is nothing below it to descend into.
    if (!blockCarriesProse(node)) return false;

    // Separator between consecutive prose blocks (matches `textBetween`'s "\n").
    if (seenFirst) text += "\n";
    seenFirst = true;
    const contentStart = nodePos + 1;
    const textStart = text.length;
    const { runs, text: blockText } = collectProseRuns(node, contentStart, textStart);
    text += blockText;
    spans.push({
      uuid: (node.attrs?.uuid as string | undefined) ?? null,
      contentStart,
      textStart,
      textEnd: text.length,
      runs,
    });
    // Don't descend further — the block's inline content is consumed, and this
    // schema nests no textblock inside a leaf textblock.
    return false;
  });

  return { text, spans };
}

/**
 * The span whose half-open `[textStart, textEnd)` contains `offset`, by binary
 * search. Spans are ascending and non-overlapping, so the only candidate is
 * the rightmost span starting at or before `offset`. (A from-index-0 linear
 * scan is O(spans) per hit and hit count scales with document length for a
 * short query, which went quadratic in document size — task 119.)
 */
export function spanAtOffset(
  spans: readonly ProseBlockSpan[],
  offset: number,
): ProseBlockSpan | null {
  let lo = 0;
  let hi = spans.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].textStart <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return null;
  const s = spans[ans];
  if (offset >= s.textStart && offset < s.textEnd) return s;
  // A zero-length block (an empty paragraph) can host an empty match exactly
  // at its start; tolerate `offset === textStart === textEnd`.
  if (offset === s.textStart && s.textStart === s.textEnd) return s;
  return null;
}

/**
 * Convert a joined-text character offset to a PM position WITHIN `span`,
 * walking its run table so the things that occupy PM slots without
 * contributing characters — inline atoms, and the raw-LaTeX runs this index
 * excludes — don't skew the result.
 *
 * Runs are char-contiguous but NOT PM-contiguous, so a character offset at a
 * run boundary names TWO distinct PM positions — before the skipped slots (the
 * preceding run's end) and after them (the following run's start). Which one
 * is right depends on the endpoint being converted:
 *
 * - `"start"` — a range STARTING at the boundary begins with the following
 *   run's first character, so it resolves AFTER the skipped slots. (A single
 *   inclusive-bound scan resolves it to the preceding run's end — the skipped
 *   slot itself — anchoring a highlight one PM slot early and painting the
 *   atom pill.)
 * - `"end"` — a range ENDING at the boundary must stop BEFORE them, at the
 *   preceding run's end.
 *
 * A block-final boundary (no following run) resolves to the last run's end for
 * both endpoints. Falls back to `contentStart + (offset - textStart)` for the
 * degenerate empty-block case (no runs).
 */
export function proseOffsetToPos(
  span: ProseBlockSpan,
  charOffset: number,
  endpoint: "start" | "end",
): number {
  const runs = span.runs;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const upper = run.charStart + run.len;
    if (charOffset >= run.charStart && charOffset < upper) {
      return run.pmStart + (charOffset - run.charStart);
    }
    if (charOffset === upper) {
      if (endpoint === "end") return run.pmStart + run.len;
      // Start endpoint at a shared boundary: defer to the following run
      // (char-contiguous, so its charStart === upper) to land after the
      // skipped slots; block-final (no following run) resolves here.
      if (!runs[i + 1]) return run.pmStart + run.len;
    }
  }
  return span.contentStart + (charOffset - span.textStart);
}
