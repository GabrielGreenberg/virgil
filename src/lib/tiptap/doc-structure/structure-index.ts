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
import { isAnchorableNode } from "@/lib/marginalia";
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

  // Walk top-level UUID-bearing blocks. For nested anchor-bearing marks
  // we need to descend into text-bearing content, so the walk is
  // recursive but only collects when a node's type matches a tracked
  // entity.
  doc.descendants((node, pos) => {
    const typeName = node.type.name;
    const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid;

    // Anchorable block — every entity-bearing node has a UUID, including
    // headings / figureBlock / exampleBlock / paragraph / etc.
    if (uuid && isAnchorableNode(node.type)) {
      blocks.set(uuid, { uuid, pos, typeName });
    }

    if (typeName === "heading" && uuid) {
      const attrs = node.attrs as {
        level?: number;
        label?: string | null;
        numbered?: boolean;
      };
      headings.push({
        uuid,
        pos,
        level: attrs.level ?? 1,
        text: node.textContent,
        label: attrs.label ?? null,
        numbered: attrs.numbered !== false,
      });
      if (attrs.label) {
        labels.set(attrs.label, {
          id: attrs.label,
          owner: "heading",
          ownerUuid: uuid,
          pos,
        });
      }
    }

    if (typeName === "figureBlock" && uuid) {
      const attrs = node.attrs as {
        label?: string;
        numbered?: boolean;
        figureNumber?: number | null;
      };
      figures.push({
        uuid,
        pos,
        label: attrs.label ?? "",
        numbered: attrs.numbered !== false,
        number: attrs.figureNumber ?? null,
      });
      if (attrs.label) {
        labels.set(attrs.label, {
          id: attrs.label,
          owner: "figure",
          ownerUuid: uuid,
          pos,
        });
      }
    }

    if (typeName === "exampleBlock") {
      const attrs = node.attrs as {
        tag?: string;
        label?: string;
        number?: string | number | null;
      };
      const id = uuid ?? attrs.tag ?? attrs.label ?? "";
      if (id) {
        examples.push({
          id,
          uuid: uuid ?? null,
          pos,
          tag: attrs.tag ?? "",
          label: attrs.label ?? "",
          number: attrs.number ?? null,
        });
        if (attrs.label) {
          labels.set(attrs.label, {
            id: attrs.label,
            owner: "example",
            ownerUuid: uuid ?? null,
            pos,
          });
        }
      }
    }

    if (typeName === "exampleItem") {
      const attrs = node.attrs as { label?: string };
      if (attrs.label) {
        labels.set(attrs.label, {
          id: attrs.label,
          owner: "exampleItem",
          ownerUuid: null,
          pos,
        });
      }
    }

    if (typeName === "footnote") {
      const attrs = node.attrs as {
        footnoteId?: string;
        linkId?: string;
        thanks?: boolean;
        number?: number;
        content?: JSONContent | null;
      };
      if (attrs.footnoteId) {
        footnotes.push({
          id: attrs.footnoteId,
          pos,
          thanks: !!attrs.thanks,
          number: attrs.number ?? 0,
        });
      }

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
      // carries (line ~158) and the footnote omni item is keyed by
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
          citations.push({
            id: hit.id,
            pos,
            command: hit.command ?? "",
            displayText: hit.displayText ?? "",
            nestedInFootnoteId: hostId,
          });
        }
      }
    }

    if (typeName === "citation") {
      const attrs = node.attrs as {
        citationId?: string;
        command?: string;
        displayText?: string;
      };
      if (attrs.citationId) {
        citations.push({
          id: attrs.citationId,
          pos,
          command: attrs.command ?? "",
          displayText: attrs.displayText ?? "",
        });
      }
    }

    // Inline linked-anchor marks live on text nodes — collect by mark.
    if (node.isText && node.marks.length > 0) {
      for (const mark of node.marks) {
        if (mark.type.name !== "linkedAnchor") continue;
        const attrs = mark.attrs as { anchorId?: string; kind?: string };
        if (!attrs.anchorId) continue;
        const prev = anchors.get(attrs.anchorId);
        if (prev) {
          // Extend the range to span every text node carrying the mark.
          prev.to = pos + node.nodeSize;
        } else {
          anchors.set(attrs.anchorId, {
            id: attrs.anchorId,
            from: pos,
            to: pos + node.nodeSize,
            kind: attrs.kind ?? "note",
          });
        }
      }
    }

    return true;
  });

  return {
    // version 2 (T3 / C10): `structure.citations` now includes footnote-nested
    // citations carrying `nestedInFootnoteId`. In-process sanity stamp only —
    // no persisted consumer reads it; it bumps per `applyDiff` thereafter.
    version: 2,
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
      next.push(changedById.get(c.id) ?? c);
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
    for (const added of diff.addedAnchors) next.set(added.id, added);
    anchors = next;
  }

  // Examples — same pattern as headings.
  let examples: readonly ExampleEntry[] = prev.examples;
  if (
    diff.addedExamples.length > 0 ||
    diff.removedExamples.length > 0 ||
    diff.exampleStructureChanged
  ) {
    const removedIds = new Set(diff.removedExamples.map((e) => e.id));
    const next: ExampleEntry[] = [];
    for (const e of prev.examples) {
      if (!removedIds.has(e.id)) next.push(e);
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
