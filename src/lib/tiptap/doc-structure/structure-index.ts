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
import type { JSONContent } from "@tiptap/react";
import { inlineAtoms } from "@/lib/inline-content";
import { extractEntitiesAt, type ExtractContext } from "./entity-extractor";
import {
  type AnchorEntry,
  type BlockEntry,
  type CitationEntry,
  citationEntryAt,
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

export function buildInitial(doc: PMNode): DocStructure {
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

    if (node.type.name === "footnote") {
      const attrs = node.attrs as {
        footnoteId?: string;
        content?: JSONContent | null;
      };
      // T3 / C10 — LOAD-ONLY descend into the footnote body literal so a
      // footnote-NESTED citation surfaces in `structure.citations` for
      // omni/search (`BIB-F3-01` / `CI-F3-01`). `descendants()` cannot enter
      // an atom's `attrs.content` (the footnote is `inline:true, atom:true`),
      // so we hand the JSONContent literal to the shared atom-aware reader.
      // This runs ONCE per footnote during the initial O(doc) walk; the
      // per-transaction `applyDiff` path never re-walks a footnote body, so
      // keystroke sanctity is preserved. The nested cite has no own PM node —
      // its address is the HOST footnote's `pos` plus `nestedInFootnoteId`.
      //
      // `hostId` MUST be the RAW `footnoteId` — the same id `FootnoteEntry.id`
      // carries (via `extractEntitiesAt`) and the footnote omni item is keyed by
      // (`popKey("footnotes", fn.footnoteId)` / `cardPopKey("footnote", …)`).
      // Do NOT prefer `linkId`: when a footnote has a non-empty `linkId` that
      // differs from `footnoteId`, a `linkId`-derived host would never match
      // the footnote item's key, so `nest-footnote-children.ts` would silently
      // degrade the nested cite to a flat card instead of nesting it.
      const hostId = attrs.footnoteId || "";
      const body = attrs.content;
      if (body && typeof body === "object") {
        for (const hit of inlineAtoms(body)) {
          if (hit.kind !== "citation" || !hit.id) continue;
          // The legacy `nestedInFootnoteId` (every existing consumer reads it)
          // is mirrored from the container by `citationEntryAt`, so the
          // render-side nesting covers footnote + example uniformly.
          citations.push(
            citationEntryAt({
              id: hit.id,
              pos,
              command: hit.command,
              displayText: hit.displayText,
              container: { kind: "footnote", id: hostId },
            }),
          );
        }
      }
    }

    return true;
  });

  return {
    // version 3 (Phase 2a): `structure.citations` carries `nestedInContainerId`
    // — the generalized "container owner" — for BOTH footnote-nested cites
    // (`{kind:"footnote"}`, alongside the retained `nestedInFootnoteId`) and
    // example-nested cites (`{kind:"example"}`). version 2 (T3 / C10) added the
    // footnote-nested descent + `nestedInFootnoteId`. In-process sanity stamp
    // only — no persisted consumer reads it; it bumps per `applyDiff` after.
    version: 3,
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

// ---------------------------------------------------------------------------
// Incremental apply — fold a diff into the previous snapshot.
// ---------------------------------------------------------------------------

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
  let headings: readonly HeadingEntry[] = prev.headings;
  if (
    diff.removedHeadings.length > 0 ||
    diff.addedHeadings.length > 0 ||
    diff.changedHeadings.length > 0
  ) {
    const removedUuids = new Set(diff.removedHeadings.map((h) => h.uuid));
    const changedByUuid = new Map(diff.changedHeadings.map((h) => [h.uuid, h]));
    const next: HeadingEntry[] = [];
    for (const h of prev.headings) {
      if (removedUuids.has(h.uuid)) continue;
      next.push(changedByUuid.get(h.uuid) ?? h);
    }
    for (const added of diff.addedHeadings) next.push(added);
    next.sort((a, b) => a.pos - b.pos);
    headings = next;
  }

  // Footnotes: same pattern. Footnote-order change just means the array
  // order is now wrong relative to current numbers — the consumer of
  // `footnoteOrderChanged` is responsible for the renumber tx.
  let footnotes: readonly FootnoteEntry[] = prev.footnotes;
  if (
    diff.addedFootnotes.length > 0 ||
    diff.removedFootnotes.length > 0 ||
    diff.changedFootnotes.length > 0
  ) {
    const removedIds = new Set(diff.removedFootnotes.map((f) => f.id));
    const changedById = new Map(diff.changedFootnotes.map((f) => [f.id, f]));
    const next: FootnoteEntry[] = [];
    for (const f of prev.footnotes) {
      if (removedIds.has(f.id)) continue;
      // A moved footnote's mapped position is stale (its old pos was
      // deleted); the changed entry carries the correct new position.
      next.push(changedById.get(f.id) ?? f);
    }
    for (const added of diff.addedFootnotes) next.push(added);
    next.sort((a, b) => a.pos - b.pos);
    footnotes = next;
  }

  // Citations: added / removed / changed (same-id attr edits). Re-sort by
  // pos so document order survives moves. A pure reorder (citationOrderChanged
  // only, no add/remove/change) is already reflected by the per-tx position
  // mapping in the observer plugin, so it needs no array rebuild here.
  let citations: readonly CitationEntry[] = prev.citations;
  if (
    diff.addedCitations.length > 0 ||
    diff.removedCitations.length > 0 ||
    diff.changedCitations.length > 0
  ) {
    const removedIds = new Set(diff.removedCitations.map((c) => c.id));
    const changedById = new Map(diff.changedCitations.map((c) => [c.id, c]));
    const next: CitationEntry[] = [];
    for (const c of prev.citations) {
      if (removedIds.has(c.id)) continue;
      const changed = changedById.get(c.id);
      if (changed) {
        // The two container KINDS reach this point differently, so they are
        // reconciled differently.
        //
        //  - `"example"` is now derived on BOTH paths: the step-inspector
        //    resolves the cite's ancestors and stamps the tag through the same
        //    `citationEntryAt` the load walk uses. The rebuilt entry is
        //    therefore AUTHORITATIVE about example nesting — carrying the prior
        //    tag forward would resurrect it for a cite that genuinely moved OUT
        //    of its example (the "accepted edge" this comment used to record;
        //    it no longer needs accepting).
        //  - `"footnote"` stays load-only: such a cite has no PM node of its
        //    own (it is a JSONContent literal inside the host footnote's
        //    `attrs.content`), so no step ever reaches it and the rebuilt entry
        //    cannot know. Carry it forward, or a footnote-nested cite would
        //    visibly un-nest to a flat card on every edit until the next
        //    reload. Its stale-on-exit edge remains accepted and self-heals on
        //    the next load.
        const keepsFootnoteTag =
          (c.nestedInFootnoteId || c.nestedInContainerId?.kind === "footnote") &&
          !changed.nestedInFootnoteId &&
          !changed.nestedInContainerId;
        next.push(
          keepsFootnoteTag
            ? {
                ...changed,
                ...(c.nestedInFootnoteId
                  ? { nestedInFootnoteId: c.nestedInFootnoteId }
                  : {}),
                ...(c.nestedInContainerId
                  ? { nestedInContainerId: c.nestedInContainerId }
                  : {}),
              }
            : changed,
        );
      } else {
        next.push(c);
      }
    }
    for (const added of diff.addedCitations) next.push(added);
    next.sort((a, b) => a.pos - b.pos);
    citations = next;
  }

  // Anchors — keyed Map.
  let anchors: ReadonlyMap<string, AnchorEntry> = prev.anchors;
  if (diff.addedAnchors.length > 0 || diff.removedAnchors.length > 0) {
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
    anchors = next;
  }

  // Examples — same pattern as figures (added / removed / changed). A same-id
  // MOVE or renumber arrives as `changedExamples` carrying the NEW pos/number;
  // replace the entry in place so the index doesn't keep the moved example's
  // stale (deleted) position, then re-sort by pos.
  let examples: readonly ExampleEntry[] = prev.examples;
  if (
    diff.addedExamples.length > 0 ||
    diff.removedExamples.length > 0 ||
    diff.changedExamples.length > 0 ||
    diff.exampleStructureChanged
  ) {
    const removedIds = new Set(diff.removedExamples.map((e) => e.id));
    const changedById = new Map(diff.changedExamples.map((e) => [e.id, e]));
    const next: ExampleEntry[] = [];
    for (const e of prev.examples) {
      if (removedIds.has(e.id)) continue;
      next.push(changedById.get(e.id) ?? e);
    }
    for (const added of diff.addedExamples) next.push(added);
    next.sort((a, b) => a.pos - b.pos);
    examples = next;
  }

  // Figures — same pattern as headings (added / removed / changed).
  let figures: readonly FigureEntry[] = prev.figures;
  if (
    diff.addedFigures.length > 0 ||
    diff.removedFigures.length > 0 ||
    diff.changedFigures.length > 0
  ) {
    const removedUuids = new Set(diff.removedFigures.map((f) => f.uuid));
    const changedByUuid = new Map(diff.changedFigures.map((f) => [f.uuid, f]));
    const next: FigureEntry[] = [];
    for (const f of prev.figures) {
      if (removedUuids.has(f.uuid)) continue;
      next.push(changedByUuid.get(f.uuid) ?? f);
    }
    for (const added of diff.addedFigures) next.push(added);
    next.sort((a, b) => a.pos - b.pos);
    figures = next;
  }

  // Labels — keyed Map.
  let labels: ReadonlyMap<string, LabelEntry> = prev.labels;
  if (diff.addedLabels.length > 0 || diff.removedLabels.length > 0) {
    const next = new Map(prev.labels);
    for (const removed of diff.removedLabels) next.delete(removed.id);
    for (const added of diff.addedLabels) next.set(added.id, added);
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
