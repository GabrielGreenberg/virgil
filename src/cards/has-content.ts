/**
 * Shared "does this card have user content?" predicate — now a single
 * registry-driven walker over `CARD_REGISTRY[kind].content` (T4 §3.1).
 *
 * Used by:
 *  - `EditableCard.tryDelete` (panel-primitives.tsx) — to decide whether to
 *    show the "This item has text. Delete it?" confirm before deleting via
 *    the trash button / three-dot menu.
 *  - `deleteMarginItem` (cards/delete-margin-item.ts) — same decision,
 *    triggered by Delete/Backspace on a margin marker.
 *  - The footnote orphan gate (`lib/tiptap/footnote.ts`) — orphan-worthiness
 *    (a footnote with body OR title is recoverable; FN-A1-02).
 *  - The citation trash confirm (`CitationCard`) — a citation with keys.
 *
 * THE DEFICIENCY THIS REPLACES: the old per-kind `switch` had no `citation` /
 * `footnote` case, ignored a report's `title` for the body-only path, and was
 * mirrored by a SECOND body-only predicate in `EditableCard`. So a titled-empty
 * report deleted with no confirm (REP-F7-01), a citation/footnote trash had no
 * confirm at all (CI-F7-01 / OMNI-F7-01), and a title-only footnote didn't
 * orphan (FN-A1-02). The walker reads the declared `CardMeta.content` model, so
 * NO kind can carry content the confirm can't see — and a new kind can't ship
 * without declaring its model (`assertContentCoverage`).
 *
 * THE SECOND DEFICIENCY (task 401): the body walk asked for TEXT. Virgil's
 * payload very often lives in ATTRS — `$\lambda$`, a tex block, a forest tree,
 * a citation, a caption-less figure — so a body that was entirely one atom read
 * as EMPTY. A footnote whose body was one atom stayed "pristine" and the
 * click-away watcher DELETED it with no confirm and no undo, and all four
 * card-delete doors below skipped the "This item has text" dialog on a card
 * that is often the only surviving copy. The body walk is now
 * `jsonCarriesContent` — the ONE walker, shared with the mount-preservation
 * door, whose allowlist of empty wrappers is closed and small where a denylist
 * of atoms could only ever be missing the tenth.
 *
 * Two layers:
 *  - `jsonCarriesContent(value)` ([@/lib/node-attr-sets](../lib/node-attr-sets.ts))
 *    walks a Tiptap JSONContent doc and returns true if it carries anything a
 *    reader would miss.
 *  - `cardHasContent(kind, card)` reads the kind's declared `content` descriptor
 *    and checks every counted field (the rich `bodyField` walked for visible
 *    text; the `textFields` matched as non-empty string or non-empty array) —
 *    plus, on a human-authored record, the `authorConditionalFields` (task 241).
 */

import { CARD_REGISTRY } from "./card-registry";
import type { CardKind } from "./types";
import { jsonCarriesContent } from "@/lib/node-attr-sets";

/** Card-kind discriminator used by `cardHasContent`. Retained as a NARROW alias
 *  of `CardKind` for the margin-marker call sites (`delete-margin-item.ts`),
 *  which only ever resolve to a marker-bearing spine kind — but the walker now
 *  accepts any `CardKind` (footnote / citation included). Keep in sync with the
 *  `MarginItemKind` union in `delete-margin-item.ts`. */
export type CardContentKind =
  | "note"
  | "highlight"
  | "archive"
  | "todo"
  | "cutter-comment"
  | "cutter-suggestion"
  | "revision-comment"
  | "revision-suggestion"
  | "report"
  | "report-request";

/** True iff a named field on the card record holds visible user content. A
 *  string counts when trimmed-non-empty; an array counts when non-empty (e.g.
 *  citation `keys`); any other truthy value counts defensively. */
function textFieldHasContent(card: Record<string, unknown>, field: string): boolean {
  const v = card[field];
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return false;
}

/** True iff the record reads as AI-authored. Mirrors the sidecar migrations'
 *  own normalization (`author === "ai" ? "ai" : "human"`, `useCutter` /
 *  `useRevisions`): anything that isn't the literal `"ai"` — including an
 *  ABSENT `author` on a partial record — is human. That default also fails
 *  SAFE: the author-conditional fields then count, so the worst case is a
 *  confirm the user didn't need, never a silent delete of typed text. */
function isAiAuthored(rec: Record<string, unknown>): boolean {
  return rec.author === "ai";
}

/**
 * True iff the card has user-authored content worth warning about before
 * destruction. The single registry-driven walker over the kind's declared
 * `CardMeta.content` model. A `null` descriptor (highlight / bib / ai / error)
 * ALWAYS reports false (no user content → delete without confirm), which is the
 * correct behavior for those kinds.
 *
 * Accepts any `CardKind`. The card record is matched against the descriptor's
 * field names, on two axes:
 *
 *  - UNCONDITIONAL — `bodyField` (a JSONContent body, walked for visible text)
 *    + `textFields` (plain string or array).
 *  - AUTHOR-CONDITIONAL — `authorConditionalFields` count only when the record
 *    is NOT AI-authored (task 241). The suggestion family's `suggested_text` is
 *    AI prefill on an AI card (which never renders an editable field grid) and
 *    the human author's typed, apply-load-bearing replacement on a human card.
 *
 * `aiPrefilledFields` are NEVER read — they're the fields no author types
 * (`original_text`, a read-only capture of the targeted passage).
 */
export function cardHasContent(kind: CardKind, card: unknown): boolean {
  if (!card || typeof card !== "object") return false;
  const model = CARD_REGISTRY[kind].content;
  if (model === null) return false; // no-user-content kind (highlight/bib/ai/error)
  const rec = card as Record<string, unknown>;
  if (model.bodyField && jsonCarriesContent(rec[model.bodyField])) return true;
  for (const f of model.textFields) {
    if (textFieldHasContent(rec, f)) return true;
  }
  if (!isAiAuthored(rec)) {
    for (const f of model.authorConditionalFields) {
      if (textFieldHasContent(rec, f)) return true;
    }
  }
  return false;
}
