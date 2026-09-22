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

// ── The REPLACEMENT precedence (task 713) ─────────────────────────────────
//
// "The human's `user_text` wins, else the AI's `suggested_text`" was doctrine
// stated in four doc comments (`suggestion-fields.tsx`, `cards/types.ts`,
// `card-registry.tsx`, `suggestion-apply-prompt.ts`) and spelled out by hand in
// exactly ONE of them. The leg that mutates the paper — `applySuggestion` /
// `insertSuggestionBelow` — read `suggested_text` and nothing else, so a human
// who typed their own revision into "Your text" watched the AI's text land
// instead, and a human-created card (seeded `suggested_text: ""`) turned Apply
// into a DELETE of the passage it was written to improve.
//
// A precedence restated in prose in four places and executed in one is not an
// SSOT. It is spelled here, once, beside the field vocabulary it is a fact
// about — and every reader (the splice, the insert, the applicability
// predicate, the flag-OFF Accept prompt) cites this function.

/** The fields the replacement precedence reads — the structural intersection of
 *  `RevisionSuggestionCard` and `CutterSuggestionCard`. */
export interface SuggestionReplacementSource {
  /** The AI's drafted replacement (also what a human types when there is no
   *  AI draft to refine). */
  suggested_text: string;
  /** The human's own replacement ("Your text"). WINS when non-empty. */
  user_text: string;
}

/**
 * **The one speller of a suggestion's replacement text.** `user_text` when the
 * human typed one, else the AI's `suggested_text` — the literal precedence the
 * four doc comments state.
 *
 * Byte-exact (`||` on the empty string, no trimming), because the result is
 * spliced into the paper as BYTES and is what `AppliedChangeDescriptor.replacement`
 * records for Revert. Whether the result counts as "something to put in the
 * paper" is a separate, trimmed question — {@link hasSuggestionReplacement}.
 */
export function suggestionReplacement(card: SuggestionReplacementSource): string {
  return card.user_text || card.suggested_text;
}

/** Does this card have a replacement to PUT IN the paper? The trimmed question
 *  behind both landing verbs' refusals: Apply's `no-replacement` (for a family
 *  that does not mean deletion) and Insert-below's. Whitespace is not a
 *  replacement — inserting a blank paragraph is the same silence as inserting
 *  nothing. */
export function hasSuggestionReplacement(
  card: SuggestionReplacementSource,
): boolean {
  return suggestionReplacement(card).trim() !== "";
}
