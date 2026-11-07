/**
 * DocStructureObserver — step inspector
 *
 * The keystroke-critical-path function. Given a transaction and the
 * before/after documents, produce a `StructureDiff` describing what
 * structural entities (blocks, headings, footnotes, anchors, examples,
 * figures, labels) entered or left the document.
 *
 * Cost: O(edit-size). The function walks only the slices touched by
 * each step — never the whole document. Most keystrokes (typing inside
 * a paragraph) produce a diff that's empty except for one entry in
 * `contentChangedUuids`.
 *
 * See `docs/perf/keystroke-sanctity-findings.md` §4.1 for the design.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  Mapping,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
  type StepMap,
} from "@tiptap/pm/transform";
import { mayCarryBlockUuid } from "@/lib/marginalia";
import { nodesBetweenLocal } from "@/lib/tiptap/changed-ranges";
import { pickFootnoteCarriedAttrs } from "@/lib/footnote-source-attrs";
import {
  cardAtomIdOf,
  type EntitySink,
  exampleIdentityOf,
  extractEntitiesAt,
  figureEntryAt,
} from "./entity-extractor";
import { collectStructure, mapAnchorSpan, type StructureTables } from "./structure-index";
import {
  type AnchorEntry,
  type BlockEntry,
  type CitationEntry,
  type DocStructure,
  type CitationContainer,
  compareReturnedBlock,
  EMPTY_DIFF,
  type ExampleEntry,
  type FigureEntry,
  type FootnoteEntry,
  type HeadingEntry,
  isEmptyDiff,
  type LabelEntry,
  type StructureDiff,
} from "./types";

// ---------------------------------------------------------------------------
// Entity extraction from a PMNode subtree.
// ---------------------------------------------------------------------------

interface EntityBundle {
  blocks: Map<string, BlockEntry>;
  headings: Map<string, HeadingEntry>;
  footnotes: Map<string, FootnoteEntry>;
  citations: Map<string, CitationEntry>;
  anchors: Map<string, AnchorEntry>;
  examples: Map<string, ExampleEntry>;
  figures: Map<string, FigureEntry>;
  labels: Map<string, LabelEntry>;
  /** The REMOVED side's rule — see `bundleSink`. */
  readonly keepFirst: boolean;
}

function emptyBundle(keepFirst = false): EntityBundle {
  return {
    keepFirst,
    blocks: new Map(),
    headings: new Map(),
    footnotes: new Map(),
    citations: new Map(),
    anchors: new Map(),
    examples: new Map(),
    figures: new Map(),
    labels: new Map(),
  };
}

// ---------------------------------------------------------------------------
// The coordinate contract.
// ---------------------------------------------------------------------------

/**
 * THREE coordinate spaces meet in this module, and only one of them is the
 * space a step's own positions are written in.
 *
 *   - `stepDoc`  — `tr.docs[i]`, the document THIS step's positions address.
 *                  Equal to `oldDoc` only for the FIRST step of a transaction.
 *   - `oldDoc`   — `tr.before`. The space every `removed.*` entry is RECORDED
 *                  in, because that is the space its consumers read it in:
 *                  `footnote.ts` does `oldState.doc.nodeAt(removed.pos)` and
 *                  `linked-anchor.ts`'s resurrection guard says so out loud.
 *   - `newDoc`   — `tr.doc`. The space every `added.*` / `changed.*` entry is
 *                  recorded in, because `applyDiff` folds them into the index
 *                  verbatim (`observer-plugin.ts`: "already in newDoc
 *                  coordinates").
 *
 * The rule used to live in a COMMENT on the `Replace*` branch and was enforced
 * only there; every other branch read `oldDoc`/`newDoc` directly for a
 * step-local question and was silently wrong on any multi-step transaction
 * (task 653). It is structural now: a branch is handed `StepCoords` and NOTHING
 * ELSE, so `oldDoc` is not in its scope to reach for, and the two mappings that
 * cross into the contract spaces are the only doors out.
 */
interface StepCoords {
  /** `tr.docs[i]` — the document this step's own positions address. */
  readonly stepDoc: PMNode;
  /** `tr.doc` — the transaction's final document. */
  readonly newDoc: PMNode;
  /** `stepDoc` → `oldDoc`. `null` for the first step (the spaces coincide). */
  readonly back: Mapping | null;
  /** `stepDoc` → `newDoc` (this step plus every later one). */
  readonly forward: Mapping;
}

/**
 * Cross a position into the space an entry is recorded in. `null` means the
 * walked document ALREADY is that space, which is the single-step case — so a
 * keystroke pays nothing for the contract.
 */
function mapPos(m: Mapping | null, pos: number, assoc: number): number {
  return m ? m.map(pos, assoc) : pos;
}

/**
 * Everything a step branch may write to. Passing this (rather than closing over
 * the whole `inspectSteps` body) is the other half of the enforcement: a branch
 * has the two bundles and the two content sets, and no document at all beyond
 * its `StepCoords`.
 */
interface DiffSink {
  readonly removed: EntityBundle;
  readonly added: EntityBundle;
  readonly contentChangedUuids: Set<string>;
  readonly exampleContentChangedUuids: Set<string>;
  exampleShapeChanged: boolean;
  footnoteOrderChanged: boolean;
  citationOrderChanged: boolean;
}

/**
 * Record one `linkedAnchor` span into a bundle, MERGING with any span already
 * recorded for that id — a mark rides several text runs, and a transaction may
 * touch several of them. The ONE writer, so the mark-step branch and the text-
 * node walk cannot disagree about what widening a span means (the remove branch
 * used to overwrite rather than merge, so a two-run removal reported only the
 * last run's extent).
 */
function noteAnchorRange(
  out: EntityBundle,
  id: string,
  kind: string,
  from: number,
  to: number,
): void {
  const prev = out.anchors.get(id);
  if (prev) {
    prev.from = Math.min(prev.from, from);
    prev.to = Math.max(prev.to, to);
    return;
  }
  out.anchors.set(id, { id, from, to, kind });
}

/**
 * Inspect ONE node into a bundle. Does not recurse — the visitor below
 * handles recursion explicitly so position math stays correct. WHAT the node
 * contributes is `extractEntitiesAt`'s, shared with `buildInitial` (task 922);
 * this adapter supplies only the two step-path facts:
 *
 * `doc` is the document `pos` addresses (the pre-step doc for the removed
 * side, `newDoc` for the added side). It is needed for the ancestor-derived
 * facts a single node cannot answer on its own — today a citation's
 * enclosing container; see `enclosingCitationContainer`.
 *
 * `record` crosses `pos` from the walked document into the space the entry is
 * RECORDED in (see `StepCoords`). The node is INSPECTED where it lives and
 * RECORDED where its side's contract says — two different questions that the
 * pre-task-653 code answered with one number.
 */
function inspectNodeAt(
  n: PMNode,
  pos: number,
  out: EntityBundle,
  doc: PMNode,
  record: Mapping | null,
  /** `n`'s immediate parent — the identity predicate reads it (a deferred
   *  inner paragraph carries no live block identity). */
  parent: PMNode | null,
): void {
  // BORN IN THIS TRANSACTION (task 1493). `record` is the back mapping of a
  // step past the first; a node whose start it DELETES did not exist in
  // `oldDoc` — an earlier step inserted it (the footnote input rule inserts F,
  // then `writeFootnoteNumbers` re-marks it in the same transaction). It has no
  // "before" for the removed side to record: recording it made a brand-new
  // entity look like a CHANGED one, which `applyDiff` folds only into ids the
  // snapshot already holds, so it vanished. Text nodes are exempt: PM merges a
  // born run into an old neighbour, so a text node's start can be new while
  // its marks are not — anchors are settled against the live doc instead.
  if (record && !n.isText && record.mapResult(pos, 1).deletedAfter) return;
  extractEntitiesAt(n, pos, parent, {
    sink: bundleSink(out),
    place: record ? (p, assoc) => record.map(p, assoc) : undefined,
    citationContainer: (p) => enclosingCitationContainer(doc, p),
  });
}

/**
 * Adapt a keyed `EntityBundle` to the extractor's sink.
 *
 * `out.keepFirst` is the REMOVED side's rule (task 1493): the first step that saw
 * an entity saw it as `oldDoc` held it; a later step re-touching it sees a
 * state this transaction already produced, and its back-mapped position can
 * be an insertion point rather than where the entity was. The added side is
 * recorded in `newDoc` with no mapping, where every sighting agrees.
 */
function bundleSink(out: EntityBundle): EntitySink {
  const put = <E>(m: Map<string, E>, k: string, e: E): void => {
    if (!out.keepFirst || !m.has(k)) m.set(k, e);
  };
  return {
    block: (e) => put(out.blocks, e.uuid, e),
    heading: (e) => put(out.headings, e.uuid, e),
    figure: (e) => put(out.figures, e.uuid, e),
    example: (e) => put(out.examples, e.id, e),
    footnote: (e) => put(out.footnotes, e.id, e),
    citation: (e) => put(out.citations, e.id, e),
    label: (e) => put(out.labels, e.id, e),
    anchor: (id, kind, from, to) => noteAnchorRange(out, id, kind, from, to),
  };
}

/**
 * Walk a range of a doc collecting every structural entity. Uses
 * `nodesBetween` and counts a node iff its **start** position lies in
 * `[from, to)`. This excludes ancestor blocks that merely overlap the
 * range (their start lies before `from`) while keeping blocks that
 * start inside the range — even if their extent reaches past `to`,
 * which is the merge case (`tr.delete(6, 8)` on `</p1><p2>` deletes
 * p2's opening token at pos 7 → p2 starts in range → counted).
 *
 * Text nodes are special: their start may fall outside the range but
 * the touched portion (and its marks) still matters for linkedAnchor
 * tracking. For text, count any node whose extent overlaps the range.
 *
 * Neither rule ever wants an ancestor that merely contains the range, so the
 * walk is `nodesBetweenLocal`: a keystroke's range visits only its own
 * textblock's inline children, never the top-level blocks above it (task 1497).
 */
function collectRange(
  doc: PMNode,
  from: number,
  to: number,
  out: EntityBundle,
  record: Mapping | null,
): void {
  if (to <= from) return;
  const clampedTo = Math.min(to, doc.content.size);
  const clampedFrom = Math.max(from, 0);
  if (clampedTo <= clampedFrom) return;
  nodesBetweenLocal(doc, clampedFrom, clampedTo, (n, pos, parent) => {
    if (n.isText) {
      inspectNodeAt(n, pos, out, doc, record, parent);
    } else if (pos >= clampedFrom && pos < clampedTo) {
      // Block-level node that starts inside the range. Whether its
      // body extends past `to` doesn't matter — if its opening token
      // got deleted, its identity is gone in newDoc.
      inspectNodeAt(n, pos, out, doc, record, parent);
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// "Changed": EVERY field the snapshot holds, by one declared table.
// ---------------------------------------------------------------------------

/**
 * How each field of a keyed entry takes part in "did this re-collected entity
 * CHANGE?" (task 1495):
 *   - `key`      — the entity's address; equal by construction on both sides.
 *   - `pos`      — compared in ONE space (see below).
 *   - `compared` — any difference is a change.
 *   - `removal`  — attached only to a REMOVED entry on its way out; never on
 *                  a snapshot row, so there is nothing to compare.
 *
 * There is no "ignored" rule, on purpose. Until 1495 each kind had a
 * hand-written predicate over a hand-picked subset, and a field it forgot went
 * stale in the snapshot with no test noticing: a cite's container
 * (`nestedInContainerId`) re-collected in place under a re-minted example, or
 * a paragraph joined into one, kept its old container, and the Citations panel
 * showed the card un-nested until reload. Each table below is
 * `satisfies Record<keyof Required<E>, …>`, so a new snapshot field is a
 * compile error here until its rule is stated. A field that must NOT wake
 * watchers (a heading's title text — keystroke sanctity; a figure's
 * `figureNumber` — the numberer's own output) is not in the snapshot at all:
 * readers take it off the live node.
 *
 * Position is compared in ONE space: `aPosInNewDoc` is the removed side mapped
 * through the transaction (`removedPosInNewDoc`), so an edit EARLIER in the
 * document maps the old position onto the new one and reports nothing. A
 * same-uuid entity that survives at a different position (a delete+insert
 * MOVE: an Outline reorder, a block drag, the undo of either) IS a change —
 * document order is a numbering input (task 892).
 */
type FieldRule = "key" | "pos" | "compared" | "removal";
type FieldRules<E> = { readonly [K in keyof Required<E>]: FieldRule };

const ENTRY_FIELDS = {
  headings: {
    uuid: "key", pos: "pos", level: "compared", label: "compared", numbered: "compared",
  } satisfies FieldRules<HeadingEntry>,
  footnotes: {
    id: "key", pos: "pos", thanks: "compared", number: "compared",
    numberOverride: "compared", title: "compared", removedCarried: "removal",
  } satisfies FieldRules<FootnoteEntry>,
  citations: {
    id: "key", pos: "pos", command: "compared", displayText: "compared",
    nestedInFootnoteId: "compared", nestedInContainerId: "compared",
  } satisfies FieldRules<CitationEntry>,
  examples: {
    id: "key", uuid: "compared", pos: "pos", tag: "compared", label: "compared",
    number: "compared",
  } satisfies FieldRules<ExampleEntry>,
  figures: {
    uuid: "key", pos: "pos", label: "compared", numbered: "compared",
    // A NUMBERING input since tasks 318/319 — see `FigureEntry.emitsCaption`.
    emitsCaption: "compared",
  } satisfies FieldRules<FigureEntry>,
} as const;

/** Value equality for snapshot fields: primitives by `Object.is`, a plain
 *  record (a `CitationContainer`) one level deep. */
function sameField(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) =>
    Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** The "differs" rule `reconcileKeyed` takes, derived from a field table. */
function differsBy<E extends { pos: number }>(rules: FieldRules<E>) {
  const compared = (Object.keys(rules) as (keyof E)[]).filter((k) => rules[k] === "compared");
  return (aPosInNewDoc: number, a: E, b: E): boolean =>
    aPosInNewDoc !== b.pos || compared.some((k) => !sameField(a[k], b[k]));
}

const DIFFERS = {
  headings: differsBy<HeadingEntry>(ENTRY_FIELDS.headings),
  footnotes: differsBy<FootnoteEntry>(ENTRY_FIELDS.footnotes),
  citations: differsBy<CitationEntry>(ENTRY_FIELDS.citations),
  examples: differsBy<ExampleEntry>(ENTRY_FIELDS.examples),
  figures: differsBy<FigureEntry>(ENTRY_FIELDS.figures),
};

// ---------------------------------------------------------------------------
// Anchorable-ancestor finder for content-change attribution.
// ---------------------------------------------------------------------------

/**
 * Walks up from `pos` in `doc` to find the nearest anchorable ancestor
 * with a non-null UUID. Returns its UUID or null. Used to attribute a
 * step's effect to one block for the `contentChangedUuids` set.
 */
function nearestAnchorableUuid(doc: PMNode, pos: number): string | null {
  // Clamp into the doc's range to defend against off-by-one in test fixtures.
  if (pos < 0) pos = 0;
  if (pos > doc.content.size) pos = doc.content.size;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    // The identity predicate, so a stale uuid on a deferred inner paragraph
    // never claims an edit its container owns (task 878).
    if (!mayCarryBlockUuid(node, depth > 0 ? $pos.node(depth - 1) : null)) continue;
    const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid;
    if (uuid) return uuid;
  }
  return null;
}

/**
 * Walks up from `pos` in `doc` to find the nearest enclosing `exampleBlock`
 * with a non-null UUID. Returns its UUID or null. Distinct from
 * `nearestAnchorableUuid`: an edit inside an example item attributes to the
 * exampleItem (the nearer anchorable node, since exampleItems also carry a
 * uuid), but the Examples-panel card addresses itself by the EXAMPLE BLOCK's
 * uuid — so it needs the enclosing block, not the item. Reuses the same
 * `$pos.resolve` ancestor walk the content-change attribution already does;
 * no extra doc walk.
 */
function nearestExampleBlockUuid(doc: PMNode, pos: number): string | null {
  if (pos < 0) pos = 0;
  if (pos > doc.content.size) pos = doc.content.size;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const uuid = exampleIdentityOf($pos.node(depth))?.uuid;
    if (uuid) return uuid;
  }
  return null;
}

/**
 * The container tag a citation collected at `pos` should carry — the step
 * path's answer to the question `buildInitial` answers with its exampleBlock
 * STACK. Same rule, different mechanism: the innermost enclosing exampleBlock
 * whose `exampleIdentityOf` id is non-empty — the SAME reading the extractor
 * records its `ExampleEntry` from (`buildInitial` pushes only
 * such blocks onto its stack, so an inner id-less example is skipped there
 * too and an outer identified one wins on both paths).
 *
 * The `"footnote"` kind is deliberately NOT derivable here and never returned:
 * a footnote-nested cite lives in the host footnote's `attrs.content`
 * JSONContent literal, has no PM node of its own, and is therefore invisible
 * to every step — it is stamped once by the load-only descend pass and carried
 * forward by `applyDiff` (pinned by `step-inspector.test.ts`).
 *
 * Cost is the same O(depth) `$pos.resolve` ancestor walk `nearestAnchorableUuid`
 * / `nearestExampleBlockUuid` already do, and it runs only when a citation NODE
 * is actually collected — typing plain prose reaches it zero times, so nothing
 * is added to the keystroke path.
 */
function enclosingCitationContainer(doc: PMNode, pos: number): CitationContainer | null {
  if (pos < 0) pos = 0;
  if (pos > doc.content.size) pos = doc.content.size;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const id = exampleIdentityOf($pos.node(depth))?.id;
    if (id) return { kind: "example", id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Body-derived facts: the ancestor pass.
// ---------------------------------------------------------------------------

/**
 * `collectRange`'s start-in-range rule answers "did this node's IDENTITY
 * change?" — a node whose opening token survived still exists. It cannot
 * answer "did this node's DERIVED FACTS change?", because a fact derived
 * from a node's BODY changes without the opening token ever being touched.
 *
 * The canonical case (task 651): whether a figure takes a NUMBER is
 * `emitsCaption`, derived from the caption's own content (tasks 318/319).
 * The editor always renders an editable caption, so giving a captionless
 * figure a caption by typing into it is an ordinary gesture — and its
 * `ReplaceStep` range lies strictly inside the caption, well past the
 * figureBlock's opening token. The block was collected on neither side,
 * `changedFigures` stayed empty, the numberer's structural gate never
 * fired, and the figure stayed unnumbered — taking every later figure's
 * number, and every `\ref` that resolves through them, off by one.
 *
 * So state ONCE which entity kinds carry facts derived from their body,
 * and walk each touched range's ancestors for exactly those kinds. Adding
 * the second member is then a ROW here, not another missed case.
 */
interface BodyDerivedFactKind {
  /** The node type whose BODY (not attrs) feeds a tracked fact. */
  readonly typeName: string;
  /**
   * Collect this node's entry into `out` under its own identity key.
   * FILL-IN ONLY: where the range walk already collected the node it saw
   * the identity change too, and stays authoritative.
   */
  readonly collect: (
    node: PMNode,
    pos: number,
    out: EntityBundle,
    record: Mapping | null,
  ) => void;
}

const BODY_DERIVED_FACT_KINDS: readonly BodyDerivedFactKind[] = [
  {
    // `FigureEntry.emitsCaption` = `hasCaption || captionNodeHasContent(caption)`.
    // The second disjunct is the body-derived half; `ENTRY_FIELDS.figures`
    // already compares it, so a filled-in pair reconciles to `changedFigures`
    // with no new branch downstream.
    typeName: "figureBlock",
    collect: (node, pos, out, record) => {
      const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid ?? null;
      if (!uuid || out.figures.has(uuid)) return;
      out.figures.set(uuid, figureEntryAt(node, mapPos(record, pos, 1), uuid));
    },
  },
];

/**
 * Walks up from `pos` to the nearest ancestor of a body-derived-fact kind.
 * Same `$pos.resolve` ancestor walk as `nearestAnchorableUuid` /
 * `nearestExampleBlockUuid` — O(depth), no doc scan, so it stays on the
 * keystroke path without cost.
 */
function nearestBodyDerivedAncestor(
  doc: PMNode,
  pos: number,
): { kind: BodyDerivedFactKind; node: PMNode; pos: number; uuid: string } | null {
  if (pos < 0) pos = 0;
  if (pos > doc.content.size) pos = doc.content.size;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    const kind = BODY_DERIVED_FACT_KINDS.find((k) => k.typeName === node.type.name);
    if (!kind) continue;
    const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid ?? null;
    if (!uuid) continue;
    return { kind, node, pos: $pos.before(depth), uuid };
  }
  return null;
}

/**
 * Collect the body-derived-fact ancestor of one step's edit point on BOTH
 * sides, so the existing per-kind reconciler can compare them. Costs one
 * extra `resolve` per step on the ordinary-prose path (no such ancestor →
 * return before the second walk).
 *
 * Only a matching-uuid PAIR is collected: if the two sides disagree about
 * which node encloses the edit, the node's identity changed, and identity
 * is the range walk's question, not this one's.
 */
function collectBodyDerivedAncestors(
  c: StepCoords,
  fromInStepDoc: number,
  fromInNew: number,
  sink: DiffSink,
): void {
  const after = nearestBodyDerivedAncestor(c.newDoc, fromInNew);
  if (!after) return;
  const before = nearestBodyDerivedAncestor(c.stepDoc, fromInStepDoc);
  if (!before || before.uuid !== after.uuid) return;
  before.kind.collect(before.node, before.pos, sink.removed, c.back);
  after.kind.collect(after.node, after.pos, sink.added, null);
}

// ---------------------------------------------------------------------------
// The step branches. Each is handed its `StepCoords` and the sink — never a
// document of its own — so the coordinate contract above is structural rather
// than remembered.
// ---------------------------------------------------------------------------

/** Order flags are per-KIND facts about what a step touched, asked the same way
 *  for every branch: if this kind entered or left a touched range, the document
 *  order of that kind may have changed. */
function noteOrderFlags(sink: DiffSink): void {
  if (sink.removed.footnotes.size > 0 || sink.added.footnotes.size > 0) {
    sink.footnoteOrderChanged = true;
  }
  if (sink.removed.citations.size > 0 || sink.added.citations.size > 0) {
    sink.citationOrderChanged = true;
  }
}

// ---------------------------------------------------------------------------
// Example shape (task 1127).
// ---------------------------------------------------------------------------

/**
 * The node kinds whose count, order or nesting inside an `exampleBlock` are
 * inputs to the expex renumberer: the item tree (sub-item letters) and the
 * aligned gloss grid (`exampleGloss.colCount`). Text typed inside any of them
 * changes none of those outputs.
 */
const EXAMPLE_SHAPE_TYPES: ReadonlySet<string> = new Set([
  "exampleItem",
  "exampleItemList",
  "exampleGloss",
  "alignedGlossRow",
  "glossCell",
]);

/** Shape-kind nodes whose OPENING token lies in `[from, to)` of `doc`. Never
 *  descends into a textblock (no shape kind lives in inline content), and a
 *  range inside one textblock — a keystroke — takes `nodesBetweenLocal`'s fast
 *  path, so it costs O(depth) rather than the caret block's index. */
function shapeNodesStartingIn(doc: PMNode, from: number, to: number, out: string[]): void {
  const lo = Math.max(from, 0);
  const hi = Math.min(to, doc.content.size);
  if (hi <= lo) return;
  nodesBetweenLocal(doc, lo, hi, (n, pos) => {
    if (pos >= lo && EXAMPLE_SHAPE_TYPES.has(n.type.name)) out.push(n.type.name);
    return !n.isTextblock;
  });
}

/** Shape-kind nodes anywhere in an inserted slice's content. */
function shapeNodesInSlice(content: PMNode["content"], out: string[]): void {
  content.forEach((n) => {
    if (EXAMPLE_SHAPE_TYPES.has(n.type.name)) out.push(n.type.name);
    if (!n.isTextblock && !n.isLeaf) shapeNodesInSlice(n.content, out);
  });
}

/**
 * Did this step change an example's SHAPE — add, remove, split, join, wrap or
 * lift an item / list / gloss / row / cell? Asked of the step's own ranges, so
 * it is O(step), never O(doc).
 *
 * A `ReplaceStep` reshapes iff a shape node starts in the deleted range or
 * rides the inserted slice (an OPEN slice's boundary node may be one that
 * already existed — over-reporting there only wakes the renumberer, which is
 * safe). A `ReplaceAroundStep` keeps its gap's content, so it reshapes iff the
 * shape kinds in its range differ before vs after: `setNodeMarkup` on an item
 * or a gloss (the renumberer's own `subLabel` / `colCount` writes, a label
 * edit, a uuid backfill) swaps a node for one of the same kind and is NOT a
 * reshape — else the renumberer would re-wake on its own output. (Compared
 * over the whole range rather than by reading the step's gap: the gap is the
 * re-parenting door's question, `reparent-identity-conservation`.)
 */
function stepReshapesExample(
  step: ReplaceStep | ReplaceAroundStep,
  c: StepCoords,
  fromInNew: number,
  toInNew: number,
): boolean {
  const before: string[] = [];
  if (step instanceof ReplaceAroundStep) {
    const after: string[] = [];
    shapeNodesStartingIn(c.stepDoc, step.from, step.to, before);
    shapeNodesStartingIn(c.newDoc, fromInNew, toInNew, after);
    if (before.length !== after.length) return true;
    before.sort();
    after.sort();
    return before.some((name, i) => name !== after[i]);
  }
  shapeNodesStartingIn(c.stepDoc, step.from, step.to, before);
  if (before.length > 0) return true;
  shapeNodesInSlice(step.slice.content, before);
  return before.length > 0;
}

function inspectReplaceStep(
  step: ReplaceStep | ReplaceAroundStep,
  c: StepCoords,
  sink: DiffSink,
): void {
  // `step.from`/`step.to` are in `c.stepDoc`. Map the range forward to `newDoc`
  // through this step AND every later one (`c.forward`); using the FULL
  // transaction mapping here mis-mapped every step past the first, so a
  // multi-step tx such as an atom MOVE (delete + re-insert) left the
  // re-inserted node undetected in `added` — the structure then dropped the
  // moved footnote/citation and the renumber walked a stale snapshot.
  //   fromInNew uses bias=-1 (stay left of the inserted content)
  //   toInNew uses bias=+1 (stay right of the inserted content)
  // so the resulting range covers everything that landed in newDoc.
  const fromInNew = c.forward.map(step.from, -1);
  const toInNew = c.forward.map(step.to, 1);

  collectRange(c.stepDoc, step.from, step.to, sink.removed, c.back);
  collectRange(c.newDoc, fromInNew, toInNew, sink.added, null);

  // Attribute content-change to nearest anchorable ancestor in newDoc.
  const uuid = nearestAnchorableUuid(c.newDoc, fromInNew);
  if (uuid) sink.contentChangedUuids.add(uuid);

  // Also attribute to the enclosing exampleBlock (if any) so the
  // Examples-panel card — keyed by exampleBlock uuid, not the nearer
  // anchorable exampleItem — can re-seed on a content-only edit. Same
  // ancestor walk; no extra doc scan.
  const exUuid = nearestExampleBlockUuid(c.newDoc, fromInNew);
  if (exUuid) sink.exampleContentChangedUuids.add(exUuid);

  if (!sink.exampleShapeChanged && stepReshapesExample(step, c, fromInNew, toInNew)) {
    sink.exampleShapeChanged = true;
  }

  // Facts derived from a node's BODY change without its opening token
  // ever entering the step range, so `collectRange` cannot see them.
  // Walk this edit point's ancestors for the kinds that carry such a
  // fact and fill both sides in — see `BODY_DERIVED_FACT_KINDS`.
  collectBodyDerivedAncestors(c, step.from, fromInNew, sink);

  noteOrderFlags(sink);
}

/**
 * The span a mark step names, in `c.stepDoc` coordinates.
 *
 * `AddMarkStep`/`RemoveMarkStep` carry a range. `AddNodeMarkStep`/
 * `RemoveNodeMarkStep` name ONE node by position, and its extent is that node's
 * own size — `pos + 1` was right only for a leaf of size 1, so a node mark on
 * anything else recorded a one-token anchor span and the linked card
 * highlighted a single character.
 */
function markStepSpan(step: Step, doc: PMNode): { from: number; to: number } {
  const s = step as unknown as { from?: number; to?: number; pos?: number };
  if (typeof s.from === "number" && typeof s.to === "number") {
    return { from: s.from, to: s.to };
  }
  const pos = s.pos ?? 0;
  return { from: pos, to: pos + (doc.nodeAt(pos)?.nodeSize ?? 1) };
}

/**
 * Record a content edit over `[from, to)` (in `c.newDoc`) the way a text
 * replace records one: every block the span touches goes into
 * `contentChangedUuids`, and every enclosing example into
 * `exampleContentChangedUuids`. A mark step changes a block's CONTENT (its
 * formatting) without moving any boundary, so without this the per-block /
 * per-example content channels never heard about a bold or an italic — an open
 * Example card kept the un-formatted text and its next whole-block write-back
 * reverted the formatting (task 1494). O(span): the walk stops at each
 * textblock, so it never descends into inline content — and a span inside ONE
 * textblock (the common mark step) is wholly answered by `attribute(from)`,
 * whose nearest anchorable / example ancestors are that textblock's, so
 * `nodesBetweenLocal` skips the top-level scan entirely (task 1497).
 */
function noteContentSpan(c: StepCoords, from: number, to: number, sink: DiffSink): void {
  const attribute = (pos: number) => {
    const uuid = nearestAnchorableUuid(c.newDoc, pos);
    if (uuid) sink.contentChangedUuids.add(uuid);
    const exUuid = nearestExampleBlockUuid(c.newDoc, pos);
    if (exUuid) sink.exampleContentChangedUuids.add(exUuid);
  };
  attribute(from);
  if (to <= from) return;
  nodesBetweenLocal(c.newDoc, from, Math.min(to, c.newDoc.content.size), (node, pos) => {
    if (!node.isTextblock) return true;
    attribute(pos + 1);
    return false;
  });
}

function inspectMarkStep(
  step: AddMarkStep | AddNodeMarkStep | RemoveMarkStep | RemoveNodeMarkStep,
  c: StepCoords,
  sink: DiffSink,
  adding: boolean,
): void {
  const { from, to } = markStepSpan(step, c.stepDoc);
  // Every mark — formatting and linkedAnchor alike — is content of the blocks
  // it spans. Recorded in `newDoc` space (inner-biased, so the span never
  // widens onto a neighbour inserted by a later step).
  const fromInNew = c.forward.map(from, 1);
  noteContentSpan(c, fromInNew, Math.max(fromInNew, c.forward.map(to, -1)), sink);
  if (step.mark.type.name !== "linkedAnchor") return;
  const attrs = step.mark.attrs as { anchorId?: string; kind?: string };
  const id = attrs.anchorId ?? "";
  if (!id) return;
  // The span is in `c.stepDoc`; record it in the side's contract space. Stored
  // raw, an added anchor whose transaction went on to edit EARLIER in the
  // document landed in the canonical anchor index off by the later steps'
  // delta — the linked card then highlighted and scrolled to the wrong text.
  const record = adding ? c.forward : c.back;
  noteAnchorRange(
    adding ? sink.added : sink.removed,
    id,
    attrs.kind ?? "note",
    mapPos(record, from, -1),
    mapPos(record, to, 1),
  );
}

/**
 * An `AttrStep` asks the same question the range walk does — "what entities does
 * this node contribute, before and after?" — about a single node rather than a
 * range. So it ANSWERS it the same way: `inspectNodeAt` on both sides, and the
 * existing per-kind reconcilers decide what actually changed. Two consequences
 * worth naming:
 *
 *   - There is no second, hand-written table of "which attrs matter" to drift
 *     from the reconcilers. An attr that changes nothing the diff reports
 *     derives EQUAL entries on both sides and cancels in reconciliation — so
 *     the branch stays silent without being told to.
 *   - A `label` attr flip now updates `added/removed.labels` (the table `\ref`
 *     display resolves against), because `inspectNodeAt` emits the label entry.
 *     The hand-rolled branch synthesised headings and figures and forgot it.
 *
 * Nothing in `src` emits a raw `AttrStep` today — every writer goes through
 * `setNodeMarkup`, which on a non-leaf node produces a `ReplaceAroundStep` and
 * on a leaf a `ReplaceStep` (task 247). This branch is the defensive fallback
 * that must be right on the day one finally fires; congruence with the live
 * range path is what makes that checkable.
 */
function inspectAttrStep(step: AttrStep, c: StepCoords, sink: DiffSink): void {
  // `step.pos` is in `c.stepDoc` — NOT in `oldDoc`. Reading `oldDoc.nodeAt` /
  // `newDoc.nodeAt` with it (the pre-task-653 code) found the wrong node in any
  // multi-step transaction whose earlier step changed the document size, or
  // `null`, in which case the whole attr change — a uuid re-mint, a heading
  // level or label flip — was silently dropped from the diff.
  const beforeNode = c.stepDoc.nodeAt(step.pos);
  if (!beforeNode) return;
  // An AttrStep moves nothing, so the node's final position is purely the later
  // steps' delta. If a later step DELETED it, that step's own range walk
  // reports the removal against the document it addresses — leave it there
  // rather than synthesising a second, differently-coordinated account.
  const res = c.forward.mapResult(step.pos, 1);
  const afterNode = res.deleted ? null : c.newDoc.nodeAt(res.pos);
  if (!afterNode || afterNode.type !== beforeNode.type) return;
  // An AttrStep moves nothing, so both sides share one parent shape; the
  // O(depth) resolve runs only on this never-emitted defensive branch.
  inspectNodeAt(beforeNode, step.pos, sink.removed, c.stepDoc, c.back, c.stepDoc.resolve(step.pos).parent);
  inspectNodeAt(afterNode, res.pos, sink.added, c.newDoc, null, c.newDoc.resolve(res.pos).parent);
  noteOrderFlags(sink);
}

/**
 * A step kind this module does not recognise — a `DocAttrStep`, or a step type
 * that did not exist when this was written.
 *
 * The comment that used to sit here described a conservative fallback and no
 * code implemented one: the step contributed nothing, so a `docChanged`
 * transaction returned `EMPTY_DIFF` and every diff-gated plugin — the section
 * numberer, `label.ts`, `title.ts`, `expex.ts` — treated it as a NON-EVENT.
 * That is the opposite of failing safe, and it contradicts the rule this
 * project states in `changed-ranges.ts`: an unrecognised step "could have
 * reached anywhere", and the extractor answers "the whole document".
 *
 * So: the touched range IS the whole document. No new vocabulary, no second
 * notion of "structural" to keep in sync — the same `collectRange` the ordinary
 * path uses, over everything, on both sides, with every block additionally
 * marked content-changed so the gates that key off `contentChangedUuids` wake
 * too. O(doc), which is the right price for a step nothing can reason about,
 * and unreachable from any current writer.
 */
function inspectUnrecognisedStep(oldDoc: PMNode, newDoc: PMNode, sink: DiffSink): void {
  collectRange(oldDoc, 0, oldDoc.content.size, sink.removed, null);
  collectRange(newDoc, 0, newDoc.content.size, sink.added, null);
  for (const uuid of sink.added.blocks.keys()) sink.contentChangedUuids.add(uuid);
  for (const e of sink.added.examples.values()) {
    if (e.uuid) sink.exampleContentChangedUuids.add(e.uuid);
  }
  sink.exampleShapeChanged = true;
  noteOrderFlags(sink);
}

// ---------------------------------------------------------------------------
// The keyed reconcile (task 1493).
// ---------------------------------------------------------------------------

function groupBy<E>(xs: readonly E[], keyOf: (e: E) => string): Map<string, E[]> {
  const m = new Map<string, E[]>();
  for (const x of xs) {
    const k = keyOf(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

interface KeyedReconcileInput<E extends { pos: number }> {
  /** Entities the touched ranges hold in `newDoc` (newDoc space). */
  readonly added: ReadonlyMap<string, E>;
  /** Entities the touched ranges held before the transaction (oldDoc space),
   *  first sighting per key, newborns excluded (`inspectNodeAt`). */
  readonly removed: ReadonlyMap<string, E>;
  /** The prior snapshot's entries for a key (`undefined` = not indexed), or
   *  `null` when no snapshot was handed in — then bundle membership stands in
   *  for it, the pre-1493 behaviour, so a caller without a snapshot is
   *  unchanged. */
  readonly prior: ((id: string) => E[] | undefined) | null;
  /** Every live `newDoc` entry for a key — the lazy O(doc) rebuild walk. */
  readonly live: (id: string) => E[];
  /** The kind's "differs" rule; `aPosInNewDoc` is `a`'s position already
   *  carried into `newDoc` space. */
  readonly differs: (aPosInNewDoc: number, a: E, b: E) => boolean;
  readonly removedPosInNewDoc: (pos: number) => number;
  readonly mapPrior: (pos: number) => number;
}

/**
 * Classify one keyed table's touched entities against the PRIOR SNAPSHOT's
 * membership and the LIVE document — never against the step bundles alone.
 * Bundle membership is a fact about the touched RANGE; whether an entity is
 * new, changed or gone is a fact about the snapshot. Where the two came apart
 * the old per-kind loops lost entities (a footnote inserted and re-numbered in
 * one transaction was reported "changed" for an id the index never held, and
 * `applyDiff` dropped it) or invented them (an entity born and deleted in one
 * transaction was reported removed).
 *
 *   - ADDED: in `newDoc`'s touched range and not in the snapshot — or a second
 *     carrier of a key the snapshot holds, which the rebuild also lists twice
 *     (a pasted duplicate, a split clone before its re-mint).
 *   - CHANGED: in the snapshot and in both bundles, and it differs after
 *     mapping (an attr edit in place, or a MOVE).
 *   - REMOVED: in the snapshot and gone from `newDoc`. When another carrier of
 *     the key survives (a split re-mint's kept half, the other copy of a
 *     duplicated cite), the key's live set is emitted as CHANGED instead —
 *     `applyDiff` replaces every entry of a changed key with it — and only
 *     when that set differs from the prior one.
 *
 * Cost: O(touched keys). The live walk is reached only from a removed-side key
 * that is not re-collected on the added side — a removal, never typing.
 */
function reconcileKeyed<E extends { pos: number }>(
  r: KeyedReconcileInput<E>,
): { added: E[]; removed: E[]; changed: E[] } {
  const added: E[] = [];
  const removed: E[] = [];
  const changed: E[] = [];
  for (const [id, after] of r.added) {
    const before = r.removed.get(id);
    const indexed = r.prior ? r.prior(id) !== undefined : before !== undefined;
    if (!indexed || !before) {
      added.push(after);
    } else if (r.differs(r.removedPosInNewDoc(before.pos), before, after)) {
      changed.push(after);
    }
  }
  for (const [id, before] of r.removed) {
    if (r.added.has(id)) continue;
    const prior = r.prior ? r.prior(id) : undefined;
    // Never indexed: born and gone inside this transaction — no event.
    if (r.prior && !prior) continue;
    const survivors = r.live(id);
    if (survivors.length === 0) {
      removed.push(before);
      continue;
    }
    // Another carrier of this key survives. Without a snapshot there is
    // nothing to compare against: report nothing, as before.
    if (!prior) continue;
    const same =
      prior.length === survivors.length &&
      prior.every((p, i) => !r.differs(r.mapPrior(p.pos), p, survivors[i]));
    if (!same) changed.push(...survivors);
  }
  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Inspect every step in `tr` and produce a `StructureDiff` describing
 * the structural delta between `oldDoc` and `newDoc`.
 *
 * The optional `prevStructure` is consulted to defuse one wrinkle of
 * lazy UUID hydration: when `tr.split` or similar clones a node, the
 * "new" half lands in newDoc with the source's UUID — until a separate
 * hydration tx assigns a fresh UUID. Without `prevStructure` we'd emit
 * an `addedBlocks` entry for a UUID that already existed, and the
 * structure index would overwrite the original block's position. With
 * it, duplicate-UUID additions are filtered out and treated as content
 * changes pending hydration.
 *
 * Guarantees:
 *   - O(1) and returns `EMPTY_DIFF` if `!tr.docChanged`.
 *   - O(edit-size) otherwise (proportional to the touched ranges, not
 *     the document size).
 *   - Returns `EMPTY_DIFF` (a shared reference) when every step is
 *     structurally null — keeps the hot path GC-free.
 */
export function inspectSteps(
  tr: Transaction,
  oldDoc: PMNode,
  newDoc: PMNode,
  prevStructure?: DocStructure,
  /** The StepMaps the observer has deferred on `prevStructure` (its
   *  positions are valid as of the last materialization; these carry them to
   *  `oldDoc`). Only the anchor/label reconcilers read positions from
   *  `prevStructure` — to ask whether mapping the index entry already lands
   *  on the live answer (task 1128). */
  prevPendingMaps: readonly StepMap[] = [],
): StructureDiff {
  if (!tr.docChanged) return EMPTY_DIFF;

  const removed = emptyBundle(true);
  const added = emptyBundle();
  const contentChangedUuids = new Set<string>();
  const exampleContentChangedUuids = new Set<string>();
  let blockOrderChanged = false;
  let blockParTitleChanged = false;

  // THE LIVE SIDE (task 1493) — what `newDoc` actually holds, collected by the
  // SAME walk a rebuild runs (`collectStructure`), lazily and at most once per
  // transaction. It answers every "does this entity survive, and as what?"
  // question the step bundles cannot settle alone:
  //
  //   - a block/heading/figure/example uuid swept into the removed bundle by a
  //     split clone's re-mint while the KEPT half still carries it (tasks
  //     247/265). Identity and kind are separate questions (task 921): a
  //     heading demoted in place survives as a block but not as a heading, and
  //     the block table's eligibility rule (`mayCarryBlockUuid`, task 1128)
  //     is the rebuild's own, so a list-wrapped inner paragraph does not count;
  //   - an anchor whose run was touched — its EXACT live extent (first run's
  //     start → last run's end), so a moved or shrunk run is reconciled against
  //     it (task 1128);
  //   - a label's live DEFINING entry (the last definition in document order);
  //   - a cite or footnote id with a second, surviving carrier (a pasted
  //     duplicate): deleting one must leave the other indexed.
  //
  // It used to be three hand-rolled walks (`survivingKindsOf`, `liveAnchorIn`,
  // `liveLabelIn`), each restating part of the rebuild. O(doc), so it is reached
  // ONLY from a removal, a both-sides re-scan, or a duplicate — never from a
  // keystroke (typing touches no node start, and an anchor touched only on the
  // added side is settled against the PRIOR snapshot, below, without it).
  let liveCache: StructureTables | null = null;
  let liveByKey: {
    headings: Map<string, HeadingEntry[]>;
    footnotes: Map<string, FootnoteEntry[]>;
    citations: Map<string, CitationEntry[]>;
    examples: Map<string, ExampleEntry[]>;
    figures: Map<string, FigureEntry[]>;
  } | null = null;
  const live = (): StructureTables => (liveCache ??= collectStructure(newDoc));
  const liveKeyed = () =>
    (liveByKey ??= {
      headings: groupBy(live().headings, (h) => h.uuid),
      footnotes: groupBy(live().footnotes, (f) => f.id),
      citations: groupBy(live().citations, (c) => c.id),
      examples: groupBy(live().examples, (e) => e.id),
      figures: groupBy(live().figures, (f) => f.uuid),
    });

  // The snapshot as it stood before this transaction, keyed — the MEMBERSHIP
  // every reconcile below classifies against (task 1493). Membership is a fact
  // about the prior snapshot; which bundle an id landed in is a fact about the
  // touched RANGE, and the two come apart (a re-marked newborn is in both
  // bundles yet new; an entity born and deleted in one transaction is in the
  // removed bundle yet was never indexed). Grouped lazily per table, only when
  // that table's bundles are non-empty.
  const priorKeyed = new Map<string, Map<string, unknown[]>>();
  const priorOf = <E>(
    table: "headings" | "footnotes" | "citations" | "examples" | "figures",
    keyOf: (e: E) => string,
  ): ((id: string) => E[] | undefined) | null => {
    if (!prevStructure) return null;
    return (id) => {
      let m = priorKeyed.get(table);
      if (!m) {
        m = groupBy(prevStructure[table] as readonly E[], keyOf) as Map<string, unknown[]>;
        priorKeyed.set(table, m);
      }
      return m.get(id) as E[] | undefined;
    };
  };

  // Where an index entry would land if this transaction were only MAPPED over
  // it — the plugin's `mapStructurePositions` over the deferred maps, then this
  // tx. A live answer equal to it needs no diff entry; a different one is a
  // `changed*` entry. One mapping object, so the anchor span goes through the
  // plugin's own `mapAnchorSpan` and cannot disagree with it about assoc.
  const priorMapping = {
    map(pos: number, assoc = 1): number {
      let p = pos;
      for (const m of prevPendingMaps) p = m.map(p, assoc);
      return tr.mapping.map(p, assoc);
    },
  };
  const mapPrior = (pos: number): number => priorMapping.map(pos);
  const labelDiffersFromPrior = (prior: LabelEntry, liveLabel: LabelEntry): boolean =>
    mapPrior(prior.pos) !== liveLabel.pos ||
    prior.owner !== liveLabel.owner ||
    prior.ownerUuid !== liveLabel.ownerUuid;

  const sink: DiffSink = {
    removed,
    added,
    contentChangedUuids,
    exampleContentChangedUuids,
    exampleShapeChanged: false,
    footnoteOrderChanged: false,
    citationOrderChanged: false,
  };

  for (let stepIndex = 0; stepIndex < tr.steps.length; stepIndex++) {
    const step = tr.steps[stepIndex] as Step;
    // The ONE place a step's coordinate spaces are resolved. Every branch below
    // gets this and nothing else — see `StepCoords`. For a single-step
    // transaction (every keystroke) `back` is null and the contract costs
    // nothing beyond the `forward` slice the Replace branch already built.
    const coords: StepCoords = {
      stepDoc: tr.docs[stepIndex] ?? oldDoc,
      newDoc,
      // NOT `tr.mapping.slice(0, stepIndex).invert()`: prosemirror's
      // `appendMappingInverted` walks `mapping.maps` in full and IGNORES the
      // slice's `from`/`to` bounds, so inverting a slice silently inverts the
      // WHOLE transaction. `map`/`mapResult` do honour the bounds, which is why
      // the forward slice below is fine — the asymmetry is the trap. Build the
      // prefix as its own Mapping so there is nothing outside it to invert.
      back:
        stepIndex === 0
          ? null
          : new Mapping(tr.mapping.maps.slice(0, stepIndex)).invert(),
      forward: tr.mapping.slice(stepIndex),
    };

    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      inspectReplaceStep(step, coords, sink);
    } else if (step instanceof AddMarkStep || step instanceof AddNodeMarkStep) {
      inspectMarkStep(step, coords, sink, true);
    } else if (step instanceof RemoveMarkStep || step instanceof RemoveNodeMarkStep) {
      inspectMarkStep(step, coords, sink, false);
    } else if (step instanceof AttrStep) {
      inspectAttrStep(step, coords, sink);
    } else {
      // Fail SAFE, not silent. The whole-document answer subsumes every other
      // step in this transaction, so stop here rather than layering a partial
      // per-step account on top of a total one. `oldDoc`/`newDoc` are passed
      // explicitly because this branch's question is the only one in the loop
      // that is NOT step-local.
      inspectUnrecognisedStep(oldDoc, newDoc, sink);
      break;
    }
  }
  const { footnoteOrderChanged, citationOrderChanged } = sink;

  // -------------------------------------------------------------------------
  // Reconcile added vs removed.
  // -------------------------------------------------------------------------

  // The two sides are recorded in DIFFERENT spaces by contract (`StepCoords`):
  // `removed.*` in oldDoc, `added.*` in newDoc. Every same-key comparison below
  // asks "did this entity MOVE?", which is only answerable in ONE space — so
  // cross at this single door rather than comparing the raw numbers, which
  // reports a move whenever an unrelated earlier edit changed the document's
  // size ahead of the entity (a spurious `blockOrderChanged` /
  // `changedFootnotes` / `changedCitations` / `changedExamples` wakes
  // position-keyed consumers and the O(doc) numberer walk on a non-event), and
  // in principle misses a real one. For a single-step transaction the mapping
  // is what already made the raw comparison work; for a multi-step one it is
  // what was missing.
  const removedPosInNewDoc = (pos: number): number => tr.mapping.map(pos, 1);

  // Blocks. The block table is a uuid-keyed MAP, so a duplicate carrier is
  // not a second entry: an added uuid the snapshot already holds (a split
  // clone, before the backfill re-mints it) is routed through
  // `contentChangedUuids` rather than overwriting the original's position.
  const addedBlocks: BlockEntry[] = [];
  const removedBlocks: BlockEntry[] = [];
  const changedBlocks: BlockEntry[] = [];
  const prevBlocks = prevStructure?.blocks;
  for (const [uuid, entry] of added.blocks) {
    const wasRemoved = removed.blocks.get(uuid);
    if (wasRemoved && (!prevBlocks || prevBlocks.has(uuid))) {
      // Same uuid on both sides of an indexed block = a MOVE (delete+insert,
      // uuid preserved), an in-place `parTitled` flip, or a same-pos TYPE change
      // (`setNode`, task 921) — `compareReturnedBlock` decides which, shared
      // with `mergeStructureDiffs` so the cross-transaction twin cannot drift
      // (task 1129).
      const verdict = compareReturnedBlock(
        wasRemoved,
        entry,
        removedPosInNewDoc(wasRemoved.pos) !== entry.pos,
      );
      if (verdict.changed) changedBlocks.push(entry);
      blockOrderChanged ||= verdict.blockOrderChanged;
      blockParTitleChanged ||= verdict.blockParTitleChanged;
      continue;
    }
    if (!wasRemoved && prevBlocks?.has(uuid)) {
      contentChangedUuids.add(uuid);
      continue;
    }
    addedBlocks.push(entry);
  }
  for (const [uuid, entry] of removed.blocks) {
    if (added.blocks.has(uuid)) continue;
    // Never indexed: born and gone inside this transaction (or a stale slice).
    if (prevBlocks && !prevBlocks.has(uuid)) continue;
    // Block-survivor guard (task 247): a split clone's re-mint sweeps the
    // KEPT half's still-live uuid into the removed bundle; emitting it would
    // drop a live block and detach every card anchored to it.
    if (live().blocks.has(uuid)) continue;
    removedBlocks.push(entry);
  }

  // The keyed, document-ordered tables — ONE reconcile, parameterized by kind
  // (task 1493; it was five hand-written copies, and only the block table
  // consulted the snapshot). Each kind supplies its key and its "differs" rule.
  const headings = reconcileKeyed({
    added: added.headings,
    removed: removed.headings,
    prior: priorOf<HeadingEntry>("headings", (h) => h.uuid),
    live: (id) => liveKeyed().headings.get(id) ?? [],
    differs: DIFFERS.headings,
    removedPosInNewDoc,
    mapPrior,
  });
  // Surviving headings re-scanned on both sides: their text may have changed
  // via the step that touched them.
  for (const [uuid] of added.headings) {
    if (removed.headings.has(uuid)) contentChangedUuids.add(uuid);
  }

  const footnotes = reconcileKeyed({
    added: added.footnotes,
    removed: removed.footnotes,
    prior: priorOf<FootnoteEntry>("footnotes", (f) => f.id),
    live: (id) => liveKeyed().footnotes.get(id) ?? [],
    differs: DIFFERS.footnotes,
    removedPosInNewDoc,
    mapPrior,
  });
  // Carry the body — and every other carried attr (task 1073) — OUT with the
  // removal (task 1072): `oldDoc` is the one doc this entry's `pos` addresses,
  // and it is in scope only HERE. A consumer handed several transactions
  // cannot know which one's before-doc a removed pos belongs to, so it must
  // never re-resolve it. O(depth), removals only.
  const removedFootnotes = footnotes.removed.map((entry) => {
    const node = oldDoc.nodeAt(entry.pos);
    const atom = node && cardAtomIdOf(node);
    return node && atom?.kind === "footnote" && atom.id === entry.id
      ? { ...entry, removedCarried: pickFootnoteCarriedAttrs(node.attrs) }
      : entry;
  });

  const citations = reconcileKeyed({
    added: added.citations,
    removed: removed.citations,
    prior: priorOf<CitationEntry>("citations", (c) => c.id),
    live: (id) => liveKeyed().citations.get(id) ?? [],
    differs: DIFFERS.citations,
    removedPosInNewDoc,
    mapPrior,
  });

  // Anchors. The index entry for an id is one span (first run → last run), and
  // the step bundles see whole TEXT NODES, so neither side's entry is the
  // answer by itself — the prior span (mapped) and, where needed, the live
  // extent are.
  const addedAnchors: AnchorEntry[] = [];
  const removedAnchors: AnchorEntry[] = [];
  const changedAnchors: AnchorEntry[] = [];
  for (const [id, entry] of added.anchors) {
    if (removed.anchors.has(id)) continue; // settled below, against the live extent
    // Seen ONLY on the added side. For an id the snapshot already holds this
    // is a WIDEN candidate, and it widens only if the run reaches past the
    // prior span mapped through this transaction. Typing at a collapsed caret
    // INSIDE a highlight is the common case (task 1493): the walk reports the
    // whole marked text node, yet mapping the prior span already covers it —
    // nothing to report, so the keystroke wakes no structural watcher. O(1):
    // a map lookup and two mapped positions, no live walk.
    const prior = prevStructure?.anchors.get(id);
    if (prior && prior.kind === entry.kind) {
      const mapped = mapAnchorSpan(prior, priorMapping);
      if (entry.from >= mapped.from && entry.to <= mapped.to) continue;
    }
    // A new id, or a real widening: `applyDiff` unions it with the prior span.
    addedAnchors.push(entry);
  }
  for (const [id, entry] of removed.anchors) {
    // A run of this anchor was touched on the removed side. Decided against
    // the LIVE extent (task 1128) and the PRIOR membership (task 1493):
    //  - gone from `newDoc`: removed — unless the snapshot never held it (born
    //    and deleted in this transaction), which is no event at all;
    //  - live, never indexed: added;
    //  - live, and mapping the index entry already lands on the live extent
    //    (an interior Backspace, a replace inside the run): nothing;
    //  - live, but mapping does NOT land on it (a MOVED run, a shrunk run):
    //    `changed`, carrying the live extent.
    const liveAnchor = live().anchors.get(id);
    const prior = prevStructure?.anchors.get(id);
    if (!liveAnchor) {
      if (!prevStructure || prior) removedAnchors.push(entry);
      continue;
    }
    if (!prior) {
      if (prevStructure) addedAnchors.push(liveAnchor);
      else changedAnchors.push(liveAnchor);
      continue;
    }
    const mapped = mapAnchorSpan(prior, priorMapping);
    if (
      prior.kind !== liveAnchor.kind ||
      mapped.from !== liveAnchor.from ||
      mapped.to !== liveAnchor.to
    ) {
      changedAnchors.push(liveAnchor);
    }
  }

  // Examples — a drag-reorder MOVE (delete+insert, uuid kept) or a renumber
  // reconciles to `changedExamples` so docked/Omni ExampleCards re-seed; a
  // same-id boundary re-scan with every field equal reports nothing.
  const examples = reconcileKeyed({
    added: added.examples,
    removed: removed.examples,
    prior: priorOf<ExampleEntry>("examples", (e) => e.id),
    live: (id) => liveKeyed().examples.get(id) ?? [],
    differs: DIFFERS.examples,
    removedPosInNewDoc,
    mapPrior,
  });
  const exampleStructureChanged =
    examples.added.length > 0 || examples.removed.length > 0 || examples.changed.length > 0;

  const figures = reconcileKeyed({
    added: added.figures,
    removed: removed.figures,
    prior: priorOf<FigureEntry>("figures", (f) => f.uuid),
    live: (id) => liveKeyed().figures.get(id) ?? [],
    differs: DIFFERS.figures,
    removedPosInNewDoc,
    mapPrior,
  });

  // Labels. A fresh id on the added side only is an addition. Everything else
  // — an id in both bundles (a MOVED labelled heading/figure), a removal
  // (which another definition of the same id may outlive), a definition added
  // for an id the index already holds (a pasted duplicate) — is settled against
  // the live winner, the LAST definition in document order (task 1128).
  const addedLabels: LabelEntry[] = [];
  const removedLabels: LabelEntry[] = [];
  const changedLabels: LabelEntry[] = [];
  const prevLabels = prevStructure?.labels;
  for (const [id, entry] of added.labels) {
    if (removed.labels.has(id)) continue; // settled below
    if (!prevLabels?.has(id)) {
      addedLabels.push(entry);
      continue;
    }
    const liveLabel = live().labels.get(id);
    if (liveLabel && labelDiffersFromPrior(prevLabels.get(id)!, liveLabel)) {
      changedLabels.push(liveLabel);
    }
  }
  for (const [id, entry] of removed.labels) {
    const liveLabel = live().labels.get(id);
    const prior = prevLabels?.get(id);
    if (!liveLabel) {
      // Never indexed and gone again: born and deleted in this transaction.
      if (!prevLabels || prior) removedLabels.push(entry);
      continue;
    }
    if (!prior) {
      // Not indexed before (born in this transaction, or no prior snapshot
      // handed in): report the live definition as what it is to the caller.
      if (prevLabels) addedLabels.push(liveLabel);
      else changedLabels.push(liveLabel);
    } else if (labelDiffersFromPrior(prior, liveLabel)) {
      changedLabels.push(liveLabel);
    }
  }

  const diff: StructureDiff = {
    addedBlocks,
    removedBlocks,
    changedBlocks,
    blockOrderChanged,
    blockParTitleChanged,
    addedHeadings: headings.added,
    removedHeadings: headings.removed,
    changedHeadings: headings.changed,
    addedFootnotes: footnotes.added,
    removedFootnotes,
    changedFootnotes: footnotes.changed,
    footnoteOrderChanged,
    addedCitations: citations.added,
    removedCitations: citations.removed,
    changedCitations: citations.changed,
    citationOrderChanged,
    addedAnchors,
    removedAnchors,
    changedAnchors,
    addedExamples: examples.added,
    removedExamples: examples.removed,
    changedExamples: examples.changed,
    exampleStructureChanged,
    addedFigures: figures.added,
    removedFigures: figures.removed,
    changedFigures: figures.changed,
    addedLabels,
    removedLabels,
    changedLabels,
    contentChangedUuids,
    exampleContentChangedUuids,
    exampleShapeChanged: sink.exampleShapeChanged,
  };

  // Fast-path: if all categories are empty, return the shared EMPTY_DIFF
  // singleton so consumers can `=== EMPTY_DIFF` for the no-op check. Delegate
  // the emptiness test to `isEmptyDiff` (the SSOT) rather than re-listing the
  // field conditions inline — the inline copy had drifted (it omitted
  // `changedFootnotes`, masked only by `footnoteOrderChanged` being co-set),
  // and a re-listing can silently drift again as fields are added. Routing
  // through `isEmptyDiff` makes that impossible: the fast-path can never
  // disagree with the canonical predicate.
  if (isEmptyDiff(diff)) return EMPTY_DIFF;

  return diff;
}
