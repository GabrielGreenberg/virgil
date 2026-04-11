/**
 * Centralized UUID generation for Virgil.
 *
 * Two flavours:
 *  1. **Node UUIDs** — 4-char hex strings persisted as `%!v:xxxx` anchors in
 *     LaTeX source. Used for paragraphs, headings, lists, math blocks, etc.
 *  2. **Entity IDs** — full v4 UUIDs for panel/sidecar entities (notes, todos,
 *     citations, quotations, revisions, etc.).
 */

// ---------------------------------------------------------------------------
// Node UUIDs (4-char hex, for %!v:xxxx anchors)
// ---------------------------------------------------------------------------

/** Generate a 4-char hex node UUID, optionally avoiding collisions with `existing`. */
export function generateNodeUuid(existing?: Set<string>): string {
  let id: string;
  do {
    id = Math.random().toString(16).slice(2, 6);
  } while (existing?.has(id));
  return id;
}

/** Regex matching a `%!v:xxxx` anchor (capture group 1 = the 4-char hex id). */
export const NODE_UUID_REGEX = /%!v:([0-9a-f]{4})/;

/** Regex for detecting a trailing `%!v:xxxx` anchor at the current parse position. */
export const NODE_UUID_ANCHOR = /^[ \t]*%!v:([0-9a-f]{4})/;

// ---------------------------------------------------------------------------
// Entity IDs (full v4 UUIDs for panel/sidecar data)
// ---------------------------------------------------------------------------

/** Generate a full v4 UUID for panel entities. */
export function generateEntityId(): string {
  return crypto.randomUUID();
}
