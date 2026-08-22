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
 *   5. For a session with a BLOCK payload, run the candidate LADDER
 *      (`insert-candidates.ts`): resolve every insert position the ancestor
 *      chain offers at this row, filter them against the payload through the
 *      same schema SSOT the commit reads, and let Y pick the boundary and X the
 *      level. A survivor IS the answer; nothing surviving means "not here".
 *   6. Otherwise classify the cursor as "inGap" (between blocks) or "inText"
 *      (inside a block's text rect) and ask `winningPlacementKind` which of the
 *      SESSION's placements wins at that geometry, and build it.
 *
 * Step 6's rule lives in `placement-policy.ts`, not inline here, so the CI
 * reachability guard reads the same function the loop does (task 258). The
 * session's list is the spec's per-payload answer when it has one — the
 * hit-test never resolves it itself, because that resolution may read
 * persisted state and this runs on every throttled pointermove.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { isAnchorableNode } from "@/lib/marginalia";
import { generateShortId } from "@/lib/uuid";
import { resolveAnchorableNode, ensureAnchorUuid } from "@/lib/anchor-uuid";
import { markAnchorMint } from "@/lib/anchor-mint-signal";
import { contentSpanFor } from "./move-geometry";
import { EXPEX_INNER_KINDS } from "@/text-objects/drop-adapters";
import { parseTextObjectPopoutKey } from "@/text-objects/text-object-registry";
import { parseAnyKey } from "@/floats/float-key";
import { findEditorAtPoint } from "./target-registry";
import { winningPlacementKind } from "./placement-policy";
import { inlineCursorHostsPayload, type InlineDropPayload } from "./inline-host";
import type { BlockDropPayload } from "./block-payload";
import {
  chooseInsertCandidate,
  filterInsertCandidates,
  resolveInsertCandidates,
  type InsertCandidate,
} from "./insert-candidates";
import type { DropSpec, Placement, PlacementKind, ViewportRect } from "./types";

/**
 * Resolve a cursor point to a `Placement` (or null if nothing valid is
 * under the cursor for the given spec).
 *
 * `sourceCardKey` is the cardKey of the popped-out item being dropped.
 * Used to reject self-drops (target editor belongs to the source card).
 *
 * `inlinePayload` is the SESSION's answer to the OTHER once-per-gesture question
 * (task 414): the schema node names this drop would splice at an inline caret,
 * so the container question can be asked in the AFFORDANCE. REQUIRED rather
 * than defaulted — a default is a decision nobody made, and the decision it
 * would silently make here is "skip the gate", which is the defect. The only
 * production caller is the controller's move pass; `TEXT_ONLY_PAYLOAD` is the
 * explicit way to say "plain text, nothing to refuse".
 *
 * `placements` is the SESSION's ordered list — `DropSession.placements`,
 * resolved once at `beginDropSession` from `spec.placementsFor` (per payload)
 * or `spec.allowedPlacements`. Passed in rather than read off the spec here so
 * a per-payload policy is resolved once per gesture, not once per move; an
 * EMPTY list is meaningful and yields no placement anywhere.
 */
export function hitTest(
  x: number,
  y: number,
  spec: DropSpec,
  placements: ReadonlyArray<PlacementKind>,
  sourceCardKey: string,
  mainEditor: Editor | null,
  inlinePayload: InlineDropPayload,
  blockPayload: BlockDropPayload,
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

  // Feature A1 — a lifted text/picture/equation block (paragraph /
  // graphicsBlock / displayMath) over an expex example surfaces ONE forgiving
  // left-edge VERTICAL bar that snaps to the nearest slot (item-gap → a new
  // exampleItem; into an item → its content). Kept AHEAD of the ladder below:
  // it is a genuinely different affordance (a vertical into-item bar with its
  // own geometry), not another rung of the same one. It returns null — falling
  // through — for every other source, so all other drags are byte-unchanged.
  if (placements.includes("between-blocks")) {
    const intoExpex = resolveBlockIntoExpex(
      editor,
      posResult.pos,
      y,
      sourceCardKey,
    );
    if (intoExpex) return intoExpex;
  }

  // Never mint on the move path — a uuid-less block rides a pos-keyed
  // sentinel until commit (mintPlacementUuid in the controller).
  const block = resolveAnchorableBlock(editor, posResult.pos, { mint: false });
  if (!block) return null;

  // ONE rect read per move for this block (wave-2b C8): the classification
  // read below is THREADED into the placement builders AND into the candidate
  // ladder's floor rung, which used to re-read the same element's rect — 2
  // forced-layout reads per throttled mousemove where one suffices.
  const blockRect = block.dom.getBoundingClientRect();

  // The BLOCK-payload ladder (task 416) — ONE resolver where three special
  // cases used to sit. `resolveInsertCandidates` walks the ancestor ladder from
  // this floor outward and yields EVERY legal insert position at this row; the
  // filter drops the levels this container cannot hold; X picks the level and Y
  // the boundary, at each level's own MIDPOINT. It SUBSUMES the retired R3
  // `resolveSubItemPeerBlock`: a peer-item boundary is simply the candidate
  // whose container is the list, now reached for EVERY payload rather than only
  // for a same-kind sub-item drag.
  //
  // Gated on the session's DECLARED block payload rather than on "does the
  // source key parse as a sub-item". That gate is the F0 half of the task: a
  // list has no top-level gaps between its items and `between-blocks` matches
  // the GAP only, so before this the only payload offered anything anywhere
  // over a list body was one that was itself a `listItem` — every other block
  // drag saw nothing at all over the same rows.
  //
  // A session with no block payload (a card pull, a plain-text slice, a
  // paragraph-side re-anchor) skips the ladder entirely and takes the gap-only
  // switch below, byte-identical to the pre-416 tree.
  let effective = placements;
  if (blockPayload.length > 0 && placements.includes("between-blocks")) {
    const chosen = chooseInsertCandidate(
      filterInsertCandidates(
        editor,
        resolveInsertCandidates(editor, block.blockPos, y, blockRect),
        blockPayload,
      ),
      x,
    );
    if (chosen) return makeCandidatePlacement(editor, chosen);
    // The ladder is the ONLY producer of `between-blocks` for a session that
    // has a block payload, so a ladder that survived nothing is an ANSWER —
    // "not here" — and F3 dies by construction: a level the commit would refuse
    // is never painted, rather than painted and then silently declined on
    // release. The session's OTHER placements are still asked below.
    effective = placements.filter((k) => k !== "between-blocks");
  }

  const inText = y >= blockRect.top && y <= blockRect.bottom;

  // Which of the session's placements wins at this geometry — the priority
  // rule itself lives in `placement-policy.ts` (its `winningPlacementKind` IS
  // this loop), so the CI reachability guard can read the rule rather than a
  // second copy of it. Here we only BUILD the winner.
  switch (winningPlacementKind(effective, inText ? "text" : "gap")) {
    case "between-blocks":
      return makeBetweenBlocksPlacement(editor, block, y, blockRect);
    case "inline-cursor":
      return makeInlineCursorPlacement(editor, posResult.pos, inlinePayload);
    case "paragraph-side":
      return makeParagraphSidePlacement(editor, block, x, blockRect);
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Block resolution
// ─────────────────────────────────────────────────────────────────────

interface AnchorableBlockInfo {
  /** Position immediately before the block's open token. */
  blockPos: number;
  /** UUID — minted on the fly if the node had none. */
  uuid: string;
  /** The block's own DOM element. */
  dom: HTMLElement;
}

/**
 * Walk up from `pos` to the nearest anchorable node, minting a UUID if missing.
 *
 * The cursor-inside-a-block case DELEGATES to the canonical anchor resolver
 * (`resolveAnchorableNode` / `ensureAnchorUuid` in `@/lib/anchor-uuid`) — the
 * SAME SSOT the normal anchor path (grab handle / action button / Marginalia)
 * uses. This is load-bearing: that resolver honors `DEFERRING_PARENTS`
 * (listItem / blockquote / codeBlock / exampleItem), so a re-anchor INTO a
 * list-item / blockquote / expex paragraph resolves the CONTAINER, not the
 * inner paragraph. Minting on the inner paragraph (the pre-fix bug) was a
 * deterministic orphan: `assignUuids` strips inner-container-paragraph UUIDs on
 * the very next save (latex-serializer.ts), so the card's anchor was guaranteed
 * stale on reload regardless of timing. Collapsing the two resolvers into one
 * removes that whole class.
 *
 * `ensureAnchorUuid` mints with `addToHistory:false` AND tags the tx with the
 * anchor-mint signal (so the autosave flushes the paragraph UUID immediately).
 *
 * Only the top-level GAP fallback below stays local — drop needs a target even
 * in the hairline between top-level blocks, picked by Y-distance (not PM's
 * position-based nodeBefore/nodeAfter). Top-level children have no deferring
 * parent, so that branch was never affected by the container mis-mint; it just
 * routes its mint through the same shared signal for the flush.
 */
export function resolveAnchorableBlock(
  editor: Editor,
  pos: number,
  opts?: { mint?: boolean },
): AnchorableBlockInfo | null {
  // Default TRUE preserves the historical contract for any direct caller;
  // the per-move hitTest passes { mint: false } and the real mint happens
  // once at commit (mintPlacementUuid) — minting per pointermove was the D4
  // drag cliff (full doc walk + dispatch + synchronous .tex flush per move).
  const mint = opts?.mint ?? true;
  const doc = editor.state.doc;
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  // Cursor inside a block: defer to the SSOT resolver, which skips a
  // container-nested paragraph in favour of its DEFERRING_PARENTS ancestor.
  // We only honor this when the walk-up genuinely found an anchorable ancestor
  // (depth ≥ 0 in the doc tree) — if the resolver fell back to nodeBefore /
  // nodeAfter for a top-level-gap cursor, we prefer the local Y-distance gap
  // heuristic below (it picks the visually-nearest neighbor, which the
  // between-blocks indicator geometry depends on).
  const inBlock = hasAnchorableAncestor($pos);
  if (inBlock) {
    const resolved = resolveAnchorableNode(editor.view, pos);
    if (resolved) {
      // Mint (if missing) through the SSOT — honors DEFERRING_PARENTS, tags the
      // tx with the anchor-mint flush signal, dedups UUIDs doc-wide. In
      // mint:false mode a uuid-less block gets a pos-keyed sentinel instead;
      // stable for indicator identity while hovering (no doc changes mid-drag
      // once per-move mints are gone).
      const uuid = mint
        ? ensureAnchorUuid(editor.view, pos)
        : ((resolved.node.attrs?.uuid as string | undefined) ??
          unmintedParagraphId(resolved.nodePos));
      if (uuid) {
        // Re-read nodePos AFTER the mint: `setNodeMarkup` keeps positions
        // stable (same node, same size), so `resolved.nodePos` is still valid.
        const domAt = editor.view.nodeDOM(resolved.nodePos);
        if (domAt instanceof HTMLElement) {
          return { blockPos: resolved.nodePos, uuid, dom: domAt };
        }
      }
    }
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
  if (!uuid && !mint) {
    uuid = unmintedParagraphId(bestPos);
  } else if (!uuid) {
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
    // Same flush signal as the SSOT path — persist the minted UUID on the
    // card's fast clock (see @/lib/anchor-mint-signal).
    markAnchorMint(tr);
    editor.view.dispatch(tr);
  }
  const domAt = editor.view.nodeDOM(bestPos);
  if (!(domAt instanceof HTMLElement)) return null;
  return { blockPos: bestPos, uuid, dom: domAt };
}

// ─────────────────────────────────────────────────────────────────────
// Deferred minting (mint-at-commit)
// ─────────────────────────────────────────────────────────────────────
//
// The per-move hit-test never mints: a uuid-less block's placement carries a
// pos-keyed sentinel id, and the ONE mint happens at commit via
// `mintPlacementUuid` — through the same `ensureAnchorUuid` SSOT (honors
// DEFERRING_PARENTS, anchor-mint flush signal, doc-wide dedup).

const UNMINTED_PREFIX = "unminted@";

function unmintedParagraphId(blockPos: number): string {
  return `${UNMINTED_PREFIX}${blockPos}`;
}

export function isUnmintedParagraphId(id: string): boolean {
  return id.startsWith(UNMINTED_PREFIX);
}

/**
 * Resolve a sentinel paragraphId to a real minted uuid at commit time.
 * Returns null when the block vanished out from under the gesture (the
 * caller should treat the drop as a no-op).
 */
export function mintPlacementUuid(editor: Editor, id: string): string | null {
  if (!isUnmintedParagraphId(id)) return id;
  const blockPos = Number(id.slice(UNMINTED_PREFIX.length));
  if (!Number.isFinite(blockPos)) return null;
  const doc = editor.state.doc;
  if (blockPos < 0 || blockPos >= doc.content.size) return null;
  const node = doc.nodeAt(blockPos);
  if (!node || !isAnchorableNode(node.type)) return null;
  // `ensureAnchorUuid` walks up from a pos INSIDE the node; blockPos + 1 is
  // inside for any non-leaf block. Leaf atoms (nodeSize 1) anchor at their own
  // position.
  return ensureAnchorUuid(
    editor.view,
    node.nodeSize > 1 ? blockPos + 1 : blockPos,
  );
}

/**
 * Did the cursor at `$pos` land INSIDE an anchorable block (vs the gap between
 * top-level blocks)? True iff some ancestor at depth ≥ 0 is anchorable. Mirrors
 * the predicate `resolveAnchorableNode`'s walk-up loop tests, so the in-block
 * delegation fires for exactly the cursors that resolver would resolve via its
 * walk-up (not its nodeBefore/nodeAfter gap fallback).
 */
function hasAnchorableAncestor($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d >= 0; d--) {
    if (isAnchorableNode($pos.node(d).type)) return true;
  }
  return false;
}

/**
 * Feature A1 — the block kinds the unified expex drop welcomes into an example:
 * paragraph (text), graphicsBlock (picture), displayMath (equation). Each is
 * schema-valid inside an `exampleItem` (`(paragraph | graphicsBlock |
 * displayMath)+`, expex.ts). Every other source kind makes
 * `resolveBlockIntoExpex` return null → its drag is byte-unchanged.
 *
 * This is the ONE SSOT (`EXPEX_INNER_KINDS`, drop-adapters.ts), NOT a parallel
 * literal — the same set `isCompatibleParent` gates on, pinned in CI against the
 * registry's `dropAdapter === blockIntoExpexDropAdapter` facet (task 254).
 */
const EXPEX_DROP_KINDS = EXPEX_INNER_KINDS;

/** Thickness (px) of the expex drop bar — the WIDTH of the vertical into-item
 *  bar AND the HEIGHT of the horizontal new-item bar. Tunable. */
const EXPEX_BAR_WIDTH = 3;
/** Fraction of an item's height, at its TOP and BOTTOM, that selects a
 *  HORIZONTAL new-item bar (a new sibling item above / below). The middle band
 *  (the remaining 1 − 2·frac) selects the VERTICAL into-item bar (a new block
 *  inside the item). Tunable — into-item owns the middle, new-item the edges. */
const EXPEX_EDGE_BAND_FRAC = 0.3;

/**
 * Geometry of one top-tier exampleItem, gathered for the thirds hit model.
 * `top`/`bottom`/`height` come from the item's own DOM box; `contentLeft` /
 * `contentWidth` from the canonical block frame of its first content child (see
 * {@link contentFrameEdges}) — the item's TEXT-left (where the prose sits), NOT
 * the far-left where expex draws the "(2)" / "a." label. Both bars hang off the
 * text-left so they read as "a line in the prose column," never under the label.
 */
interface ExpexItemGeom {
  /** The item's own position (before its open token) — the new-item wrap anchor. */
  pos: number;
  nodeSize: number;
  top: number;
  bottom: number;
  height: number;
  contentLeft: number;
  contentWidth: number;
}

/**
 * The TEXT-left x (and content width) of an expex container's insertion site,
 * read from the canonical content-edge primitive `resolveContentEdges` (which
 * `resolveBlockFrame` composes) — the SAME content-left the grab handles get
 * from the frame — so the expex drop bars and the between-blocks bar share ONE
 * content-left source and line up by construction (the §4 fix), instead of each
 * measuring `getBoundingClientRect().left` independently.
 *
 * Resolves the frame of the container's FIRST CONTENT CHILD (`containerPos + 1`)
 * — where the dropped block's text will land. Resolving the child (not the
 * container) is deliberate and robust: `resolveContentEdges` on the container
 * would container-descend via `data-uuid` grabbable children, but those
 * decorations are lazily hydrated (uuid-attr.ts) and may be absent on a body
 * the user hasn't touched yet mid-drag; the child's own frame needs no uuid. For
 * a paragraph-first item the child IS the same `<p>` the container would descend
 * to, so the number matches the grab handle by construction. Falls back to the
 * passed container-box edges when there's no resolvable content child (empty
 * body / non-element DOM). Used for BOTH an exampleItem (multi) and the
 * exampleBlock body (single).
 *
 * O(1) — bounded DOM reads + cached font metrics; safe on the frame-coalesced
 * drop path (AGENTS.md gesture sanctity), no doc walk. Since task 351 it reads
 * through `contentSpanFor`, the gesture-scoped memo: the extent is HORIZONTAL
 * only, and horizontal is exactly what cannot change while the pointer is held
 * (auto-scroll moves content vertically, so a cached Y would be stale within a
 * frame — see `move-geometry.ts`).
 */
function contentFrameEdges(
  editor: Editor,
  containerPos: number,
  container: PMNode,
  fallbackLeft: number,
  fallbackWidth: number,
): { left: number; width: number } {
  if (container.childCount > 0) {
    const dom = editor.view.nodeDOM(containerPos + 1);
    if (dom instanceof HTMLElement) {
      return contentSpanFor(dom);
    }
  }
  return { left: fallbackLeft, width: fallbackWidth };
}

/**
 * Source-kind-aware resolution for a lifted text/picture/equation block over an
 * expex example. Feature A3 redesigns the affordance so ORIENTATION carries
 * meaning (A1/A2 drew the new-item AND the into-item bars both as vertical
 * left-edge bars — a short tick vs a tall bar — which the user found
 * ambiguous):
 *
 *   • a HORIZONTAL full-width bar = a new sibling ITEM (wrap; push the others
 *                                   down) — drawn at an item's top / bottom gap.
 *   • a VERTICAL left-edge bar    = a new block WITHIN that item (drop-direct,
 *                                   pushed to the item's top) — drawn down the
 *                                   item's text-left, spanning its height.
 *
 * Hit model = vertical-position thirds (Notion-style). For the top-tier item the
 * cursor's Y is within (above all → first item; below all → last item), let
 * `frac = clamp((cursorY − item.top) / item.height, 0, 1)`:
 *   • `frac < EXPEX_EDGE_BAND_FRAC`     → new-item ABOVE: a horizontal bar at the
 *                                         item's top; insertPos = the item's own
 *                                         pos (in the exampleItemList) → wrap.
 *   • `frac > 1 − EXPEX_EDGE_BAND_FRAC` → new-item BELOW: a horizontal bar at the
 *                                         item's bottom; insertPos = after the
 *                                         item → wrap. (Adjacent items SHARE a
 *                                         gap: new-below-I == new-above-(I+1).)
 *   • else (the middle band)            → into-item: a vertical bar at the item's
 *                                         text-left; insertPos = the item's
 *                                         content START (pos + 1) → drop-direct,
 *                                         the dropped block becomes the item's
 *                                         new FIRST child.
 *
 * A SINGLE example (no items) has no "new item" concept (it is NOT converted to
 * a multi `\pex`): it gets ONE vertical into-body bar down the body's text-left,
 * full body height; insertPos = the block body's content START
 * (`exampleBlockPos + 1`) → drop-direct, pushed to the top.
 *
 * Returns the finished `Placement` directly (kind `between-blocks`, so the
 * existing wrap-vs-direct commit handles it — only the rect is reshaped). Gated
 * on the source kind ∈ {paragraph, graphicsBlock, displayMath} AND the cursor
 * being inside an exampleBlock; returns null for every other case — a
 * non-{three-kind} source, or a cursor OUTSIDE any exampleBlock (above / below
 * the example → the normal top-level between-blocks drop) — preserving those
 * drags byte-for-byte.
 *
 * O(items) — the only scan (`collectExpexItems`) is bounded to ONE exampleBlock's
 * top-tier items + one content child each. No doc walk — safe on every throttled
 * mousemove (the gesture-sanctity constraint, AGENTS.md).
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
  const blockRect = blockDom.getBoundingClientRect();

  const { items, structuralCount } = collectExpexItems(
    editor,
    exampleBlockPos,
    exampleBlock,
  );

  // SINGLE example (no items) — ONE vertical into-body bar down the body's
  // text-left, full body height; insert at the body content START (push down).
  if (structuralCount === 0) {
    const { left } = contentFrameEdges(
      editor,
      exampleBlockPos,
      exampleBlock,
      blockRect.left,
      blockRect.width,
    );
    const rect: ViewportRect = {
      x: left,
      y: blockRect.top,
      width: EXPEX_BAR_WIDTH,
      height: Math.max(blockRect.height, EXPEX_BAR_WIDTH * 2),
    };
    return {
      kind: "between-blocks",
      editor,
      insertPos: exampleBlockPos + 1,
      rect,
    };
  }

  // MULTI example whose item DOM is gone → fall through (preserve A1/A2's
  // null-when-unresolvable behavior; the top-level drop still fires).
  if (items.length === 0) return null;

  // Thirds: pick the item the cursor's Y is within (above all → first; below
  // all → last), compute its band, build the one bar.
  let active = items[0];
  for (let i = 1; i < items.length; i++) {
    if (cursorY >= items[i].top) active = items[i];
  }
  const frac = Math.min(
    1,
    Math.max(0, (cursorY - active.top) / (active.height || 1)),
  );

  if (frac < EXPEX_EDGE_BAND_FRAC) {
    return makeExpexNewItemPlacement(editor, active, "above", blockRect.right);
  }
  if (frac > 1 - EXPEX_EDGE_BAND_FRAC) {
    return makeExpexNewItemPlacement(editor, active, "below", blockRect.right);
  }
  return makeExpexIntoItemPlacement(editor, active);
}

/**
 * Gather the geometry of an exampleBlock's TOP-TIER exampleItems for the thirds
 * hit model — bounded to ONE block (no doc walk; gesture sanctity, AGENTS.md).
 * `nodesBetween` returns false at each exampleItem so nested item lists are
 * skipped (a new-item wrap stays schema-valid at the top tier).
 *
 * Returns the per-item geometry (only for items whose DOM resolves) AND the
 * STRUCTURAL item count (every exampleItem node, DOM or not) so the caller can
 * tell a genuine SINGLE example (count 0 → one body bar) from a MULTI whose DOM
 * is transiently gone (count > 0 but no geometry → fall through to null).
 */
function collectExpexItems(
  editor: Editor,
  exampleBlockPos: number,
  exampleBlock: PMNode,
): { items: ExpexItemGeom[]; structuralCount: number } {
  const items: ExpexItemGeom[] = [];
  let structuralCount = 0;

  editor.state.doc.nodesBetween(
    exampleBlockPos,
    exampleBlockPos + exampleBlock.nodeSize,
    (node, nodePos) => {
      if (node.type.name !== "exampleItem") return true; // descend to the items
      structuralCount++;
      const dom = editor.view.nodeDOM(nodePos);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();
        const { left, width } = contentFrameEdges(
          editor,
          nodePos,
          node,
          rect.left,
          rect.width,
        );
        items.push({
          pos: nodePos,
          nodeSize: node.nodeSize,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          contentLeft: left,
          contentWidth: width,
        });
      }
      return false; // top-tier only — don't descend into the item
    },
  );

  return { items, structuralCount };
}

/**
 * A HORIZONTAL new-item bar at an item boundary — spans the item's content
 * width, `EXPEX_BAR_WIDTH` thick, centered on the gap line (the item's top for
 * "above", its bottom for "below"). insertPos sits in the exampleItemList (the
 * item's own pos / just after it) → the commit's wrap-vs-direct path WRAPS the
 * dropped block in a fresh sibling exampleItem, pushing the others down. Keeps
 * `kind:"between-blocks"` (the commit reads insertPos, not the rect); the
 * wide-short rect renders horizontal via the Indicator's aspect test.
 */
function makeExpexNewItemPlacement(
  editor: Editor,
  item: ExpexItemGeom,
  side: "above" | "below",
  bodyRight: number,
): Placement {
  const gapY = side === "above" ? item.top : item.bottom;
  // WIDTH encodes SCOPE (task 007): a new sibling ITEM spans the example's BODY
  // COLUMN — from the item's indented text-left to the example body's right edge
  // (`bodyRight`, the exampleBlock box's right; body `1fr` extends to it) — NOT
  // the (possibly short, one-line) `item.contentWidth`. So "a new item lands
  // here" reads full-width within the example, mirroring the full-column bar a
  // top-level sibling gets. Falls back to the item's own content width if the
  // body edge somehow sits left of it (defensive; never in a laid-out block).
  const rect: ViewportRect = {
    x: item.contentLeft,
    y: gapY - EXPEX_BAR_WIDTH / 2,
    width: Math.max(bodyRight - item.contentLeft, item.contentWidth, EXPEX_BAR_WIDTH * 2),
    height: EXPEX_BAR_WIDTH,
  };
  const insertPos = side === "above" ? item.pos : item.pos + item.nodeSize;
  return { kind: "between-blocks", editor, insertPos, rect };
}

/**
 * A VERTICAL into-item bar down an item's text-left, spanning its height,
 * `EXPEX_BAR_WIDTH` thick. insertPos = the item's content START (`pos + 1`,
 * before its first child) → the commit drops the block DIRECTLY into the item as
 * its new FIRST child, pushing the item's existing content down. The tall-thin
 * rect renders vertical via the Indicator's aspect test.
 */
function makeExpexIntoItemPlacement(
  editor: Editor,
  item: ExpexItemGeom,
): Placement {
  const rect: ViewportRect = {
    x: item.contentLeft,
    y: item.top,
    width: EXPEX_BAR_WIDTH,
    height: Math.max(item.height, EXPEX_BAR_WIDTH * 2),
  };
  return { kind: "between-blocks", editor, insertPos: item.pos + 1, rect };
}

// ─────────────────────────────────────────────────────────────────────
// Placement constructors
// ─────────────────────────────────────────────────────────────────────

export function makeBetweenBlocksPlacement(
  editor: Editor,
  block: AnchorableBlockInfo,
  cursorY: number,
  // The caller's already-read rect for `block.dom` (C8 — hitTest threads its
  // classification read). Optional: paths that arrive without one pay the
  // single read here instead.
  preReadRect?: DOMRect,
): Placement {
  const blockRect = preReadRect ?? block.dom.getBoundingClientRect();
  // Cursor above the block's vertical MIDPOINT → insert before; below → after.
  // ONE threshold for every payload since task 416: `snapToMidpoint` was a flag
  // with a single `true` call site (the retired R3 sub-item path), so a list
  // read as a stack of after-targets for every other drag. On the gap-only path
  // this reaches — where the cursor is by construction OUTSIDE the block's box —
  // the midpoint and the pre-416 top edge give the same answer, so nothing here
  // moves; the flag's removal is what makes the rule one rule.
  const insertBefore = cursorY < blockRect.top + blockRect.height / 2;
  const node = editor.state.doc.nodeAt(block.blockPos);
  const insertPos = insertBefore
    ? block.blockPos
    : block.blockPos + (node ? node.nodeSize : 0);
  const isTopLevelSibling =
    editor.state.doc.resolve(block.blockPos).depth === 0;
  return {
    kind: "between-blocks",
    editor,
    insertPos,
    rect: betweenBlocksBarRect(block.dom, blockRect, insertBefore, isTopLevelSibling),
  };
}

/**
 * The between-blocks placement for one resolved {@link InsertCandidate} — the
 * ladder's builder (task 416). Same bar rule as the flat path above; the
 * candidate has already decided the boundary (Y, at its OWN midpoint) and the
 * level (X).
 */
function makeCandidatePlacement(
  editor: Editor,
  cand: InsertCandidate,
): Placement {
  return {
    kind: "between-blocks",
    editor,
    insertPos: cand.insertPos,
    rect: betweenBlocksBarRect(
      cand.dom,
      cand.rect,
      cand.insertBefore,
      cand.refDepth === 1,
    ),
  };
}

/**
 * The bar's rect. Its horizontal extent encodes the insert SCOPE (task 007),
 * not the neighbour's text length — and since task 416 that encoding is a LIVE
 * affordance rather than a readout, because X chooses which level the bar is
 * drawn for:
 *
 *  • TOP-LEVEL sibling insert (the reference block sits at doc depth 0) → the
 *    bar spans the block's OWN COLUMN box (its border box). A top-level block
 *    fills the prose column, and its content-left IS the column-left — for a
 *    paragraph / heading / figure that box already equals the descended content
 *    edge, but for a CONTAINER (exampleBlock / list) the descended first-line
 *    target is the narrow, INDENTED inner item (`resolveContentEdges` walks into
 *    it), which made the sibling bar read short below an example. Because the
 *    descended target is always a DESCENDANT of the block's DOM, the outer box
 *    is never narrower — this can only widen the bar to true column scope, never
 *    shrink it, so "a new top-level block lands here" reads full-width for every
 *    kind.
 *
 *  • SUB-TIER insert (a level at depth ≥ 1) → the shared content-edge primitive
 *    `resolveContentEdges` (which `resolveBlockFrame` composes — the SAME
 *    content-left / width the grab handles read), so the bar hugs that level's
 *    indented TEXT-left and coincides with the into-item bar over the same item
 *    (chip 4a §4).
 *
 * Y comes from the reference block's own box (the gap line above/below).
 */
function betweenBlocksBarRect(
  dom: HTMLElement,
  blockRect: DOMRect,
  insertBefore: boolean,
  isTopLevelSibling: boolean,
): ViewportRect {
  const barY = insertBefore ? blockRect.top : blockRect.bottom;
  let barLeft: number;
  let barWidth: number;
  if (isTopLevelSibling) {
    barLeft = blockRect.left;
    barWidth = blockRect.width;
  } else {
    const span = contentSpanFor(dom);
    barLeft = span.left;
    barWidth = span.width;
  }
  return {
    x: barLeft,
    y: barY - 1,
    // Floor the span above the 2px bar height so a (theoretical) zero-width
    // content box can't flip the indicator vertical (Indicator: height>width ⇒
    // vertical); real laid-out blocks are hundreds of px, so it never bites.
    width: Math.max(barWidth, 3),
    height: 2,
  };
}

function makeParagraphSidePlacement(
  editor: Editor,
  block: AnchorableBlockInfo,
  cursorX: number,
  // See makeBetweenBlocksPlacement — hitTest's classification read, threaded.
  preReadRect?: DOMRect,
): Placement {
  const blockRect = preReadRect ?? block.dom.getBoundingClientRect();
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

/**
 * The ONE chokepoint every inline-cursor drop resolves its landing through — so
 * the container question is asked HERE (task 414), where it answers for all
 * seven splice sites at once AND in the affordance rather than only at the
 * commit. "What the hover OFFERS is what the commit ACCEPTS" (tasks 258 / 321 /
 * 332): a gate at each splice alone would leave the indicator lighting a caret
 * inside a `codeBlock` / `latexComment` that the release then silently refuses,
 * which is the false-affordance class this subsystem's own guardrails outlaw.
 *
 * `inlinePayload` is the session's answer, resolved once at `beginDropSession`;
 * an empty payload is plain text, which every textblock hosts, so nothing is
 * refused for it.
 */
function makeInlineCursorPlacement(
  editor: Editor,
  pos: number,
  inlinePayload: InlineDropPayload,
): Placement | null {
  if (!inlineCursorHostsPayload(editor, pos, inlinePayload)) return null;
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
  // Colon-safe: extract the bare id via the shared parser. The float grammar
  // (`float:<domain>:<kind>:<id>`) and the legacy grammars all carry interior
  // colons — hand-slicing the first colon yields `card:<kind>:<id>` and never
  // matches the `data-pristine-card-id`.
  const sourceId = parseAnyKey(sourceCardKey)?.id;
  if (!sourceId) return false;
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
