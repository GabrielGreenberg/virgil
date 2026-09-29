/**
 * The FOLD CHEVRON contract — one control, two renderers (task 830).
 *
 * Two elements occupy the `--margin-col-chevron` column and are the same
 * affordance: the heading's section-fold chevron (a vanilla-DOM button minted
 * by the heading NodeView, `editor-extensions.ts`, repainted doc-wide by the
 * section-folding plugin view) and the source pod's collapse chevron (React,
 * `SourcePodNodeView.tsx`). Until task 830 they were built twice and had
 * drifted: the heading's had no focus ring, no `aria-expanded`, and a native
 * `title` written only when its fold state CHANGED — so an expanded heading
 * at load had no tooltip at all.
 *
 * Both now read this module:
 *   - {@link FOLD_CHEVRON_CLASS} — the shared stylesheet class (globals.css
 *     `.margin-fold-chevron`) carrying every common rule; the per-kind class
 *     keeps only what legitimately differs (`top`, read-only visibility).
 *   - {@link foldChevronAttrs} — the state-dependent attributes: the hint +
 *     accessible name through {@link iconHint} (one label, both consumers),
 *     and `aria-expanded`. React spreads it; vanilla DOM paints it through
 *     {@link paintFoldChevron}.
 */
import { iconHint, type IconHintAttributes } from "@/components/Hint";

/** What a heading's chevron folds — its section. */
export const FOLD_SUBJECT_SECTION = "section";

/** The shared class both fold chevrons carry (plus `focus-ring`). */
export const FOLD_CHEVRON_CLASS = "margin-fold-chevron";

export type FoldChevronAttributes = IconHintAttributes & {
  "aria-expanded": "true" | "false";
};

/**
 * The attributes a fold chevron carries in a given state. `subject` names
 * what folds ("section", or a pod's kind label) — the label reads
 * "Collapse <subject>" while expanded and "Expand <subject>" while folded.
 * `aria-expanded` describes the CONTROLLED content, so it is `"true"` when
 * NOT folded.
 */
export function foldChevronAttrs(
  folded: boolean,
  subject: string,
): FoldChevronAttributes {
  return {
    ...iconHint({ label: `${folded ? "Expand" : "Collapse"} ${subject}` }),
    "aria-expanded": folded ? "false" : "true",
  };
}

/**
 * Vanilla-DOM writer for {@link foldChevronAttrs} + the `is-folded` state
 * class. O(1) per call; callers keep their own idempotence bail (the
 * section-folding resync compares against the live `is-folded` class).
 */
export function paintFoldChevron(
  btn: HTMLElement,
  folded: boolean,
  subject: string,
): void {
  btn.classList.toggle("is-folded", folded);
  for (const [k, v] of Object.entries(foldChevronAttrs(folded, subject))) {
    if (typeof v === "string") btn.setAttribute(k, v);
  }
}
