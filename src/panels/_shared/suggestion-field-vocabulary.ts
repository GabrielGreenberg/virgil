/**
 * The suggestion card's FIELD VOCABULARY — the field union, the order the human
 * composition grid renders them in, and which of those the grid renders
 * read-only. Pure data: no React, no panel primitives, no editor.
 *
 * It lives apart from `suggestion-fields.tsx` (which owns the actual widgets)
 * because the vocabulary is a fact about the card's content model, not about
 * its chrome — and the content model's guard has to be able to read it. The
 * delete-confirm descriptor in `CARD_REGISTRY` must count every field a human
 * can type into (task 241), and `suggestion-content-model.test.ts` derives that
 * set from `FIELD_ORDER ∖ READONLY_HUMAN_FIELDS` rather than restating it. A
 * guard that had to import the whole panel-primitives tree to ask "which fields
 * can a human type into?" would be pressured into hand-listing them instead —
 * which is the hand-enumeration this class keeps getting bitten by.
 *
 * `suggestion-fields.tsx` re-exports all three, so existing call sites (and the
 * two suggestion cards) can keep importing from there.
 */

export type SuggestionField =
  | "original_text"
  | "suggested_text"
  | "explanation"
  | "user_text"
  | "instructions";

/** The order the human composition grid renders. (`instructions` is AI-only and
 *  deliberately absent — it never renders on the human surface.) */
export const FIELD_ORDER: SuggestionField[] = [
  "original_text",
  "suggested_text",
  "explanation",
  "user_text",
];

/** The fields the HUMAN composition grid renders READ-ONLY. `original_text` is
 *  a capture of the targeted passage — no author types it — and both suggestion
 *  cards hard-coded the same `field === "original_text"` literal, so it lives
 *  here once.
 *
 *  Load-bearing beyond the textarea: `FIELD_ORDER ∖ READONLY_HUMAN_FIELDS` IS
 *  the set of fields a human author can type into (the grid renders for human
 *  authorship only — an AI card gets `PendingAiRecordBody`), so the delete-
 *  confirm content model must count every one of them on a human-authored
 *  record. Derived-guard: `suggestion-content-model.test.ts` (task 241), which
 *  catches the ORIGINAL shape — a human-typed field declared as AI prefill and
 *  therefore invisible to the confirm. */
export const READONLY_HUMAN_FIELDS: ReadonlySet<SuggestionField> = new Set<SuggestionField>([
  "original_text",
]);
