import { Mark, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { COMMAND_MAP } from "./commands";

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
            if (!touched && oldSet.find().length > 0) {
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
