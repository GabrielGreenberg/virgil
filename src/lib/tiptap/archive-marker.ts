import { Node, mergeAttributes } from "@tiptap/react";

/** Inline atom that marks the spot where archived text used to live. */
export const ArchiveMarker = Node.create({
  name: "archiveMarker",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      archiveId: { default: "" },
      preview: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="archive-marker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "archive-marker",
        class: "archive-marker",
      }),
      "A",
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "archive-marker";
      dom.dataset.type = "archive-marker";
      dom.dataset.archiveId = node.attrs.archiveId || "";
      dom.contentEditable = "false";
      dom.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:-2px"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="#7191b0" stroke-width="1.5" fill="#f0f5fa"/><text x="8" y="11.8" text-anchor="middle" font-size="9.5" font-weight="600" fill="#7191b0" font-family="var(--font-sans), sans-serif">A</text></svg>`;
      dom.title = node.attrs.preview
        ? `Archived: ${node.attrs.preview}...`
        : "Archived text";

      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("virgil-archive-click", {
            detail: { archiveId: node.attrs.archiveId },
          })
        );
      });

      return { dom };
    };
  },
});
