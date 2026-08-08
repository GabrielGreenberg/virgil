import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "../card-registry";
import { cardHasContent } from "../has-content";
import {
  FIELD_ORDER,
  READONLY_HUMAN_FIELDS,
  type SuggestionField,
} from "@/panels/_shared/suggestion-field-vocabulary";
import { buildSuggestionApplyPrompt } from "@/links/suggestion-apply-prompt";
import type { PendingChangeFamily } from "@/links/apply-suggestion";

/**
 * task 241 — the delete-confirm content model is AUTHOR-AWARE for the
 * suggestion family, and the guard for it is DERIVED from the composition
 * surface rather than hand-listed.
 *
 * THE ORIGINAL SHAPE. Both suggestion kinds declared `suggested_text` in
 * `aiPrefilledFields` (never counted), on a rationale that holds only for AI
 * authorship: "an AI suggestion arrives with original/suggested prefilled —
 * those are NOT user content." But an AI card never renders the editable field
 * grid at all (`PendingAiRecordBody`); the grid is the HUMAN composition
 * surface, where `suggested_text` is a live textarea and the apply path's
 * replacement (`user_text || suggested_text`). So a human-authored suggestion
 * whose only content was a typed replacement read as EMPTY to `cardHasContent`
 * → hard-deleted with no confirm from the docked trash, the Delete key, and the
 * in-text margin marker alike. Silent loss, and asymmetric with apply.
 *
 * WHY THIS TEST IS SHAPED THIS WAY. A test that merely asserts
 * `cardHasContent("cutter-suggestion", { author: "human", suggested_text })` is
 * a restatement of the fix — it cannot catch the NEXT field to land in the grid
 * and be left off (or moved back onto) the counted lists, which is exactly how
 * 241 happened (and 067 before it, one field over). So the human-typed set is
 * derived: `FIELD_ORDER ∖ READONLY_HUMAN_FIELDS` is, by construction, every
 * field the human grid lets an author type into. Every one of them must count
 * for a human-authored record.
 */

/** The suggestion family, keyed on `PendingChangeFamily` (the union
 *  `apply-suggestion.ts` already owns) so a third family member left out of
 *  this guard is a COMPILE error, not a silent coverage gap — the same
 *  derived-membership discipline as `applied-splice.ts`. */
const SUGGESTION_KINDS: Record<PendingChangeFamily, true> = {
  "cutter-suggestion": true,
  "revision-suggestion": true,
};
const KINDS = Object.keys(SUGGESTION_KINDS) as PendingChangeFamily[];

/** Every field the HUMAN composition grid lets an author type into. */
const HUMAN_TYPED: SuggestionField[] = FIELD_ORDER.filter(
  (f) => !READONLY_HUMAN_FIELDS.has(f),
);

describe.each(KINDS)("%s — author-aware content model (task 241)", (kind) => {
  it("EVERY human-typed grid field counts as content on a human record", () => {
    // The derived guard. `HUMAN_TYPED` is read off the grid itself, so a new
    // editable field (or one moved back to `aiPrefilledFields`) fails here.
    expect(HUMAN_TYPED.length).toBeGreaterThan(0);
    for (const field of HUMAN_TYPED) {
      expect(
        cardHasContent(kind, { author: "human", [field]: "the user typed this" }),
        `${kind}: a human-authored card whose only content is "${field}" must ` +
          `confirm before delete`,
      ).toBe(true);
    }
  });

  it("the ratified AI behavior survives: an untouched AI suggestion deletes freely", () => {
    // An AI card arrives with original/suggested prefilled and no editable
    // grid — dismissing it must stay nag-free.
    expect(
      cardHasContent(kind, {
        author: "ai",
        original_text: "the original passage",
        suggested_text: "the AI's replacement",
        explanation: "",
        user_text: "",
      }),
    ).toBe(false);
  });

  it("`original_text` alone never counts — for EITHER author", () => {
    // It's read-only on every surface and recoverable from the document.
    for (const author of ["human", "ai"] as const) {
      expect(
        cardHasContent(kind, { author, original_text: "the original passage" }),
      ).toBe(false);
    }
  });

  it("an ABSENT author reads as human (the migrations' default, and fail-safe)", () => {
    // `useCutter`/`useRevisions` normalize `author === "ai" ? "ai" : "human"`,
    // and confirming a delete we didn't need to is the safe direction.
    expect(cardHasContent(kind, { suggested_text: "typed replacement" })).toBe(true);
  });

  it("symmetry with the APPLY path: what apply would splice, the confirm sees", () => {
    // `buildSuggestionApplyPrompt` splices `user_text || suggested_text`. A
    // human card carrying ONLY `suggested_text` therefore has a real, applyable
    // replacement — the confirm must not treat it as an empty card. This is the
    // asymmetry the task named, pinned against the apply builder itself.
    const card = {
      original_text: "the original passage",
      suggested_text: "typed replacement",
      explanation: "",
      user_text: "",
      instructions: "",
      links: [],
    };
    expect(buildSuggestionApplyPrompt(kind, card)).toContain(
      "REPLACEMENT: typed replacement",
    );
    expect(cardHasContent(kind, { ...card, author: "human" })).toBe(true);
  });

  it("declares `suggested_text` author-conditional (never counted / always counted)", () => {
    // Regression pin on the descriptor itself: the field must sit on the
    // author-conditional axis — not back in `aiPrefilledFields` (the 241 bug)
    // and not in `textFields` (which would nag on every untouched AI card).
    const c = CARD_REGISTRY[kind].content;
    expect(c).not.toBeNull();
    expect(c!.authorConditionalFields).toContain("suggested_text");
    expect(c!.aiPrefilledFields).not.toContain("suggested_text");
    expect(c!.textFields).not.toContain("suggested_text");
  });
});
