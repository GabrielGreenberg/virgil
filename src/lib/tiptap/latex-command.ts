import { Mark, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { COMMAND_MAP } from "./commands";
import { LATEX_VERBATIM_MARK } from "@/lib/latex-lexer";

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

/** Grey-monospace styling for unhandled LaTeX commands, plus Enter-to-execute. */
export const LatexCommandMark = Mark.create({
  name: "latexCommand",

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
            return touched ? buildDecorations(tr.doc) : mapped;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
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
