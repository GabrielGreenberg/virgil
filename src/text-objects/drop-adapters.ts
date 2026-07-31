/**
 * Drop adapter — given a source TextObject (with its source context)
 * and the drop site's target context, decides whether to drop the node
 * directly or wrap it in a fresh single-item parent of the right kind.
 *
 * Why this lives in the registry, not scattered switches:
 * Today drop behavior for each block source kind is a per-case switch
 * in `src/components/drop-mode/specs/`. After the refactor, the wrap/
 * no-wrap decision is a function in the registry entry — one shape for
 * every kind. Adding a new sub-object kind = one entry in the registry,
 * no per-spec edits.
 *
 * See TEXT-OBJECT-REFACTOR.md §8.
 */

import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { generateShortId } from "@/lib/uuid";
import type {
  DropAction,
  DropTarget,
  TextObjectKind,
  TextObjectRef,
  TextObjectSourceContext,
} from "./types";

// ---------------------------------------------------------------------------
// Default adapter for top-level kinds — drop directly, no wrapping.
// Reserved for future opt-in (e.g. dropping a paragraph into a listItem's
// content might wrap into a fresh paragraph; not implemented today since
// it's out of scope per memo §8).
// ---------------------------------------------------------------------------

export function topLevelDropAdapter(
  _sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
  _target: DropTarget,
): DropAction {
  return { kind: "drop-direct" };
}

// ---------------------------------------------------------------------------
// listItem — wraps into a fresh single-item list when dropped outside a
// compatible list. The wrap kind comes from the source's context, NOT
// from a hardcoded default — a bullet listItem wraps into bulletList,
// an ordered listItem wraps into orderedList. Cross-list drops (bullet
// into ordered) are "compatible parent" today (target accepts the item
// as-is).
//
// Task 065 — shares the `canPlaceHere` wrap-validity gate with the two other
// wrap adapters below. It no-ops (rejects) the drop when the fresh list would
// be invalid at the TRUE immediate insert parent, instead of fabricating a
// splitting insert (see `DropTarget.canPlaceHere`).
// ---------------------------------------------------------------------------

export function listItemDropAdapter(
  sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
  target: DropTarget,
): DropAction {
  if (target.kind === "inside-compatible-parent") {
    // Inside a bulletList or orderedList — the target accepts the item
    // directly. Cross-list drops (bullet → ordered) get re-parented to
    // the target kind by ProseMirror's content rules.
    return { kind: "drop-direct" };
  }
  // Anywhere else: wrap into a fresh list of the source's parent kind.
  // Default to bulletList if source context didn't carry one (shouldn't
  // happen in practice, but defensive).
  const wrapKind =
    sourceRef.sourceContext.parentKind === "orderedList"
      ? "orderedList"
      : "bulletList";
  // The shared gate: `classifyParentAt` collapses distinct positions onto the
  // same registered ancestor, so "inside-incompatible-parent" alone does NOT
  // prove the fresh list is schema-valid at the immediate parent. Dropping a
  // listItem into a foreign container's item gap (a multi-item `exampleBlock`,
  // immediate parent `exampleItemList` with content `exampleItem+`) would
  // otherwise wrap into a `bulletList` that is invalid there — ProseMirror
  // splits the container to fit it, tearing one example into two with a
  // DUPLICATE uuid. Wrap only when the fresh list actually fits here; else
  // reject. (Omitted predicate → keep the pre-065 wrap for isolated callers.)
  if (target.canPlaceHere && !target.canPlaceHere(wrapKind)) {
    return { kind: "no-op" };
  }
  return { kind: "wrap", parentKind: wrapKind };
}

// ---------------------------------------------------------------------------
// exampleItem — always wraps into a fresh exampleBlock when dropped
// outside an existing one. The exampleBlock schema requires items to
// sit inside an `exampleItemList` wrapper; the wrap step constructs the
// full envelope (exampleBlock > exampleItemList > exampleItem).
//
// Task 065 — the symmetric guard to `listItemDropAdapter`: it no-ops the drop
// when the fresh `exampleBlock` would be invalid at the TRUE immediate insert
// parent. Dropping an exampleItem into a foreign container's item gap (a
// multi-item `bulletList`, immediate parent `bulletList` with content
// `listItem+`) would otherwise fabricate an `exampleBlock` invalid there —
// splitting the list into two both keeping one uuid. Shares the same
// `canPlaceHere` gate.
// ---------------------------------------------------------------------------

export function exampleItemDropAdapter(
  _sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
  target: DropTarget,
): DropAction {
  if (target.kind === "inside-compatible-parent") {
    return { kind: "drop-direct" };
  }
  if (target.canPlaceHere && !target.canPlaceHere("exampleBlock")) {
    return { kind: "no-op" };
  }
  return { kind: "wrap", parentKind: "exampleBlock" };
}

// ---------------------------------------------------------------------------
// EXPEX_INNER_KINDS — the ONE source of truth for the block kinds that may land
// inside an expex example. This restates the schema fact that an `exampleItem`'s
// content is `(paragraph | graphicsBlock | displayMath)+` (expex.ts, the true
// root) — text, picture, equation. Every place that gates the into-example drop
// derives from THIS set, never a hand-kept parallel literal:
//   • the `isCompatibleParent` if-chain below consumes it (`kind ∈ set`), and
//   • `hit-test.ts` imports it as its `EXPEX_DROP_KINDS` gate.
// The registry facet `dropAdapter === blockIntoExpexDropAdapter` is the natural
// SSOT for the SAME fact; the registry imports THIS module (cycle), so it cannot
// derive the set at runtime — instead a parity test pins this set against that
// facet (drop-adapters.test.ts) so a future registry edit and the drop machinery
// can never disagree. Adding a 4th expex-inner kind is then: widen the expex.ts
// union + set that kind's registry `dropAdapter` + add it here, and the parity
// test enforces the last two agree. Mirrors the shipped
// `MEANINGFUL_BLOCK_ATOM_NODE_NAMES` derivation (drag-handle-actions.ts).
// ---------------------------------------------------------------------------

export const EXPEX_INNER_KINDS: ReadonlySet<TextObjectKind> =
  new Set<TextObjectKind>(["paragraph", "graphicsBlock", "displayMath"]);

// ---------------------------------------------------------------------------
// blockIntoExpex — the unified "land a block inside an expex example" adapter
// (Feature A1, generalizing A0's graphics-only `graphicsBlockDropAdapter`;
// Feature A2 makes the decision schema-driven). Shared by the three block kinds
// the expex drop welcomes — paragraph (text), graphicsBlock (picture),
// displayMath (equation) — each schema-valid inside an exampleItem AND (A2) a
// single example's widened body (expex.ts). The body is kind-agnostic.
//
// The decision is now SCHEMA-DRIVEN via `target.canDropDirect` (the spec's
// `canDropDirectAt` = whether the IMMEDIATE insert parent accepts a bare block
// of this kind). This replaces A1's brittle `parentKind === "exampleBlock"`
// magic string, which collapsed two structurally different positions:
//   • the multi between-items gap — immediate parent `exampleItemList`
//     (content `exampleItem+`), which REJECTS a bare block → must WRAP it in a
//     fresh single-block exampleItem [case a]; and
//   • a single example's direct body — immediate parent `exampleBlock`
//     (post-widen), which ACCEPTS the bare block → drop-direct [A2].
// `classifyParentAt` reports BOTH as `exampleBlock` (it skips the unregistered
// exampleItemList), so only the schema at the true immediate parent tells them
// apart. The wrap fires iff the bare block is REJECTED here
// (`canDropDirect === false`) AND an `exampleItem` is ACCEPTED here — the
// generalized `canPlaceHere("exampleItem")` gate (task 065; the A2 edge-fix,
// formerly the bespoke `canWrapHere` boolean). `exampleItem` is valid only
// inside an `exampleItemList`, so this is true exactly at the multi between-
// items gap [case a] — the precise wrap site. Everything else — an exampleItem
// body [case b], a single example body [A2], top level, a missing signal, OR a
// non-expex position where the bare block is rejected but an `exampleItem` is
// ALSO invalid (e.g. a `displayMath` at a `listItem`'s index 0) — drops
// directly, preserving each kind's non-expex placement byte-for-byte (that last
// case restores A1's drop-direct instead of fabricating a here-invalid
// exampleItem). `buildWrap`'s exampleItem case builds the single sibling; the
// enclosing exampleItemList already exists at the insert site. figureBlock /
// texBlock stay on `topLevelDropAdapter` (user decision: text/picture/equation
// only). `canPlaceHere` is now the ONE wrap-validity gate shared with the two
// sub-object adapters above (task 065).
// ---------------------------------------------------------------------------

export function blockIntoExpexDropAdapter(
  _sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
  target: DropTarget,
): DropAction {
  if (target.canDropDirect === false && target.canPlaceHere?.("exampleItem")) {
    return { kind: "wrap", parentKind: "exampleItem" };
  }
  return { kind: "drop-direct" };
}

// ---------------------------------------------------------------------------
// Compatibility check — does this parent kind accept this sub-object?
// Used by drop hit-testing to classify the target context before calling
// the adapter.
// ---------------------------------------------------------------------------

export function isCompatibleParent(
  childKind: TextObjectKind,
  parentKind: TextObjectKind,
): boolean {
  if (childKind === "listItem") {
    return parentKind === "bulletList" || parentKind === "orderedList";
  }
  if (childKind === "exampleItem") {
    // exampleItem's true parent is `exampleItemList`, which lives inside
    // `exampleBlock`. Drop sites typically classify by the visible
    // enclosing block, so report `exampleBlock` as compatible too.
    return parentKind === "exampleBlock";
  }
  if (EXPEX_INNER_KINDS.has(childKind)) {
    // Feature A1 — text (paragraph), picture (graphicsBlock) and equation
    // (displayMath) are each schema-valid inside an exampleItem (expex.ts,
    // `(paragraph | graphicsBlock | displayMath)+`). None is a valid DIRECT
    // child of the exampleBlock (which holds items via exampleItemList) — that
    // between-items case routes to a wrap in `blockIntoExpexDropAdapter`.
    // Reporting exampleItem-only compatibility here is gated downstream by the
    // hit-test resolver firing only inside an exampleBlock, so a paragraph
    // dropped anywhere else still classifies incompatible → drop-direct
    // (its non-expex placement, unchanged).
    return parentKind === "exampleItem";
  }
  return false;
}

// ---------------------------------------------------------------------------
// Wrap construction — build a fresh single-item parent of `parentKind`
// containing `sourceNode`. Called by the drop spec when the adapter
// returns `{ kind: "wrap", parentKind }`. Lives here (not in the spec)
// so the wrap shape stays co-located with the adapter that produced it.
// ---------------------------------------------------------------------------

export function buildWrap(
  schema: Schema,
  sourceNode: PMNode,
  parentKind: TextObjectKind,
): PMNode {
  const newUuid = generateShortId();
  switch (parentKind) {
    case "bulletList":
    case "orderedList": {
      const parent = schema.nodes[parentKind];
      if (!parent) {
        throw new Error(`buildWrap: schema has no node "${parentKind}"`);
      }
      return parent.create({ uuid: newUuid }, [sourceNode]);
    }
    case "exampleBlock": {
      const itemList = schema.nodes.exampleItemList;
      const block = schema.nodes.exampleBlock;
      if (!itemList || !block) {
        throw new Error(
          "buildWrap: schema missing exampleBlock or exampleItemList",
        );
      }
      const inner = itemList.create({}, [sourceNode]);
      return block.create({ uuid: newUuid }, [inner]);
    }
    case "exampleItem": {
      const item = schema.nodes.exampleItem;
      if (!item) {
        throw new Error('buildWrap: schema has no node "exampleItem"');
      }
      // A single sibling item — the enclosing exampleBlock + exampleItemList
      // already exist at the case-a insert site (we insert one item into the
      // list), so unlike the exampleBlock case we build only the item, not the
      // whole envelope. Fresh uuid (block-uuid backfill compatible).
      return item.create({ uuid: newUuid }, [sourceNode]);
    }
    default:
      throw new Error(
        `buildWrap: parentKind "${parentKind}" is not a wrap target`,
      );
  }
}
