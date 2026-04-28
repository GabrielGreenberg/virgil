/**
 * Centralized UUID generation for Virgil.
 *
 * Two flavours:
 *  1. **Short IDs** — 4-char hex strings used wherever an id appears in the
 *     `.tex` source: `%!v:xxxx` paragraph anchors and the `\vfid{xxxx}` /
 *     `\vcid{xxxx}` / `\vexid{xxxx}` no-op markers serialized before
 *     footnotes, citations, and example blocks. Compact and human-readable
 *     in the source. 65K-id space with optional collision-avoidance retry.
 *  2. **Entity IDs** — full v4 UUIDs for sidecar-only entities (notes,
 *     todos, comments, archive, revisions, links, etc.) that never appear
 *     in the `.tex` source.
 */

// ---------------------------------------------------------------------------
// Short IDs (4-char hex, used in .tex source)
// ---------------------------------------------------------------------------

/** Generate a 4-char hex id, optionally avoiding collisions with `existing`. */
export function generateShortId(existing?: Set<string>): string {
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
// Entity IDs (full v4 UUIDs for sidecar-only data)
// ---------------------------------------------------------------------------

/** Generate a full v4 UUID for sidecar-only entities. */
export function generateEntityId(): string {
  return crypto.randomUUID();
}
