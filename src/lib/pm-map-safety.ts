/**
 * Shared map-safety discriminator for cached top-level node-decoration sets.
 *
 * A `Decoration.node` is dropped by `DecorationSet.map()` when its node is
 * REPLACED (a `ReplaceAroundStep`, a block-boundary `ReplaceStep`, a
 * split/merge) — silently un-hiding a hidden block. Plugins that cache a
 * node-decoration set in plugin state (focus-view's band, section-folding's
 * fold set) therefore carry the set forward with `.map()` ONLY for
 * transactions this module classifies as safe, and REBUILD otherwise.
 * Extracted from focus-view (typing-latency fix 2b) so both plugins share
 * one discriminator.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceStep,
} from "@tiptap/pm/transform";

/**
 * True iff every step in `tr` is safe to carry a cached top-level
 * node-decoration set forward with `DecorationSet.map` — i.e. a pure
 * in-block content edit that does NOT replace any top-level node boundary.
 *
 * Map-safe steps:
 *  - `ReplaceStep` whose from/to lie strictly inside a SINGLE top-level block
 *    (typing, inline formatting) — the block's outer boundary is untouched.
 *  - mark/attr steps — they don't move positions (identity mapping), so node
 *    decorations survive unchanged.
 * Everything else (ReplaceAroundStep, cross-block or boundary ReplaceStep,
 * unknown step kinds) is NOT map-safe → rebuild.
 */
export function isMapSafeEdit(tr: Transaction): boolean {
  try {
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i];
      if (step instanceof ReplaceStep) {
        // CRITICAL: step.from/to are in the coordinate space of the doc BEFORE
        // THIS step (`tr.docs[i]`), NOT `tr.docs[0]`. Resolving a later step's
        // position against the original doc can land out of range (a multi-step
        // tail edit — input rules / IME / smart punctuation — with no childCount
        // change) and throw, OR mis-classify and drop a decoration. Resolve
        // against the correct before-step doc, mirroring step-inspector.ts.
        const beforeDoc = tr.docs[i];
        if (!beforeDoc) return false;
        const from = (step as unknown as { from: number }).from;
        const to = (step as unknown as { to: number }).to;
        if (from < 0 || to > beforeDoc.content.size) return false;
        const $from = beforeDoc.resolve(from);
        const $to = beforeDoc.resolve(to);
        // Touches a top-level boundary, or spans more than one top-level block.
        if ($from.depth === 0 || $to.depth === 0) return false;
        if ($from.index(0) !== $to.index(0)) return false;
        continue;
      }
      if (
        step instanceof AddMarkStep ||
        step instanceof RemoveMarkStep ||
        step instanceof AddNodeMarkStep ||
        step instanceof RemoveNodeMarkStep ||
        step instanceof AttrStep
      ) {
        continue;
      }
      return false;
    }
    return true;
  } catch {
    // Any surprise (unexpected step shape / position) → rebuild, which is always
    // correct, just less optimal. Never let the discriminator crash dispatch.
    return false;
  }
}

/**
 * The full carry-forward gate: a cached top-level node-decoration set may be
 * `.map()`ed across `tr` iff the top-level child count is unchanged AND every
 * step is map-safe. Anything else must rebuild.
 */
export function txPreservesTopLevelNodeDecorations(
  tr: Transaction,
  oldDoc: PMNode,
  newDoc: PMNode,
): boolean {
  if (oldDoc.childCount !== newDoc.childCount) return false;
  return isMapSafeEdit(tr);
}
