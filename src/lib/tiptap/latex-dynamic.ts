import { Node, mergeAttributes } from "@tiptap/react";
import { ATOM_REGISTRY } from "./atom-registry";
import { createLeafNodeView } from "./leaf-node-view";
import { withClipboardCodec } from "@/lib/tiptap/attr-clipboard-codec";
import { setDataIfChanged, setTextIfChanged, setTitleIfChanged } from "./idempotent-dom";
import {
  LATEX_DYNAMIC_NODE,
  renderDynamicCommand,
} from "@/lib/latex-dynamic-commands";

const DYNAMIC_ATOM = ATOM_REGISTRY.dynamic;

/**
 * `\today` (and any future {@link DYNAMIC_COMMANDS} member) — an inline atom
 * that holds the command NAME and paints its computed value (task 1335).
 *
 * The document never holds the rendered date: the chip is a view, the `.tex`
 * keeps `\today`, and pdfTeX expands it at compile time (the PDF shows the
 * compile date — LaTeX's own semantics). `term` remembers how the source ended
 * the control word (`""` / `"{}"`) so the round trip is byte-identical; see
 * `emitDynamicCommand`.
 */
export const LatexDynamic = Node.create({
  name: LATEX_DYNAMIC_NODE,
  group: "inline",
  inline: true,
  atom: true,
  // Same reason as `\ref` (ATOM_REGISTRY.dynamic.selectable): a resting
  // NodeSelection on the leaf scrolls; the chip owns no selection chrome.
  selectable: false,

  addAttributes() {
    // Round-trips the HTML clipboard through the ONE codec (task 1068), like
    // every inline atom's attrs (attr-codec census).
    return withClipboardCodec({
      command: { default: "today" },
      // A fresh chip (slash insert) takes the `{}` break — the spelling that
      // is safe before anything.
      term: { default: "{}" },
    });
  },

  parseHTML() {
    return [{ tag: `span[data-type="${DYNAMIC_ATOM.domType}"]` }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": DYNAMIC_ATOM.domType,
        class: DYNAMIC_ATOM.domClass,
      }),
      renderDynamicCommand(node.attrs.command as string),
    ];
  },

  renderText({ node }) {
    return renderDynamicCommand(node.attrs.command as string);
  },

  addNodeView() {
    return ({ node, getPos }) =>
      createLeafNodeView({
        node,
        getPos,
        className: DYNAMIC_ATOM.domClass,
        dataType: DYNAMIC_ATOM.domType,
        paint(dom, next) {
          const command = (next.attrs.command as string) || "today";
          setDataIfChanged(dom, "command", command);
          setTextIfChanged(dom, renderDynamicCommand(command));
          setTitleIfChanged(dom, `\\${command}`);
        },
      });
  },
});
