/**
 * The ranges a transaction actually touched — marks included.
 *
 * Every consumer that reacts to an edit by re-deriving something from the
 * document asks one of two questions, and BOTH of them have the same trap in
 * them. A step map describes how positions MOVE, not what changed, so a step
 * that moves nothing contributes `StepMap.empty` while its transaction is
 * still `docChanged`. Six do: `AddMarkStep` / `RemoveMarkStep` (`from`/`to`),
 * `AddNodeMarkStep` / `RemoveNodeMarkStep` / `AttrStep` (`pos`), and
 * `DocAttrStep` (no position at all). A gate that reads only the maps
 * therefore concludes "nothing happened" when the user bolds a word.
 *
 * `AGENTS.md` states that law ("Writing a positional gate: a step map is not a
 * description of what changed") and it was implemented three times: the
 * PREDICATE half module-privately in `float-source-range.ts`, and the
 * EXTRACTOR half in `latex-command.ts` — where it was implemented WITHOUT the
 * rule, so the carrier's own mark transaction was invisible to it. This module
 * is the one home: `positionalStepRange` states the rule once, and both
 * readings are derived from it.
 *
 * ── The two questions, and why they are two exports ────────────────────────
 *
 * `contentChangedRanges(trs)` — "where did the DOCUMENT CONTENT change?" Step
 * maps only. This is what a consumer that derives something FROM TEXT wants:
 * the `latexCommand` type-time carrier derives marks from the characters, so a
 * mark step is its own OUTPUT and never its input — and excluding it is what
 * makes the carrier's re-entry on its own appended transaction terminate.
 *
 * `touchedRanges(trs)` — "which regions could RENDER differently now?" Maps
 * plus every positional step. This is what a decoration/geometry consumer
 * wants: a mark that renders its own span changes what a decoration over the
 * same run should be, and a paragraph-local aggregate (`p-cmd-only`) changes
 * when a sibling run gains any mark at all.
 *
 * They are two named exports over one implementation rather than one function
 * with a boolean, because the two answers are different claims and a defaulted
 * argument is a decision nobody made.
 *
 * ── Coordinates ───────────────────────────────────────────────────────────
 *
 * Ranges come back in the coordinates of the LAST transaction's document. Each
 * step is read against its OWN map and then mapped forward through the rest of
 * its transaction and through every later one — the rule `BlockUuidBackfill`
 * earned (task 320): a per-transaction `tr.mapping` re-applies earlier steps'
 * maps to positions that already reflect them, which for the delete-then-insert
 * shape every relocation uses collapses the inserted range to nothing.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** A region of a document, in the coordinates the producer states. */
export interface ChangedRange {
  from: number;
  to: number;
}

type AnyStep = Transaction["steps"][number];

/**
 * The range a step reaches when its StepMap has no ranges of its own, or null
 * when the step names no position at all.
 *
 * The single statement of the empty-StepMap rule. `null` means "this step could
 * have reached anywhere" — `DocAttrStep`, or a step type that did not exist
 * when this was written — and every reader of this function fails SAFE on it
 * (the predicate says "touched", the extractor says "the whole document"),
 * because a needless re-derivation is the status quo while a missed one is
 * silently stale.
 */
function positionalStepRange(step: AnyStep | undefined): ChangedRange | null {
  if (!step) return null;
  const s = step as unknown as { from?: unknown; to?: unknown; pos?: unknown };
  if (typeof s.from === "number" && typeof s.to === "number") {
    return { from: s.from, to: s.to };
  }
  if (typeof s.pos === "number") return { from: s.pos, to: s.pos };
  return null;
}

/**
 * Does a step whose StepMap has NO ranges touch `[from, to]`?
 *
 * The PREDICATE reading of the rule above. Callers reach here only when the
 * step's map contributed nothing; see `trackSourceRange` in
 * `float-source-range.ts`, whose docstring carries the full account of what a
 * missed mark step costs a mirroring consumer (a stale float whose write-back
 * DELETES the mark from the document).
 */
export function stepTouches(
  step: AnyStep | undefined,
  from: number,
  to: number,
): boolean {
  const r = positionalStepRange(step);
  if (!r) return true;
  return r.from <= to && r.to >= from;
}

function collect(
  trs: readonly Transaction[],
  includePositionalSteps: boolean,
): ChangedRange[] {
  const out: ChangedRange[] = [];
  trs.forEach((tr, ti) => {
    if (!tr.docChanged) return;
    const push = (si: number, newFrom: number, newTo: number) => {
      const rest = tr.mapping.slice(si + 1);
      let from = rest.map(newFrom, -1);
      let to = rest.map(newTo, 1);
      for (let k = ti + 1; k < trs.length; k++) {
        from = trs[k].mapping.map(from, -1);
        to = trs[k].mapping.map(to, 1);
      }
      out.push({ from, to });
    };
    tr.steps.forEach((step, si) => {
      let hadRange = false;
      step.getMap().forEach((_oldFrom, _oldTo, newFrom, newTo) => {
        hadRange = true;
        push(si, newFrom, newTo);
      });
      if (hadRange || !includePositionalSteps) return;
      const r = positionalStepRange(step);
      // No position at all ⇒ assume the whole document. `touchedTextblocks`
      // clamps, so an over-wide range costs a full re-derivation and never a
      // bad index.
      if (r) push(si, r.from, r.to);
      else push(si, 0, tr.docs[si].content.size);
    });
  });
  return out;
}

/**
 * Where the document CONTENT changed. Step maps only — a mark step is not a
 * content change. See the module header for why that exclusion is load-bearing
 * rather than an oversight.
 */
export function contentChangedRanges(
  trs: readonly Transaction[],
): ChangedRange[] {
  return collect(trs, false);
}

/**
 * Every region these transactions reached, marks and node attrs included — the
 * question a consumer that re-derives RENDERING has to ask.
 */
export function touchedRanges(trs: readonly Transaction[]): ChangedRange[] {
  return collect(trs, true);
}

/**
 * The innermost textblock containing the whole of `[from, to]`, or null when
 * the range is not inside one (a position between blocks) or spans more than
 * one.
 *
 * O(depth), and it is the point of the fast path: an ordinary keystroke and
 * every mark step have exactly this shape, while `Fragment.nodesBetween` walks
 * the parent's children from index 0 until it passes `to` — cheap per step, but
 * proportional to the block's INDEX, so a keystroke deep in a long paper pays
 * for every block above it.
 */
function soleTextblockAround(
  doc: PMNode,
  from: number,
  to: number,
): { pos: number; node: PMNode } | null {
  let $from;
  try {
    $from = doc.resolve(from);
  } catch {
    return null;
  }
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (!node.isTextblock) continue;
    const pos = $from.before(d);
    return to <= pos + node.nodeSize ? { pos, node } : null;
  }
  return null;
}

/**
 * The textblocks these ranges reach, keyed by position — the unit of
 * re-derivation for every consumer in this family, because a construct can
 * start well before the edit (`\definecolor{a}{b}{c}` typed into its last
 * argument) and a paragraph-local aggregate can only be recomputed whole.
 *
 * Ranges are clamped into `doc`, so an over-wide range from the fail-safe arm
 * above is honoured rather than throwing.
 */
export function touchedTextblocks(
  doc: PMNode,
  ranges: readonly ChangedRange[],
): Map<number, PMNode> {
  const blocks = new Map<number, PMNode>();
  const size = doc.content.size;
  for (const r of ranges) {
    const from = Math.max(0, Math.min(r.from, size));
    const to = Math.max(from, Math.min(r.to, size));
    const sole = soleTextblockAround(doc, from, to);
    if (sole) {
      blocks.set(sole.pos, sole.node);
      continue;
    }
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      blocks.set(pos, node);
      return false;
    });
  }
  return blocks;
}
