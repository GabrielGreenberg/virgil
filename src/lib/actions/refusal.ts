/**
 * WHY a command is greyed — the reason channel of the action registry's verdict
 * (task 968).
 *
 * `ActionSpec.applies(ctx)` answers `"ok" | "disabled" | "absent"`: a bare
 * verdict. Every command surface (grab menu, lightning grid, slash popup)
 * painted that verdict and nothing else, so a greyed row could mean the partner
 * holds the pen, the paper is open read-only, the caret's container refuses the
 * action, or there is simply nothing selected — and a whole-menu grey looked
 * like a broken menu. STYLE_GUIDE "A command surface RENDERS its verdict"
 * (task 695): "A disabled control with no reason is the same silence one step
 * further back."
 *
 * The reason is decided where the verdict is: `verdictOf` in
 * `action-registry.ts` walks the SAME gates `applies()` routes through and
 * names the one that refused, as a `Refusal`. This module is the ONE table that
 * turns a refusal into the words the user reads — so no surface writes its own
 * copy and no two surfaces can explain one grey two ways.
 *
 * Pure: no editor, no DOM. `subject` is a ProseMirror node type name (which is
 * also the `TEXT_OBJECT_REGISTRY` key), resolved to the kind's own label.
 */

import { TEXT_OBJECT_REGISTRY, isTextObjectKind } from "@/text-objects/text-object-registry";

/** Which gate refused. Ordered as `verdictOf` asks them. */
export type RefusalCause =
  /** Collab: the other author holds the pen (`ctx.canEdit === false`). */
  | "pen"
  /** The host mounted this surface read-only (the Library Reader — task 733). */
  | "host"
  /** A `selection: "required"` action at a collapsed caret (DA-5). */
  | "needs-selection"
  /** The target block's KIND excludes the action (`TEXT_OBJECT_REGISTRY.actions`,
   *  or a meaningful block atom as an insert/convert target). */
  | "kind"
  /** The caret's / selection's CONTAINER cannot host what the action makes. */
  | "container"
  /** A wrap action whose capture cannot carry everything selected (task 907). */
  | "capture";

export interface Refusal {
  cause: RefusalCause;
  /** The node type name the refusal is ABOUT (`"titleField"`, `"codeBlock"`…)
   *  for `kind` / `container`; absent when no specific block can be named. */
  subject?: string | null;
}

/** A kind's label as it reads mid-sentence: "Title field" → "title field", but
 *  "LaTeX comment" / "TeX block" keep their casing (an inner capital in the
 *  first word marks a proper spelling, not a sentence-initial capital). */
function midSentence(label: string): string {
  const first = label.split(" ")[0] ?? "";
  if (/[A-Z]/.test(first.slice(1))) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function subjectLabel(subject: string | null | undefined): string | null {
  if (!subject || !isTextObjectKind(subject)) return null;
  return midSentence(TEXT_OBJECT_REGISTRY[subject].label);
}

/**
 * The words for a refusal — short (a hint bubble is 1–4 words where it can
 * be), plain, and about the user's situation rather than the code's.
 */
export function refusalPhrase(refusal: Refusal): string {
  switch (refusal.cause) {
    case "pen":
      return "Your co-author has the pen";
    case "host":
      return "This paper is open read-only";
    case "needs-selection":
      return "Select some text first";
    case "capture":
      return "The selection holds something this can't wrap";
    case "kind": {
      const label = subjectLabel(refusal.subject);
      return label ? `Not available on this ${label}` : "Not available here";
    }
    case "container": {
      const label = subjectLabel(refusal.subject);
      return label ? `Not available inside this ${label}` : "Not available here";
    }
  }
}
