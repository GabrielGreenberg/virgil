/**
 * Shared "does this card have user content?" predicate — now a single
 * registry-driven walker over `CARD_REGISTRY[kind].content` (T4 §3.1).
 *
 * Used by:
 *  - `EditableCard.tryDelete` (panel-primitives.tsx) — to decide whether to
 *    show the "This item has text. Delete it?" confirm before deleting via
 *    the trash button / three-dot menu.
 *  - `deleteMarginItem` (cards/delete-margin-item.ts) — same decision,
 *    triggered by Delete/Backspace on a gutter marker.
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
 * Two layers:
 *  - `hasJsonContent(value)` walks a Tiptap JSONContent doc and returns
 *    true if any text node contains visible (non-whitespace) text.
 *  - `cardHasContent(kind, card)` reads the kind's declared `content` descriptor
 *    and checks every counted field (the rich `bodyField` walked for visible
 *    text; the `textFields` matched as non-empty string or non-empty array).
 */

import { CARD_REGISTRY } from "./card-registry";
import type { CardKind } from "./types";

/** Card-kind discriminator used by `cardHasContent`. Retained as a NARROW alias
 *  of `CardKind` for the gutter-marker call sites (`delete-margin-item.ts`),
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

/** Walk a Tiptap JSONContent doc (or fragment) for visible text. */
export function hasJsonContent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const node = value as { text?: unknown; content?: unknown };
  if (typeof node.text === "string" && node.text.trim() !== "") return true;
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (hasJsonContent(child)) return true;
    }
  }
  return false;
}

/** True iff a named field on the card record holds visible user content. A
 *  string counts when trimmed-non-empty; an array counts when non-empty (e.g.
 *  citation `keys`); any other truthy value counts defensively. */
function textFieldHasContent(card: Record<string, unknown>, field: string): boolean {
  const v = card[field];
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return false;
}

/**
 * True iff the card has user-authored content worth warning about before
 * destruction. The single registry-driven walker over the kind's declared
 * `CardMeta.content` model. A `null` descriptor (highlight / bib / ai / error)
 * ALWAYS reports false (no user content → delete without confirm), which is the
 * correct behavior for those kinds.
 *
 * Accepts any `CardKind`. The card record is matched against the descriptor's
 * field names: `bodyField` (a JSONContent body, walked for visible text) +
 * `textFields` (plain string or array). `aiPrefilledFields` are NOT read — they
 * are AI-prefilled (the suggestion family's `original_text`/`suggested_text`)
 * and don't count as user content.
 */
export function cardHasContent(kind: CardKind, card: unknown): boolean {
  if (!card || typeof card !== "object") return false;
  const model = CARD_REGISTRY[kind].content;
  if (model === null) return false; // no-user-content kind (highlight/bib/ai/error)
  const rec = card as Record<string, unknown>;
  if (model.bodyField && hasJsonContent(rec[model.bodyField])) return true;
  for (const f of model.textFields) {
    if (textFieldHasContent(rec, f)) return true;
  }
  return false;
}
