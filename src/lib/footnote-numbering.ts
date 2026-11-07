/**
 * THE footnote-numbering rule — one owner, every surface reads it.
 *
 * A footnote's displayed number is a DERIVATION over the footnotes of a
 * document in order, and the rule has exactly two subtleties, both LaTeX's:
 *
 *  - a `\thanks` is a title-page acknowledgement, not a numbered footnote. It
 *    renders `A`, so it is assigned `number: 0` and does **not** step the
 *    counter;
 *  - a `\footnote[7]{…}` prints its optional mark INSTEAD of the counter and,
 *    in LaTeX, does not step it either (`\footnote{a}\footnote[7]{b}
 *    \footnote{c}` prints 1, 7, 2). Same treatment: `number: 0`, no step (task
 *    1517 — before it, the override stepped Virgil's counter and every later
 *    footnote displayed one too high).
 *
 * And the LABEL a surface prints is the same derivation's other half:
 * `footnoteLabel` — `A` for a thanks, the mark for an override, else the
 * number. Every display site (the atom's `renderHTML` and NodeView paint, the
 * card badge, the tool gutter, the Citations panel's "in footnote N") reads
 * it; before task 1517 each restated it, and they disagreed on the override.
 *
 * Before task 725 that rule was re-implemented four times — the parser's
 * load-time pass, the extension's `appendTransaction` numberer, the typed
 * `\footnote{…}` input rule, and an `EditorHandle.renumberFootnotes` door —
 * and only two of them knew about `\thanks`. The parser's copy did not, so
 * **every paper imported with an author note displayed every later footnote
 * one too high, from the moment it loaded**: the thanks silently consumed
 * slot 1 while rendering `A`, which is why the defect hid for so long. The
 * handle's copy did not either, and because it ran *after* the extension had
 * already numbered correctly, it overwrote a right answer with a wrong one on
 * every footnote the user created.
 *
 * So the rule lives here, once, and the three surviving surfaces call it:
 * `latex-parser.ts` (JSON, pre-mount), and `lib/tiptap/footnote.ts` twice
 * (the `appendTransaction` numberer and the input rule's own transaction).
 * `footnote-number-authority.test.ts` fails if a fifth is written.
 */

import type { Transaction } from "@tiptap/pm/state";

/** What the rule needs to know about one footnote, in document order. */
export interface FootnoteNumberInput {
  /** True for a `\thanks{…}` acknowledgement (renders `A`, takes no number). */
  thanks?: unknown;
  /** `\footnote[7]{…}`'s raw mark (renders the mark, takes no number). */
  numberOverride?: unknown;
}

/** True when the footnote prints the counter (and so steps it). */
function isCounted(f: FootnoteNumberInput): boolean {
  return !f.thanks && !hasOverride(f.numberOverride);
}

function hasOverride(mark: unknown): mark is string {
  return typeof mark === "string" && mark !== "";
}

/**
 * The numbers for `footnotes` (document order), aligned index-for-index.
 *
 * A `\thanks` or a `[n]` override yields `0` and does not advance the
 * counter; every other footnote takes the next counter value starting at 1.
 */
export function footnoteNumbersFor(
  footnotes: readonly FootnoteNumberInput[],
): number[] {
  const out: number[] = [];
  let counter = 1;
  for (const f of footnotes) out.push(isCounted(f) ? counter++ : 0);
  return out;
}

/** What `footnoteLabel` reads — a live node's attrs, a `FootnoteInfo`, or a
 *  `FootnoteEntry` all satisfy it. */
export interface FootnoteLabelInput extends FootnoteNumberInput {
  number?: unknown;
}

/**
 * THE label a footnote displays — the one door every surface prints through.
 * `A` for a `\thanks` (the serializer drops a mark on a thanks, so thanks
 * wins), the raw mark for a `\footnote[n]`, else the derived number (`1` for a
 * not-yet-numbered atom, the atom's long-standing fallback).
 */
export function footnoteLabel(f: FootnoteLabelInput): string {
  if (f.thanks) return "A";
  if (hasOverride(f.numberOverride)) return f.numberOverride;
  return String(f.number || "1");
}

/**
 * Write the numbers onto `tr` for the footnote atoms at `positions`
 * (document order, resolved against `tr.doc`).
 *
 * Two properties every caller needs and nobody should have to re-derive:
 *
 *  - **Equality bail.** A position whose node already carries its number is
 *    not written, so a no-op renumber produces a transaction with zero steps —
 *    the caller can then skip dispatching entirely rather than fanning a
 *    `docChanged` observer diff out over the whole app on every insert.
 *  - **Position stability.** `setNodeMarkup` on a leaf atom is size-preserving,
 *    so the positions stay valid across the loop. Never add a size-changing
 *    step here.
 *
 * A position that no longer holds a footnote is skipped and does not step the
 * counter, so a stale index degrades to a gap rather than to a wrong sequence.
 */
export function writeFootnoteNumbers(
  tr: Transaction,
  positions: readonly number[],
): Transaction {
  const live: { pos: number; attrs: Record<string, unknown> }[] = [];
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos);
    if (!node || node.type.name !== "footnote") continue;
    live.push({ pos, attrs: node.attrs as Record<string, unknown> });
  }
  const numbers = footnoteNumbersFor(
    live.map((e) => ({ thanks: e.attrs.thanks, numberOverride: e.attrs.numberOverride })),
  );
  live.forEach((e, i) => {
    if (e.attrs.number !== numbers[i]) {
      tr.setNodeMarkup(e.pos, undefined, { ...e.attrs, number: numbers[i] });
    }
  });
  return tr;
}
