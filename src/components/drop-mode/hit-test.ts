/**
 * Hit-testing: given the cursor position (viewport coords) and the
 * active drop spec, decide whether there's a valid drop target there
 * and what kind of indicator to show.
 *
 * The pipeline:
 *   1. Find the editor under the cursor.
 *   2. Reject read-only / out-of-scope / self-drop targets.
 *   3. Use ProseMirror's `posAtCoords` to find the relevant position.
 *   4. Walk up to the nearest anchorable block; ensure it has a UUID.
 *   5. Classify the cursor as "inGap" (between blocks) or "inText"
 *      (inside a block's text rect).
 *   6. Walk the spec's `allowedPlacements` in priority order; return
 *      the first one whose geometry matches.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isAnchorableNode } from "@/lib/marginalia";
import { generateShortId } from "@/lib/uuid";
import { findEditorAtPoint } from "./target-registry";
import type { DropSpec, Placement, ViewportRect } from "./types";

/**
 * Resolve a cursor point to a `Placement` (or null if nothing valid is
 * under the cursor for the given spec).
 *
 * `sourceCardKey` is the cardKey of the popped-out item being dropped.
 * Used to reject self-drops (target editor belongs to the source card).
 */
export function hitTest(
  x: number,
  y: number,
  spec: DropSpec,
  sourceCardKey: string,
  mainEditor: Editor | null,
): Placement | null {
  const editor = findEditorAtPoint(x, y);
  if (!editor) return null;
  if (!editor.isEditable) return null;
  if (spec.targetScope === "main-only" && editor !== mainEditor) return null;
  if (isSelfDrop(editor, sourceCardKey)) return null;

  let posResult: { pos: number; inside: number } | null;
  try {
    posResult = editor.view.posAtCoords({ left: x, top: y });
  } catch {
    return null;
  }
  if (!posResult) return null;

  const block = resolveAnchorableBlock(editor, posResult.pos);
  if (!block) return null;

  const blockRect = block.dom.getBoundingClientRect();
  const inText = y >= blockRect.top && y <= blockRect.bottom;
  const inGap = !inText;

  // Walk priority order; return the first placement that matches.
  for (const kind of spec.allowedPlacements) {
    if (kind === "between-blocks" && inGap) {
      return makeBetweenBlocksPlacement(editor, block, y);
    }
    if (kind === "inline-cursor" && inText) {
      return makeInlineCursorPlacement(editor, posResult.pos);
    }
    if (kind === "paragraph-side") {
      return makeParagraphSidePlacement(editor, block, x);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Block resolution
// ─────────────────────────────────────────────────────────────────────

interface AnchorableBlockInfo {
  /** Position immediately before the block's open token. */
  blockPos: number;
  /** ProseMirror depth of the block. */
  depth: number;
  /** UUID — minted on the fly if the node had none. */
  uuid: string;
  /** The block's own DOM element. */
  dom: HTMLElement;
}

/** Walk up from `pos` to the nearest anchorable node, minting a UUID if
 *  missing. Mirrors the pattern in `Marginalia.tsx` lines 222-256. */
function resolveAnchorableBlock(
  editor: Editor,
  pos: number,
): AnchorableBlockInfo | null {
  const doc = editor.state.doc;
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  // Walk up the parent chain (cursor inside a block).
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (!isAnchorableNode(node.type)) continue;
    const blockPos = d === 0 ? 0 : $pos.before(d);
    let uuid: string | undefined = node.attrs?.uuid as string | undefined;
    if (!uuid) {
      const existing = new Set<string>();
      doc.descendants((n) => {
        if (n.attrs?.uuid) existing.add(n.attrs.uuid as string);
      });
      uuid = generateShortId(existing);
      const tr = editor.state.tr.setNodeMarkup(blockPos, undefined, {
        ...node.attrs,
        uuid,
      });
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    }
    const domAt = editor.view.nodeDOM(blockPos);
    if (!(domAt instanceof HTMLElement)) continue;
    return { blockPos, depth: d, uuid, dom: domAt };
  }
  // Walk-up didn't find an anchorable ancestor — the cursor is in the
  // "gap" between top-level blocks (depth 0). Fall back to the nearest
  // top-level child by traversing the doc's direct children and picking
  // the one with the smallest Y-distance to the cursor's resolved pos.
  // We use `nodeBefore` / `nodeAfter` semantics by walking children
  // until we straddle `pos`.
  let runningPos = 0;
  let bestNode: PMNode | null = null;
  let bestPos = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const childStart = runningPos;
    const childEnd = runningPos + child.nodeSize;
    runningPos = childEnd;
    if (!isAnchorableNode(child.type)) continue;
    const dist =
      pos < childStart ? childStart - pos : pos > childEnd ? pos - childEnd : 0;
    if (dist < bestDist) {
      bestDist = dist;
      bestNode = child;
      bestPos = childStart;
    }
  }
  if (!bestNode) return null;
  let uuid: string | undefined = bestNode.attrs?.uuid as string | undefined;
  if (!uuid) {
    const existing = new Set<string>();
    doc.descendants((n) => {
      if (n.attrs?.uuid) existing.add(n.attrs.uuid as string);
    });
    uuid = generateShortId(existing);
    const tr = editor.state.tr.setNodeMarkup(bestPos, undefined, {
      ...bestNode.attrs,
      uuid,
    });
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }
  const domAt = editor.view.nodeDOM(bestPos);
  if (!(domAt instanceof HTMLElement)) return null;
  return { blockPos: bestPos, depth: 0, uuid, dom: domAt };
}

// ─────────────────────────────────────────────────────────────────────
// Placement constructors
// ─────────────────────────────────────────────────────────────────────

function makeBetweenBlocksPlacement(
  editor: Editor,
  block: AnchorableBlockInfo,
  cursorY: number,
): Placement {
  const blockRect = block.dom.getBoundingClientRect();
  // Cursor is above the block's top → insert before; below → insert after.
  const insertBefore = cursorY < blockRect.top;
  const node = editor.state.doc.nodeAt(block.blockPos);
  const insertPos = insertBefore
    ? block.blockPos
    : block.blockPos + (node ? node.nodeSize : 0);

  // Bar spans the editor's text column width. Use the block's own width
  // as a stand-in (paragraphs all share the same column width).
  const barY = insertBefore ? blockRect.top : blockRect.bottom;
  const rect: ViewportRect = {
    x: blockRect.left,
    y: barY - 1,
    width: blockRect.width,
    height: 2,
  };
  return { kind: "between-blocks", editor, insertPos, rect };
}

function makeParagraphSidePlacement(
  editor: Editor,
  block: AnchorableBlockInfo,
  cursorX: number,
): Placement {
  const blockRect = block.dom.getBoundingClientRect();
  const side: "left" | "right" =
    cursorX < blockRect.left + blockRect.width / 2 ? "left" : "right";
  // Bar position: 8px outside the block on the chosen side.
  const BAR_OFFSET = 8;
  const x = side === "left" ? blockRect.left - BAR_OFFSET : blockRect.right + BAR_OFFSET - 2;
  const rect: ViewportRect = {
    x,
    y: blockRect.top,
    width: 2,
    height: blockRect.height,
  };
  return {
    kind: "paragraph-side",
    editor,
    paragraphId: block.uuid,
    side,
    rect,
  };
}

function makeInlineCursorPlacement(editor: Editor, pos: number): Placement | null {
  let coords: { left: number; top: number; bottom: number };
  try {
    coords = editor.view.coordsAtPos(pos);
  } catch {
    return null;
  }
  const height = Math.max(8, coords.bottom - coords.top);
  const rect: ViewportRect = {
    x: coords.left - 1,
    y: coords.top,
    width: 2,
    height,
  };
  return { kind: "inline-cursor", editor, pos, rect };
}

// ─────────────────────────────────────────────────────────────────────
// Self-drop detection
// ─────────────────────────────────────────────────────────────────────

/**
 * Reject drops back into the editor that is the source of the dragged
 * card. e.g. if the popped-out item is a paragraph, its float contains a
 * mini-editor displaying that very paragraph — drop targets inside that
 * mini-editor would be confusing.
 *
 * Detection: the target editor's DOM is inside a FloatingPanel that
 * carries a `data-pristine-card-id` matching the cardKey's id.
 */
function isSelfDrop(targetEditor: Editor, sourceCardKey: string): boolean {
  const sep = sourceCardKey.indexOf(":");
  if (sep <= 0) return false;
  const sourceId = sourceCardKey.slice(sep + 1);
  const dom = targetEditor.view.dom;
  const wrapper = (dom as HTMLElement).closest?.(
    `[data-pristine-card-id="${cssEscape(sourceId)}"]`,
  );
  return !!wrapper;
}

/** Minimal CSS attribute-value escape — enough for UUIDs / kebab ids. */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
