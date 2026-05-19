import { Node, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { richJsonToPlainText, normalizeRichContent } from "@/lib/footnote-content";
import { generateShortId } from "@/lib/uuid";

// Options accepted by the Footnote extension. `idGenerator` lets a host
// (e.g. the Library Reader) substitute a different ID strategy for newly
// created footnotes. Defaults to the 4-char hex generator with collision
// avoidance against the existing footnote IDs in the document.
export interface FootnoteOptions {
  idGenerator: (existing: Set<string>) => string;
}

export const Footnote = Node.create<FootnoteOptions>({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  // PM otherwise creates a NodeSelection on mousedown for inline atoms,
  // and that selection transaction defaults to `scrollIntoView: true` —
  // which scrolls the row by ~100px before our click handler can route
  // to alignOmniCardWithClick. `atom: true` still keeps Backspace
  // deletion working (single-unit deletion), and `draggable: true` is
  // officially compatible with `selectable: false` as long as the node
  // is an atom (PM docs). Matches archive-marker.ts.
  selectable: false,
  draggable: true,

  addOptions() {
    return {
      idGenerator: (existing: Set<string>) => generateShortId(existing),
    };
  },

  addAttributes() {
    return {
      // Tiptap JSONContent doc — see normalizeRichContent for accepted shapes.
      // Default null so every footnote node owns its own object (avoids the
      // single-shared-default-mutation footgun).
      content: { default: null },
      number: { default: 1 },
      title: { default: "" },
      // footnoteId stays in JSON (persistence) but doesn't render to HTML —
      // data-link-id carries the same value and is the canonical address.
      footnoteId: { default: "", renderHTML: () => ({}) },
      // Unified link attrs — rendered as data-link-* via explicit renderHTML
      // below; suppress auto-render here to avoid camelCase HTML attrs.
      linkId: { default: "", renderHTML: () => ({}) },
      linkKind: { default: "footnote", renderHTML: () => ({}) },
      linkCard: { default: "", renderHTML: () => ({}) },
      // True when this footnote originated from a `\thanks{...}` (typically
      // inside `\author{...}`) rather than a `\footnote{...}`. Drives the
      // serializer to round-trip back to `\thanks{...}` and the panel/omni
      // card to overline as ACKNOWLEDGEMENT instead of FOOTNOTE.
      thanks: { default: false, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="footnote"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const footnoteId =
      (node.attrs.linkId as string) ||
      (node.attrs.footnoteId as string) ||
      "";
    const linkCard =
      (node.attrs.linkCard as string) ||
      (footnoteId ? `footnote:${footnoteId}` : "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote",
        class: "footnote-marker",
        "data-link-id": footnoteId,
        "data-link-kind": "footnote",
        "data-link-card": linkCard,
        ...(node.attrs.thanks ? { "data-thanks": "true" } : {}),
      }),
      node.attrs.thanks ? "A" : String(node.attrs.number || "1"),
    ];
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;
    const idGenerator = this.options.idGenerator;
    return [
      new Plugin({
        key: new PluginKey("footnoteInput"),
        props: {
          handleTextInput(view, from, _to, text) {
            if (text !== "}") return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 200),
              $from.parentOffset,
              undefined,
              "\ufffc"
            ) + text;
            const match = textBefore.match(/\\footnote\{([^}]*)\}$/);
            if (!match) return false;
            const content = normalizeRichContent(match[1]);
            const existing = new Set<string>();
            state.doc.descendants((node) => {
              if (node.type.name === "footnote" && node.attrs.footnoteId) {
                existing.add(node.attrs.footnoteId as string);
              }
              return true;
            });
            const footnoteId = idGenerator(existing);
            const start = from + 1 - match[0].length;
            const tr = state.tr.replaceWith(
              start,
              from + 1,
              nodeType.create({ content, footnoteId, number: 0 })
            );
            // Insert the typed "}" into the document first so replaceWith range is valid
            // Actually we already accounted for it — replaceWith from start to from+1 covers the "}" we're inserting
            // But we need to handle this: from is pre-insert, so we replace start..from and consume the text
            const trFixed = state.tr.replaceWith(
              start,
              from,
              nodeType.create({ content, footnoteId, number: 0 })
            );
            let counter = 1;
            trFixed.doc.descendants((node, pos) => {
              if (node.type.name === "footnote") {
                if (node.attrs.thanks) {
                  // Acknowledgements don't consume the footnote counter.
                  if (node.attrs.number !== 0) {
                    trFixed.setNodeMarkup(pos, undefined, { ...node.attrs, number: 0 });
                  }
                } else {
                  trFixed.setNodeMarkup(pos, undefined, { ...node.attrs, number: counter++ });
                }
              }
              return true;
            });
            view.dispatch(trFixed);
            // Notify persistent state about the new footnote
            window.dispatchEvent(
              new CustomEvent("virgil-footnote-created", {
                detail: { footnoteId, content },
              })
            );
            return true;
          },
        },
      }),
      // Orphan detector + auto-renumber plugin
      new Plugin({
        key: new PluginKey("footnoteOrphanDetector"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const oldFootnotes = new Map<string, unknown>();
          oldState.doc.descendants((node) => {
            if (node.type.name === "footnote" && node.attrs.footnoteId) {
              oldFootnotes.set(node.attrs.footnoteId, node.attrs.content);
            }
            return true;
          });

          const newFootnotes = new Set<string>();
          newState.doc.descendants((node) => {
            if (node.type.name === "footnote" && node.attrs.footnoteId) {
              newFootnotes.add(node.attrs.footnoteId);
            }
            return true;
          });

          for (const [id, content] of oldFootnotes) {
            if (!newFootnotes.has(id) && richJsonToPlainText(content).trim()) {
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent("virgil-footnote-orphaned", {
                    detail: { footnoteId: id, content },
                  })
                );
              }, 0);
            }
          }

          let counter = 1;
          let needsRenumber = false;
          newState.doc.descendants((node) => {
            if (node.type.name === "footnote") {
              if (node.attrs.thanks) {
                // Acknowledgements don't consume the counter; they're
                // pinned to number 0 (rendered as "A" in the marker/badge).
                if (node.attrs.number !== 0) needsRenumber = true;
              } else {
                if (node.attrs.number !== counter) needsRenumber = true;
                counter++;
              }
            }
            return true;
          });

          if (!needsRenumber) return null;

          const tr = newState.tr;
          let num = 1;
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "footnote") {
              if (node.attrs.thanks) {
                if (node.attrs.number !== 0) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, number: 0 });
                }
              } else {
                if (node.attrs.number !== num) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, number: num });
                }
                num++;
              }
            }
            return true;
          });

          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "footnote-marker";
      dom.dataset.type = "footnote";
      dom.dataset.footnoteId = node.attrs.footnoteId || "";
      dom.contentEditable = "false";
      dom.draggable = true;
      dom.style.cursor = "grab";
      if (node.attrs.thanks) dom.dataset.thanks = "true";
      dom.textContent = node.attrs.thanks ? "A" : String(node.attrs.number || "1");
      dom.title = richJsonToPlainText(node.attrs.content);

      // Click on the marker just routes the user to the side panel — the
      // panel hosts the full Tiptap mini editor for footnote bodies now.
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.attrs.footnoteId) {
          const rect = dom.getBoundingClientRect();
          window.dispatchEvent(
            new CustomEvent("virgil-footnote-click", {
              detail: { footnoteId: node.attrs.footnoteId, clickY: rect.top },
            })
          );
        }
      });

      return {
        dom,
        draggable: true,
        update(updatedNode) {
          if (updatedNode.type.name !== "footnote") return false;
          dom.dataset.footnoteId = updatedNode.attrs.footnoteId || "";
          if (updatedNode.attrs.thanks) dom.dataset.thanks = "true";
          else delete dom.dataset.thanks;
          dom.textContent = updatedNode.attrs.thanks ? "A" : String(updatedNode.attrs.number || "1");
          dom.title = richJsonToPlainText(updatedNode.attrs.content);
          return true;
        },
      };
    };
  },
});
