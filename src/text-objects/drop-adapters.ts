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
  return { kind: "wrap", parentKind: wrapKind };
}

// ---------------------------------------------------------------------------
// exampleItem — always wraps into a fresh exampleBlock when dropped
// outside an existing one. The exampleBlock schema requires items to
// sit inside an `exampleItemList` wrapper; the wrap step constructs the
// full envelope (exampleBlock > exampleItemList > exampleItem).
// ---------------------------------------------------------------------------

export function exampleItemDropAdapter(
  _sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
  target: DropTarget,
): DropAction {
  if (target.kind === "inside-compatible-parent") {
    return { kind: "drop-direct" };
  }
  return { kind: "wrap", parentKind: "exampleBlock" };
}

// ---------------------------------------------------------------------------
// blockIntoExpex — the unified "land a block inside an expex example" adapter
// (Feature A1, generalizing A0's graphics-only `graphicsBlockDropAdapter`).
// Shared by the three block kinds the expex drop welcomes — paragraph (text),
// graphicsBlock (picture), displayMath (equation) — each schema-valid inside an
// exampleItem (`(paragraph | graphicsBlock | displayMath)+`, expex.ts). The body
// is kind-agnostic: it decides drop-direct vs. wrap purely from the TARGET
// context, so one function serves all three.
//   • inside-compatible-parent (an exampleItem) → drop the block directly into
//     that item's content, joining its existing children [case b].
//   • inside-incompatible-parent whose parent is the exampleBlock itself
//     (a between-items boundary) → wrap the block in a fresh exampleItem so it
//     becomes its own new example item [case a]. `buildWrap`'s exampleItem case
//     builds the single sibling; the enclosing exampleItemList already exists
//     at the insert site.
//   • top-level, or any OTHER incompatible parent → drop the block directly,
//     preserving each kind's original (non-expex) placement byte-for-byte.
// Generalizes R3's source-kind-aware resolution: a block lands wherever the
// schema allows it — directly, or with a single wrap. figureBlock / texBlock
// stay on `topLevelDropAdapter` (user decision: text/picture/equation only).
// ---------------------------------------------------------------------------

export function blockIntoExpexDropAdapter(
  _sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
  target: DropTarget,
): DropAction {
  if (target.kind === "inside-compatible-parent") {
    // The only compatible parent for these kinds is an exampleItem.
    return { kind: "drop-direct" };
  }
  if (
    target.kind === "inside-incompatible-parent" &&
    target.parentKind === "exampleBlock"
  ) {
    // Between example items (the exampleBlock doesn't accept a bare block as a
    // direct child) → wrap into a fresh single-block exampleItem.
    return { kind: "wrap", parentKind: "exampleItem" };
  }
  // Top-level, or any other incompatible parent → drop the block directly
  // (preserves today's top-level placement for this kind, byte-for-byte).
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
  if (
    childKind === "graphicsBlock" ||
    childKind === "paragraph" ||
    childKind === "displayMath"
  ) {
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
