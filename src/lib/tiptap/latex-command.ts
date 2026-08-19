import { Mark, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep } from "@tiptap/pm/transform";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { COMMAND_MAP } from "./commands";
import {
  LATEX_COMMENT_TAIL_MARK,
  LATEX_VERBATIM_MARK,
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
//  - **ADDITIVE only.** The plugin never removes a mark. The parse rung carries
//    things this scanner deliberately declines (the braces of a bare `{a, b}`
//    group, task 349 M6), so a re-derivation that also removed would strip them
//    on the next keystroke in that paragraph.
//
// Cost: O(edit) to collect the ranges, then one scan of each TOUCHED TEXTBLOCK
// — never a doc walk, and nothing at all when the block holds no `\` or `{`.

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
            // rebuilt whenever this mark's presence changes. O(steps).
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
      // The TYPE-TIME CARRIER (task 360) — see the note above the mark for the
      // four rules. Registered on the mark itself, so both surfaces that mount
      // `LatexCommandMark` get it: the main editor and every card body
      // (`buildCardBodySchema`), whose serializer runs the same escape rung.
      new Plugin({
        key: latexCarrierPluginKey,
        appendTransaction(trs, _oldState, newState) {
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

          let tr: Transaction | null = null;
          for (const [pos, block] of blocks) {
            // `codeBlock` / `latexComment` declare `marks: ""` — the markless
            // pair the serializer emits byte-raw. Nothing to promote, and
            // `addMark` would silently decline anyway.
            if (!block.type.allowsMarkType(markType)) continue;
            const start = pos + 1;
            let text = "";
            block.forEach((child) => {
              text +=
                child.isText && !isOpaqueRun(child)
                  ? (child.text as string)
                  : OPAQUE.repeat(child.nodeSize);
            });
            if (!text.includes("\\") && !text.includes("{")) continue;

            for (const span of scanRawLatexSpans(text)) {
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
