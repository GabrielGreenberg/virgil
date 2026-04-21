import { Node, mergeAttributes } from "@tiptap/react";

/**
 * Inline atom that represents a draft AI request "pinned" into the document.
 * The full request text lives in the unified `useAiRequests` store; the
 * marker only carries the id (plus a text fallback for stale cases).
 *
 * Clicking the marker dispatches `virgil-ai-request-click` so the side
 * panels can scroll to the matching card.
 */
export const AiRequestMarker = Node.create({
  name: "aiRequestMarker",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      requestId: { default: "" },
      kind: { default: "footnote" },
      text: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="ai-request-marker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "ai-request-marker",
        class: "ai-request-marker",
      }),
      "\u2605",
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "ai-request-marker";
      dom.dataset.type = "ai-request-marker";
      dom.dataset.requestId = node.attrs.requestId || "";
      dom.dataset.kind = node.attrs.kind || "";
      dom.contentEditable = "false";
      dom.draggable = true;
      dom.style.cursor = "grab";

      const star = document.createElement("span");
      star.className = "ai-request-marker-star";
      star.textContent = "\u2605";
      dom.appendChild(star);

      const label = document.createElement("span");
      label.className = "ai-request-marker-label";
      const t = String(node.attrs.text || "").trim();
      label.textContent = t.length > 30 ? t.slice(0, 30) + "\u2026" : (t || "AI request");
      dom.appendChild(label);

      const fullText = String(node.attrs.text || "").trim();
      const kindLabel = String(node.attrs.kind || "");
      dom.title = fullText
        ? `AI ${kindLabel} request: ${fullText}`
        : `AI ${kindLabel} request`;

      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.attrs.requestId) {
          window.dispatchEvent(
            new CustomEvent("virgil-ai-request-click", {
              detail: { requestId: node.attrs.requestId, kind: node.attrs.kind },
            }),
          );
        }
      });

      return {
        dom,
        draggable: true,
        update(updatedNode) {
          if (updatedNode.type.name !== "aiRequestMarker") return false;
          dom.dataset.requestId = updatedNode.attrs.requestId || "";
          dom.dataset.kind = updatedNode.attrs.kind || "";
          const u = String(updatedNode.attrs.text || "").trim();
          label.textContent = u.length > 30 ? u.slice(0, 30) + "\u2026" : (u || "AI request");
          dom.title = u
            ? `AI ${updatedNode.attrs.kind} request: ${u}`
            : `AI ${updatedNode.attrs.kind} request`;
          return true;
        },
      };
    };
  },
});
