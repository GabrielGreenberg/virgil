/**
 * BlockAddress — how a SNAPSHOT-derived surface names a LIVE top-level block
 * across an async gap (task 285, the T3 residual).
 *
 * THE CLASS
 * The Outline renders from a debounced `content` snapshot and calls back on a
 * user gesture — a click, a drop — that lands one or more frames later. Between
 * the render that produced the row and the gesture that consumed it, a
 * concurrent writer (Gabriel typing a block insert/delete, an AI
 * `apply_response`, a second Virgil window) can add or remove a top-level block
 * ABOVE the target. Every integer top-level index below the edit shifts, so a
 * gesture that names its target by index addresses the WRONG block: the reorder
 * moves a different section, the click scrolls to a different heading, the focus
 * band lands on different prose. Nothing throws; the document is well-formed
 * afterwards; only the content is wrong.
 *
 * T3/W3a fixed exactly this for rename / parTitle / label by addressing the
 * durable block `uuid` (`editStructuredNodeByUuid`, [structural-edit.ts]).
 * Reorder, scroll and the focus-band writes never made that migration. This
 * module is the vocabulary the whole Outline callback boundary now speaks, so
 * the addressing model is ONE scheme rather than two.
 *
 * THE RULES, and why each is the way it is:
 *
 *  1. **A HYDRATED address resolves by uuid, and ONLY by uuid.** If the uuid is
 *     no longer in the document — a concurrent writer deleted the block — the
 *     resolve REFUSES (`null`) and the caller no-ops. It never falls back to the
 *     snapshot index, because that index is precisely the mis-address this
 *     module exists to prevent: falling back would turn "the thing you clicked
 *     is gone" into "so here is a different one."
 *
 *  2. **An UNHYDRATED address (uuid still null) falls back to its snapshot
 *     index**, bounds-checked. Block uuids are minted at load (`assignUuids`) and
 *     at insertion (`BlockUuidBackfill`), so this is the rare pre-hydration
 *     window — and the same graceful degradation the rename path chose: an
 *     un-addressable row stays usable rather than becoming a dead control.
 *
 *  3. **A span's EXTENT is re-derived live, never carried.** A heading pod owns
 *     its whole section, and the snapshot's `blockCount` is stale in exactly the
 *     same way its `blockIndex` is — worse, it is stale under an edit INSIDE the
 *     section, which no amount of correct index addressing would catch. So a
 *     `section: true` address carries no count at all: `resolveBlockSpan` reads
 *     the live doc and walks to the next heading of same-or-higher level, the
 *     same rule `buildPods` applies to the snapshot. A block inserted into the
 *     section travels with it; a deleted one is simply not there.
 *
 * Cost: O(top-level block count) per resolve, on a human-paced structural
 * action (a click, a drop) — never on the keystroke path. Nothing here
 * subscribes to the editor.
 */

import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * The sentinel `blockIndex` meaning "the very top of the document" for
 * `EditorHandle.scrollToHeading`. Spelled once here because the producer
 * (the Outline's Document-start row, the paragraph-nav `__DOC_TOP__` branch)
 * and the consumer (the handle's own `=== -1` check) must agree byte-for-byte.
 */
export const DOC_START_BLOCK_INDEX = -1;

/**
 * How a snapshot-derived surface names one live top-level block.
 *
 * `uuid` is the address. `index` is what the snapshot SAW — a last-resort
 * fallback consulted only when `uuid` is null (rule 2 above), never for a
 * hydrated address.
 */
export interface BlockAddress {
  uuid: string | null;
  index: number;
}

/**
 * An address that may own a RANGE of top-level blocks.
 *
 * `section: true` means "this is a heading and it owns its whole section" —
 * the extent is re-derived from the live doc at resolve time (rule 3), so this
 * interface deliberately carries no count for a caller to keep in sync.
 */
export interface BlockSpanAddress extends BlockAddress {
  section: boolean;
}

/** A resolved span: a live top-level start index and how many blocks it owns. */
export interface ResolvedSpan {
  index: number;
  count: number;
}

/** Live top-level index of the block carrying `uuid`, or -1 when it is gone. */
export function topLevelIndexOfUuid(doc: PMNode, uuid: string): number {
  let idx = -1;
  doc.forEach((node, _offset, index) => {
    if (idx !== -1) return;
    if ((node.attrs?.uuid as string | undefined) === uuid) idx = index;
  });
  return idx;
}

/**
 * Resolve an address to a live top-level index, or `null` to REFUSE — the
 * addressed block was deleted (hydrated case), or the snapshot index is out of
 * bounds (unhydrated case).
 */
export function resolveBlockIndex(doc: PMNode, addr: BlockAddress): number | null {
  if (addr.uuid) {
    const idx = topLevelIndexOfUuid(doc, addr.uuid);
    // Rule 1: a hydrated address NEVER degrades to its index.
    return idx === -1 ? null : idx;
  }
  // Rule 2: pre-hydration positional fallback, bounds-checked.
  if (!Number.isInteger(addr.index)) return null;
  if (addr.index < 0 || addr.index >= doc.childCount) return null;
  return addr.index;
}

// ---------------------------------------------------------------------------
// "Where does a section end?" — ONE rule, two adapters
// ---------------------------------------------------------------------------

/** A heading reduced to what the section rule needs. */
export interface HeadingRef {
  index: number;
  level: number;
}

/**
 * THE section rule: a heading owns itself plus everything up to the next
 * heading of the same or a HIGHER level (or the end of the document).
 *
 * It had three copies before task 285 — `buildPods`'s `blockCount` (snapshot),
 * `sectionRange`'s heading branch (focus mode), and the live walk the reorder
 * needed — and they must agree, because the drop INDICATOR paints from the
 * snapshot copy while the drop itself uses the live one: a disagreement is a
 * line that lies about where the blocks land. So the rule lives here once, with
 * an adapter for each shape a caller has: a `(index, level)` list, or a doc.
 *
 * `headings` must be in document order. A `blockIndex` that names no heading
 * owns exactly itself.
 */
export function sectionExtentFromHeadings(
  blockIndex: number,
  headings: readonly HeadingRef[],
  totalBlocks: number,
): number {
  const hi = headings.findIndex((h) => h.index === blockIndex);
  if (hi === -1) return 1;
  const level = headings[hi].level;
  for (let i = hi + 1; i < headings.length; i++) {
    if (headings[i].level <= level) return headings[i].index - blockIndex;
  }
  return totalBlocks - blockIndex;
}

/** Every top-level heading in `doc`, in document order. */
export function collectTopLevelHeadings(doc: PMNode): HeadingRef[] {
  const out: HeadingRef[] = [];
  doc.forEach((node, _offset, index) => {
    if (node.type.name !== "heading") return;
    const level = node.attrs?.level as number | undefined;
    if (typeof level === "number") out.push({ index, level });
  });
  return out;
}

/**
 * The doc adapter of the section rule — how many top-level blocks the block at
 * `index` owns right now. A non-heading owns itself; an out-of-range index owns
 * nothing.
 */
export function sectionExtentAt(doc: PMNode, index: number): number {
  if (index < 0 || index >= doc.childCount) return 0;
  return sectionExtentFromHeadings(index, collectTopLevelHeadings(doc), doc.childCount);
}

/**
 * Resolve a span address against the live doc, or `null` to refuse.
 * The extent is always derived here (rule 3); nothing is carried in.
 */
export function resolveBlockSpan(doc: PMNode, addr: BlockSpanAddress): ResolvedSpan | null {
  const index = resolveBlockIndex(doc, addr);
  if (index == null) return null;
  return { index, count: addr.section ? sectionExtentAt(doc, index) : 1 };
}
