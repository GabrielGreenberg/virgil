/**
 * Shared "does this card have user content?" predicate.
 *
 * Used by:
 *  - `EditableCard.tryDelete` (panel-primitives.tsx) — to decide whether to
 *    show the "This item has text. Delete it?" confirm before deleting via
 *    the trash button / three-dot menu.
 *  - `deleteMarginItem` (cards/delete-margin-item.ts) — same decision,
 *    triggered by Delete/Backspace on a gutter marker.
 *
 * Two layers:
 *  - `hasJsonContent(value)` walks a Tiptap JSONContent doc and returns
 *    true if any text node contains visible (non-whitespace) text.
 *  - `cardHasContent(kind, card)` dispatches on card kind and applies the
 *    right rule per kind. Highlights have no user content; AI-prefilled
 *    suggestion fields don't count; quotation titles are auto-derived and
 *    don't count.
 */

/** Card-kind discriminator used by `cardHasContent`. Spans every kind that
 *  can be anchored from a gutter marker — keep in sync with the
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
  | "quotation";

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

/** True iff the card has user-authored content worth warning about before
 *  destruction. Highlights, fresh suggestions with only the AI-prefilled
 *  fields, and quotation groups whose only "content" is an auto-derived
 *  title all return false. */
export function cardHasContent(kind: CardContentKind, card: unknown): boolean {
  if (!card || typeof card !== "object") return false;
  switch (kind) {
    case "highlight":
      // Highlights carry no user-typed body — just a color + range.
      return false;
    case "note":
    case "archive": {
      const c = card as { content?: unknown };
      return hasJsonContent(c.content);
    }
    case "todo":
    case "cutter-comment":
    case "revision-comment": {
      // These carry both a plain-text mirror (`text`) and a JSON body
      // (`content`). Either populated counts as content.
      const c = card as { text?: unknown; content?: unknown };
      if (typeof c.text === "string" && c.text.trim() !== "") return true;
      return hasJsonContent(c.content);
    }
    case "cutter-suggestion":
    case "revision-suggestion": {
      // AI suggestions land with `original_text` / `suggested_text` already
      // filled — those aren't user content. Only count fields the user
      // explicitly typed: `user_text` and `explanation`.
      const c = card as { user_text?: unknown; explanation?: unknown };
      if (typeof c.user_text === "string" && c.user_text.trim() !== "") return true;
      if (typeof c.explanation === "string" && c.explanation.trim() !== "") return true;
      return false;
    }
    case "quotation": {
      // Group title is often auto-derived from the citekey — ignore it.
      // Only the user's notes + actual quote texts count.
      const c = card as {
        notes?: unknown;
        references?: Array<{ quotes?: Array<{ text?: unknown }> }>;
      };
      if (typeof c.notes === "string" && c.notes.trim() !== "") return true;
      if (Array.isArray(c.references)) {
        for (const ref of c.references) {
          if (!ref || !Array.isArray(ref.quotes)) continue;
          for (const q of ref.quotes) {
            if (q && typeof q.text === "string" && q.text.trim() !== "") return true;
          }
        }
      }
      return false;
    }
  }
}
