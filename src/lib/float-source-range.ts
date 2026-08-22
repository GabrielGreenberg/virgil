/**
 * Float source ranges — the positional primitive behind main→float sync.
 *
 * A text-object float MIRRORS one region of the main document (a paragraph by
 * uuid, a section by heading uuid, a listItem, a `linkedAnchor` range, …). Two
 * questions come up on every main-editor transaction, and both used to be
 * answered by walking the whole document:
 *
 *   1. "Did this transaction touch MY source?" — asked once per open float, per
 *      transaction. The old answer was "assume yes, re-read the doc", which made
 *      every main keystroke O(doc) per open float (task 140: a keystroke-sanctity
 *      law violation hiding behind an allowlist entry that described only the
 *      SUBSCRIBER's gate, not the O(doc) callback it invoked).
 *   2. "Where IS my source right now?" — asked whenever the answer to (1) is yes.
 *      The old answer was `doc.descendants(…)` from position 0.
 *
 * This module answers both from the LIVE RANGE the float already knows:
 *
 *   • `trackSourceRange(tr, range)` maps the range forward through a
 *     transaction's step maps AND reports whether any step intersected it —
 *     one pass, **O(steps)**, never O(doc). A keystroke elsewhere in the
 *     document costs a handful of integer comparisons per float.
 *   • `findSourceNodeByUuid(doc, uuid, types, hint)` uses that mapped range as a
 *     POSITION HINT: resolve the node at `hint.from`, verify its type + uuid,
 *     and return in O(depth). Only a hint that fails verification falls back to
 *     the full `descendants` walk — so a stale hint costs correctness nothing.
 *
 * Why positional rather than `StructureDiff`-driven: the float has to react to
 * in-paragraph text edits to its source, which are structurally-null (no
 * DocStructureBus event, no `contentChangedUuids` entry for a uuid-less block,
 * and no diff at ALL for an attr-only step). The transaction's STEPS are the
 * one signal that sees every kind of change, so a gate built on them can be
 * both cheap and complete.
 *
 * Note the word STEPS, not step maps. A step map describes how positions MOVE;
 * a step that moves nothing (`AddMarkStep`, `RemoveMarkStep`, the node-mark
 * pair, `AttrStep`, `DocAttrStep`) contributes `StepMap.empty` while its
 * transaction is still `docChanged`. Reading only the maps would therefore
 * report "nothing happened" for bolding a word inside the mirrored paragraph —
 * silently stale, and then destructive, because the float's next write-back
 * rebuilds the source from its stale copy. `stepTouches` covers that gap —
 * and since task 400 it lives in `tiptap/changed-ranges.ts`, the one home of
 * that rule, beside the EXTRACTOR reading of it that the decoration and
 * carrier plugins consume. The rule was restated in three places and one of
 * the three did not carry it.
 *
 * Boundary convention — a source range is a NODE range `[from, to)`:
 * `from` maps with assoc `+1` and `to` with assoc `-1`, so content inserted at
 * either boundary lands OUTSIDE the range (a new sibling before the mirrored
 * paragraph pushes it down; one after leaves its end where it was), while a
 * replace of the range itself still tracks the new content. The intersection
 * test is deliberately INCLUSIVE of both endpoints — a boundary touch re-reads
 * (cheap and correct) rather than risking a missed grow/shrink.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { stepTouches } from "@/lib/tiptap/changed-ranges";

/** A half-open region of the MAIN document a float mirrors. */
export interface SourceRange {
  from: number;
  to: number;
}

/** A resolved source node plus the context a float body's wrapper needs. */
export interface FoundSourceNode {
  node: PMNode;
  /** Position of the node's opening token. */
  start: number;
  /** `start + node.nodeSize`. */
  end: number;
  /** The node's immediate parent (null only for a top-level node's doc parent
   *  when resolution came from the `descendants` fallback at depth 0). */
  parent: PMNode | null;
  /** The node's index within `parent`. */
  index: number;
  /** The PARENT's own range, or null at the doc root. A body whose rendered
   *  content depends on its container — a listItem's ordinal comes from the
   *  enclosing list's `start` + its index; an exampleItem's `(N)` from the
   *  enclosing block — must report THIS as its source range, not the node's,
   *  or a sibling inserted before it would renumber the page and leave the
   *  float showing the old marker. */
  parentRange: SourceRange | null;
}

/**
 * Map `range` forward through `tr` and report whether any of the transaction's
 * steps intersected it. Single pass over the step maps — **O(steps)**.
 *
 * Both answers come from the same walk because they must share coordinates:
 * step *i*'s map speaks the document as of steps 0…*i*−1, so the range has to
 * be re-mapped between intersection tests.
 *
 * A transaction that leaves the doc unchanged returns the range untouched with
 * `touched: false`; callers normally gate on `tr.docChanged` before calling.
 */
export function trackSourceRange(
  tr: Transaction,
  range: SourceRange,
): { touched: boolean; mapped: SourceRange } {
  let from = range.from;
  let to = range.to;
  let touched = false;

  // `maps` is 1:1 with `steps` — `Transform.addStep` appends exactly one map
  // per step — and we need the pairing, because a step's MAP is not always a
  // description of what it changed (see `stepTouches`).
  const { maps } = tr.mapping;
  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    if (!touched) {
      let hadRange = false;
      map.forEach((oldStart, oldEnd) => {
        hadRange = true;
        // Inclusive on both ends: a step that merely abuts the range can still
        // grow or shrink it (a heading inserted right after a section's last
        // block shortens the section; a sibling deleted at `to` lengthens it).
        if (oldStart <= to && oldEnd >= from) touched = true;
      });
      if (!hadRange && stepTouches(tr.steps[i], from, to)) touched = true;
    }
    from = map.map(from, 1);
    to = map.map(to, -1);
  }

  // A delete that swallowed the range collapses it; keep it well-formed. The
  // intersection test already flagged `touched`, so the caller re-reads and
  // either re-derives a fresh range or reports the source missing.
  if (to < from) to = from;

  return { touched, mapped: { from, to } };
}

/** The parent's own range at a resolved position, or null at the doc root. */
function parentRangeAt(doc: PMNode, pos: number): SourceRange | null {
  let $pos;
  try {
    $pos = doc.resolve(pos);
  } catch {
    return null;
  }
  if ($pos.depth === 0) return null;
  return { from: $pos.before($pos.depth), to: $pos.after($pos.depth) };
}

/**
 * Resolve the node a hint's START points at, verifying it is still the node we
 * mean. O(depth) — no document walk. Returns null when the hint is absent, out
 * of range, or no longer describes a matching node of exactly that extent,
 * which is the caller's cue to search.
 */
export function resolveHintedNode(
  doc: PMNode,
  hint: SourceRange | null | undefined,
  matches: (node: PMNode) => boolean,
): FoundSourceNode | null {
  if (!hint) return null;
  const { from, to } = hint;
  if (from < 0 || from >= doc.content.size || to <= from) return null;
  let $pos;
  try {
    $pos = doc.resolve(from);
  } catch {
    return null;
  }
  const node = $pos.nodeAfter;
  if (!node) return null;
  // The extent check is what makes a stale hint safe: a node of the right type
  // and uuid but a different size means the range we've been tracking is not
  // this node's, so we search instead of trusting it.
  if (from + node.nodeSize !== to) return null;
  if (!matches(node)) return null;
  return {
    node,
    start: from,
    end: to,
    parent: $pos.parent,
    index: $pos.index(),
    parentRange: $pos.depth === 0 ? null : { from: $pos.before(), to: $pos.after() },
  };
}

/**
 * Find the node of one of `typeNames` carrying `uuid` — the single walk that
 * replaced the eight byte-identical `doc.descendants((node, pos) => …uuid…)`
 * copies the float bodies each kept.
 *
 * `hint` (the float's live source range) is a REGION to look in, tried in
 * increasing cost and always verified against `typeNames` + `uuid`:
 *
 *   1. the node sits exactly at `hint.from` — O(depth), the top-level-body case;
 *   2. otherwise scan just the hinted region — O(region), the nested-item case,
 *      where the reported range is the enclosing list / example block because
 *      that container is what the float's rendering depends on;
 *   3. otherwise walk the document, as before.
 *
 * A stale hint therefore costs a wasted check, never a wrong answer.
 */
export function findSourceNodeByUuid(
  doc: PMNode,
  uuid: string,
  typeNames: string | readonly string[],
  hint?: SourceRange | null,
): FoundSourceNode | null {
  const matches = (node: PMNode) =>
    (typeof typeNames === "string"
      ? node.type.name === typeNames
      : typeNames.includes(node.type.name)) && node.attrs?.uuid === uuid;

  const hinted = resolveHintedNode(doc, hint, matches);
  if (hinted) return hinted;

  const found = (node: PMNode, pos: number, parent: PMNode | null, index: number) => ({
    node,
    start: pos,
    end: pos + node.nodeSize,
    parent,
    index,
    parentRange: parentRangeAt(doc, pos),
  });

  if (hint) {
    const from = Math.max(0, Math.min(hint.from, doc.content.size));
    const to = Math.max(from, Math.min(hint.to, doc.content.size));
    let inRegion: FoundSourceNode | null = null;
    try {
      doc.nodesBetween(from, to, (node, pos, parent, index) => {
        if (inRegion) return false;
        if (matches(node)) {
          inRegion = found(node, pos, parent, index);
          return false;
        }
        return true;
      });
    } catch {
      inRegion = null;
    }
    if (inRegion) return inRegion;
  }

  let result: FoundSourceNode | null = null;
  doc.descendants((node, pos, parent, index) => {
    if (result) return false;
    if (matches(node)) {
      result = found(node, pos, parent, index);
      return false;
    }
    return true;
  });
  return result;
}
