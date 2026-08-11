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
import { figureNodeEmitsCaption } from "@/lib/figures/env-body";
import {
  type AnchorEntry,
  type BlockEntry,
  type CitationEntry,
  deriveExampleIdentity,
  deriveParTitled,
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

  // Phase 2a — enclosing-exampleBlock tracking for example-NESTED citations.
  // A `\cite` inside an example body/item/gloss is a REAL PM node the walk
  // below already reaches and collects as a top-level `CitationEntry` — but
  // with no owner tag, so its Omni card floats free instead of nesting under
  // the example's card. We track a stack of currently-open exampleBlocks
  // `{ id, end }` and, when we hit a citation, stamp it with the innermost
  // enclosing example's id (`nestedInContainerId.kind === "example"`). The
  // stack is O(depth) and runs INSIDE the single load-only `buildInitial`
  // walk — no extra doc pass, and `applyDiff` never re-walks (keystroke
  // sanctity; see AGENTS.md "Card-source derivation"). `id` is the example's
  // `ExampleEntry.id` (first non-empty of uuid → tag → label, via the shared
  // `deriveExampleIdentity`) so it matches the example omni item key
  // `cardPopKey("example", id)` the nesting transform resolves.
  const exampleStack: { id: string; end: number }[] = [];

  // Walk top-level UUID-bearing blocks. For nested anchor-bearing marks
  // we need to descend into text-bearing content, so the walk is
  // recursive but only collects when a node's type matches a tracked
  // entity.
  doc.descendants((node, pos) => {
    const typeName = node.type.name;
    const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid;

    // Pop any exampleBlocks we've now walked past (the walk is depth-first in
    // document order, so once `pos` reaches a tracked example's `end` we've
    // left it). Done BEFORE collecting this node so a citation's enclosing
    // example reflects only blocks that actually contain it.
    while (exampleStack.length > 0 && pos >= exampleStack[exampleStack.length - 1].end) {
      exampleStack.pop();
    }

    // Anchorable block — every entity-bearing node has a UUID, including
    // headings / figureBlock / exampleBlock / paragraph / etc.
    if (uuid && isAnchorableNode(node.type)) {
      blocks.set(uuid, {
        uuid,
        pos,
        typeName,
        parTitled: deriveParTitled(node.attrs as Record<string, unknown>),
      });
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
        emitsCaption: figureNodeEmitsCaption(node),
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
      // Shared derivation with inspectNodeAt — see `deriveExampleIdentity`.
      const { id, uuid: exUuid, tag, label, number } = deriveExampleIdentity({
        uuid,
        tag: attrs.tag,
        label: attrs.label,
        number: attrs.number,
      });
      if (id) {
        examples.push({ id, uuid: exUuid, pos, tag, label, number });
        if (label) {
          labels.set(label, {
            id: label,
            owner: "example",
            ownerUuid: exUuid,
            pos,
          });
        }
        // Phase 2a — push this example onto the enclosing-block stack so any
        // citation collected while we're inside its range gets tagged as
        // example-nested. `end` is the position one past the block's close
        // token; we pop the stack when the walk reaches it (above).
        exampleStack.push({ id, end: pos + node.nodeSize });
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
            // Keep the legacy field working byte-for-byte (every existing
            // consumer reads it) AND populate the generalized container owner
            // so the render-side nesting covers footnote + example uniformly.
            nestedInFootnoteId: hostId,
            nestedInContainerId: { kind: "footnote", id: hostId },
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
        // Phase 2a — if this real-PM-node citation sits inside an exampleBlock,
        // tag it with the innermost enclosing example so its Omni card nests
        // under the example's card. A cite NOT inside any example keeps no
        // container owner (top-level), so it stays a flat card unchanged.
        const enclosingExample =
          exampleStack.length > 0
            ? exampleStack[exampleStack.length - 1].id
            : null;
        citations.push({
          id: attrs.citationId,
          pos,
          command: attrs.command ?? "",
          displayText: attrs.displayText ?? "",
          ...(enclosingExample
            ? { nestedInContainerId: { kind: "example", id: enclosingExample } }
            : {}),
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
    // version 3 (Phase 2a): `structure.citations` carries `nestedInContainerId`
    // — the generalized "container owner" — for BOTH footnote-nested cites
    // (`{kind:"footnote"}`, alongside the retained `nestedInFootnoteId`) and
    // example-nested cites (`{kind:"example"}`). version 2 (T3 / C10) added the
    // footnote-nested descent + `nestedInFootnoteId`. In-process sanity stamp
    // only — no persisted consumer reads it; it bumps per `applyDiff` after.
    version: 3,
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
        // The container-nesting tag (`nestedInContainerId` / `nestedInFootnoteId`)
        // is stamped ONLY by the load-only `buildInitial` descend pass — it needs
        // the enclosing example/footnote, which `applyDiff` can't see (it gets
        // only `(prev, diff)`, no doc, and `ExampleEntry` has no end-extent). The
        // step-inspector rebuilds a `changedCitations` entry from the citation
        // node's attrs ALONE (`{id, pos, command, displayText}`), so it drops the
        // tag. A `changedCitations` entry is an in-place attr edit (citekey edit)
        // or an atom MOVE — neither removes the cite from its container in the
        // common case — so carry the PRIOR entry's owner tag forward when the
        // rebuilt entry lacks one, or an example/footnote-nested cite would
        // visibly un-nest to a flat card on every edit until the next reload.
        //
        // Accepted edge: a cite MOVED OUT of its example/footnote keeps a stale
        // tag here (we can't detect the exit without container extents). It
        // self-heals on the next reload, when `buildInitial` re-runs the descend
        // pass and re-derives ownership — matching the Phase-1 footnote behavior.
        // Low-severity + self-healing, so accepted.
        next.push(
          (c.nestedInContainerId || c.nestedInFootnoteId) &&
            !changed.nestedInContainerId &&
            !changed.nestedInFootnoteId
            ? {
                ...changed,
                ...(c.nestedInContainerId
                  ? { nestedInContainerId: c.nestedInContainerId }
                  : {}),
                ...(c.nestedInFootnoteId
                  ? { nestedInFootnoteId: c.nestedInFootnoteId }
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
    for (const added of diff.addedAnchors) next.set(added.id, added);
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
