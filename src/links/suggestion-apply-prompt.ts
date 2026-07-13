import type { Link } from "@/links/_shared/types";
import type { PendingChangeFamily } from "@/links/apply-suggestion";

/**
 * Shared builder for the flag-OFF **Accept** prompt of a suggestion card
 * (Cutter + Revisions). Both hosts' `onAcceptSuggestion` file an AI request
 * whose prompt is this string.
 *
 * This is the single source of truth for that prompt contract. The two hosts
 * used to carry near-identical private `buildSuggestionPrompt` copies that had
 * silently DRIFTED: the cutter copy dropped both the `user_text` fallback and
 * the conditional `INSTRUCTIONS` line, so a human who typed their cut into the
 * "your version" (`user_text`) field and clicked Accept queued a request built
 * from the stale/blank `suggested_text` instead. Hoisting it here means the
 * REPLACEMENT precedence (`user_text` wins, else `suggested_text`) can't
 * diverge between the two families again. Only the lead-in verb line is
 * parameterized by `family`.
 */

/** The fields the Accept prompt reads — the structural intersection of
 *  `CutterSuggestionCard` and `RevisionSuggestionCard`. Both are assignable. */
export interface SuggestionPromptSource {
  original_text: string;
  suggested_text: string;
  explanation: string;
  /** Human's own replacement ("your version"). Wins over `suggested_text`
   *  when non-empty — the whole point of this shared builder. */
  user_text: string;
  instructions: string;
  selectedText?: string;
  links: Link[];
}

const LEAD_IN: Record<PendingChangeFamily, string> = {
  "cutter-suggestion": "Apply this suggestion in the document:",
  "revision-suggestion": "Apply this revision suggestion in the document:",
};

export function buildSuggestionApplyPrompt(
  family: PendingChangeFamily,
  s: SuggestionPromptSource,
): string {
  const anchorBits: string[] = [];
  if (s.selectedText) anchorBits.push(`captured text: "${s.selectedText}"`);
  if (s.links.length > 0) {
    const pids = new Set<string>();
    for (const l of s.links) {
      if (l.anchor.type === "textObject") {
        for (const p of l.anchor.textObjectIds) pids.add(p);
      }
    }
    if (pids.size > 0) anchorBits.push(`paragraphs: ${[...pids].join(", ")}`);
  }
  const anchor = anchorBits.length > 0 ? anchorBits.join("; ") : "(none)";
  return [
    LEAD_IN[family],
    `ORIGINAL: ${s.original_text}`,
    `REPLACEMENT: ${s.user_text || s.suggested_text}`,
    `EXPLANATION: ${s.explanation || "(none)"}`,
    s.instructions ? `INSTRUCTIONS: ${s.instructions}` : null,
    `ANCHOR: ${anchor}`,
  ]
    .filter(Boolean)
    .join("\n");
}
