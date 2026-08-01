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
  type CitationEntry,
  type DocStructure,
  deriveExampleIdentity,
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
}

function emptyBundle(): EntityBundle {
  return {
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
      // Shared derivation with buildInitial — see `deriveExampleIdentity`.
      const { id, uuid: exUuid, tag, label, number } = deriveExampleIdentity({
        uuid,
        tag: attrs.tag as string | null | undefined,
        label: attrs.label as string | null | undefined,
        number: attrs.number as string | number | null | undefined,
      });
      if (id) {
        out.examples.set(id, { id, uuid: exUuid, pos, tag, label, number });
        if (label) {
          out.labels.set(label, {
            id: label,
            owner: "example",
            ownerUuid: exUuid,
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

    if (typeName === "citation") {
      const id = (attrs.citationId as string | undefined) ?? "";
      if (id) {
        out.citations.set(id, {
          id,
          pos,
          command: (attrs.command as string | undefined) ?? "",
          displayText: (attrs.displayText as string | undefined) ?? "",
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

/**
 * Returns true iff two citation entries differ in a way the cards show —
 * the LaTeX command (which `keys` are parsed from) or the rendered text.
 */
function citationChanged(a: CitationEntry, b: CitationEntry): boolean {
  return a.command !== b.command || a.displayText !== b.displayText;
}

/** A footnote that survived (same id) but whose position or attrs changed
 *  — the signature of an atom MOVE (delete+insert). `pos` is the load-
 *  bearing field for the structure index + renumber; thanks/number folded
 *  in so the snapshot stays exact. */
function footnoteChanged(a: FootnoteEntry, b: FootnoteEntry): boolean {
  return a.pos !== b.pos || a.thanks !== b.thanks || a.number !== b.number;
}

/** An example that survived (same id) but whose position or displayed attrs
 *  changed — the signature of a same-uuid drag-reorder MOVE (delete+insert,
 *  uuid preserved) or an in-place `setNodeMarkup` renumber. `pos` is load-
 *  bearing for the structure index; `number`/`tag`/`label` are what the
 *  ExampleCard renders, so a renumber `(9)`→`(10)` must count as changed and
 *  re-seed the card. Mirrors `footnoteChanged`. A same-id re-scan with every
 *  field equal (an edit at the block boundary that touched nothing) returns
 *  false, so it never fires spuriously. */
function exampleChanged(a: ExampleEntry, b: ExampleEntry): boolean {
  return (
    a.pos !== b.pos ||
    a.number !== b.number ||
    a.tag !== b.tag ||
    a.label !== b.label
  );
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
    const node = $pos.node(depth);
    if (node.type.name !== "exampleBlock") continue;
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
  const exampleContentChangedUuids = new Set<string>();
  let footnoteOrderChanged = false;
  let citationOrderChanged = false;
  let blockOrderChanged = false;

  // Lazily-built set of every uuid live in `newDoc`. The ONE block-survivor
  // guard — consulted by BOTH the uuid-AttrStep branch AND the reachable
  // ReplaceStep|ReplaceAroundStep block reconciler below — to avoid claiming a
  // block "removed" when its uuid in fact still survives elsewhere in the doc.
  // The canonical trigger: a mid-paragraph Enter split clones a block (both
  // halves transiently share one uuid), then BlockUuidBackfill re-mints the
  // CLONE (oldUuid → fresh) via `setNodeMarkup` — but the ORIGINAL (kept) half
  // still carries `oldUuid`. Naively emitting `removed.blocks[oldUuid]` desyncs
  // `structure.blocks` (drops a still-live uuid) and makes UuidAttrDecorator
  // strip the original's `data-uuid`. NOTE the re-mint's REAL step type: a
  // paragraph is a non-leaf node, so `setNodeMarkup` emits a ReplaceAroundStep,
  // NOT an AttrStep (task 247) — the Replace* reconciler is the live path; the
  // AttrStep branch is a defensive fallback sharing this same guard. Built at
  // most once per transaction, and ONLY when some uuid entered `removed.blocks`
  // — never on a plain keystroke (no block-start touched → `removed.blocks`
  // empty), so keystroke sanctity is preserved (the O(doc) walk is off the
  // typing path).
  let newDocUuidsCache: Set<string> | null = null;
  const oldUuidSurvivesInNewDoc = (uuid: string): boolean => {
    if (!newDocUuidsCache) {
      const set = new Set<string>();
      newDoc.descendants((node) => {
        const u = (node.attrs as { uuid?: string | null } | undefined)?.uuid;
        if (u) set.add(u);
        return true;
      });
      newDocUuidsCache = set;
    }
    return newDocUuidsCache.has(uuid);
  };

  // The ONE survivor guard shared by every anchorable-block removed-reconciler
  // (blocks + the three sub-views headings/figures/examples), so no sub-view can
  // drift out of guard again (task 265 — the sub-view twin of task 247). A split
  // clone transiently shares a uuid across two nodes; `BlockUuidBackfill` re-mints
  // the CLONE (`setNodeMarkup` → ReplaceAroundStep on a non-leaf), whose range
  // walk sweeps the KEPT half's still-live uuid into `removed.*`. `removedBlocks`
  // was guarded (247) but the sub-views were not: `headingStructurallyChanged`
  // only covers the same-key CHANGED case, and a re-mint has DIFFERENT keys on
  // each side (removed=oldUuid, added=newUuid), so it flowed through the unguarded
  // `removed<Kind>.push` loops and `applyDiff` spliced the kept heading/figure/
  // example out of the canonical index. Report a removal only when the uuid is
  // truly gone from `newDoc`. A `null`/empty key (a tag/label-only example, never
  // a backfill re-mint candidate) can't hit this path → treated as NOT surviving,
  // so a genuine removal still fires. Same lazy O(doc)-once cost as the block
  // path (`oldUuidSurvivesInNewDoc` builds its set at most once per tx); every
  // call site is gated behind its `!added.<kind>.has(key)` short-circuit so the
  // walk stays off the re-collected-add and plain-keystroke paths (a keystroke
  // touches no block start → `removed.<kind>` empty → these loops never execute).
  const uuidSurvivesRemoval = (uuid: string | null | undefined): boolean =>
    !!uuid && oldUuidSurvivesInNewDoc(uuid);

  // Anchor-id survivor guard — the mark-level twin of `oldUuidSurvivesInNewDoc`.
  // `collectRange` registers a `linkedAnchor` by WHOLE text node (`inspectNodeAt`),
  // so deleting one char strictly INSIDE a marked run puts the anchor id into
  // `removed.anchors` even though the mark still rides the untouched remainder in
  // `newDoc` (the added side collapses — nothing was inserted — so `added.anchors`
  // stays empty and the naive reconciler false-reports it removed). That false
  // positive makes `LinkedAnchorGuard` orphan the card and the feature hooks
  // persist the anchor loss — silent detachment on an ordinary interior Backspace.
  // Consult this before pushing an anchor to `removedAnchors`: it's truly removed
  // only if its id is absent from every `linkedAnchor` mark in `newDoc`. A genuine
  // mark removal (RemoveMarkStep) or a full-run deletion leaves the id nowhere →
  // removal still fires. Built at most once per tx, and ONLY when some anchor
  // entered `removed.anchors` (never on plain typing — no anchor removal, no walk),
  // so keystroke sanctity holds (the O(doc) walk is off the typing path).
  let newDocAnchorIdsCache: Set<string> | null = null;
  const anchorSurvivesInNewDoc = (anchorId: string): boolean => {
    if (!newDocAnchorIdsCache) {
      const set = new Set<string>();
      newDoc.descendants((node) => {
        if (node.isText && node.marks.length > 0) {
          for (const mark of node.marks) {
            if (mark.type.name !== "linkedAnchor") continue;
            const aid = (mark.attrs as { anchorId?: string }).anchorId ?? "";
            if (aid) set.add(aid);
          }
        }
        return true;
      });
      newDocAnchorIdsCache = set;
    }
    return newDocAnchorIdsCache.has(anchorId);
  };

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
      // `step.from`/`step.to` are in the coordinate space of the doc
      // BEFORE this step (`tr.docs[stepIndex]`) — which equals `oldDoc`
      // only for the first step. Walk `removed` against that before-step
      // doc, and map the range forward to `newDoc` through the steps AFTER
      // this one (`tr.mapping.slice(stepIndex)`). Using the FULL mapping
      // here mis-mapped every step past the first, so a multi-step tx such
      // as an atom MOVE (delete + re-insert) left the re-inserted node
      // undetected in `added` — the structure then dropped the moved
      // footnote/citation and the renumber walked a stale snapshot.
      const beforeStepDoc = tr.docs[stepIndex] ?? oldDoc;
      const mappingAfter = tr.mapping.slice(stepIndex);
      const fromInNew = mappingAfter.map(step.from, -1);
      const toInNew = mappingAfter.map(step.to, 1);

      collectRange(beforeStepDoc, step.from, step.to, removed);
      collectRange(newDoc, fromInNew, toInNew, added);

      // Attribute content-change to nearest anchorable ancestor in newDoc.
      const uuid = nearestAnchorableUuid(newDoc, fromInNew);
      if (uuid) contentChangedUuids.add(uuid);

      // Also attribute to the enclosing exampleBlock (if any) so the
      // Examples-panel card — keyed by exampleBlock uuid, not the nearer
      // anchorable exampleItem — can re-seed on a content-only edit. Same
      // ancestor walk; no extra doc scan.
      const exUuid = nearestExampleBlockUuid(newDoc, fromInNew);
      if (exUuid) exampleContentChangedUuids.add(exUuid);

      // Footnotes whose pos changed need a renumber check too.
      if (removed.footnotes.size > 0 || added.footnotes.size > 0) {
        footnoteOrderChanged = true;
      }
      // Citations: any add/remove/move in a touched range may reorder the
      // citation list (a pure move with unchanged attrs surfaces only here).
      if (removed.citations.size > 0 || added.citations.size > 0) {
        citationOrderChanged = true;
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
          // Only report the OLD uuid as removed if it did NOT survive elsewhere
          // in the final doc. After a split, the re-minted CLONE sheds `oldUuid`
          // here while the ORIGINAL half still carries it — emitting a removal
          // would drop a still-live block from `structure.blocks` and strip its
          // `data-uuid`. A genuine rename/death (uuid → null, or a true identity
          // change) leaves `oldUuid` nowhere in the doc → removal still fires.
          if (oldUuid && !uuidSurvivesRemoval(oldUuid)) {
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
  const changedBlocks: BlockEntry[] = [];
  const prevBlocks = prevStructure?.blocks;
  for (const [uuid, entry] of added.blocks) {
    const wasRemoved = removed.blocks.get(uuid);
    if (wasRemoved) {
      // Same UUID in both added + removed = a top-level block MOVE
      // (delete+insert, uuid preserved by block-uuid-backfill). The
      // identity didn't change, so it must NOT appear in addedBlocks/
      // removedBlocks — but its mapped position is stale (the old pos was
      // deleted), so emit it as `changedBlocks` carrying the NEW pos (so the
      // structure index folds it in) and flag the reorder for position-keyed
      // consumers. Same pos = a no-op/round-trip, so neither.
      if (wasRemoved.pos !== entry.pos) {
        changedBlocks.push(entry);
        blockOrderChanged = true;
      }
      continue;
    }
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
    // Block-survivor guard (task 247) — the block twin of the anchor-survivor
    // check `anchorSurvivesInNewDoc`. The REAL post-split re-mint lands HERE,
    // not in the AttrStep branch: `setNodeMarkup` on a non-leaf paragraph emits
    // a ReplaceAroundStep, whose `collectRange` sweeps the CLONE's old
    // (duplicate) uuid into `removed.blocks` even though the KEPT half still
    // carries it live in `newDoc`. Emitting the removal would drop a still-live
    // block from `structure.blocks` (`applyDiff` does `blocks.delete(uuid)`) and
    // fire a spurious `onBlocksRemoved` — silently detaching every card anchored
    // to the kept paragraph. Skip when the uuid still survives. This is the same
    // lazy O(doc)-once guard the AttrStep branch uses, gated behind the
    // `added.blocks.has` short-circuit so it never runs for a re-collected add;
    // off the plain-keystroke path (a keystroke touches no block-start, so
    // `removed.blocks` stays empty and this loop body never executes).
    if (uuidSurvivesRemoval(uuid)) continue;
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
    // Survivor guard (task 265) — the heading twin of the block guard above. A
    // mid-heading Enter split re-mints the clone; its old (duplicate) uuid gets
    // swept into `removed.headings` while the KEPT heading still carries it in
    // `newDoc`. `headingStructurallyChanged` (the added-side reconciler) only
    // catches the same-KEY changed case — a re-mint has different keys on each
    // side, so it lands here. Skip when the uuid still survives, or `applyDiff`
    // splices the kept heading out of `structure.headings` (a spurious
    // `onHeadingsRemoved` desyncs Focus-mode boundaries + the fold mirror).
    if (!added.headings.has(uuid) && !uuidSurvivesRemoval(uuid)) removedHeadings.push(entry);
  }
  // Mark contentChangedUuids for surviving headings — text may have
  // changed via the ReplaceStep that triggered the attribute step.
  for (const [uuid] of added.headings) {
    if (removed.headings.has(uuid)) contentChangedUuids.add(uuid);
  }

  // Footnotes: separate added / removed / changed, mirroring citations.
  // A same-id in both added+removed is a MOVE (delete+insert) — emit it as
  // `changedFootnotes` (carrying the NEW pos) so the structure index folds
  // the new position in. It is NOT in added/removed, so no spurious orphan.
  const addedFootnotes: FootnoteEntry[] = [];
  const removedFootnotes: FootnoteEntry[] = [];
  const changedFootnotes: FootnoteEntry[] = [];
  for (const [id, entry] of added.footnotes) {
    const wasRemoved = removed.footnotes.get(id);
    if (!wasRemoved) addedFootnotes.push(entry);
    else if (footnoteChanged(wasRemoved, entry)) changedFootnotes.push(entry);
  }
  for (const [id, entry] of removed.footnotes) {
    if (!added.footnotes.has(id)) removedFootnotes.push(entry);
  }

  // Citations: separate added / removed / changed. An in-place
  // `setNodeMarkup` (citation is a leaf atom) shows up as same-id in both
  // added + removed — collapse to `changedCitations` when attrs differ,
  // mirroring the heading reconciler.
  const addedCitations: CitationEntry[] = [];
  const removedCitations: CitationEntry[] = [];
  const changedCitations: CitationEntry[] = [];
  for (const [id, entry] of added.citations) {
    const wasRemoved = removed.citations.get(id);
    if (!wasRemoved) {
      addedCitations.push(entry);
    } else if (citationChanged(wasRemoved, entry) || wasRemoved.pos !== entry.pos) {
      // attr edit in place OR an atom MOVE (delete+insert) — both must
      // refresh the structure entry's pos/attrs (an atom move's mapped
      // old position is stale; only the NEW entry carries the right pos).
      changedCitations.push(entry);
    }
  }
  for (const [id, entry] of removed.citations) {
    if (!added.citations.has(id)) removedCitations.push(entry);
  }

  // Anchors.
  const addedAnchors: AnchorEntry[] = [];
  const removedAnchors: AnchorEntry[] = [];
  for (const [id, entry] of added.anchors) {
    if (!removed.anchors.has(id)) addedAnchors.push(entry);
  }
  for (const [id, entry] of removed.anchors) {
    // Survivor guard: an interior char-delete inside a marked run reports the
    // whole run removed while the mark still survives in `newDoc`. Only report
    // the anchor removed if it's absent from `added` AND truly gone from newDoc.
    // The `!added.anchors.has(id)` short-circuit keeps the O(doc) walk off the
    // hot path when the anchor was re-collected on the added side.
    if (!added.anchors.has(id) && !anchorSurvivesInNewDoc(id)) removedAnchors.push(entry);
  }

  // Examples: separate added / removed / changed, mirroring footnotes &
  // figures. A same-id in BOTH added+removed is an identity-preserving MOVE
  // (a drag-reorder is `tr.delete(old)+tr.insert(node)` with the uuid kept by
  // block-uuid-backfill) — or a same-tx re-scan. It must NOT land in
  // added/removed (that would orphan/duplicate the card), but its mapped entry
  // is stale, so emit it as `changedExamples` carrying the NEW pos/number when
  // any displayed field differs. This is the hole that left docked/Omni
  // ExampleCards showing a stale `(N)` after a reorder: with no changed bucket,
  // a moved example fired NEITHER `rev.examples` nor per-uuid `contentRev`, so
  // the card never re-seeded. A same-id with every field equal (a boundary
  // re-scan) is a no-op → neither, so keystroke sanctity holds.
  const addedExamples: ExampleEntry[] = [];
  const removedExamples: ExampleEntry[] = [];
  const changedExamples: ExampleEntry[] = [];
  let exampleStructureChanged = false;
  for (const [id, entry] of added.examples) {
    const wasRemoved = removed.examples.get(id);
    if (!wasRemoved) {
      addedExamples.push(entry);
      exampleStructureChanged = true;
    } else if (exampleChanged(wasRemoved, entry)) {
      changedExamples.push(entry);
      exampleStructureChanged = true;
    }
  }
  for (const [id, entry] of removed.examples) {
    if (!added.examples.has(id)) {
      // Survivor guard (task 265) — same class as headings/figures. `exampleBlock`
      // is anchorable, so a duplicate-uuid re-mint sweeps its old uuid here. The
      // example key is `id = uuid || tag || label`, so guard on `entry.uuid` only
      // when it's non-null: a tag/label-only example (null uuid) is never a
      // backfill re-mint candidate, so it can't false-report and must fall through
      // to a genuine removal.
      if (uuidSurvivesRemoval(entry.uuid)) continue;
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
    // Survivor guard (task 265) — same class as headings/examples. `figureBlock`
    // is anchorable, so a duplicate-uuid re-mint (paste-duplication, drag-copy)
    // sweeps its old uuid here while the kept figure still carries it in `newDoc`.
    if (!added.figures.has(uuid) && !uuidSurvivesRemoval(uuid)) removedFigures.push(entry);
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

  const diff: StructureDiff = {
    addedBlocks,
    removedBlocks,
    changedBlocks,
    blockOrderChanged,
    addedHeadings,
    removedHeadings,
    changedHeadings,
    addedFootnotes,
    removedFootnotes,
    changedFootnotes,
    footnoteOrderChanged,
    addedCitations,
    removedCitations,
    changedCitations,
    citationOrderChanged,
    addedAnchors,
    removedAnchors,
    addedExamples,
    removedExamples,
    changedExamples,
    exampleStructureChanged,
    addedFigures,
    removedFigures,
    changedFigures,
    addedLabels,
    removedLabels,
    contentChangedUuids,
    exampleContentChangedUuids,
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
