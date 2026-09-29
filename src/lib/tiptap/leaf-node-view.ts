/**
 * # A leaf NodeView reads the node it IS, not the node it was MOUNTED with
 *
 * The inline atoms (math, `\ref`, footnote marker, citation) and the
 * display-math block are the same view: a non-editable span/div painted from
 * the node's attrs, a click that preventDefaults and fires a window
 * CustomEvent, and an `update()` that accepts an attr change and keeps the
 * view. Because `update()` returns `true`, ProseMirror KEEPS the view across
 * the change — so a click handler that closed over the `node` passed at mount
 * keeps reading the OLD attrs forever (task 840: a renamed `\ref` sent its old
 * label, a re-minted footnote id opened the wrong card).
 *
 * The one "fix" that existed made it worse: math's `update()` did
 * `Object.assign(node, updated)`, MUTATING an immutable ProseMirror node. The
 * history's inverted step holds that very object, so undo of a math edit
 * restored the EDITED formula — the user's previous math was unrecoverable.
 *
 * This factory states the answer once: the view holds `let current`, and
 * `update()` REPLACES it (never mutates). The click reads `current`; `paint`
 * receives `(next, prev)` so a costly render (KaTeX, citation children) runs
 * only when its inputs changed — `prev` is `null` at mount. A node is never
 * written to; the NodeView census bans `Object.assign(node…)` / `node.attrs… =`.
 *
 * `paint` runs from `update()` on every transaction that touches the node, so
 * its DOM writes go through `idempotent-dom.ts` (the task-551 census reads
 * `paint` bodies alongside `update` bodies).
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";

export interface LeafClickContext {
  /** The LIVE node — whatever the last `update()` delivered. */
  node: PMNode;
  dom: HTMLElement;
  /** The node's current position in its OWN editor, or `undefined`. */
  pos(): number | undefined;
}

export interface LeafNodeViewSpec {
  node: PMNode;
  getPos: unknown;
  tag?: "span" | "div";
  className: string;
  dataType: string;
  /** Paint `next` onto `dom`. `prev` is `null` at mount, else the node the
   *  view showed before this update — compare against it to skip work. */
  paint(dom: HTMLElement, next: PMNode, prev: PMNode | null): void;
  onClick?(ctx: LeafClickContext): void;
  selectNode?(dom: HTMLElement): void;
  deselectNode?(dom: HTMLElement): void;
}

export function createLeafNodeView(spec: LeafNodeViewSpec): NodeView {
  let current = spec.node;
  const dom = document.createElement(spec.tag ?? "span");
  dom.className = spec.className;
  dom.setAttribute("data-type", spec.dataType);
  dom.contentEditable = "false";
  // contenteditable=false islands are natively draggable inside a
  // contenteditable root; disable it so the InlineAtomGrab mousedown gesture
  // keeps its mousemove/mouseup stream (a native drag would hijack it, and the
  // Editor.tsx dragstart guard fires too late).
  dom.draggable = false;
  spec.paint(dom, current, null);

  const getPos = spec.getPos;
  const pos = (): number | undefined => {
    if (typeof getPos !== "function") return undefined;
    const p = getPos();
    return typeof p === "number" ? p : undefined;
  };

  const onClick = spec.onClick;
  if (onClick) {
    dom.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick({ node: current, dom, pos });
    });
  }

  const view: NodeView = {
    dom,
    update(next) {
      if (next.type !== current.type) return false;
      const prev = current;
      current = next;
      spec.paint(dom, next, prev);
      return true;
    },
  };
  const { selectNode, deselectNode } = spec;
  if (selectNode) view.selectNode = () => selectNode(dom);
  if (deselectNode) view.deselectNode = () => deselectNode(dom);
  return view;
}
