import { Node, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { readPendingDiff } from "./doc-structure";

/** \ref{label} — inline cross-reference rendered as a clickable pod. */
export const LabelRef = Node.create({
  name: "labelRef",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: { default: "" },
      displayText: { default: "" },
      // "ref" → \ref{…} (bare number, e.g. "3" / "2.1")
      // "getref" → \getref{…} (parenthesized, e.g. "(3)")
      // "getfullref" → \getfullref{…} (dotted; rendered as "(3b)")
      refCommand: { default: "ref" },
      // Advisory tag used by the label popover to group candidates.
      // "heading" | "example" | null.
      targetKind: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="label-ref"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "label-ref",
        class: "label-ref-node",
      }),
      HTMLAttributes.displayText || "??",
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "label-ref-node";
      dom.dataset.type = "label-ref";
      dom.dataset.label = node.attrs.label || "";
      dom.dataset.refCommand = node.attrs.refCommand || "ref";
      if (node.attrs.targetKind) dom.dataset.targetKind = node.attrs.targetKind;
      dom.contentEditable = "false";
      dom.draggable = false; // see footnote.ts: keep the grab gesture's mousemove stream
      dom.textContent = node.attrs.displayText || "??";

      dom.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("virgil-label-ref-click", {
            detail: {
              label: node.attrs.label,
              refCommand: node.attrs.refCommand || "ref",
              targetKind: node.attrs.targetKind || null,
            },
          })
        );
      });

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "labelRef") return false;
          dom.dataset.label = updatedNode.attrs.label || "";
          dom.dataset.refCommand = updatedNode.attrs.refCommand || "ref";
          if (updatedNode.attrs.targetKind)
            dom.dataset.targetKind = updatedNode.attrs.targetKind;
          else delete dom.dataset.targetKind;
          dom.textContent = updatedNode.attrs.displayText || "??";
          return true;
        },
      };
    };
  },
});

/**
 * Absorbs \label{...} paragraphs that immediately follow a heading into
 * the heading's label attribute, and removes the paragraph.
 */
export const LabelHandler = Extension.create({
  name: "labelHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("labelHandler"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          // Gate: this plugin's job is to absorb `\label{...}` paragraphs
          // that follow headings. It only matters when a paragraph's
          // text content was touched (typing) or when blocks were added
          // (paste). Pure-text edits in non-paragraph blocks, or
          // selection-only transactions, skip.
          const pending = readPendingDiff(newState);
          if (pending) {
            const couldMatter =
              pending.addedBlocks.length > 0 ||
              pending.contentChangedUuids.size > 0 ||
              pending.changedHeadings.length > 0;
            if (!couldMatter) return null;
          }

          const { doc, schema } = newState;
          const headingType = schema.nodes.heading;
          const paragraphType = schema.nodes.paragraph;

          const changes: Array<{
            headingPos: number;
            headingAttrs: Record<string, unknown>;
            label: string;
            paraPos: number;
            paraSize: number;
          }> = [];

          doc.forEach((node, pos) => {
            if (node.type !== headingType) return;
            const nextPos = pos + node.nodeSize;
            if (nextPos >= doc.content.size) return;
            const nextNode = doc.nodeAt(nextPos);
            if (!nextNode || nextNode.type !== paragraphType) return;
            const text = nextNode.textContent;
            const match = text.match(/^\\label\{([^}]*)\}$/);
            if (!match) return;
            const label = match[1];
            if (node.attrs.label === label) return;
            changes.push({
              headingPos: pos,
              headingAttrs: node.attrs,
              label,
              paraPos: nextPos,
              paraSize: nextNode.nodeSize,
            });
          });

          if (changes.length === 0) return null;

          // Process in reverse order so deletions don't shift earlier positions
          const tr = newState.tr;
          for (const c of [...changes].reverse()) {
            tr.setNodeMarkup(c.headingPos, undefined, { ...c.headingAttrs, label: c.label });
            tr.delete(c.paraPos, c.paraPos + c.paraSize);
          }
          return tr;
        },
      }),
    ];
  },
});
