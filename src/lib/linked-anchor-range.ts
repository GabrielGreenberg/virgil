/**
 * Shared `linkedAnchor` range helpers.
 *
 * `findLinkedAnchorRange` — the single resolver for "the bounding doc range
 * a `linkedAnchor` mark covers." Extracted from `linked-range-body.tsx`
 * (L3f-2) so the bidirectional float, the `linkedRange` lift-overlay hooks
 * (`renderGhost` / `liftSourceRect` in `text-object-registry.ts`), and the
 * `text-range-move` drop spec all resolve a marked range one way — no copies.
 *
 * `stripLinkedAnchorMarks` — remove `linkedAnchor` marks from a slice's text,
 * mirroring `LinkedAnchorGuard.transformPasted`
 * (src/lib/tiptap/linked-anchor.ts): a PASTED run must not carry any anchor
 * identity (a paste is a COPY — a second live id would collide). AnchorIds mint
 * exactly once at hydration; copies do not propagate identity.
 *
 * `moveSliceOf` — the payload of a MOVE, which is the opposite case (task
 * 1023): "a move conserves identity; a split mints it" (task 320). Every REAL
 * anchor the range wholly contains travels with its words; only the gesture's
 * own transient handle, and any anchor the range only partly holds, are shed.
 *
 * `rangeSliceToBlocks` — the range→block-nodes form shared by the float
 * (`sliceAsDoc`) and the `text-range-move` between-paragraphs drop (L3f-3):
 * an inline run becomes one paragraph, a multi-block range keeps its blocks.
 * One transform, no parallel logic.
 *
 * `blocksToRangeSlice` — the named INVERSE of `rangeSliceToBlocks` (L3f-7):
 * given the live doc, a tracked text-bounded range, and the (edited) block
 * nodes from a float, it builds the `Slice` for `tr.replace(from, to, slice)`
 * so write-back is the faithful inverse of the seed extraction (reusing the
 * cut's open depths) instead of forcing a closed-block `replaceWith` that
 * splits the boundary paragraphs / wraps an extra list. `text-range-move.ts`
 * already follows this open-slice discipline (its inline-cursor move inserts
 * the open `doc.slice(from,to)` via `tr.replace`); `blocksToRangeSlice`
 * codifies it for the same-range write-back, which was the lone outlier.
 */

import { Fragment, Slice } from "@tiptap/pm/model";
import type { MarkType, Node as PMNode, Schema } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { resolveTouchedAnchor } from "@/lib/tiptap/doc-structure/observer-plugin";

/**
 * THE single anchor-range walker for the whole codebase. Walk the doc for text
 * nodes carrying a `linkedAnchor` (or, if `markType` is given, that exact mark)
 * with the matching `anchorId`, and return the BOUNDING range
 * `[firstMarkedStart, lastMarkedEnd)`.
 *
 * The bounding span is deliberately the FULL extent even when the marked text
 * is INTERRUPTED: a highlight/note/cutter/revision over `"text \cite{x} more"`
 * is stored as two marked runs (before/after the inline atom) sharing one
 * `anchorId`, and a cross-block Highlight marks a run in every block it spans.
 * Any unmarked interior gap (e.g. the atom, or a paragraph break) is included —
 * which is correct for every caller: `unsetMark` over the span only clears
 * where the mark is actually present, and jump-to / source-range / reanchor
 * want the full extent. Returning only the first contiguous run truncated
 * atom-split and cross-block anchors, leaving a stale tint on runs 2..N when a
 * card was deleted and reading short for jump-to (task 071).
 *
 * SSOT: `resolveTextRangeByAnchorId` (src/links/links.ts) and the drag-handle
 * range/bounds lookups fold onto this so no fourth copy can re-drift; the
 * float / lift-overlay / drop-spec / stack-snapshot / pending-change-nav paths
 * already resolved through here.
 *
 * Returns null when no text carries the mark — typically because the range
 * was deleted or the doc was reloaded before sidecar reanchoring restored it.
 */
export function findLinkedAnchorRange(
  doc: PMNode,
  anchorId: string,
  markType?: MarkType,
  within?: { from: number; to: number },
): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  const visit = (node: PMNode, pos: number): boolean => {
    if (!node.isText) return true;
    const hasMark = node.marks.some(
      (m) =>
        (markType ? m.type === markType : m.type.name === "linkedAnchor") &&
        m.attrs.anchorId === anchorId,
    );
    if (hasMark) {
      if (from === -1) from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  };
  if (within) {
    // BOUNDED walk (task 700): a caller that already knows roughly where the
    // mark lives — the DocStructure snapshot's mapped `anchors` entry — pays
    // O(range), not O(doc). Same predicate, same bounding rule.
    const lo = Math.max(0, Math.min(within.from, doc.content.size));
    const hi = Math.max(lo, Math.min(within.to, doc.content.size));
    doc.nodesBetween(lo, hi, visit);
  } else {
    doc.descendants(visit);
  }
  if (from === -1) return null;
  return { from, to };
}

/**
 * THE live-editor door (task 926): the bounding range of `anchorId`'s
 * `linkedAnchor` mark in `state`, resolved through the DocStructure snapshot
 * so the walk is O(range), never O(doc). Every caller holding an editor state
 * — and every caller on an `update` / `transaction` / render / scroll path —
 * resolves here; the bare `findLinkedAnchorRange(doc, id)` form is for
 * doc-only one-shot gestures (census: `linked-anchor-range-bound-census.test.ts`).
 *
 *   - observer present, id absent → null with no walk (the anchors table is
 *     authoritative for membership — the `hasLiveAnchor` contract);
 *   - observer present, id present → bounded walk over the entry's live
 *     (deferred-map-resolved) span, without materializing the snapshot;
 *   - no observer (a bare test/stand-in editor) → the full walk, the only
 *     honest answer there.
 * A bounded miss on a present entry would mean the snapshot drifted from the
 * doc; it falls back to the full walk rather than report a live mark gone.
 */
export function resolveLinkedAnchorRange(
  state: EditorState,
  anchorId: string,
): { from: number; to: number } | null {
  const entry = resolveTouchedAnchor(state, anchorId);
  if (entry === undefined) return findLinkedAnchorRange(state.doc, anchorId);
  if (entry === null) return null;
  return (
    findLinkedAnchorRange(state.doc, anchorId, undefined, entry) ??
    findLinkedAnchorRange(state.doc, anchorId)
  );
}

/**
 * The LIVE text under a `linkedAnchor` mark — what the passage says NOW, read
 * the same way the create path captured its `textSnapshot`
 * (`doc.textBetween(from, to, " ")` over the mark's bounding range), so a live
 * read and a stored snapshot are the same currency and compare equal when
 * nothing was edited.
 *
 * Task 700: the snapshot is the RECOVERY key `reanchorByText` searches with
 * when the mark is lost — never display text. A surface that shows "the
 * highlighted words" reads HERE (through `useLinkedAnchorText`), and the load
 * reconcile refreshes the stored snapshot from here so recovery searches
 * current text. `within` bounds the walk (see `findLinkedAnchorRange`).
 * Returns null when no text carries the mark.
 */
export function readLinkedAnchorText(
  doc: PMNode,
  anchorId: string,
  within?: { from: number; to: number },
): string | null {
  const range = findLinkedAnchorRange(doc, anchorId, undefined, within);
  return range ? doc.textBetween(range.from, range.to, " ") : null;
}

/**
 * Return a copy of `slice` with its `linkedAnchor` marks removed from its text
 * nodes (recursively, preserving open depths + all other marks). The rebuild
 * mirrors `LinkedAnchorGuard.transformPasted` exactly. With no `keep`, EVERY
 * anchor is shed — the paste / copy semantics. `keep` names the anchor ids
 * that survive; `moveSliceOf` is the one caller that passes it.
 */
export function stripLinkedAnchorMarks(
  slice: Slice,
  keep?: ReadonlySet<string>,
): Slice {
  const shed = (m: { type: { name: string }; attrs: Record<string, unknown> }) =>
    m.type.name === "linkedAnchor" &&
    !(keep && keep.has(m.attrs.anchorId as string));
  const rebuild = (frag: Fragment): Fragment => {
    const out: PMNode[] = [];
    frag.forEach((n) => {
      if (n.isText) {
        const filtered = n.marks.filter((m) => !shed(m));
        out.push(filtered.length === n.marks.length ? n : n.mark(filtered));
      } else {
        out.push(n.copy(rebuild(n.content)));
      }
    });
    return Fragment.fromArray(out);
  };
  return new Slice(rebuild(slice.content), slice.openStart, slice.openEnd);
}

/**
 * The payload of MOVING `[from, to)` within `state`'s document (task 1023).
 *
 * A move is not a paste. A paste is a COPY: the source keeps its anchor, so a
 * second live id would collide, and `stripLinkedAnchorMarks` sheds them all. A
 * move DELETES the source — so an anchor stripped from the payload exists
 * nowhere afterwards, `LinkedAnchorGuard` reports it vanished, and every card
 * hook PERMANENTLY unlinks its note / highlight / cut / revision from the very
 * words the user moved. This is task 320's "a move conserves identity; a split
 * mints it", stated for mark anchors:
 *
 *  • a REAL anchor whose whole extent lies inside the range TRAVELS — the move
 *    takes all of it, so its id stays unique and the card follows its words;
 *  • a TRANSIENT anchor (`kind: "transient"`, the plain grab's own cardless
 *    handle) is shed — it is gesture scaffolding, not an annotation;
 *  • a real anchor the range only PARTLY holds is shed from the payload and
 *    keeps its id on the residue left at the source. Carrying it would make one
 *    id answer to two separated runs. (`hydrateSelectionToTextObject` refuses a
 *    selection that partly overlaps an anchor, and the range a grab moves is the
 *    hydrated anchor's own bounding range — but that range is BOUNDING, so a
 *    discontinuous anchor's gap can hold the edge of a third one. Asked, not
 *    assumed.)
 *
 * `travelling` is the set of real ids the payload carries. A caller moving the
 * slice into a DIFFERENT document must ask it: an anchor id means nothing
 * there, so such a move can neither carry the id nor drop it without orphaning
 * the card.
 *
 * Cost: O(range) to collect the ids, plus one `resolveLinkedAnchorRange` per
 * distinct real id (O(that anchor's range) through the DocStructure snapshot).
 */
export function moveSliceOf(
  state: EditorState,
  from: number,
  to: number,
): { slice: Slice; travelling: ReadonlySet<string> } {
  const real = new Set<string>();
  state.doc.nodesBetween(from, to, (n) => {
    if (!n.isText) return true;
    for (const m of n.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      if (m.attrs.kind === "transient") continue;
      const id = m.attrs.anchorId;
      if (typeof id === "string" && id) real.add(id);
    }
    return false;
  });
  const travelling = new Set<string>();
  for (const id of real) {
    const extent = resolveLinkedAnchorRange(state, id);
    if (extent && extent.from >= from && extent.to <= to) travelling.add(id);
  }
  return {
    slice: stripLinkedAnchorMarks(state.doc.slice(from, to), travelling),
    travelling,
  };
}

/**
 * Convert a marked range's slice into block-level PM nodes — the shared
 * range→blocks form behind BOTH the `linked-range-body` float (`sliceAsDoc`)
 * and the `text-range-move` between-paragraphs drop (L3f-3). One transform,
 * no parallel logic (the same DRY move as `findLinkedAnchorRange` /
 * `stripLinkedAnchorMarks`).
 *
 * Policy: a slice cut INSIDE one text block comes through as bare inline
 * content → wrap it in a single `paragraph` so the run becomes its own
 * block; a slice that already spans whole blocks comes through as block
 * children → keep them as siblings; an empty slice → one empty paragraph.
 * New paragraphs carry default attrs (uuid null, minted lazily like any
 * freshly-created block). Which anchors the blocks carry is the caller's
 * concern — the float keeps them all; the move builds its slice through
 * `moveSliceOf`, which sheds the transient handle and keeps every real anchor
 * it wholly holds.
 */
export function rangeSliceToBlocks(slice: Slice, schema: Schema): PMNode[] {
  const children: PMNode[] = [];
  slice.content.forEach((n) => children.push(n));
  if (children.some((c) => c.isInline)) {
    return [schema.nodes.paragraph.create(null, slice.content)];
  }
  return children.length > 0 ? children : [schema.nodes.paragraph.create()];
}

/**
 * Inverse of `rangeSliceToBlocks` (L3f-7): given the live main `doc`, the
 * tracked text-bounded `range`, and the (possibly edited) block nodes read
 * back from a float, build the `Slice` to hand to `tr.replace(from, to, slice)`
 * so a float write-back is the FAITHFUL INVERSE of the seed extraction.
 *
 * Why this is needed. `findLinkedAnchorRange` returns TEXT-bounded positions,
 * so `[from,to)` is usually mid-paragraph and `doc.slice(from,to)` is an OPEN
 * cut (openStart/openEnd > 0). The forward seed kept a multi-block range's
 * blocks and WRAPPED a within-one-textblock run in a single paragraph. To
 * invert, the replacement must re-open with the SAME depths (block range) or
 * unwrap that single paragraph (inline range). Replacing with FULLY-CLOSED
 * blocks instead (`tr.replaceWith`, which builds a Slice with
 * openStart=openEnd=0) forces ProseMirror's fitter to split the boundary
 * paragraphs and, when the range touches a list, wrap an extra list — the
 * L3f-7 artifact. Reusing the cut's open depths makes an UNEDITED round-trip
 * byte-identical (`tr.doc.eq(doc)`) and an EDITED one land exactly the edit
 * with the boundary paragraphs preserved.
 *
 * `text-range-move.ts` already follows this discipline (its inline-cursor move
 * inserts the open `doc.slice(from,to)` via `tr.replace`); write-back was the
 * lone outlier. O(range-size): `doc.slice(from,to)` is O(range), never a doc
 * walk.
 */
export function blocksToRangeSlice(
  doc: PMNode,
  range: { from: number; to: number },
  blocks: PMNode[],
): Slice {
  const cut = doc.slice(range.from, range.to);
  // Mirror `rangeSliceToBlocks`' inline branch: a cut WITHIN one text block
  // arrives as bare inline content, which the forward wrapped in ONE paragraph.
  // Unwrap that single paragraph so the replacement re-opens as bare inline
  // (openStart = openEnd = 0) exactly as the cut produced — no boundary split.
  const cutInline =
    cut.content.childCount > 0 && cut.content.child(0).isInline;
  if (cutInline && blocks.length === 1 && blocks[0].type.name === "paragraph") {
    return new Slice(blocks[0].content, 0, 0);
  }
  // Block range (multi-block, including lists, or a boundary-aligned whole-block
  // cut): re-apply the cut's open depths so the boundary paragraphs MERGE back
  // into the surrounding text instead of splitting, and a touched list isn't
  // re-wrapped. CLAMP each depth to what the edited blocks can actually support
  // (`Slice.maxOpen`): a float edit may restructure the leading/trailing block
  // (e.g. add a paragraph after a list whose tail the cut opened 3 deep) so it
  // no longer opens as deep as the original cut — an unclamped `Slice` would be
  // malformed and `tr.replace` would throw, silently dropping the write-back
  // (losing the edit). For an unedited or structure-preserving edit the blocks
  // open at least as deep as the cut, so the clamp is a no-op and the
  // round-trip stays byte-identical.
  const content = Fragment.from(blocks);
  const maxOpen = Slice.maxOpen(content);
  return new Slice(
    content,
    Math.min(cut.openStart, maxOpen.openStart),
    Math.min(cut.openEnd, maxOpen.openEnd),
  );
}
