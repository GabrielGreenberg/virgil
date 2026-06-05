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
import { isCompatibleParent } from "@/text-objects/drop-adapters";
import {
  parseTextObjectPopoutKey,
  TEXT_OBJECT_REGISTRY,
} from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";
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

  // R3 — source-kind-aware resolution for lifted SUB-ITEMS. A lifted
  // sub-item (listItem / exampleItem) is a first-class movable object: it
  // should drop AMONG its peers, not only inside one of them. When the
  // dragged source is a sub-object and the cursor sits inside a peer item in
  // a container that accepts it, resolve the between-blocks placement at the
  // nearest PEER ITEM boundary — surfacing the inter-item insert positions
  // the commit path (classifyDropTarget → inside-compatible → drop-direct)
  // already honors, within a list AND across same-kind lists. Gated on
  // isSubObject + isCompatibleParent, so a non-sub-object drag, or a sub-item
  // over a top-level gap (not inside a compatible container), falls through
  // to the existing resolution below — preserving the top-level pull-out
  // (wrap) behavior byte-for-byte.
  if (spec.allowedPlacements.includes("between-blocks")) {
    const peer = resolveSubItemPeerBlock(editor, posResult.pos, sourceCardKey);
    if (peer) return makeBetweenBlocksPlacement(editor, peer, y, true);
    // Feature A1 — a lifted text/picture/equation block (paragraph /
    // graphicsBlock / displayMath) over an expex example surfaces ONE forgiving
    // left-edge VERTICAL bar that snaps to the nearest slot (item-gap → a new
    // exampleItem; into an item → its content). The resolver gates on source
    // kind ∈ the three kinds AND cursor-inside-an-exampleBlock, returning null
    // (falls through to resolveAnchorableBlock + the existing top-level drop)
    // for every other source — so all other drags are byte-unchanged. It
    // returns the finished vertical-bar Placement directly (NOT fed through
    // makeBetweenBlocksPlacement, whose horizontal rect is the wrong shape).
    const intoExpex = resolveBlockIntoExpex(
      editor,
      posResult.pos,
      y,
      sourceCardKey,
    );
    if (intoExpex) return intoExpex;
  }

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

/**
 * Source-kind-aware block resolution for lifted SUB-ITEMS (R3).
 *
 * `resolveAnchorableBlock` resolves the innermost anchorable node, which
 * inside a list/expex item is the item's inner paragraph — so a dragged
 * sub-item only ever gets drop positions INSIDE one item, never at the
 * boundary BETWEEN peer items. This resolver instead targets the nearest
 * ancestor that is a PEER ITEM of the dragged kind (`type.name ===
 * sourceKind`), provided that item sits inside a container that accepts the
 * kind (`isCompatibleParent`). The resulting `blockPos` is the item's own
 * position, so `makeBetweenBlocksPlacement` yields an inter-item insert
 * position (a sibling boundary) that the commit path already honors.
 *
 * Returns null — so the caller falls through to `resolveAnchorableBlock` and
 * the existing behavior is preserved byte-for-byte — for every other case:
 *   - the source isn't a sub-object (registry `isSubObject` false),
 *   - the cursor isn't inside a peer item of the same kind (e.g. a listItem
 *     dragged over an expex item, or over a top-level gap → still pulls out),
 *   - the peer item isn't inside a compatible container.
 *
 * O(depth): a single `$pos` ancestor walk + an `isCompatibleParent` scan of
 * the enclosing ancestors. No doc walk — safe on every throttled mousemove.
 */
export function resolveSubItemPeerBlock(
  editor: Editor,
  pos: number,
  sourceCardKey: string,
): AnchorableBlockInfo | null {
  const ref = parseTextObjectPopoutKey(sourceCardKey);
  if (!ref) return null;
  const sourceKind = ref.kind;
  if (!TEXT_OBJECT_REGISTRY[sourceKind]?.isSubObject) return null;

  const doc = editor.state.doc;
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);

  // Walk innermost→outermost for the nearest ancestor that is a peer item of
  // the dragged kind, then confirm a compatible container encloses it.
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name !== sourceKind) continue;
    let inCompatibleContainer = false;
    for (let p = d - 1; p >= 0; p--) {
      const ancestorKind = $pos.node(p).type.name as TextObjectKind;
      if (isCompatibleParent(sourceKind, ancestorKind)) {
        inCompatibleContainer = true;
        break;
      }
    }
    if (!inCompatibleContainer) return null;
    const blockPos = $pos.before(d);
    const domAt = editor.view.nodeDOM(blockPos);
    if (!(domAt instanceof HTMLElement)) return null;
    const uuid = (node.attrs?.uuid as string | undefined) ?? "";
    return { blockPos, depth: d, uuid, dom: domAt };
  }
  return null;
}

/**
 * Feature A1 — the three block kinds the unified expex drop welcomes into an
 * example: paragraph (text), graphicsBlock (picture), displayMath (equation).
 * Each is schema-valid inside an `exampleItem`
 * (`(paragraph | graphicsBlock | displayMath)+`, expex.ts). Every other source
 * kind makes `resolveBlockIntoExpex` return null → its drag is byte-unchanged.
 */
const EXPEX_DROP_KINDS: ReadonlySet<TextObjectKind> = new Set<TextObjectKind>([
  "paragraph",
  "graphicsBlock",
  "displayMath",
]);

/** Width (px) of the expex left-edge vertical bar. Tunable. */
const EXPEX_BAR_WIDTH = 3;
/** Height (px) of the short "insert a new item here" tick drawn for a
 *  new-item (item-gap) slot — distinct from the full-item-height bar an
 *  into-content slot draws. Tunable. */
const EXPEX_NEW_ITEM_BAR_HEIGHT = 22;

/**
 * One candidate insertion slot along an exampleBlock's left edge.
 *   • `new-item`     — a gap before/between/after items → wrap the dropped block
 *                      in a fresh exampleItem (insertPos in the exampleItemList,
 *                      between items; `classifyParentAt` → exampleBlock).
 *   • `into-content` — joins an existing item's content (insertPos inside the
 *                      item; `classifyParentAt` → exampleItem → drop-direct).
 * `pickY` is the viewport Y the nearest-slot snap compares against the cursor;
 * `barTop`/`barHeight` are the vertical segment the indicator paints if this
 * slot wins.
 */
interface ExpexSlot {
  insertPos: number;
  pickY: number;
  barTop: number;
  barHeight: number;
  mode: "new-item" | "into-content";
}

/**
 * Source-kind-aware resolution for a lifted text/picture/equation block over an
 * expex example (Feature A1 — the unifying generalization of A0's graphics-only
 * path and R3's `resolveSubItemPeerBlock`). A0 proved the COMMIT (drop-direct
 * into an item / wrap into a fresh item); the user proved its affordance wrong —
 * the densely-tiled items leave ~0 inter-item gap, so A0's per-cursor horizontal
 * bars were "very hard to get to show up." A1 replaces that with ONE forgiving
 * left-edge VERTICAL bar: anywhere along the example's left side is a valid
 * hover, and the insertion point SNAPS to the nearest slot as the cursor moves
 * up/down.
 *
 * Fired only when the source kind ∈ {paragraph, graphicsBlock, displayMath} AND
 * the cursor sits inside an `exampleBlock`, it enumerates that block's slots —
 * for a MULTI example, an item-gap before/between/after each item (→ new
 * exampleItem) plus one into-content slot per item (→ that item's content); for
 * a SINGLE example (no items), one into-content slot for the block body (→ the
 * body, drop-direct). It returns the vertical-bar `Placement` for the slot whose
 * `pickY` is nearest the cursor Y. The placement keeps `kind: "between-blocks"`
 * (so the existing commit handles it) — only the rect is vertical.
 *
 * Returns null — so the caller falls through to `resolveAnchorableBlock` and
 * each kind's top-level drop is preserved byte-for-byte — for every other case:
 * a non-{three-kind} source, or one NOT inside an exampleBlock. (Feature A2: a
 * single `\ex` example now yields a body slot rather than 0, so the same bar
 * appears there too.)
 *
 * O(items) — the only scan (`collectExpexSlots`) is bounded to ONE exampleBlock's
 * top-tier items + their direct children. No doc walk — safe on every throttled
 * mousemove (the gesture-sanctity constraint).
 */
export function resolveBlockIntoExpex(
  editor: Editor,
  pos: number,
  cursorY: number,
  sourceCardKey: string,
): Placement | null {
  const ref = parseTextObjectPopoutKey(sourceCardKey);
  if (!ref || !EXPEX_DROP_KINDS.has(ref.kind)) return null;

  const doc = editor.state.doc;
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);

  // Find the enclosing exampleBlock.
  let exampleBlockDepth = -1;
  for (let d = $pos.depth; d >= 1; d--) {
    if ($pos.node(d).type.name === "exampleBlock") {
      exampleBlockDepth = d;
      break;
    }
  }
  if (exampleBlockDepth < 0) return null; // not inside an expex → fall through

  const exampleBlockPos = $pos.before(exampleBlockDepth);
  const exampleBlock = $pos.node(exampleBlockDepth);
  const blockDom = editor.view.nodeDOM(exampleBlockPos);
  if (!(blockDom instanceof HTMLElement)) return null;
  const blockLeft = blockDom.getBoundingClientRect().left;

  const slots = collectExpexSlots(editor, exampleBlockPos, exampleBlock);
  if (slots.length === 0) return null; // no resolvable slot (DOM gone) → fall through

  // Generous left-zone snap: the whole left band qualifies — pick the slot
  // whose pickY is nearest the cursor Y (first slot wins ties, keeping the
  // result stable as the cursor drifts).
  let best = slots[0];
  let bestDist = Math.abs(best.pickY - cursorY);
  for (let i = 1; i < slots.length; i++) {
    const dist = Math.abs(slots[i].pickY - cursorY);
    if (dist < bestDist) {
      bestDist = dist;
      best = slots[i];
    }
  }
  return makeExpexLeftBarPlacement(editor, blockLeft, best);
}

/**
 * Enumerate the insertion slots along an exampleBlock's left edge — for EVERY
 * expex shape, multi OR single (Feature A2 unifies them under one affordance).
 *
 * MULTI (the block has exampleItems): bounded to its TOP-TIER items
 * (`nodesBetween` returns false at each so nested item lists are skipped —
 * keeping a new-item wrap schema-valid). Per item: a `new-item` slot at its top
 * edge (a gap → fresh sibling item) and one `into-content` slot spanning its
 * body (→ join the item). A trailing `new-item` slot sits below the last item.
 *
 * SINGLE (no exampleItem — a single `\ex` with direct content, or a gloss-only
 * example): one `into-content` slot for the BLOCK BODY (insertPos =
 * `leadingContentEnd` of the exampleBlock itself, before any gloss). A single
 * example has no "new item" concept, so just the one body bar — the dropped
 * block joins the body directly (schema-driven drop-direct at commit time,
 * see `blockIntoExpexDropAdapter`), keeping it one numbered example.
 *
 * Bounded to ONE exampleBlock (no doc walk) — it runs on every throttled
 * mousemove (gesture sanctity, AGENTS.md).
 */
function collectExpexSlots(
  editor: Editor,
  exampleBlockPos: number,
  exampleBlock: PMNode,
): ExpexSlot[] {
  const slots: ExpexSlot[] = [];
  let lastItemBottom: number | null = null;
  let lastItemEnd: number | null = null;
  let itemCount = 0;

  editor.state.doc.nodesBetween(
    exampleBlockPos,
    exampleBlockPos + exampleBlock.nodeSize,
    (node, nodePos) => {
      if (node.type.name !== "exampleItem") return true; // descend to the items
      itemCount++;
      const dom = editor.view.nodeDOM(nodePos);
      if (!(dom instanceof HTMLElement)) return false;
      const rect = dom.getBoundingClientRect();

      // new-item slot — the gap BEFORE this item (a between-items / above-first
      // boundary). insertPos at the item's own position sits in the
      // exampleItemList between items → classifyParentAt → exampleBlock → wrap.
      slots.push({
        insertPos: nodePos,
        pickY: rect.top,
        barTop: rect.top - EXPEX_NEW_ITEM_BAR_HEIGHT / 2,
        barHeight: EXPEX_NEW_ITEM_BAR_HEIGHT,
        mode: "new-item",
      });

      // into-content slot — append after the item's leading content run; the
      // bar spans the whole item so the affordance reads "lands in this item".
      slots.push({
        insertPos: leadingContentEnd(node, nodePos),
        pickY: rect.top + rect.height / 2,
        barTop: rect.top,
        barHeight: rect.height,
        mode: "into-content",
      });

      lastItemBottom = rect.bottom;
      lastItemEnd = nodePos + node.nodeSize;
      return false; // top-tier only — don't descend into the item
    },
  );

  // new-item slot — the gap BELOW the last item.
  if (lastItemBottom !== null && lastItemEnd !== null) {
    slots.push({
      insertPos: lastItemEnd,
      pickY: lastItemBottom,
      barTop: lastItemBottom - EXPEX_NEW_ITEM_BAR_HEIGHT / 2,
      barHeight: EXPEX_NEW_ITEM_BAR_HEIGHT,
      mode: "new-item",
    });
  }

  // SINGLE example (no items) — one into-content slot for the block body. The
  // bar spans the whole block; the insert lands after the leading content run
  // and before any gloss. (A1 enumerated only exampleItems, so a single example
  // yielded 0 slots → no bar; this is the gap A2 closes.)
  if (itemCount === 0) {
    const blockDom = editor.view.nodeDOM(exampleBlockPos);
    if (blockDom instanceof HTMLElement) {
      const rect = blockDom.getBoundingClientRect();
      slots.push({
        insertPos: leadingContentEnd(exampleBlock, exampleBlockPos),
        pickY: rect.top + rect.height / 2,
        barTop: rect.top,
        barHeight: rect.height,
        mode: "into-content",
      });
    }
  }
  return slots;
}

/**
 * Position just after a container's leading content run — the run of
 * paragraph / graphicsBlock / displayMath children before any nested
 * exampleItemList / exampleGloss. A block inserted here joins the container as
 * its last content sibling, keeping the schema's `(content)+ list? gloss?`
 * order intact.
 *
 * Generic over BOTH an `exampleItem` (the A1 multi-item case) and an
 * `exampleBlock` body (the A2 single-example case) — their leading content
 * runs share the same three kinds. For a gloss-only single example
 * (exampleBlock → [exampleGloss], no leading paragraph) the loop breaks
 * immediately, returning the position just inside the block, BEFORE the gloss,
 * so a drop lands above it (schema-valid; reads naturally).
 */
function leadingContentEnd(parent: PMNode, parentPos: number): number {
  let pos = parentPos + 1; // just inside the container, before its first child
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const name = child.type.name;
    if (
      name === "paragraph" ||
      name === "graphicsBlock" ||
      name === "displayMath"
    ) {
      pos += child.nodeSize;
    } else {
      break; // first non-content child (exampleItemList / exampleGloss)
    }
  }
  return pos;
}

/**
 * Build the vertical-left-bar `Placement` for a snapped expex slot. Keeps
 * `kind: "between-blocks"` (the commit reads `insertPos`, not the rect, so A0's
 * wrap/into-content machinery is reused unchanged) — only the rect is vertical:
 * a thin bar (`height > width`) at the exampleBlock's left edge. The x-offset
 * and bar heights (`EXPEX_BAR_WIDTH` / `EXPEX_NEW_ITEM_BAR_HEIGHT`) are tunable.
 */
export function makeExpexLeftBarPlacement(
  editor: Editor,
  blockLeft: number,
  slot: ExpexSlot,
): Placement {
  const rect: ViewportRect = {
    x: blockLeft,
    y: slot.barTop,
    width: EXPEX_BAR_WIDTH,
    height: Math.max(slot.barHeight, EXPEX_BAR_WIDTH * 2),
  };
  return { kind: "between-blocks", editor, insertPos: slot.insertPos, rect };
}

// ─────────────────────────────────────────────────────────────────────
// Placement constructors
// ─────────────────────────────────────────────────────────────────────

export function makeBetweenBlocksPlacement(
  editor: Editor,
  block: AnchorableBlockInfo,
  cursorY: number,
  snapToMidpoint = false,
): Placement {
  const blockRect = block.dom.getBoundingClientRect();
  // Cursor above the threshold → insert before; below → insert after. For
  // sub-item peer drops (R3) the threshold is the block's vertical MIDPOINT
  // (Notion-style), so the line snaps to the nearest item boundary as the
  // cursor moves over the list rather than firing only in the hairline gap.
  // Top-level block drops keep the top-edge threshold (snapToMidpoint
  // defaults false → byte-identical to before).
  const threshold = snapToMidpoint
    ? blockRect.top + blockRect.height / 2
    : blockRect.top;
  const insertBefore = cursorY < threshold;
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
