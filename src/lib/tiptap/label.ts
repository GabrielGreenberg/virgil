import { Node, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { readDocStructure, readPendingDiff, touchedBlockPositions } from "./doc-structure";

/** \ref{label} — inline cross-reference rendered as a clickable pod. */
export const LabelRef = Node.create({
  name: "labelRef",
  group: "inline",
  inline: true,
  atom: true,
  // See ATOM_REGISTRY (ref.selectable): opt out of the PM-default NodeSelection
  // to kill the ~100px scrollIntoView jump on modifier-click / read-only click,
  // exactly as footnote/citation do. \ref owns no NodeSelection chrome, so it
  // was selectable only because the flag was unset. Pinned by
  // atom-selectable-parity.test.ts.
  selectable: false,

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

const LABEL_ONLY_PARAGRAPH = /^\\label\{([^}]*)\}$/;

/**
 * Absorbs \label{...} paragraphs that immediately follow a heading into
 * the heading's label attribute, and removes the paragraph.
 *
 * Keystroke-sanctity (AGENTS.md): this never walks the whole doc. It consumes
 * the structural diff and inspects only the blocks the transaction touched
 * (via `touchedBlockPositions`). An absorption is a heading+following-paragraph
 * pair, so either end can trigger it — the pair is discovered from whichever
 * side the diff names:
 *   - a touched HEADING (a `\label`-bearing follower may now match it), or
 *   - a touched PARAGRAPH that just became `^\label{…}$` (typed) or was added
 *     (pasted), whose preceding sibling is a heading.
 * Cost is O(edit-size), never O(#blocks): a plain in-paragraph keystroke
 * inspects exactly the one typed block.
 */
export const LabelHandler = Extension.create({
  name: "labelHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("labelHandler"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const pending = readPendingDiff(newState);
          if (!pending) return null;
          // Gate: this plugin's job is to absorb `\label{...}` paragraphs
          // that follow headings. It only matters when a paragraph's text
          // was touched (typing), blocks were added (paste), or a heading
          // changed. Selection-only transactions skip.
          if (
            pending.addedBlocks.length === 0 &&
            pending.contentChangedUuids.size === 0 &&
            pending.changedHeadings.length === 0
          ) {
            return null;
          }

          const { doc, schema } = newState;
          const headingType = schema.nodes.heading;
          const paragraphType = schema.nodes.paragraph;
          const structure = readDocStructure(newState);

          // Deduped by the label paragraph's position — a heading/paragraph
          // pair can surface from BOTH ends when both are in the touched set.
          const changes = new Map<
            number,
            {
              headingPos: number;
              headingAttrs: Record<string, unknown>;
              label: string;
              paraPos: number;
              paraSize: number;
            }
          >();

          // Record an absorption for the heading at `headingNode`/`headingPos`
          // and the following label paragraph at `paraPos`, if the label differs.
          const consider = (
            headingNode: ReturnType<typeof doc.nodeAt>,
            headingPos: number,
            paraNode: ReturnType<typeof doc.nodeAt>,
            paraPos: number,
          ) => {
            if (!headingNode || headingNode.type !== headingType) return;
            if (!paraNode || paraNode.type !== paragraphType) return;
            const match = paraNode.textContent.match(LABEL_ONLY_PARAGRAPH);
            if (!match) return;
            const label = match[1];
            if (headingNode.attrs.label === label) return;
            changes.set(paraPos, {
              headingPos,
              headingAttrs: headingNode.attrs,
              label,
              paraPos,
              paraSize: paraNode.nodeSize,
            });
          };

          for (const pos of touchedBlockPositions(pending, structure, doc)) {
            const node = doc.nodeAt(pos);
            if (!node) continue;
            if (node.type === headingType) {
              // Heading touched → its immediate following paragraph may be a
              // label to absorb.
              const nextPos = pos + node.nodeSize;
              if (nextPos < doc.content.size) {
                consider(node, pos, doc.nodeAt(nextPos), nextPos);
              }
            } else if (node.type === paragraphType) {
              // Paragraph touched → if it's a label paragraph, its preceding
              // sibling may be the heading that should absorb it.
              const prev = doc.resolve(pos).nodeBefore;
              if (prev) consider(prev, pos - prev.nodeSize, node, pos);
            }
          }

          if (changes.size === 0) return null;

          // Process in reverse position order so deletions don't shift earlier
          // positions.
          const ordered = [...changes.values()].sort((a, b) => b.headingPos - a.headingPos);
          const tr = newState.tr;
          for (const c of ordered) {
            tr.setNodeMarkup(c.headingPos, undefined, { ...c.headingAttrs, label: c.label });
            tr.delete(c.paraPos, c.paraPos + c.paraSize);
          }
          return tr;
        },
      }),
    ];
  },
});
