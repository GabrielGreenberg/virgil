import { Node, Extension, mergeAttributes, type Editor } from "@tiptap/react";
import type { RefCommand } from "@/lib/ref-display";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { readPendingDiff, touchedBlockPositions } from "./doc-structure";
// Task 232: structural DOM facets (`data-type` / `class`) come from the atom
// SSOT rather than hardcoded literals, so a NodeView rename can't drift from
// ATOM_REGISTRY. Pinned by atom-selectable-parity.test.ts.
import { ATOM_REGISTRY } from "./atom-registry";

const REF_ATOM = ATOM_REGISTRY.ref;

/** The event a clicked `\ref` chip dispatches on `window`. */
export const REF_CLICK_EVENT = "virgil-label-ref-click";

/**
 * A `labelRef` atom's IDENTITY across the gap between the click and the
 * popover's commit: the editor that owns it and its position there. The
 * handlers that re-point it resolve `editor.state.doc.nodeAt(pos)` at commit
 * time and REFUSE when it is no longer a `labelRef` naming `label` (the doc
 * may have moved) — never falling back to "the first chip with that label",
 * which is the mis-address this identity exists to prevent (task 550; the
 * task-285 rule for addressing a node across an async gap).
 */
export interface RefNodeIdentity {
  editor: Editor;
  pos: number;
  label: string;
}

/** What `REF_CLICK_EVENT` carries. */
export interface RefClickDetail extends RefNodeIdentity {
  refCommand: string;
  targetKind: string | null;
  /** The clicked chip's own screen rect — the popover anchors at THIS chip. */
  rect: DOMRect;
}

/** The open popover's subject: the clicked chip plus what it currently shows. */
export interface ActiveRef extends RefNodeIdentity {
  refCommand: RefCommand;
  rect: DOMRect;
}

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
      // Advisory tag written beside `displayText` by the ref-display
      // resolver: "heading" | "example" | "figure" | null.
      targetKind: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${REF_ATOM.domType}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": REF_ATOM.domType,
        class: REF_ATOM.domClass,
      }),
      HTMLAttributes.displayText || "??",
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = REF_ATOM.domClass;
      dom.dataset.type = REF_ATOM.domType;
      dom.dataset.label = node.attrs.label || "";
      dom.dataset.refCommand = node.attrs.refCommand || "ref";
      if (node.attrs.targetKind) dom.dataset.targetKind = node.attrs.targetKind;
      dom.contentEditable = "false";
      dom.draggable = false; // see footnote.ts: keep the grab gesture's mousemove stream
      dom.textContent = node.attrs.displayText || "??";

      dom.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        // The click carries the chip's IDENTITY — its position in the editor
        // that OWNS it — exactly as its siblings do (`virgil-math-click`,
        // `virgil-citation-click`'s `clickedPos`, the shared
        // `AtomCreateRequest`). A `\ref` label is NOT unique: a paper cites
        // the same section several times, and a bridge that re-found the chip
        // by its label string opened the popover beside the FIRST match and
        // re-pointed the FIRST match (task 550). `pos` names the clicked one;
        // `editor` is the pos-space it was minted in (main OR a card body).
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos == null) return;
        // Re-minted as a `DOMRect` so the detail always carries the ONE shape
        // the bridge validates (`instanceof DOMRect`, as its math/figure
        // siblings do) — a headless DOM's `getBoundingClientRect` answers a
        // plain object, which would otherwise drop the click at the bridge.
        const r = dom.getBoundingClientRect();
        const detail: RefClickDetail = {
          label: node.attrs.label,
          refCommand: node.attrs.refCommand || "ref",
          targetKind: node.attrs.targetKind || null,
          pos,
          editor,
          rect: new DOMRect(r.x, r.y, r.width, r.height),
        };
        window.dispatchEvent(new CustomEvent(REF_CLICK_EVENT, { detail }));
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

          for (const pos of touchedBlockPositions(pending, newState, doc)) {
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
            // label-write-exempt: ABSORBS a `\label` paragraph into the heading
            // it follows — a declaration the paper ALREADY held, moving from a
            // text node to an attr. No key changes, so there is no ref to carry
            // and nothing for the rename door to ask (task 553 census).
            tr.setNodeMarkup(c.headingPos, undefined, { ...c.headingAttrs, label: c.label });
            tr.delete(c.paraPos, c.paraPos + c.paraSize);
          }
          return tr;
        },
      }),
    ];
  },
});
