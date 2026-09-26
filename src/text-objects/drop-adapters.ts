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
// The ONE wrap-vs-direct ladder, shared by every adapter that can fabricate a
// container (task 234).
// ---------------------------------------------------------------------------
//
// Every such adapter answers the same question — "this kind was released HERE:
// does it go in bare, go in wrapped, or not at all?" — and before this they
// answered it from two different sources of truth. `blockIntoExpexDropAdapter`
// asked the SCHEMA at the true immediate insert parent (`canDropDirect`, A2);
// the two sub-item adapters asked `classifyParentAt`'s `isCompatibleParent`
// verdict, which is a LOSSY PROXY: it reports the nearest REGISTERED
// `TextObjectKind`, so an unregistered structural container between the insert
// point and that ancestor is skipped and two structurally different positions
// collapse onto one answer.
//
// That is not a cosmetic difference. `exampleItemList` is unregistered, so at a
// NESTED xlist tier (`exampleItem > exampleItemList > exampleItem`, which the
// real schema permits and the Tab/`sinkListItem` keymap makes reachable) the
// walk-up lands on the enclosing `exampleItem` instead of the `exampleBlock`,
// `isCompatibleParent("exampleItem","exampleItem")` is false, and
// `exampleItemDropAdapter` fell through to its wrap branch — where task 065's
// gate correctly refuses a fresh `exampleBlock` inside an `exampleItemList`, so
// the drop SILENTLY NO-OPED while the hit-test happily painted an indicator
// there. All the while the schema at the true immediate parent (content
// `exampleItem+`) accepted the bare item. Lists never hit this because their
// intermediary (`bulletList`) is itself registered AND compatible.
//
// So the FIRST question is the schema's, for every adapter (rung 1), and the
// proxy survives only as a fallback for the positions the schema signal cannot
// settle. The rungs, in order:
//
//   1. the TRUE immediate parent accepts a bare node of this kind → `direct`;
//   2. it REFUSES the bare node, but the wrapper this adapter would fabricate
//      is valid here → `wrap` (the task-065 `canPlaceHere` gate — the wrap is
//      what would otherwise make ProseMirror split the container);
//   3. the lossy proxy says the enclosing REGISTERED container welcomes this
//      kind → `direct`, handing the exact shape to the container-fit SSOT
//      (`fitNodesAtInsert`), which can still wrap or pad or refuse. This is
//      what keeps an `exampleItem` released in a SINGLE example's widened body
//      landing: the body rejects a bare item (rung 1 no) and cannot hold an
//      `exampleBlock` (rung 2 no), yet the fit places it inside the block;
//   4. no evidence either way → `unproven`, the adapter's own default. A
//      sub-item wraps (it cannot live bare where nothing welcomed it) and then
//      no-ops if its gate refuses that wrap; a BLOCK drops direct (a block is a
//      legitimate citizen of every position that takes blocks), which is why
//      `blockIntoExpexDropAdapter` never returns `no-op`.
//
// Rungs 2–4 are the pre-234 behaviour of all three adapters, case for case;
// rung 1 is the new first move and the whole of the fix. `canDropDirect` /
// `canPlaceHere` are OPTIONAL on `DropTarget`, so an isolated caller that
// supplies neither gets exactly the pre-065 answer (rungs 3–4).

type UnprovenPolicy = "wrap" | "drop-direct";

function resolveWrapOrDirect(
  target: DropTarget,
  wrapKind: TextObjectKind,
  unproven: UnprovenPolicy,
): DropAction {
  // 1 — the schema at the TRUE immediate insert parent, asked FIRST.
  if (target.canDropDirect === true) return { kind: "drop-direct" };
  // 2 — it refuses the bare node: wrap iff the fabricated wrapper belongs here.
  if (target.canDropDirect === false && target.canPlaceHere?.(wrapKind)) {
    return { kind: "wrap", parentKind: wrapKind };
  }
  // 3 — the proxy, as a fallback: let the container-fit SSOT settle the shape.
  if (target.kind === "inside-compatible-parent") return { kind: "drop-direct" };
  // 4 — no evidence.
  if (unproven === "drop-direct") return { kind: "drop-direct" };
  return target.canPlaceHere && !target.canPlaceHere(wrapKind)
    ? { kind: "no-op" }
    : { kind: "wrap", parentKind: wrapKind };
}

// ---------------------------------------------------------------------------
// listItem — wraps into a fresh single-item list when dropped outside a
// compatible list. The wrap kind comes from the source's context, NOT
// from a hardcoded default — a bullet listItem wraps into bulletList,
// an ordered listItem wraps into orderedList. Cross-list drops (bullet
// into ordered) land directly (the target accepts the item as-is).
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
  // The wrap kind is the source's own list kind, so an ordered item pulled out
  // rebuilds an ordered list. Default to bulletList if source context didn't
  // carry one (shouldn't happen in practice, but defensive).
  const wrapKind =
    sourceRef.sourceContext.parentKind === "orderedList"
      ? "orderedList"
      : "bulletList";
  return resolveWrapOrDirect(target, wrapKind, "wrap");
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
//
// Task 234 — this is the adapter the shared ladder's rung 1 was written for:
// the NESTED xlist tier is a position where the proxy says "incompatible" and
// the schema says "yes, bare". See `resolveWrapOrDirect` above.
// ---------------------------------------------------------------------------

export function exampleItemDropAdapter(
  _sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
  target: DropTarget,
): DropAction {
  return resolveWrapOrDirect(target, "exampleBlock", "wrap");
}

// ---------------------------------------------------------------------------
// EXPEX_INNER_KINDS — the ONE source of truth for the block kinds that may land
// inside an expex example. This restates the schema fact that an `exampleItem`'s
// content is `(paragraph | graphicsBlock | displayMath)+` (expex.ts, the true
// root) — text, picture, equation. Every place that gates the into-example drop
// derives from THIS set, never a hand-kept parallel literal:
//   • `isCompatibleParent` (text-object-registry.ts) consumes it, and
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
//
// Task 234 — this adapter's schema-first shape BECAME the shared ladder
// (`resolveWrapOrDirect`): it is that ladder at `unproven: "drop-direct"`, which
// reproduces its every case. A block is a legitimate citizen of any position
// that takes blocks, so this adapter never returns `no-op`; the sub-item
// adapters, whose payload cannot live bare outside its own container kind, pass
// `"wrap"` and reach `no-op` when their gate refuses the wrap.
// ---------------------------------------------------------------------------

export function blockIntoExpexDropAdapter(
  _sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
  target: DropTarget,
): DropAction {
  return resolveWrapOrDirect(target, "exampleItem", "drop-direct");
}

// ---------------------------------------------------------------------------
// Compatibility check (`isCompatibleParent`) lives in text-object-registry.ts
// since task 743: the sub-object half is the registry's `parentKinds` facet,
// and the registry imports THIS module, so the reader sits on that side.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wrap construction — build a fresh single-item parent of `parentKind`
// containing `sourceNode`. Called by the drop spec when the adapter
// returns `{ kind: "wrap", parentKind }`. Lives here (not in the spec)
// so the wrap shape stays co-located with the adapter that produced it.
//
// Every level is built with `createChecked`, so a wrap whose content the
// wrapper CANNOT hold throws instead of fabricating a schema-invalid node.
// That is what makes `tryBuildWrap` (below) a DERIVED capability test rather
// than a hand-kept table of "which wrapper accepts which child": the answer
// comes from attempting the real construction, so it can never drift from what
// this function actually builds (the `exampleBlock` case, which interposes an
// `exampleItemList`, is exactly the shape a naive `wrapperType.validContent`
// check would get wrong).
//
// Task 776: the kinds a drop may WRAP with are not listed here — they are
// derived from the registry's `parentKinds` facet (`WRAP_TARGET_KINDS`,
// container-fit.ts). This switch is the CONSTRUCTION half; the vocabulary
// parity test (container-fit-vocabulary.test.ts) fails when the registry
// declares a sub-object/container pair this switch cannot build.
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
      return parent.createChecked({ uuid: newUuid }, [sourceNode]);
    }
    case "exampleBlock": {
      const itemList = schema.nodes.exampleItemList;
      const block = schema.nodes.exampleBlock;
      if (!itemList || !block) {
        throw new Error(
          "buildWrap: schema missing exampleBlock or exampleItemList",
        );
      }
      const inner = itemList.createChecked({}, [sourceNode]);
      return block.createChecked({ uuid: newUuid }, [inner]);
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
      return item.createChecked({ uuid: newUuid }, [sourceNode]);
    }
    case "listItem": {
      const item = schema.nodes.listItem;
      if (!item) {
        throw new Error('buildWrap: schema has no node "listItem"');
      }
      // The list twin of the exampleItem case: the enclosing bulletList /
      // orderedList already exists at the insert site, so a block joining a
      // list needs only the fresh item around it. This case exists because the
      // between-blocks range move used to build it inline (`listItem.create`)
      // as the ONLY context it knew how to fit — folding it in here is what
      // lets `fitNodeInContainer` answer for lists and expex from one
      // vocabulary. Fresh uuid, matching every other wrap.
      return item.createChecked({ uuid: newUuid }, [sourceNode]);
    }
    default:
      throw new Error(
        `buildWrap: parentKind "${parentKind}" is not a wrap target`,
      );
  }
}

/**
 * Build `buildWrap`'s wrapper, or null when this wrapper cannot hold the node.
 * The capability is DERIVED from the construction (see `buildWrap` above), so a
 * wrapper whose real shape interposes another node — `exampleBlock`, which
 * wraps through an `exampleItemList` — is answered correctly without a second,
 * driftable description of that shape.
 */
export function tryBuildWrap(
  schema: Schema,
  sourceNode: PMNode,
  parentKind: TextObjectKind,
): PMNode | null {
  try {
    return buildWrap(schema, sourceNode, parentKind);
  } catch {
    return null;
  }
}
