/**
 * DocStructureObserver — structure index
 *
 * Builds and maintains the steady-state `DocStructure` snapshot. Two
 * entry points:
 *   - `buildInitial(doc)` — one full doc walk on plugin init.
 *   - `applyDiff(prev, diff)` — incrementally fold a transaction's
 *     `StructureDiff` into the previous snapshot. Pure: returns a new
 *     `DocStructure`.
 *
 * Once `buildInitial` has run, no consumer should ever cause another
 * full doc walk on the structure-index — every keystroke flows through
 * `applyDiff` with at-most edit-size work.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { extractEntitiesAt, type ExtractContext } from "./entity-extractor";
import {
  type AnchorEntry,
  type BlockEntry,
  type CitationEntry,
  type DocStructure,
  EMPTY_STRUCTURE,
  type ExampleEntry,
  type FigureEntry,
  type FootnoteEntry,
  type HeadingEntry,
  type LabelEntry,
  nextStructuralVersion,
  type StructureDiff,
} from "./types";

// ---------------------------------------------------------------------------
// Initial build — one O(N) walk on plugin init.
// ---------------------------------------------------------------------------

/** Every table of `doc`, as a full rebuild sees it. */
export type StructureTables = Omit<DocStructure, "version" | "structuralVersion">;

/**
 * The ONE full collection of a document's tables — `buildInitial`'s walk
 * without the snapshot stamps. Also the step path's LIVE side (task 1493):
 * `inspectSteps` asks it, lazily and at most once per transaction, what
 * `newDoc` actually holds whenever a touched entity's fate cannot be settled
 * from the step bundles alone — so the incremental path and the rebuild answer
 * "what survives" with literally the same code.
 */
export function collectStructure(doc: PMNode): StructureTables {
  const blocks = new Map<string, BlockEntry>();
  const headings: HeadingEntry[] = [];
  const footnotes: FootnoteEntry[] = [];
  const citations: CitationEntry[] = [];
  const anchors = new Map<string, AnchorEntry>();
  const examples: ExampleEntry[] = [];
  const figures: FigureEntry[] = [];
  const labels = new Map<string, LabelEntry>();

  // Phase 2a — enclosing-exampleBlock tracking for example-NESTED citations.
  // A `\cite` inside an example body/item/gloss is a REAL PM node the walk
  // below already reaches and collects as a top-level `CitationEntry` — but
  // with no owner tag, so its Omni card floats free instead of nesting under
  // the example's card. We track a stack of currently-open exampleBlocks
  // `{ id, end }` and, when we hit a citation, stamp it with the innermost
  // enclosing example's id (`nestedInContainerId.kind === "example"`). The
  // stack is O(depth) and runs INSIDE the single load-only `buildInitial`
  // walk — no extra doc pass, and `applyDiff` never re-walks (keystroke
  // sanctity; see docs/agents/laws/keystroke-sanctity.md "Card-source derivation"). `id` is the example's
  // `ExampleEntry.id` (first non-empty of uuid → tag → label, via the shared
  // `deriveExampleIdentity`) so it matches the example omni item key
  // `cardPopKey("example", id)` the nesting transform resolves.
  const exampleStack: { id: string; end: number }[] = [];
  /** End of the node currently being visited (an example's stack bound). */
  let visitingEnd = 0;

  // ONE entity extractor, shared with the step path's `inspectNodeAt`
  // (task 922): this walk owns only its traversal (EVERY depth — hence the
  // identity predicate's parent check, task 878) and the example stack it
  // answers a citation's container from.
  const ctx: ExtractContext = {
    sink: {
      block: (e) => void blocks.set(e.uuid, e),
      heading: (e) => void headings.push(e),
      figure: (e) => void figures.push(e),
      example: (e) => {
        examples.push(e);
        // Phase 2a — push this example onto the enclosing-block stack so any
        // citation collected while we're inside its range gets tagged as
        // example-nested. `end` is one past the block's close token; the walk
        // pops it on reaching that position (below).
        exampleStack.push({ id: e.id, end: visitingEnd });
      },
      footnote: (e) => void footnotes.push(e),
      citation: (e) => void citations.push(e),
      label: (e) => void labels.set(e.id, e),
      anchor: (id, kind, from, to) => {
        const prev = anchors.get(id);
        // Extend the range to span every text node carrying the mark.
        if (prev) prev.to = to;
        else anchors.set(id, { id, from, to, kind });
      },
    },
    // Phase 2a — a real-PM-node citation inside an exampleBlock is tagged with
    // the innermost enclosing example so its Omni card nests under the
    // example's card; a cite outside every example stays top-level.
    citationContainer: () =>
      exampleStack.length > 0
        ? { kind: "example", id: exampleStack[exampleStack.length - 1].id }
        : null,
  };

  doc.descendants((node, pos, parent) => {
    // Pop any exampleBlocks we've now walked past (the walk is depth-first in
    // document order, so once `pos` reaches a tracked example's `end` we've
    // left it). Done BEFORE collecting this node so a citation's enclosing
    // example reflects only blocks that actually contain it.
    while (exampleStack.length > 0 && pos >= exampleStack[exampleStack.length - 1].end) {
      exampleStack.pop();
    }

    visitingEnd = pos + node.nodeSize;
    extractEntitiesAt(node, pos, parent, ctx);

    return true;
  });

  return { blocks, headings, footnotes, citations, anchors, examples, figures, labels };
}

export function buildInitial(doc: PMNode): DocStructure {
  return {
    // version 3 (Phase 2a): `structure.citations` carries `nestedInContainerId`
    // — the generalized "container owner" — for BOTH footnote-nested cites
    // (`{kind:"footnote"}`, alongside the retained `nestedInFootnoteId`) and
    // example-nested cites (`{kind:"example"}`). version 2 (T3 / C10) added the
    // footnote-nested descent + `nestedInFootnoteId`. In-process sanity stamp
    // only — no persisted consumer reads it; it bumps per `applyDiff` after.
    version: 3,
    structuralVersion: nextStructuralVersion(),
    ...collectStructure(doc),
  };
}

/**
 * Map a `linkedAnchor` span the way the MARK moves. The mark is
 * `inclusive: false` (`linked-anchor.ts`), so text typed at either edge lands
 * OUTSIDE it: `from` sticks right (+1) and `to` sticks LEFT (−1). The default
 * (+1) assoc on `to` stretched the snapshot over every character typed just
 * after a highlight, with no diff to correct it (task 1493). Shared with the
 * step reconciler's prior-vs-live comparison, so the two cannot disagree about
 * where a mapped anchor lands.
 */
export function mapAnchorSpan(
  span: { from: number; to: number },
  mapping: { map(pos: number, assoc?: number): number },
): { from: number; to: number } {
  const from = mapping.map(span.from, 1);
  // A collapsed (empty) span stays collapsed rather than inverting.
  const to = Math.max(from, mapping.map(span.to, -1));
  return { from, to };
}

// ---------------------------------------------------------------------------
// Incremental apply — fold a diff into the previous snapshot.
// ---------------------------------------------------------------------------

/**
 * Fold one keyed, document-ordered table. The ONE rule for every array table
 * (task 1493 — it used to be five hand-copied loops):
 *
 *   - a REMOVED key drops every entry carrying it;
 *   - a CHANGED key's entries are REPLACED by the changed set for that key —
 *     the full live set, so a table holding two same-key entries (a pasted
 *     duplicate cite or footnote) can lose ONE of them: the reconciler reports
 *     the survivor as the key's new set, where an id-filtered removal dropped
 *     both;
 *   - a changed key the table does NOT hold is appended (fail-open: an entity
 *     reported as changed is live by definition, and dropping it would lose it
 *     from the snapshot silently);
 *   - added entries are appended; the result is re-sorted by position.
 *
 * Untouched (the previous array, by identity) when the diff names nothing for
 * this table and `force` is unset.
 */
function foldKeyed<E extends { pos: number }>(
  prev: readonly E[],
  removed: readonly E[],
  changed: readonly E[],
  added: readonly E[],
  keyOf: (e: E) => string,
  force = false,
): readonly E[] {
  if (removed.length === 0 && changed.length === 0 && added.length === 0 && !force) {
    return prev;
  }
  const removedKeys = new Set(removed.map(keyOf));
  const changedByKey = new Map<string, E[]>();
  for (const e of changed) {
    const k = keyOf(e);
    const list = changedByKey.get(k);
    if (list) list.push(e);
    else changedByKey.set(k, [e]);
  }
  const placed = new Set<string>();
  const next: E[] = [];
  for (const e of prev) {
    const k = keyOf(e);
    if (removedKeys.has(k)) continue;
    const replacement = changedByKey.get(k);
    if (!replacement) {
      next.push(e);
    } else if (!placed.has(k)) {
      placed.add(k);
      next.push(...replacement);
    }
  }
  for (const [k, list] of changedByKey) if (!placed.has(k)) next.push(...list);
  next.push(...added);
  next.sort((a, b) => a.pos - b.pos);
  return next;
}

/**
 * Returns a new `DocStructure` with `diff` folded in. The caller is
 * responsible for ensuring `diff` was produced from `prev`'s underlying
 * doc — passing a mismatched diff produces a stale snapshot.
 *
 * Implementation note: `headings`/`footnotes`/`examples`/`figures` are
 * arrays in document order. Insertion/removal preserves order by walking
 * the array linearly. The arrays are small (single-digit to low-hundreds
 * per doc); a sort-or-binary-search would be premature.
 */
export function applyDiff(prev: DocStructure, diff: StructureDiff): DocStructure {
  // Blocks — keyed by UUID, simplest case. `changedBlocks` carries the new
  // position of a MOVED block whose mapped pos went stale (its old pos was
  // deleted) — overwrite the entry so the index tracks the move.
  const blocks = new Map(prev.blocks);
  for (const removed of diff.removedBlocks) blocks.delete(removed.uuid);
  for (const added of diff.addedBlocks) blocks.set(added.uuid, added);
  for (const changed of diff.changedBlocks) blocks.set(changed.uuid, changed);

  // Headings: remove by UUID, fold in adds and changes. Re-sort by pos
  // afterwards so document order is preserved when positions shift.
  const headings = foldKeyed(
    prev.headings,
    diff.removedHeadings,
    diff.changedHeadings,
    diff.addedHeadings,
    (h) => h.uuid,
  );
  const footnotes = foldKeyed(
    prev.footnotes,
    diff.removedFootnotes,
    diff.changedFootnotes,
    diff.addedFootnotes,
    (f) => f.id,
  );
  const citations = foldKeyed(
    prev.citations,
    diff.removedCitations,
    diff.changedCitations,
    diff.addedCitations,
    (c) => c.id,
  );

  let anchors: ReadonlyMap<string, AnchorEntry> = prev.anchors;
  if (
    diff.addedAnchors.length > 0 ||
    diff.removedAnchors.length > 0 ||
    diff.changedAnchors.length > 0
  ) {
    const next = new Map(prev.anchors);
    for (const removed of diff.removedAnchors) next.delete(removed.id);
    for (const added of diff.addedAnchors) {
      // An "added" id that is already indexed (and was not removed in this
      // diff) is a NEW RUN of a live anchor — a mark laid over more text in a
      // later transaction. The diff carries only that run's span, so the entry
      // WIDENS to the union rather than being overwritten: the entry's
      // contract is that it BOUNDS every run of the mark (task 926 — the live
      // door `resolveLinkedAnchorRange` walks only this span, so a shrunken
      // entry would truncate a multi-run anchor). `prev` is already mapped into
      // the new doc's coordinates (the observer materializes before applying).
      const old = next.get(added.id);
      next.set(
        added.id,
        old
          ? { ...added, from: Math.min(old.from, added.from), to: Math.max(old.to, added.to) }
          : added,
      );
    }
    // A CHANGED anchor carries its exact live extent (task 1128 — a moved
    // run, a dropped boundary run): REPLACE, never widen, or the collapsed
    // residue of the old span would survive the union.
    for (const changed of diff.changedAnchors) next.set(changed.id, changed);
    anchors = next;
  }

  // Examples — same pattern as figures (added / removed / changed). A same-id
  // MOVE or renumber arrives as `changedExamples` carrying the NEW pos/number;
  // replace the entry in place so the index doesn't keep the moved example's
  // stale (deleted) position, then re-sort by pos.
  const examples = foldKeyed(
    prev.examples,
    diff.removedExamples,
    diff.changedExamples,
    diff.addedExamples,
    (e) => e.id,
    diff.exampleStructureChanged,
  );
  const figures = foldKeyed(
    prev.figures,
    diff.removedFigures,
    diff.changedFigures,
    diff.addedFigures,
    (f) => f.uuid,
  );

  let labels: ReadonlyMap<string, LabelEntry> = prev.labels;
  if (
    diff.addedLabels.length > 0 ||
    diff.removedLabels.length > 0 ||
    diff.changedLabels.length > 0
  ) {
    const next = new Map(prev.labels);
    for (const removed of diff.removedLabels) next.delete(removed.id);
    for (const added of diff.addedLabels) next.set(added.id, added);
    for (const changed of diff.changedLabels) next.set(changed.id, changed);
    labels = next;
  }

  return {
    version: prev.version + 1,
    structuralVersion: nextStructuralVersion(),
    blocks,
    headings,
    footnotes,
    citations,
    anchors,
    examples,
    figures,
    labels,
  };
}

// Re-export the empty constants so plugin code has a single import.
export { EMPTY_STRUCTURE };
