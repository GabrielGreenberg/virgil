import { Node, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { UUID_ATTR_SPEC } from "./uuid-attr";
import { readDocStructure, readPendingDiff, touchedBlockPositions } from "./doc-structure";

/**
 * Clears parTitle (and uuid) from empty paragraphs.
 * This prevents stranded titles when a paragraph is split (e.g. Enter at start).
 *
 * Keystroke-sanctity (AGENTS.md): this never walks the whole doc. It consumes
 * the structural diff and inspects only the blocks the transaction touched
 * (via `touchedBlockPositions`), plus their immediate siblings so the
 * Enter-at-start split case still fires in either direction. A split copies
 * `parTitle` onto the new paragraph, then the block-uuid backfill runs as a
 * trailing transaction and re-uuids the duplicate — so `pendingDiff` describes
 * the re-uuid, not the split. If the stranded empty paragraph is the re-uuid'd
 * one it is a direct `addedBlocks` entry; if it kept its uuid it is the sibling
 * of the re-uuid'd content block. Scanning siblings covers both. Cost is
 * O(edit-size), never O(#blocks): a plain in-paragraph keystroke inspects
 * exactly the one typed block plus its two neighbours. The invariant "no empty
 * titled paragraph survives an edit" is held incrementally, so restricting to
 * the edit site is behaviour-preserving — a lingering empty-titled paragraph
 * can only ever appear where the edit happened.
 */
export const EmptyParagraphTitleCleaner = Extension.create({
  name: "emptyParagraphTitleCleaner",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("emptyParagraphTitleCleaner"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const pending = readPendingDiff(newState);
          if (!pending) return null;
          // Gate: parTitle-cleanup only matters when a paragraph's content
          // changed (typing/deleting) or a block was added (split/paste).
          // Pure selection moves and non-paragraph edits skip.
          if (
            pending.addedBlocks.length === 0 &&
            pending.contentChangedUuids.size === 0
          ) {
            return null;
          }

          const { doc, schema } = newState;
          const paragraphType = schema.nodes.paragraph;
          const structure = readDocStructure(newState);
          let tr: typeof newState.tr | null = null;

          // Only the touched blocks (and their neighbours) can have just
          // become an empty titled paragraph — never the whole doc.
          for (const pos of touchedBlockPositions(pending, structure, doc, true)) {
            const node = doc.nodeAt(pos);
            if (!node || node.type !== paragraphType) continue;
            if (!node.attrs.parTitle) continue;
            // If paragraph has no text content, clear its title and uuid.
            if (node.textContent.trim() === "") {
              if (!tr) tr = newState.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, parTitle: null, uuid: null });
            }
          }

          return tr;
        },
      }),
    ];
  },
});

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  author: "Author",
  date: "Date",
};

/** Block node with editable content, annotated "Title" / "Author" / "Date". */
export const TitleField = Node.create({
  name: "titleField",
  group: "block textObject",
  content: "inline*",

  addAttributes() {
    return {
      field: { default: "title" },
      rawPrefix: { default: null },
      isToday: { default: false },
      uuid: UUID_ATTR_SPEC.uuid,
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="title-field"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "title-field",
        "data-field": HTMLAttributes.field,
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "title-field-wrapper";

      const content = document.createElement("div");
      content.className = `title-field-content${node.attrs.field === "title" ? " title-field-title" : ""}`;
      wrapper.appendChild(content);

      const annot = document.createElement("div");
      annot.className = "title-field-annotation";
      annot.contentEditable = "false";
      annot.textContent = FIELD_LABELS[node.attrs.field as string] || node.attrs.field;
      wrapper.appendChild(annot);

      return {
        dom: wrapper,
        contentDOM: content,
        update(updatedNode) {
          if (updatedNode.type.name !== "titleField") return false;
          annot.textContent = FIELD_LABELS[updatedNode.attrs.field as string] || updatedNode.attrs.field;
          return true;
        },
      };
    };
  },
});

/**
 * Hidden atom block that stands in for `\maketitle`. The title block
 * is already visible in the editor as `titleField` nodes, so we don't
 * need to render the `\maketitle` command itself — but we do need a
 * node to round-trip through the LaTeX source.
 */
export const MaketitleMarker = Node.create({
  name: "maketitleMarker",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      uuid: UUID_ATTR_SPEC.uuid,
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="maketitle-marker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "maketitle-marker",
        class: "maketitle-marker",
      }),
    ];
  },

  addNodeView() {
    return () => {
      const wrapper = document.createElement("div");
      wrapper.className = "maketitle-marker";
      wrapper.setAttribute("data-type", "maketitle-marker");
      return { dom: wrapper };
    };
  },
});
