import { Mark, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { AddMarkStep, Mapping, RemoveMarkStep } from "@tiptap/pm/transform";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { COMMAND_MAP } from "./commands";
import {
  LATEX_COMMENT_TAIL_MARK,
  LATEX_VERBATIM_MARK,
  matchBraceGroupAt,
  scanRawLatexSpans,
} from "@/lib/latex-lexer";

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
// Cost: O(edit) to collect the ranges, then one scan of each TOUCHED TEXTBLOCK
// — never a doc walk, and nothing at all when the block holds no `\`, no `{`
// and no mark. A block that holds a STALE mark the edit did not itself reach
// pays one further scan, of that block's prior text; nothing else does.

/** Stands in for a non-text child, and for the bytes of a run carrying a
 *  stricter carrier, so offsets stay 1:1 with document positions while no
 *  construct can start in — or reach across — either. */
const OPAQUE = "￼";

/** The two carriers whose bytes are LITERAL or INERT. A `\` inside one of them
 *  is not a construct this scanner may claim. */
function isOpaqueRun(child: PMNode): boolean {
  return child.marks.some(
    (m) =>
      m.type.name === LATEX_VERBATIM_MARK ||
      m.type.name === LATEX_COMMENT_TAIL_MARK,
  );
}

/**
 * Every range the given transactions CHANGED, in the coordinates of the final
 * document.
 *
 * Read per STEP against that step's own map and then mapped forward through the
 * rest of the transaction and through every later transaction — the rule
 * `BlockUuidBackfill` earned (task 320): a per-transaction `tr.mapping` re-applies
 * earlier steps' maps to positions that already reflect them, which for the
 * delete-then-insert shape every relocation uses collapses the inserted range to
 * nothing.
 */
function changedRanges(
  trs: readonly Transaction[],
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  trs.forEach((tr, ti) => {
    if (!tr.docChanged) return;
    tr.steps.forEach((step, si) => {
      step.getMap().forEach((_oldFrom, _oldTo, newFrom, newTo) => {
        const rest = tr.mapping.slice(si + 1);
        let from = rest.map(newFrom, -1);
        let to = rest.map(newTo, 1);
        for (let k = ti + 1; k < trs.length; k++) {
          from = trs[k].mapping.map(from, -1);
          to = trs[k].mapping.map(to, 1);
        }
        out.push({ from, to });
      });
    });
  });
  return out;
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
): { text: string; marked: Range[] } {
  let text = "";
  const marked: Range[] = [];
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
    at += size;
  });
  return { text, marked };
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
 * The pair set is what the demotion's own verdicts are then reconciled against
 * (below): exactly one side scheduled means NEITHER goes. Refusing is the safe
 * direction — it leaves the source group untouched, which for a group this
 * scanner never claimed is the honest answer to an edit that merely happened
 * next to it.
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
 * per-keystroke work in that one paragraph, not nothing.
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
  name: "latexCommand",

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

    /** Match a full LaTeX command span: \cmd*?[opt]{arg}{arg} — same as the parser. */
    function matchCommandLength(text: string, start: number): number {
      let i = start;
      // \
      if (i >= text.length || text[i] !== "\\") return 0;
      i++;
      // command name: [a-zA-Z]+
      const nameStart = i;
      while (i < text.length && /[a-zA-Z]/.test(text[i])) i++;
      if (i === nameStart) return i - start; // just "\" alone
      // optional *
      if (i < text.length && text[i] === "*") i++;
      // optional [...] args
      while (i < text.length && text[i] === "[") {
        const close = text.indexOf("]", i);
        if (close === -1) break;
        i = close + 1;
      }
      // up to 2 {braced} args — include unclosed braces (user still typing)
      let braces = 0;
      while (i < text.length && text[i] === "{" && braces < 2) {
        let depth = 0;
        let closed = false;
        for (let j = i; j < text.length; j++) {
          if (text[j] === "{") depth++;
          else if (text[j] === "}") { depth--; if (depth === 0) { i = j + 1; braces++; closed = true; break; } }
        }
        if (!closed) { i = text.length; break; } // unclosed — include to end (typing in progress)
      }
      return i - start;
    }

    /** Paint `.latex-cmd` inline decos over the bare-text commands in one
     *  text node (skips text already carrying the latexCommand mark, which
     *  renders its own `.latex-cmd` span). Returns how many decos it added. */
    function decorateTextNode(
      decos: Decoration[],
      node: any,
      pos: number,
    ): number {
      if (!node.isText || !node.text) return 0;
      if (node.marks.some((m: any) => m.type === markType)) return 0;
      const text = node.text as string;
      let added = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== "\\") continue;
        // Skip \\ (double backslash)
        if (i > 0 && text[i - 1] === "\\") { i++; continue; }
        const len = matchCommandLength(text, i);
        if (len > 0) {
          decos.push(Decoration.inline(pos + i, pos + i + len, { class: "latex-cmd" }));
          added++;
          i += len - 1; // advance past the match
        }
      }
      return added;
    }

    function buildDecorations(doc: any): DecorationSet {
      const decos: Decoration[] = [];
      doc.descendants((node: any, pos: number) => {
        if (node.type?.name === "paragraph") {
          // Per-paragraph pass: paint the inline decos AND decide whether the
          // paragraph is "command-only" — the DOM-semantics twin of the old
          // `p:has(> .latex-cmd:first-child:last-child)` rhythm selector
          // (perf Wave 0, plan P5.1): exactly ONE element child, and it is a
          // `.latex-cmd` span. Bare unmarked text renders as text nodes (not
          // elements); each inline deco, each latexCommand-marked text run,
          // each other-marked run, and each inline atom renders one element.
          let cmdElements = 0;
          let otherElements = 0;
          node.forEach((child: any, offset: number) => {
            if (child.isText) {
              if (child.marks.some((m: any) => m.type === markType)) {
                cmdElements++;
              } else if (child.marks.length > 0) {
                otherElements++;
              } else {
                cmdElements += decorateTextNode(decos, child, pos + 1 + offset);
              }
            } else {
              otherElements++;
            }
          });
          if (cmdElements === 1 && otherElements === 0) {
            decos.push(
              Decoration.node(pos, pos + node.nodeSize, { class: "p-cmd-only" }),
            );
          }
          return false; // children handled above
        }
        decorateTextNode(decos, node, pos);
        return undefined;
      });
      return DecorationSet.create(doc, decos);
    }

    return [
      // Live decoration for \commands while typing.
      // Canonical mapping pattern: forward-map existing decorations,
      // then rebuild only when a changed region might contain `\`.
      new Plugin({
        key: new PluginKey("latexCmdDecorations"),
        state: {
          init(_config, state) {
            return buildDecorations(state.doc);
          },
          apply(tr, oldSet) {
            const mapped = oldSet.map(tr.mapping, tr.doc);
            if (!tr.docChanged) return mapped;
            // Cheap text scan of the changed regions for a backslash —
            // the only character that could create or break a command.
            // If absent, the mapped set is correct.
            let touched = false;
            tr.mapping.maps.forEach((stepMap) => {
              if (touched) return;
              stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
                if (touched) return;
                const expandedFrom = Math.max(0, newFrom - 1);
                const expandedTo = Math.min(tr.doc.content.size, newTo + 1);
                if (expandedTo <= expandedFrom) return;
                const text = tr.doc.textBetween(expandedFrom, expandedTo, "\n", "\n");
                if (text.includes("\\")) touched = true;
              });
            });
            // Also rebuild if any existing decoration overlaps a
            // changed region (the typed text might land mid-command and
            // change its length without inserting a `\`).
            //
            // KEYSTROKE SANCTITY (task 337): this loop used to be gated on
            // `oldSet.find().length > 0` — an ARGLESS find, which is the one
            // DecorationSet call that is O(all decorations in the document):
            // `findInner` with the default `0 … 1e9` range enters EVERY child
            // subtree and allocates a copied `Decoration` per hit. It ran on
            // exactly the path that exists to be cheap — a plain keystroke
            // whose changed region holds no backslash — so a paper with
            // hundreds of `\commands` paid a full-set walk per character.
            // The gate bought nothing: `find(from, to)` descends only into
            // children whose span overlaps the query, so on an empty set the
            // loop below is already O(steps), and mapping can never ADD a
            // decoration — so the guard could never suppress a `touched` the
            // loop would have set. Bounded ranges only; never argless.
            if (!touched) {
              tr.mapping.maps.forEach((stepMap) => {
                if (touched) return;
                stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
                  if (touched) return;
                  if (mapped.find(newFrom, newTo).length > 0) touched = true;
                });
              });
            }
            // A MARK step carries an EMPTY step map (`AddMarkStep` moves
            // nothing), so neither probe above can see the type-time carrier
            // promoting a bare span to the mark — and a decoration left
            // standing over a now-MARKED run paints a second `.latex-cmd`
            // over the one the mark renders itself. The two carriers of the
            // same grey are the same state since task 360, so the set is
            // rebuilt whenever this mark's presence changes. The DETECTION is
            // O(steps); the REBUILD it gates is O(document) — the pre-existing
            // cost of the promote arm's own AddMarkStep, which a demotion
            // reaches too since task 390. Bounded by being one-shot per
            // construct: once the mark is off, the block carries no marked run
            // and no further step is produced.
            if (!touched) {
              touched = tr.steps.some(
                (step) =>
                  (step instanceof AddMarkStep ||
                    step instanceof RemoveMarkStep) &&
                  step.mark.type === markType,
              );
            }
            return touched ? buildDecorations(tr.doc) : mapped;
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

          const ranges = changedRanges(trs);
          if (ranges.length === 0) return null;

          // The touched TEXTBLOCKS, deduped by position — a construct can start
          // well before the edit (`\definecolor{a}{b}{c}` typed into its last
          // argument), so the block is the smallest honest scan window.
          const blocks = new Map<number, PMNode>();
          for (const r of ranges) {
            newState.doc.nodesBetween(r.from, r.to, (node, pos) => {
              if (!node.isTextblock) return true;
              blocks.set(pos, node);
              return false;
            });
          }

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
            // decline anyway.
            if (!block.type.allowsMarkType(markType)) continue;
            const start = pos + 1;
            const { text, marked } = readBlock(block, markType);

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
            // A BRACE IS NOT A CONSTRUCT ON ITS OWN (task 390b). The pair
            // comes off together or not at all — see `markedBracePairs` for
            // what a one-sided demotion emits. ONE pass suffices and that is a
            // property, not a shortcut: an offset is either a `{` or a `}`, so
            // it belongs to at most one balanced pair, and a refusal therefore
            // cannot cascade into another.
            const scheduled = new Set<number>();
            for (const { run, parts } of pending) {
              if (!reaches(run)) continue;
              for (const part of parts) {
                for (let o = part.from; o < part.to; o++) scheduled.add(o);
              }
            }
            if (scheduled.size > 0) {
              for (const { open, close } of markedBracePairs(text, marked)) {
                const a = scheduled.has(open);
                if (a === scheduled.has(close)) continue;
                scheduled.delete(a ? open : close);
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
      // Virgil command execution on Enter
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

            const cmd = COMMAND_MAP.get(cmdMatch[1]);
            if (!cmd) return false;

            // Delete the typed \command text
            const cmdLen = cmdMatch[0].length;
            const deleteFrom = from - cmdLen;
            const tr = state.tr.delete(deleteFrom, from);
            view.dispatch(tr);

            // Run the command action
            cmd.action(view, cmdMatch[0]);
            return true;
          },
        },
      }),
    ];
  },
});
