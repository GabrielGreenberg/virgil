/**
 * MORPH_DROP_FIELDS — the single source of truth for the `MorphDropField`
 * vocabulary: what each dropped field is CALLED in user-facing copy, and how
 * much of the user's work it destroys.
 *
 * WHY A TABLE AND NOT TWO SCATTERED ANSWERS. `morph.drops` is already the SSOT
 * the morph-confirm dialog is generated from (T4 §3.2 — so the copy can never
 * be direction-blind, REP-F6-03). But the dialog asks the drop set two
 * questions, and before task 303 only one of them was answered from the
 * declaration: the LABELS lived in a `Record<string, string>` inside the
 * executor, and the TONE was a hardcoded `"default"` literal at the confirm
 * call site — so the single most destructive morph (note → highlight discards
 * the entire rich body) and the mildest one (report → report-request drops a
 * title and a byline) shared one calm dialog, while a delete of that same note
 * body showed red. Both questions are properties of the FIELD, so both are
 * declared here, once, per field.
 *
 * TWO INVARIANTS THIS MODULE OWNS, each pinned by
 * `__tests__/morph-drop-fields.test.ts`:
 *
 *  1. EXHAUSTIVE ON THE UNION. The table is a `Record<MorphDropField, …>`, so a
 *     seventh drop field is a compile error until someone states its noun and
 *     its severity. The pre-303 `Record<string, string>` with a `?? d` fallback
 *     silently rendered the raw identifier (`"This drops attachments (a Report
 *     can't hold it)"`) into a user-facing dialog — a declaration with no
 *     description is exactly the kind of gap a type can close.
 *
 *  2. EVERY `noun` IS AN ATOMIC, COMMA-FREE NOUN PHRASE. `describeDrops` joins
 *     the nouns with `and` / a serial comma list, which assumes each part is
 *     atomic. The `formatting` label used to carry its own em-dash sub-list
 *     ("the rich formatting — citations, math, and lists"), so the two morphs
 *     that drop `["formatting", "aiRequest"]` rendered a garden path:
 *     "…citations, math, and lists and the AI-request flag" — the reader can't
 *     tell whether the flag is a fourth member of the sub-list or the second
 *     top-level item. The fix is structural rather than a reworded string: the
 *     joiner can only be unambiguous if no part carries punctuation of its own,
 *     so that is asserted over the whole table and a future comma-bearing label
 *     fails CI instead of surfacing as a copy nit two morphs deep.
 *
 * This is a LEAF with zero runtime imports (the `MorphDropField` import is
 * type-only, so it erases): the vocabulary belongs to the card model, not to
 * the lifecycle executor that happens to be its first reader.
 */

import type { MorphDropField } from "./types";

/** How much of the user's authored work a dropped field takes with it — the
 *  axis the confirm dialog's TONE tracks.
 *
 *  DELIBERATELY NOT `cardHasContent`'s question. That predicate asks "is there
 *  anything at all in this card?" and counts a report's `title` as content —
 *  correctly, for a delete confirm, where the alternative is silently binning
 *  a card the user typed one word into. This axis asks the narrower "will the
 *  card still hold what you wrote?", and a title or a byline survives the morph
 *  as a few characters to retype, while a body or the inline atoms inside it do
 *  not. Deriving one from the other would over-warn the metadata-only morph and
 *  dull the signal on the one that erases a paragraph. */
export type MorphDropSeverity =
  /** The card loses authored substance it cannot get back: prose, or the inline
   *  atoms (citations, math) that only the richer shape can hold. → `danger`. */
  | "substance"
  /** The card loses a label, a byline, or a flag — annoying, retypeable, and
   *  not the thing the user wrote. → `default`. */
  | "metadata";

export interface MorphDropDescriptor {
  /** The user-facing noun phrase, article included. MUST be atomic: no comma,
   *  no semicolon, no em dash (invariant 2 above) — `describeDrops` joins these
   *  into a list and a part carrying its own punctuation garden-paths the
   *  reader. Keep the examples out; the dialog is a confirm, not a manual. */
  noun: string;
  severity: MorphDropSeverity;
}

export const MORPH_DROP_FIELDS: Record<MorphDropField, MorphDropDescriptor> = {
  title: { noun: "the title", severity: "metadata" },
  byline: { noun: "the author byline", severity: "metadata" },
  // Dropping the flag ends a pending `ai-requests.json` row (the executor
  // unbridges it in the same step). That's a request the user filed, not prose
  // they wrote — and the ask can be re-filed on the surviving card's twin.
  aiRequest: { noun: "the AI-request flag", severity: "metadata" },
  body: { noun: "the body", severity: "substance" },
  keys: { noun: "the cite keys", severity: "substance" },
  // The prose survives; the citations / math / lists inside it are flattened to
  // plain text, which for a card that held a `\cite` atom is real loss.
  formatting: { noun: "the rich formatting", severity: "substance" },
};

/** Render a `drops` set as an English clause. Deterministic: follows the
 *  declared array order, so the copy is reproducible. Every part is an atomic
 *  noun phrase (invariant 2), so the join can't be misread. */
export function describeDrops(drops: readonly MorphDropField[]): string {
  const parts = drops.map((d) => dropDescriptor(d).noun);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** The confirm TONE a `drops` set earns: red as soon as one dropped field takes
 *  authored substance with it, calm when the whole set is metadata. Same axis
 *  the generated copy already describes, so the dialog's two signals can't
 *  disagree — and the same axis a content-bearing DELETE has always used, which
 *  is the inconsistency task 303 reported (morphing a note to a highlight
 *  discards the identical body under a calm dialog).
 *
 *  An EMPTY set is `"default"`, but it never reaches a dialog:
 *  `morphConfirmMessage` returns null for a non-lossy morph, so no confirm is
 *  raised at all. */
export function morphDropsTone(
  drops: readonly MorphDropField[],
): "default" | "danger" {
  return drops.some((d) => dropDescriptor(d).severity === "substance")
    ? "danger"
    : "default";
}

/** Unreachable by construction — the table is exhaustive on the union and
 *  `drops` is a code literal in `CARD_REGISTRY`, never persisted or parsed. It
 *  exists so an out-of-tree reader can't crash the morph mid-click, and it
 *  fails SAFE on both axes: the raw key is at least honest about which field is
 *  going, and an unknown field warns rather than reassures. */
function dropDescriptor(field: MorphDropField): MorphDropDescriptor {
  return (
    (MORPH_DROP_FIELDS[field] as MorphDropDescriptor | undefined) ?? {
      noun: field,
      severity: "substance",
    }
  );
}
