import { Mark, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { commitSlashCommand } from "./commands";
import {
  CARRIER_MARK_NAMES,
  LATEX_COMMAND_MARK,
  LATEX_COMMENT_TAIL_MARK,
  LATEX_VERBATIM_MARK,
  carrierRowFor,
  matchBraceGroupAt,
  scanRawLatexSpans,
  verbatimFormOf,
} from "@/lib/latex-lexer";
import type { CarrierRow, VerbatimForm } from "@/lib/latex-lexer";
import {
  contentChangedRanges,
  touchedRanges,
  touchedTextblocks,
} from "./changed-ranges";
import { forEachBareCommand } from "./cmd-only-paragraph";

/**
 * BYTE-LITERAL raw LaTeX — the verbatim carrier (task 264).
 *
 * Its sibling `latexCommand` below means "raw LaTeX the editor doesn't model,"
 * and its serializer path deliberately smart-quotes so a mark TipTap inherited
 * onto stray prose still round-trips to valid `.tex`. `latexVerbatim` means
 * something stricter: "these bytes are literal" — an inline `\verb<delim>…`
 * run, or a `VERBATIM_ENVS_FULL` environment with no modeled node. Every
 * serializer returns this text EXACTLY as parsed; running the prose
 * typographic reverse-map over it corrupts the user's source (it rewrote
 * `x = "hi"` inside a `lstlisting` to ``x = ``hi''`` on the first save).
 *
 * Rationale for a separate mark rather than an attr on `latexCommand`, plus
 * the carrier contract, live with the name in `latex-lexer.ts`.
 *
 * It renders with the same grey-monospace `latex-cmd` class as its sibling —
 * this is a serialization distinction, not a visual one — plus a
 * `latex-verbatim` hook for any future styling.
 */
export const LatexVerbatimMark = Mark.create({
  name: LATEX_VERBATIM_MARK,

  // The TYPE-TIME half of the same law. TipTap's INPUT-rule runner refuses to
  // fire on text adjacent to a mark whose spec is `code` — the same gate that
  // already protects inline code and code blocks. Without it, SmartQuotes
  // would turn a `"` typed inside a `\verb|…|` run or a listing body into a
  // curly `“`, which this mark's byte-literal serializer then writes straight
  // into the `.tex`: the identical corruption arriving through the keyboard
  // instead of through save. (Its `latexCommand` sibling is deliberately NOT
  // `code` — smartening typed quotes there is what keeps an inherited stray
  // mark round-tripping to valid `.tex`.)
  //
  // NOTE the gate is input-rules ONLY: TipTap's paste-rule runner tests the
  // NODE spec and never inspects marks, so a future `addPasteRules` typographic
  // transform would NOT be declined here and would need its own guard. Virgil
  // registers no paste rules today.
  code: true,

  // NOT inclusive: text typed at the trailing edge must NOT inherit the
  // carrier. `code: true` above removes the type-time smart-quote net, and
  // this mark's serializer removes the save-time one, so inherited stray prose
  // would emit raw `"`/`--` into the `.tex` with nothing to normalize it —
  // strictly worse than the `latexCommand` inheritance this carrier was split
  // out of. Interior text keeps the mark either way; only the boundary
  // changes, and the boundary of a `\verb|…|` run is its closing delimiter, so
  // extending it was never right.
  inclusive: false,

  // The one attribute this family declares, and the reason it is worth the
  // JSON-shape change its sibling `latexCommand` deliberately avoided (task
  // 407): a run's own text cannot tell a BROKEN inline `\verb` from an
  // arbitrary REFUSAL carrier, so the demotion half has to read provenance
  // recorded at the push site. `verbatimFormOf` reads anything unrecognized —
  // an older stored card body, a clipboard round trip through a DOM that never
  // carried the attribute — as `"carrier"`, which never demotes: a missed
  // demotion is the status quo, a wrong one escapes the user's source.
  //
  // RENDERED, so a copy/paste inside the app keeps the distinction; only the
  // `"inline"` value is written, so a carrier's DOM is byte-identical to what
  // it was before this attr existed.
  addAttributes() {
    return {
      form: {
        default: "carrier" satisfies VerbatimForm,
        parseHTML: (el: HTMLElement) =>
          verbatimFormOf({ form: el.getAttribute("data-verbatim-form") }),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.form === "inline" ? { "data-verbatim-form": "inline" } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-latex-verbatim]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-latex-verbatim": "",
        class: "latex-cmd latex-verbatim",
      }),
      0,
    ];
  },
});

/**
 * A `%` COMMENT TAIL — the third carrier in this family (task 347).
 *
 * Its two siblings above say "these bytes are raw LaTeX" and "these bytes are
 * literal". This one says something the other two do not: **LaTeX will not
 * typeset these bytes at all**, and it owns the rest of its line. Before task
 * 347 a mid-line `%` had no representation, so it fell into the prose buffer
 * and came back out of the serializer as `\%` — which silently turned every
 * `% TODO cite` into printed body text.
 *
 * Rationale for a separate mark rather than an attr on a sibling, plus the
 * carrier contract and the serializer's line obligation, live with the name in
 * `latex-lexer.ts`.
 *
 * `code: true` and `inclusive: false` for the same two reasons the verbatim
 * carrier gives, and one more for the second: text typed at the trailing edge
 * of a comment must NOT inherit the mark, because the serializer would then
 * emit it after the `%` on the same line — where LaTeX discards it. That is
 * this task's own defect arriving through the keyboard, so the boundary is
 * closed here as well as guarded at the emit end.
 */
export const LatexCommentTailMark = Mark.create({
  name: LATEX_COMMENT_TAIL_MARK,

  code: true,
  inclusive: false,

  parseHTML() {
    return [{ tag: "span[data-latex-comment-tail]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-latex-comment-tail": "",
        class: "latex-comment-tail",
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// The TYPE-TIME carrier (task 360)
// ---------------------------------------------------------------------------
//
// Bare unmarked text used to be a fourth, undeclared carrier for raw LaTeX.
// `latexVerbatim`, `latexCommentTail` and `latexCommand` say what their bytes
// are; a bare text node says nothing, and the decoration below painted a typed
// `\command` grey WITHOUT marking it — so the autosave 1500 ms later handed the
// serializer a run that was raw LaTeX by intent and prose by document model.
// The escape rung could not tell them apart, which is why `CHAR_ESCAPE_TABLE`
// spent tasks 339–349 refusing to write half its own vocabulary.
//
// This plugin retires the ambiguity instead of describing it: as soon as an
// edit WRITES a raw-LaTeX span, the span takes the `latexCommand` mark, in the
// same dispatch. Bare text is then prose BY CONSTRUCTION and the whole escape
// vocabulary emits unconditionally.
//
// Four rules it is built on:
//
//  - **Promotion needs a WRITER.** A span is marked only where the transaction's
//    own changed ranges touch the CONSTRUCT it belongs to. Merely existing is
//    not evidence: a literal backslash that arrived from a source
//    `\textbackslash{}` looks exactly like a typed command, and promoting it on
//    an unrelated keystroke elsewhere in the paragraph would re-create the very
//    corruption this closes. That the correctness rule and the keystroke-sanctity
//    rule are the SAME rule here is not a coincidence — both say *look only at
//    what the edit did*.
//
//  - **A document REPLACEMENT is not a writer.** `setContent` (the load, the
//    code-pane bridge's re-parse) replaces 0…docSize in one step, and its
//    content already carries whatever marks the parse rung decided. Scanning it
//    would promote every literal backslash in the file, on open, with no user
//    gesture — so a step spanning the whole document is skipped. Undo/redo is
//    skipped for the same reason: restored content must keep exactly the marks
//    it had.
//
//  - **The vocabulary is the LEXER's**, not a local copy — `scanRawLatexSpans`
//    is the same door, in the same order, that both inline parsers read at a
//    backslash. What the user types and what a reload produces cannot drift.
//
//  - **…and deletion of what made it LaTeX is a WRITER too** (task 390). The
//    plugin was ADDITIVE-only, on the ground that the parse rung carries things
//    this scanner deliberately declines (the braces of a bare `{a, b}` group,
//    task 349 M6), so a re-derivation that also removed would strip them on the
//    next keystroke in that paragraph. That ground argues for SCOPING the
//    removal, not for refusing it: the mark could never come off at all, so
//    backspacing the `\` off a typed command left the word grey forever — and,
//    because the carrier's serializer contract is EMIT RAW, left whatever the
//    user wrote under it (`%`, `&`, `_`) reaching the `.tex` UNESCAPED. So the
//    mark comes off a run the edit TOUCHED that the scanner no longer claims,
//    and off nothing else. Which construct an edit touched is asked of the OLD
//    text as well as the new — see `brokenConstructs`, and the note there on
//    why the new text alone cannot answer it.
//
//  - **…and the law is about CARRIERS, not about this mark** (task 407). Its
//    two siblings were left one-way for a year, and the comment tail was the
//    silent one: a run whose leading `%` an edit removed kept
//    `latexCommentTail`, whose serializer arm emits the bytes VERBATIM with no
//    `%` re-prefix, so the user's annotation started typesetting in the PDF.
//    They demote through the SAME `touches` scoping and the SAME
//    replacement/history exemptions, off the family table in `latex-lexer.ts`
//    — but their predicate can NOT be `scanRawLatexSpans`: a comment tail's
//    bytes are not raw LaTeX at all (they are not typeset), and a `\verb` run
//    is one whole construct rather than a sequence of them, so each row asks
//    its own anchored question of the run's own text. The one row that never
//    demotes is `latexVerbatim`'s REFUSAL form — arbitrary source with no
//    grammar, which no edit can break.
//
// Cost: O(edit) to collect the ranges, then one scan of each TOUCHED TEXTBLOCK
// — never a doc walk, and nothing at all when the block holds no `\`, no `{`
// and no mark. A block that holds a STALE mark the edit did not itself reach
// pays one further scan, of that block's prior text; nothing else does.

/** Stands in for a non-text child, and for the bytes of a run carrying a
 *  stricter carrier, so offsets stay 1:1 with document positions while no
 *  construct can start in — or reach across — either. */
const OPAQUE = "￼";

/** The two carriers whose bytes are LITERAL or INERT. A `\` inside one of them
 *  is not a construct this scanner may claim.
 *
 *  DERIVED from the family table (task 407) rather than hand-listed: the
 *  census of "which marks are stricter carriers" belongs in exactly one place,
 *  beside the rows that say what each one CLAIMS. */
const SIBLING_CARRIER_MARKS = new Set(CARRIER_MARK_NAMES);

function isOpaqueRun(child: PMNode): boolean {
  return child.marks.some((m) => SIBLING_CARRIER_MARKS.has(m.type.name));
}

/**
 * One maximal run of a block's text children that all carry the SAME carrier
 * row — its own bytes and its BLOCK-RELATIVE range (task 407).
 *
 * Merged by ROW, not by mark-set identity: bolding the word `verb` inside
 * `\verb|x|` splits it into three text nodes with different mark arrays, and
 * asking each third whether it spells a `\verb` run would demote all three.
 * Two runs of the SAME mark with different `form` attrs are different rows and
 * stay separate, which is what keeps an inline `\verb` abutting a refusal
 * carrier from being answered by one question.
 */
interface CarrierRun extends Range {
  row: CarrierRow;
  text: string;
}

/**
 * Is this transaction a DOCUMENT REPLACEMENT rather than an edit? See rule 2.
 *
 * Two signals, because neither alone is honest. TipTap's `setContent` stamps
 * `preventUpdate` (with the value `!emitUpdate`, so the meta is PRESENT either
 * way) — the precise answer for the load and for the code-pane bridge's
 * re-parse. The structural test beside it is the backstop for a raw
 * `view.dispatch(tr.replaceWith(0, size, doc))`, which stamps nothing.
 *
 * Stated residual: select-all-then-type replaces 0…size too, so raw LaTeX
 * arriving that way is not promoted. It is escaped as the literal characters it
 * is, which round-trips — a missed promotion, never a corruption.
 */
function replacesWholeDoc(tr: Transaction): boolean {
  if (tr.getMeta("preventUpdate") !== undefined) return true;
  return tr.steps.some((step, si) => {
    const range = step as unknown as { from?: number; to?: number };
    return (
      range.from === 0 &&
      typeof range.to === "number" &&
      range.to === tr.docs[si].content.size
    );
  });
}

/**
 * Does EVERY text node in `from…to` already carry `type`?
 *
 * Deliberately not `Node.rangeHasMark`, which answers "somewhere in this range"
 * — the wrong question here and a silent one: typing `}` to close `\emph{hi}`
 * offers a span whose FIRST characters (`\emph`, marked one keystroke earlier)
 * already carry the mark, so the "already done" bail fired and the argument was
 * never promoted. The command emitted raw and its own braces emitted escaped.
 */
function fullyMarked(
  doc: PMNode,
  from: number,
  to: number,
  type: { name: string },
): boolean {
  let complete = true;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    if (!node.marks.some((m) => m.type.name === type.name)) complete = false;
    return true;
  });
  return complete;
}

/**
 * A half-open interval. Block-RELATIVE (the scan's coordinates) or ABSOLUTE
 * (the document's) — they are `start` apart and are never mixed in one list.
 */
interface Range {
  from: number;
  to: number;
}

/**
 * Does `a` TOUCH `b`? Adjacency counts, and it has to in BOTH directions:
 * promotion because completing `\emph` by typing `h` at its very edge is
 * writing it, demotion because a deletion's changed range is ZERO-WIDTH in the
 * new document — a strict-overlap test would make the commonest demotion there
 * is (backspacing the `\` off a command) invisible. One predicate, so the two
 * halves of the carrier cannot come to disagree about what "the edit reached
 * this" means.
 */
function touches(a: Range, b: Range): boolean {
  return a.from <= b.to && a.to >= b.from;
}

/** Sorted, disjoint union of `spans`. Adjacent intervals merge — the braces and
 *  the command of `{\bf hi}` are three spans and one stretch of carrier. */
function mergeRanges(spans: Range[]): Range[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const out: Range[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].from <= last.to) last.to = Math.max(last.to, sorted[i].to);
    else out.push({ ...sorted[i] });
  }
  return out;
}

/** The parts of `run` that `cover` (sorted + disjoint) does not account for. */
function subtractCover(run: Range, cover: Range[]): Range[] {
  const out: Range[] = [];
  let at = run.from;
  for (const c of cover) {
    if (c.to <= at) continue;
    if (c.from >= run.to) break;
    if (c.from > at) out.push({ from: at, to: Math.min(c.from, run.to) });
    at = Math.max(at, c.to);
    if (at >= run.to) break;
  }
  if (at < run.to) out.push({ from: at, to: run.to });
  return out;
}

/**
 * One walk of a textblock, answering both halves of the carrier at once: the
 * TEXT the scanner reads, and the maximal contiguous runs that already carry
 * the mark.
 *
 * Every non-text child — and every run wearing a STRICTER carrier — stands in
 * as `OPAQUE`, so offsets stay 1:1 with document positions while no construct
 * can start in, or reach across, either.
 *
 * The marked runs cost nothing extra: this walk already had to happen to build
 * the text, which is why the block gate below can afford its third disjunct.
 */
function readBlock(
  block: PMNode,
  type: { name: string },
): { text: string; marked: Range[]; carriers: CarrierRun[] } {
  let text = "";
  const marked: Range[] = [];
  const carriers: CarrierRun[] = [];
  let at = 0;
  block.forEach((child) => {
    const size = child.nodeSize;
    const opaque = !child.isText || isOpaqueRun(child);
    text += opaque ? OPAQUE.repeat(size) : (child.text as string);
    if (!opaque && child.marks.some((m) => m.type.name === type.name)) {
      const last = marked[marked.length - 1];
      if (last && last.to === at) last.to = at + size;
      else marked.push({ from: at, to: at + size });
    }
    // The SIBLING carriers ride this same walk (task 407) rather than a second
    // one: their demotion half asks a whole-RUN question, and the runs are
    // exactly the children this loop is already visiting. A block carrying no
    // sibling mark therefore pays one `Set.has` per child and nothing else.
    if (child.isText) {
      for (const m of child.marks) {
        if (!SIBLING_CARRIER_MARKS.has(m.type.name)) continue;
        const row = carrierRowFor(m.type.name, m.attrs);
        if (!row) continue;
        const last = carriers[carriers.length - 1];
        if (last && last.row === row && last.to === at) {
          last.to = at + size;
          last.text += child.text as string;
        } else {
          carriers.push({
            row,
            text: child.text as string,
            from: at,
            to: at + size,
          });
        }
      }
    }
    at += size;
  });
  return { text, marked, carriers };
}

/**
 * The BALANCED brace pairs of a block, as block-relative offsets, where BOTH
 * braces carry the carrier (task 390b).
 *
 * A brace is not a construct on its own. The carrier marks a `{`/`}` only as
 * the DELIMITERS of a group — promotion gives the pair one shared extent and
 * marks them together — so they have to come OFF together too. A demotion that
 * takes one and leaves the other emits unbalanced LaTeX: the demoted brace goes
 * through the escape rung to `\}`, which the next parse reads as the literal
 * character it now is, so the surviving `{` has no partner and the paper stops
 * compiling. And the write gate cannot see it — `\}` against `}` moves zero
 * word tokens.
 *
 * So an INTACT pair never demotes (below). Both-or-neither was the first cut
 * and is weaker: it keeps the output balanced and still escapes a pair the edit
 * reaches on both sides, which for `caf{\'e}s` turns a grouping the user never
 * touched into printed braces the moment they delete the accented letter.
 * Refusing outright is better on every case, because a marked pair is a group
 * either way — emitting it raw is exactly what a re-parse of those bytes
 * produces, so `\emph{hi}` minus its lead saves as `emph{hi}` rather than
 * diverging from the parse rung. A brace whose partner is GONE has no pair
 * here and demotes normally, which is the group twin this law must not block.
 *
 * Escape-aware through the lexer's own door (`matchBraceGroupAt`), so a typed
 * `\{` is not mistaken for a delimiter, and blind to OPAQUE runs by
 * construction — a brace inside a `\verb` run is not in this text.
 */
function markedBracePairs(
  text: string,
  marked: Range[],
): { open: number; close: number }[] {
  const inMarked = (off: number) =>
    marked.some((m) => off >= m.from && off < m.to);
  const out: { open: number; close: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" || !inMarked(i)) continue;
    const group = matchBraceGroupAt(text, i);
    if (!group) continue;
    const close = group.end - 1;
    if (inMarked(close)) out.push({ open: i, close });
  }
  return out;
}

/**
 * The constructs this edit BROKE, as ranges in the final document, clipped to
 * the block that asked (task 390).
 *
 * Demotion asks exactly the question promotion asks — *did this edit WRITE this
 * construct?* — of the text as it stood BEFORE the edit, because a construct
 * the user has just dismantled leaves nothing in the NEW text to gate on.
 * Deleting the `{` of `{\bf hi}` orphans its `}` six characters away: the new
 * text says nothing at all about the pair, while the old scan says everything
 * (both braces carry the group's own extent). One scanner, two texts, the same
 * question — which is what makes the demotion half a derivation rather than a
 * special case for backspace.
 *
 * COST, stated precisely because the loose version of it was wrong. This runs
 * only for a block holding a stale run that the changed ranges do not
 * themselves reach — so an ordinary keystroke in ordinary prose, and every
 * deletion that strands a mark under its own cursor, pay nothing for it. What
 * DOES pay is a block holding a run this scanner permanently declines while
 * the parse rung carries it (a source bare `{a, b}` group): such a run is
 * "stale" forever, so every keystroke anywhere in that block buys a second
 * `readBlock` + a second scan + one `Mapping` build. Block-bounded, never
 * document-bounded — the law holds — but it is roughly 2x the carrier's
 * per-keystroke work in that one paragraph, not nothing. Measured over every
 * `.tex` in the repo, almost no paragraph has the shape: a bare-looking group
 * in a body is nearly always a `]{…}` command argument, which the scanner
 * claims (hence covered, never pending).
 */
function brokenConstructs(
  oldDoc: PMNode,
  backward: Mapping,
  forward: Mapping,
  block: Range,
  ranges: Range[],
  type: { name: string },
): Range[] {
  let $old;
  try {
    const at = backward.map(block.from);
    $old = oldDoc.resolve(Math.min(Math.max(at, 0), oldDoc.content.size));
  } catch {
    return [];
  }
  // A block the edit CREATED maps back to no textblock of its own (or to a
  // different one). There is then no prior construct to have broken, and the
  // clip below bounds a mis-resolution to the block the user is editing.
  if (!$old.parent.isTextblock) return [];
  const { text } = readBlock($old.parent, type);
  const oldStart = $old.start();
  const out: Range[] = [];
  for (const span of scanRawLatexSpans(text)) {
    const from = forward.map(oldStart + span.extentFrom, -1);
    const to = forward.map(oldStart + span.extentTo, 1);
    if (!ranges.some((r) => touches({ from, to }, r))) continue;
    const clipped = {
      from: Math.max(from, block.from),
      to: Math.min(to, block.to),
    };
    if (clipped.from <= clipped.to) out.push(clipped);
  }
  return out;
}

export const latexCarrierPluginKey = new PluginKey("latexCommandCarrier");

/** Grey-monospace styling for unhandled LaTeX commands, plus Enter-to-execute. */
export const LatexCommandMark = Mark.create({
  // The name lives in `latex-lexer.ts` beside its two siblings, so the
  // tiptap-free layers (the parser, the serializer, the prose index) can name
  // this carrier without a literal of their own (task 517).
  name: LATEX_COMMAND_MARK,

  // NOT inclusive (task 360). ProseMirror's default is `true`, so text typed at
  // the trailing edge of a marked run INHERITED the carrier — which is why
  // `serializeMarks`' latexCommand branch smart-quotes: prose that had drifted
  // onto the mark still had to round-trip to valid `.tex`. With the type-time
  // carrier deriving the mark from the text, inheritance is not merely
  // unnecessary but wrong: finishing `\emph{hi}` and continuing to write must
  // produce prose, and the scanner re-extends the mark itself while a command is
  // still being typed. Same boundary rule its two sibling carriers took, for the
  // same reason (`latexVerbatim` task 264, `latexCommentTail` task 347) —
  // interior text keeps the mark either way; only the boundary changes.
  //
  // Deliberately NOT `code: true`, unlike those siblings: smartening a typed
  // quote inside a `\command` run is what keeps a stray inherited mark emitting
  // valid `.tex`, and that net stays.
  inclusive: false,

  parseHTML() {
    return [{ tag: 'span[data-latex-cmd]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-latex-cmd": "",
        class: "latex-cmd",
      }),
      0,
    ];
  },

  addProseMirrorPlugins() {
    const markType = this.type;

    /** Paint `.latex-cmd` inline decos over the bare-text commands in one
     *  text node (skips text already carrying the latexCommand mark, which
     *  renders its own `.latex-cmd` span). The scanner is the SAME
     *  `forEachBareCommand` the `p-cmd-only` stamp counts with
     *  (`cmd-only-paragraph.ts`), so the grey span and the rhythm class can
     *  never disagree about what a command run is. */
    function decorateTextNode(
      decos: Decoration[],
      node: any,
      pos: number,
    ): void {
      if (!node.isText || !node.text) return;
      if (node.marks.some((m: any) => m.type === markType)) return;
      forEachBareCommand(node.text as string, (off, len) => {
        decos.push(Decoration.inline(pos + off, pos + off + len, { class: "latex-cmd" }));
      });
    }

    /**
     * Every decoration ONE textblock carries: the inline `.latex-cmd` spans
     * over its bare-text command runs. The unit of re-derivation for both the
     * cold build and the per-transaction rebuild, so the two can never come to
     * disagree about what a block's decorations are.
     *
     * The `p-cmd-only` paragraph aggregate is NOT a decoration any more (task
     * 430): it is stamped by the paragraph NodeView from
     * `paragraphIsCmdOnly` (`cmd-only-paragraph.ts`). A node decoration over a
     * whole paragraph lives in the ROOT set's `local` array, so every
     * `find`/`remove`/`add` below swept O(command-only paragraphs) per
     * keystroke; with inline spans only, that array is EMPTY and the set
     * bookkeeping here is bounded by the touched blocks alone.
     */
    function decorateBlock(
      decos: Decoration[],
      node: any,
      pos: number,
    ): void {
      node.forEach((child: any, offset: number) => {
        decorateTextNode(decos, child, pos + 1 + offset);
      });
    }

    /** The cold build — a whole document, once at init and on a document
     *  REPLACEMENT. Every other transaction goes through `rebuildBlocks`. */
    function buildDecorations(doc: any): DecorationSet {
      const decos: Decoration[] = [];
      doc.descendants((node: any, pos: number) => {
        if (!node.isTextblock) return true;
        decorateBlock(decos, node, pos);
        return false; // children handled above
      });
      return DecorationSet.create(doc, decos);
    }

    /**
     * Re-derive ONLY the given blocks: drop what the set holds inside each one,
     * paint it fresh.
     *
     * The removal window is "anything that REACHES INTO this block", not
     * "anything the query returned" and not "anything wholly inside it", and
     * both halves of that are load-bearing:
     *
     *  • `find(from, to)` is INCLUSIVE at both endpoints, so a neighbour's
     *    decoration whose range abuts this block exactly comes back (until
     *    task 430 that was the next paragraph's `p-cmd-only` NODE decoration,
     *    and removing it without re-adding it silently un-flagged it; today
     *    nothing this plugin paints abuts a block edge, and the test is kept
     *    because the rule is about the query, not about what happens to be
     *    in the set).
     *  • A mapped inline decoration CAN straddle a block boundary: press Enter
     *    inside a command run and the split maps its `from` into the first
     *    paragraph and its `to` into the second, where ProseMirror's `forChild`
     *    paints it on BOTH halves. A wholly-inside test would leave that
     *    stale span standing — the one case the retired whole-document rebuild
     *    cleaned up by accident. A straddle can only be produced by a change
     *    that crossed the boundary, so both blocks are in `blocks` and both get
     *    repainted.
     *
     * Cost, stated rather than implied: `find`/`remove`/`add` each sweep the
     * root's own `local` array and its child index. Since task 430 every
     * decoration here is an INLINE span, strictly contained in its textblock,
     * so the root `local` array is EMPTY (pinned in decoration-probe-cost) and
     * the sweep is the child index — integer comparisons over top-level
     * blocks, the same order as the `oldSet.map(...)` that precedes it on
     * every transaction, and roughly two orders below the `DecorationSet.create`
     * it replaces. The O(command-only paragraphs) `local` sweep that the
     * `p-cmd-only` node decorations used to cost is gone with them.
     */
    function rebuildBlocks(
      set: DecorationSet,
      doc: any,
      blocks: Map<number, PMNode>,
    ): DecorationSet {
      const stale: Decoration[] = [];
      const fresh: Decoration[] = [];
      for (const [pos, node] of blocks) {
        const end = pos + node.nodeSize;
        for (const deco of set.find(pos, end)) {
          // Merely touching the boundary is a NEIGHBOUR's decoration; anything
          // that reaches inside is this block's, straddles included.
          if (deco.to <= pos || deco.from >= end) continue;
          stale.push(deco);
        }
        decorateBlock(fresh, node, pos);
      }
      const kept = set.remove(stale);
      return fresh.length > 0 ? kept.add(doc, fresh) : kept;
    }

    return [
      // Live decoration for \commands while typing.
      //
      // ONE question per transaction — WHICH BLOCKS DID THIS EDIT TOUCH — and a
      // rebuild scoped to the answer. Until task 400 there were three PROBES in
      // front of an all-or-nothing `buildDecorations(tr.doc)`: a backslash scan
      // of the changed text, an overlap test against the mapped set, and a
      // mark-step test. Each was correct, and each gated a WHOLE-DOCUMENT walk
      // ending in `DecorationSet.create`, whose `buildTree` re-scans the entire
      // decoration array once per top-level child. MEASURED on the pre-fix tree
      // through `decoration-probe-cost.test.ts`: typing the nine characters of
      // `\emph{hi}` into paragraph 0 re-derived 605 decorations in a
      // 60-paragraph document and 2405 in a 240-paragraph one — the keystroke
      // cost scaling with the PAPER. (The task's own trace counted 14 rebuilds
      // for that string typed into an empty paragraph, since `applyTransaction`
      // runs `applyInner` on the root transaction and again per appended one,
      // and put the per-rebuild cost near 320 000 iterations at 400 paragraphs.)
      // The probes only existed because the
      // rebuild was all-or-nothing; once re-derivation is per block there is
      // nothing left to gate, and the mark-step case that motivated the third
      // probe is just another positional step in the shared answer.
      //
      // Every decoration this plugin paints is block-LOCAL (inline spans inside
      // one textblock — the `p-cmd-only` aggregate over one paragraph's own
      // children is the paragraph NodeView's stamp since task 430), which is
      // what makes the scoped rebuild sufficient and not merely cheaper. The correctness the third probe bought is kept whole: a
      // mark step reaches `touchedRanges` through `positionalStepRange`, so an
      // inline deco standing over a run the carrier has just MARKED is dropped
      // in the same dispatch — otherwise it paints a second `.latex-cmd` inside
      // the mark's own span and the nested `font-size: 0.9em` compounds to
      // 0.81em. (The `p-cmd-only` flag the task-400 text used to describe here
      // is the paragraph NodeView's since task 430 — it re-derives from the
      // node on every change to that node, mark steps included.)
      new Plugin({
        key: new PluginKey("latexCmdDecorations"),
        state: {
          init(_config, state) {
            return buildDecorations(state.doc);
          },
          apply(tr, oldSet) {
            const mapped = oldSet.map(tr.mapping, tr.doc);
            if (!tr.docChanged) return mapped;
            // A document REPLACEMENT (the load, the code-pane bridge's
            // re-parse, a raw full-range dispatch) touches every block, so the
            // cold build is both correct and cheaper than removing and re-adding
            // block by block. The same predicate the carrier below uses, for the
            // same reason. [cost: O(doc) — the ONE whole-document arm, reachable
            // only from a document replacement, never from a keystroke] (the
            // task-433 census's stated exemption; the ordinary path below takes
            // the `touchedTextblocks` door).
            if (replacesWholeDoc(tr)) return buildDecorations(tr.doc);
            const blocks = touchedTextblocks(tr.doc, touchedRanges([tr]));
            if (blocks.size === 0) return mapped;
            return rebuildBlocks(mapped, tr.doc, blocks);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
      // The TYPE-TIME CARRIER (task 360; BOTH directions since task 390) — see
      // the note above the mark for the rules. Registered on the mark itself,
      // so both surfaces that mount `LatexCommandMark` get it: the main editor
      // and every card body (`buildCardBodySchema`), whose serializer runs the
      // same escape rung.
      new Plugin({
        key: latexCarrierPluginKey,
        appendTransaction(trs, oldState, newState) {
          if (!trs.some((t) => t.docChanged)) return null;
          if (trs.some((t) => replacesWholeDoc(t) || isHistoryTransaction(t)))
            return null;

          const ranges = contentChangedRanges(trs);
          if (ranges.length === 0) return null;

          // The touched TEXTBLOCKS, deduped by position — a construct can start
          // well before the edit (`\definecolor{a}{b}{c}` typed into its last
          // argument), so the block is the smallest honest scan window. Shared
          // with the decoration plugin above since task 400; the helper adds an
          // O(depth) fast path for the single-block shape every keystroke has.
          const blocks = touchedTextblocks(newState.doc, ranges);

          // old ⇄ new positions, composed ONCE and only if the demotion half
          // asks (see `brokenConstructs`). An ordinary keystroke never gets
          // here, and neither does a deletion whose own range already reaches
          // the run it stranded.
          let forward: Mapping | null = null;
          let backward: Mapping | null = null;
          const composed = () => {
            if (!forward || !backward) {
              const f = new Mapping();
              for (const t of trs) f.appendMapping(t.mapping);
              forward = f;
              backward = f.invert();
            }
            return { forward, backward };
          };

          let tr: Transaction | null = null;
          for (const [pos, block] of blocks) {
            // `codeBlock` / `latexComment` declare `marks: ""` — the markless
            // pair the serializer emits byte-raw. Nothing to promote, nothing
            // that could be carrying a stale mark, and `addMark` would silently
            // decline anyway. The SIBLING pass below sits under the same guard
            // for the same reason and one more: `marks: ""` excludes the whole
            // vocabulary, so such a block cannot be carrying a stale sibling
            // mark either.
            if (!block.type.allowsMarkType(markType)) continue;
            const start = pos + 1;
            const { text, marked, carriers } = readBlock(block, markType);

            // ── the SIBLING carriers demote too (task 407) ─────────────────
            //
            // Task 390's law is about CARRIERS, not about `latexCommand`, and
            // its two siblings were left one-way. The comment tail was the
            // SILENT leg: backspace the `%` of `x % TODO cite` and the
            // remainder kept `latexCommentTail`, whose serializer arm emits the
            // run's bytes VERBATIM with no `%` re-prefix anywhere — so the
            // user's annotation reached the `.tex` as live body text and
            // started TYPESETTING in the PDF, as a fixed point (the next parse
            // reads unmarked prose and the `%` is gone for good). The inline
            // `\verb` twin is the loud one: delete its lead and a live `%`
            // inside the payload comments out the rest of the source line;
            // delete a delimiter and the paper stops compiling.
            //
            // WHOLE-RUN, so this half is strictly cheaper than the sub-span
            // machinery below — one anchored match per marked run in a touched
            // block, no cover subtraction, no brace pairing and no old-text
            // pass. The run IS the construct, so an edit that can break it lies
            // inside it or is adjacent to its boundary, which `touches` already
            // counts in both directions (a deletion's changed range is
            // ZERO-WIDTH in the new document — the commonest demotion there is).
            //
            // A REFUSAL-carrier row (`claims === null`) never demotes, and that
            // is a decision rather than an omission: a stale mark there is a
            // VISIBLE compile error, while demoting an unmodeled environment or
            // a `\begingl…` gloss would push a screenful of the user's source
            // through the escape rung (`\`→`\textbackslash{}`, `{`→`\{`) —
            // strictly worse than the thing being fixed. Which row a run takes
            // is PROVENANCE read off the mark, never a guess from its text: a
            // damaged inline `\verb` and an arbitrary carrier both fail every
            // lexer door, so a text-shape test would be a blacklist that leaks
            // onto all four carrier shapes.
            for (const run of carriers) {
              if (!run.row.claims) continue;
              const abs = { from: start + run.from, to: start + run.to };
              if (run.row.claims(run.text)) continue;
              if (!ranges.some((r) => touches(abs, r))) continue;
              const siblingType = newState.schema.marks[run.row.mark];
              if (!siblingType) continue;
              tr ??= newState.tr;
              tr.removeMark(abs.from, abs.to, siblingType);
            }

            // THE BLOCK GATE, in both directions. Promotion needs a `\` or a
            // `{` to have anything to find; DEMOTION needs the block to still
            // CARRY the mark — which is exactly the block a deletion has just
            // emptied of both leads, and exactly the block the promotion-only
            // gate skipped, so even a demotion-aware scan would never have
            // looked at it (task 390).
            const hasLead = text.includes("\\") || text.includes("{");
            if (!hasLead && marked.length === 0) continue;
            // With no lead the scan is PROVABLY empty (it advances on any other
            // character), so a stale mark over plain prose costs no scan at all.
            const spans = hasLead ? scanRawLatexSpans(text) : [];

            // ── promote: the mark goes ON what the edit WROTE ──────────────
            for (const span of spans) {
              const extentFrom = start + span.extentFrom;
              const extentTo = start + span.extentTo;
              // Rule 1: this edit must have WRITTEN the construct. Touching
              // counts — completing `\emph` by typing `h` at its very edge is
              // writing it.
              if (!ranges.some((r) => extentFrom <= r.to && extentTo >= r.from))
                continue;
              // Never mark ACROSS an inline atom or a stricter carrier: a
              // citation chip inside a `\textbf{…}` argument would take the
              // mark with the text.
              if (text.slice(span.from, span.to).includes(OPAQUE)) continue;
              const from = start + span.from;
              const to = start + span.to;
              if (fullyMarked(newState.doc, from, to, markType)) continue;
              tr ??= newState.tr;
              tr.addMark(from, to, markType.create());
            }

            // ── demote: the mark comes OFF what the edit UN-wrote ──────────
            //
            // Deleting what made a run LaTeX is a writer exactly as typing it
            // was. Without this the mark could never come off: the run stayed
            // grey with no `\` in sight, and — the half that is not cosmetic —
            // kept the carrier's EMIT-RAW contract, so a `%`/`&`/`_` left under
            // it reached the `.tex` unescaped and commented out (or broke) the
            // line.
            if (marked.length === 0) continue;
            const cover = mergeRanges(
              spans.map((s) => ({ from: s.from, to: s.to })),
            );
            // Every scanned span PROTECTS, whether or not this edit touched it
            // and whether or not promotion declined it for an OPAQUE crossing:
            // a missed demotion is the status quo, while a wrong one changes
            // the bytes. Protect broadly, demote narrowly.
            const pending: { run: Range; parts: Range[] }[] = [];
            for (const run of marked) {
              const parts = subtractCover(run, cover);
              if (parts.length > 0) pending.push({ run, parts });
            }
            if (pending.length === 0) continue;

            // Rule 1 again, and it is load-bearing rather than tidy: the parse
            // rung carries things this scanner deliberately declines (the
            // braces of a SOURCE `{a, b}` group, task 349 M6 — and of a group
            // whose LaTeX the parse itself normalized to glyphs, `{\'e}` →
            // `{é}`, which reads here as a prose group), so a block-wide
            // demotion would strip them on an unrelated keystroke two words
            // away — and those bytes would then go through the escape rung on
            // the next save. That is this defect's own inverse, arriving as the
            // fix. Touch-scoped, the worst wrong demotion is of a run the user
            // was editing, which is the honest reading of their edit — the same
            // standing residual promotion already carries for the mirror case
            // (an edit INSIDE a literal backslash promotes it).
            let window = ranges;
            const reaches = (run: Range) =>
              window.some((w) =>
                touches({ from: start + run.from, to: start + run.to }, w),
              );
            if (pending.some((p) => !reaches(p.run))) {
              const { forward: f, backward: b } = composed();
              window = ranges.concat(
                brokenConstructs(
                  oldState.doc,
                  b,
                  f,
                  { from: start, to: start + text.length },
                  ranges,
                  markType,
                ),
              );
            }
            // A BRACE IS NOT A CONSTRUCT ON ITS OWN (task 390b): an INTACT
            // marked pair never demotes — see `markedBracePairs` for what a
            // one-sided demotion emits and why both-or-neither was not enough.
            // A brace whose partner is gone is in no pair and demotes.
            const scheduled = new Set<number>();
            for (const { run, parts } of pending) {
              if (!reaches(run)) continue;
              for (const part of parts) {
                for (let o = part.from; o < part.to; o++) scheduled.add(o);
              }
            }
            if (scheduled.size > 0) {
              for (const { open, close } of markedBracePairs(text, marked)) {
                scheduled.delete(open);
                scheduled.delete(close);
              }
            }
            for (const { run, parts } of pending) {
              if (!reaches(run)) continue;
              for (const part of parts) {
                // Re-cut the part around anything the brace pairing withdrew.
                let at = part.from;
                for (let o = part.from; o <= part.to; o++) {
                  if (o < part.to && scheduled.has(o)) continue;
                  if (o > at) {
                    tr ??= newState.tr;
                    tr.removeMark(start + at, start + o, markType);
                  }
                  at = o + 1;
                }
              }
            }
          }
          // A mark-only transaction carries an EMPTY step map, so re-entering
          // here on our own append finds no changed range and stops. Nothing to
          // guard against by hand.
          return tr;
        },
      }),
      // Virgil command execution on Enter — the slash surface's SECOND commit
      // door, and the one with no popup in front of it: it matches a trailing
      // `\name` on Enter, so it fires when the popup was never opened
      // (dismissed with Escape, or suppressed by `isFreshPosition`).
      //
      // Task 398: it used to carry its own copy of the popup's three steps and
      // its own copy of the popup's DEFECT — delete the typed text first, let
      // the action refuse afterwards — so fixing the popup alone would have left
      // this door eating characters in exactly the same containers. Both now
      // route through `commitSlashCommand`, which asks the registry row's
      // `applies()` BEFORE it deletes anything.
      //
      // On a refusal this returns FALSE rather than consuming the key, and the
      // asymmetry with the popup is deliberate: there is no offered row here to
      // report a refusal on, so the least surprising outcome is an ordinary
      // Enter with the user's text left where they typed it. (The popup, which
      // DOES show the row, consumes — activating a disabled control does
      // nothing.)
      new Plugin({
        key: new PluginKey("virgilCommands"),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Enter") return false;
            const { state } = view;
            const { from } = state.selection;
            if (from !== state.selection.to) return false; // collapsed cursor only

            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 40),
              $from.parentOffset,
              undefined,
              "\ufffc",
            );

            // Match \commandname at end of text before cursor
            const cmdMatch = textBefore.match(/\\([a-zA-Z]+)$/);
            if (!cmdMatch) return false;

            return commitSlashCommand(
              view,
              cmdMatch[1]!,
              from - cmdMatch[0].length,
              from,
            );
          },
        },
      }),
    ];
  },
});
