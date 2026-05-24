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
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
} from "@tiptap/pm/transform";
import { isAnchorableNode } from "@/lib/marginalia";
import {
  type AnchorEntry,
  type BlockEntry,
  type DocStructure,
  EMPTY_DIFF,
  type ExampleEntry,
  type FigureEntry,
  type FootnoteEntry,
  type HeadingEntry,
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
  anchors: Map<string, AnchorEntry>;
  examples: Map<string, ExampleEntry>;
  figures: Map<string, FigureEntry>;
  labels: Map<string, LabelEntry>;
}

function emptyBundle(): EntityBundle {
  return {
    blocks: new Map(),
    headings: new Map(),
    footnotes: new Map(),
    anchors: new Map(),
    examples: new Map(),
    figures: new Map(),
    labels: new Map(),
  };
}

/**
 * Inspect ONE node (including its own attrs/text and any linkedAnchor
 * marks if it's a text node). Does not recurse — the visitor below
 * handles recursion explicitly so position math stays correct.
 */
function inspectNodeAt(n: PMNode, pos: number, out: EntityBundle): void {
  const typeName = n.type.name;
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    const uuid = (attrs.uuid as string | null | undefined) ?? null;

    if (uuid && isAnchorableNode(n.type)) {
      out.blocks.set(uuid, { uuid, pos, typeName });
    }

    if (typeName === "heading" && uuid) {
      out.headings.set(uuid, {
        uuid,
        pos,
        level: (attrs.level as number | undefined) ?? 1,
        text: n.textContent,
        label: (attrs.label as string | null | undefined) ?? null,
        numbered: attrs.numbered !== false,
      });
      if (typeof attrs.label === "string" && attrs.label) {
        out.labels.set(attrs.label, {
          id: attrs.label,
          owner: "heading",
          ownerUuid: uuid,
          pos,
        });
      }
    }

    if (typeName === "figureBlock" && uuid) {
      out.figures.set(uuid, {
        uuid,
        pos,
        label: (attrs.label as string | undefined) ?? "",
        numbered: attrs.numbered !== false,
        number: (attrs.figureNumber as number | null | undefined) ?? null,
      });
      if (typeof attrs.label === "string" && attrs.label) {
        out.labels.set(attrs.label, {
          id: attrs.label,
          owner: "figure",
          ownerUuid: uuid,
          pos,
        });
      }
    }

    if (typeName === "exampleBlock") {
      const tag = (attrs.tag as string | undefined) ?? "";
      const label = (attrs.label as string | undefined) ?? "";
      const id = uuid ?? tag ?? label ?? "";
      if (id) {
        out.examples.set(id, {
          id,
          uuid: uuid ?? null,
          pos,
          tag,
          label,
          number: (attrs.number as string | number | null | undefined) ?? null,
        });
        if (label) {
          out.labels.set(label, {
            id: label,
            owner: "example",
            ownerUuid: uuid ?? null,
            pos,
          });
        }
      }
    }

    if (typeName === "exampleItem") {
      const label = (attrs.label as string | undefined) ?? "";
      if (label) {
        out.labels.set(label, {
          id: label,
          owner: "exampleItem",
          ownerUuid: null,
          pos,
        });
      }
    }

    if (typeName === "footnote") {
      const id = (attrs.footnoteId as string | undefined) ?? "";
      if (id) {
        out.footnotes.set(id, {
          id,
          pos,
          thanks: !!attrs.thanks,
          number: (attrs.number as number | undefined) ?? 0,
        });
      }
    }

    // Linked-anchor marks ride on text nodes.
    if (n.isText && n.marks.length > 0) {
      for (const mark of n.marks) {
        if (mark.type.name !== "linkedAnchor") continue;
        const mAttrs = mark.attrs as { anchorId?: string; kind?: string };
        const id = mAttrs.anchorId ?? "";
        if (!id) continue;
        const prev = out.anchors.get(id);
        if (prev) {
          // Extend the right edge if the mark spans multiple text runs.
          prev.to = pos + n.nodeSize;
        } else {
          out.anchors.set(id, {
            id,
            from: pos,
            to: pos + n.nodeSize,
            kind: mAttrs.kind ?? "note",
          });
        }
      }
    }
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
 */
function collectRange(doc: PMNode, from: number, to: number, out: EntityBundle): void {
  if (to <= from) return;
  const clampedTo = Math.min(to, doc.content.size);
  const clampedFrom = Math.max(from, 0);
  if (clampedTo <= clampedFrom) return;
  doc.nodesBetween(clampedFrom, clampedTo, (n, pos) => {
    if (n.isText) {
      inspectNodeAt(n, pos, out);
    } else if (pos >= clampedFrom && pos < clampedTo) {
      // Block-level node that starts inside the range. Whether its
      // body extends past `to` doesn't matter — if its opening token
      // got deleted, its identity is gone in newDoc.
      inspectNodeAt(n, pos, out);
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Heading structural-attr comparison.
// ---------------------------------------------------------------------------

/**
 * Returns true iff two heading entries differ in any attribute that
 * affects numbering / outline structure. Text-only differences do not
 * count — those go into `contentChangedUuids` instead, keeping
 * heading-typing off the numberer's wake path.
 */
function headingStructurallyChanged(a: HeadingEntry, b: HeadingEntry): boolean {
  return a.level !== b.level || a.label !== b.label || a.numbered !== b.numbered;
}

function figureStructurallyChanged(a: FigureEntry, b: FigureEntry): boolean {
  return a.label !== b.label || a.numbered !== b.numbered;
}

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
    if (!isAnchorableNode(node.type)) continue;
    const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid;
    if (uuid) return uuid;
  }
  return null;
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
): StructureDiff {
  if (!tr.docChanged) return EMPTY_DIFF;

  const removed = emptyBundle();
  const added = emptyBundle();
  const contentChangedUuids = new Set<string>();
  let footnoteOrderChanged = false;

  for (let stepIndex = 0; stepIndex < tr.steps.length; stepIndex++) {
    const step = tr.steps[stepIndex] as Step;
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      // Range-walk both states. The mapping for [step.from, step.to] in
      // oldDoc → newDoc is obtained from `tr.mapping.slice(stepIndex, 1)`:
      // the partial mapping of this step alone. The post-step state is
      // then carried forward by `tr.mapping.slice(stepIndex + 1)` to
      // map onto the final newDoc. We compose them implicitly by using
      // `tr.mapping.map` with the proper bias.
      // For mapping a range that's been changed by the step:
      //   fromInNew uses bias=-1 (stay left of the inserted content)
      //   toInNew uses bias=+1 (stay right of the inserted content)
      // so the resulting range covers everything that landed in newDoc.
      const fromInNew = tr.mapping.map(step.from, -1);
      const toInNew = tr.mapping.map(step.to, 1);

      collectRange(oldDoc, step.from, step.to, removed);
      collectRange(newDoc, fromInNew, toInNew, added);

      // Attribute content-change to nearest anchorable ancestor in newDoc.
      const uuid = nearestAnchorableUuid(newDoc, fromInNew);
      if (uuid) contentChangedUuids.add(uuid);

      // Footnotes whose pos changed need a renumber check too.
      if (removed.footnotes.size > 0 || added.footnotes.size > 0) {
        footnoteOrderChanged = true;
      }
      continue;
    }

    if (step instanceof AddMarkStep || step instanceof AddNodeMarkStep) {
      if (step.mark.type.name === "linkedAnchor") {
        const attrs = step.mark.attrs as { anchorId?: string; kind?: string };
        const id = attrs.anchorId ?? "";
        if (id) {
          const from = "from" in step ? step.from : (step as { pos: number }).pos;
          const to = "to" in step ? step.to : (step as { pos: number }).pos + 1;
          const prev = added.anchors.get(id);
          if (prev) {
            prev.from = Math.min(prev.from, from);
            prev.to = Math.max(prev.to, to);
          } else {
            added.anchors.set(id, {
              id,
              from,
              to,
              kind: attrs.kind ?? "note",
            });
          }
        }
      }
      continue;
    }

    if (step instanceof RemoveMarkStep || step instanceof RemoveNodeMarkStep) {
      if (step.mark.type.name === "linkedAnchor") {
        const attrs = step.mark.attrs as { anchorId?: string; kind?: string };
        const id = attrs.anchorId ?? "";
        if (id) {
          const from = "from" in step ? step.from : (step as { pos: number }).pos;
          const to = "to" in step ? step.to : (step as { pos: number }).pos + 1;
          removed.anchors.set(id, {
            id,
            from,
            to,
            kind: attrs.kind ?? "note",
          });
        }
      }
      continue;
    }

    if (step instanceof AttrStep) {
      // Find the affected node in both states. If it's a tracked node
      // type and the attribute is one we care about, emit a change.
      const oldNode = oldDoc.nodeAt(step.pos);
      const newNode = newDoc.nodeAt(step.pos);
      if (!oldNode || !newNode) continue;
      const typeName = newNode.type.name;
      const attr = step.attr;
      const oldAttrs = (oldNode.attrs ?? {}) as Record<string, unknown>;
      const newAttrs = (newNode.attrs ?? {}) as Record<string, unknown>;
      const oldUuid = (oldAttrs.uuid as string | null | undefined) ?? null;
      const newUuid = (newAttrs.uuid as string | null | undefined) ?? null;

      // UUID transitions: lazy hydration of anchorable identity. Three
      // cases — birth (null → uuid), death (uuid → null), and rename
      // (uuid1 → uuid2). The "rename" case is the post-split hydration:
      // the cloned block gets its duplicate UUID replaced with a fresh
      // one, which we surface as remove-old + add-new so downstream
      // consumers (in-text positions, marginalia registry) see a real
      // block being born.
      if (attr === "uuid" && isAnchorableNode(newNode.type)) {
        if (oldUuid !== newUuid) {
          if (oldUuid) {
            removed.blocks.set(oldUuid, { uuid: oldUuid, pos: step.pos, typeName });
          }
          if (newUuid) {
            added.blocks.set(newUuid, { uuid: newUuid, pos: step.pos, typeName });
          }
        }
      }

      if (typeName === "heading" && newUuid) {
        // Build candidate entries for both states so the diff logic can
        // distinguish text-only vs structural attrs cleanly.
        if (attr === "level" || attr === "label" || attr === "numbered") {
          // Synthesize old + new heading entries so the structural-change
          // comparison can drive `changedHeadings` below.
          if (oldUuid) {
            removed.headings.set(oldUuid, {
              uuid: oldUuid,
              pos: step.pos,
              level: (oldAttrs.level as number | undefined) ?? 1,
              text: oldNode.textContent,
              label: (oldAttrs.label as string | null | undefined) ?? null,
              numbered: oldAttrs.numbered !== false,
            });
          }
          added.headings.set(newUuid, {
            uuid: newUuid,
            pos: step.pos,
            level: (newAttrs.level as number | undefined) ?? 1,
            text: newNode.textContent,
            label: (newAttrs.label as string | null | undefined) ?? null,
            numbered: newAttrs.numbered !== false,
          });
        }
      }

      if (typeName === "figureBlock" && newUuid) {
        if (attr === "label" || attr === "numbered") {
          if (oldUuid) {
            removed.figures.set(oldUuid, {
              uuid: oldUuid,
              pos: step.pos,
              label: (oldAttrs.label as string | undefined) ?? "",
              numbered: oldAttrs.numbered !== false,
              number: (oldAttrs.figureNumber as number | null | undefined) ?? null,
            });
          }
          added.figures.set(newUuid, {
            uuid: newUuid,
            pos: step.pos,
            label: (newAttrs.label as string | undefined) ?? "",
            numbered: newAttrs.numbered !== false,
            number: (newAttrs.figureNumber as number | null | undefined) ?? null,
          });
        }
      }

      if (typeName === "footnote") {
        // `thanks` flips affect numbering parity. `footnoteId` changes
        // are renames — treat as remove+add.
        if (attr === "footnoteId" || attr === "thanks") {
          const oldId = (oldAttrs.footnoteId as string | undefined) ?? "";
          const newId = (newAttrs.footnoteId as string | undefined) ?? "";
          if (oldId) {
            removed.footnotes.set(oldId, {
              id: oldId,
              pos: step.pos,
              thanks: !!oldAttrs.thanks,
              number: (oldAttrs.number as number | undefined) ?? 0,
            });
          }
          if (newId) {
            added.footnotes.set(newId, {
              id: newId,
              pos: step.pos,
              thanks: !!newAttrs.thanks,
              number: (newAttrs.number as number | undefined) ?? 0,
            });
          }
          footnoteOrderChanged = true;
        }
      }
      continue;
    }

    // Unknown step kind: conservatively bump version via contentChangedUuids
    // for the nearest enclosing block, so consumers re-read if they need to.
    // No bundled-entity adds/removes.
  }

  // -------------------------------------------------------------------------
  // Reconcile added vs removed.
  // -------------------------------------------------------------------------

  // Blocks. Filter out duplicate-UUID adds: if a UUID is in added but
  // also already in prevStructure.blocks (and not in removed), it's a
  // lazy-hydration clone — drop the add and route it through
  // `contentChangedUuids` instead so consumers don't overwrite the
  // original block's position.
  const addedBlocks: BlockEntry[] = [];
  const removedBlocks: BlockEntry[] = [];
  const prevBlocks = prevStructure?.blocks;
  for (const [uuid, entry] of added.blocks) {
    if (removed.blocks.has(uuid)) continue;
    if (prevBlocks?.has(uuid)) {
      // Duplicate-UUID transient state from split/clone. Mark the
      // existing UUID's content as changed instead of adding a phantom.
      contentChangedUuids.add(uuid);
      continue;
    }
    addedBlocks.push(entry);
  }
  for (const [uuid, entry] of removed.blocks) {
    if (added.blocks.has(uuid)) continue;
    if (prevBlocks && !prevBlocks.has(uuid)) {
      // UUID was never in oldDoc's structure index — likely a stale
      // partial slice extraction. Skip.
      continue;
    }
    removedBlocks.push(entry);
  }

  // Headings: separate added / removed / structurally-changed.
  const addedHeadings: HeadingEntry[] = [];
  const removedHeadings: HeadingEntry[] = [];
  const changedHeadings: HeadingEntry[] = [];
  for (const [uuid, entry] of added.headings) {
    const wasRemoved = removed.headings.get(uuid);
    if (!wasRemoved) {
      addedHeadings.push(entry);
    } else if (headingStructurallyChanged(wasRemoved, entry)) {
      changedHeadings.push(entry);
    }
    // else: same-UUID, no structural change → don't emit; text changes
    // flow through contentChangedUuids if anywhere.
  }
  for (const [uuid, entry] of removed.headings) {
    if (!added.headings.has(uuid)) removedHeadings.push(entry);
  }
  // Mark contentChangedUuids for surviving headings — text may have
  // changed via the ReplaceStep that triggered the attribute step.
  for (const [uuid] of added.headings) {
    if (removed.headings.has(uuid)) contentChangedUuids.add(uuid);
  }

  // Footnotes.
  const addedFootnotes: FootnoteEntry[] = [];
  const removedFootnotes: FootnoteEntry[] = [];
  for (const [id, entry] of added.footnotes) {
    if (!removed.footnotes.has(id)) addedFootnotes.push(entry);
  }
  for (const [id, entry] of removed.footnotes) {
    if (!added.footnotes.has(id)) removedFootnotes.push(entry);
  }

  // Anchors.
  const addedAnchors: AnchorEntry[] = [];
  const removedAnchors: AnchorEntry[] = [];
  for (const [id, entry] of added.anchors) {
    if (!removed.anchors.has(id)) addedAnchors.push(entry);
  }
  for (const [id, entry] of removed.anchors) {
    if (!added.anchors.has(id)) removedAnchors.push(entry);
  }

  // Examples.
  const addedExamples: ExampleEntry[] = [];
  const removedExamples: ExampleEntry[] = [];
  let exampleStructureChanged = false;
  for (const [id, entry] of added.examples) {
    if (!removed.examples.has(id)) {
      addedExamples.push(entry);
      exampleStructureChanged = true;
    }
  }
  for (const [id, entry] of removed.examples) {
    if (!added.examples.has(id)) {
      removedExamples.push(entry);
      exampleStructureChanged = true;
    }
  }

  // Figures.
  const addedFigures: FigureEntry[] = [];
  const removedFigures: FigureEntry[] = [];
  const changedFigures: FigureEntry[] = [];
  for (const [uuid, entry] of added.figures) {
    const wasRemoved = removed.figures.get(uuid);
    if (!wasRemoved) {
      addedFigures.push(entry);
    } else if (figureStructurallyChanged(wasRemoved, entry)) {
      changedFigures.push(entry);
    }
  }
  for (const [uuid, entry] of removed.figures) {
    if (!added.figures.has(uuid)) removedFigures.push(entry);
  }

  // Labels.
  const addedLabels: LabelEntry[] = [];
  const removedLabels: LabelEntry[] = [];
  for (const [id, entry] of added.labels) {
    if (!removed.labels.has(id)) addedLabels.push(entry);
  }
  for (const [id, entry] of removed.labels) {
    if (!added.labels.has(id)) removedLabels.push(entry);
  }

  // Fast-path: if all categories are empty, return the shared EMPTY_DIFF
  // singleton so consumers can `=== EMPTY_DIFF` for the no-op check.
  if (
    addedBlocks.length === 0 &&
    removedBlocks.length === 0 &&
    addedHeadings.length === 0 &&
    removedHeadings.length === 0 &&
    changedHeadings.length === 0 &&
    addedFootnotes.length === 0 &&
    removedFootnotes.length === 0 &&
    !footnoteOrderChanged &&
    addedAnchors.length === 0 &&
    removedAnchors.length === 0 &&
    addedExamples.length === 0 &&
    removedExamples.length === 0 &&
    !exampleStructureChanged &&
    addedFigures.length === 0 &&
    removedFigures.length === 0 &&
    changedFigures.length === 0 &&
    addedLabels.length === 0 &&
    removedLabels.length === 0 &&
    contentChangedUuids.size === 0
  ) {
    return EMPTY_DIFF;
  }

  return {
    addedBlocks,
    removedBlocks,
    addedHeadings,
    removedHeadings,
    changedHeadings,
    addedFootnotes,
    removedFootnotes,
    footnoteOrderChanged,
    addedAnchors,
    removedAnchors,
    addedExamples,
    removedExamples,
    exampleStructureChanged,
    addedFigures,
    removedFigures,
    changedFigures,
    addedLabels,
    removedLabels,
    contentChangedUuids,
  };
}
