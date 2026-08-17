/**
 * Centralized UUID generation for Virgil.
 *
 * Two flavours:
 *  1. **Short IDs** — 4-char hex strings used wherever an id appears in the
 *     `.tex` source: `%!v:xxxx` paragraph anchors and the `\vfid{xxxx}` /
 *     `\vcid{xxxx}` / `\vexid{xxxx}` / `\vxid{xxxx}` / `\vlid{xxxx}` no-op
 *     markers serialized before footnotes, citations, example blocks,
 *     example items, and linked-anchor ranges. Compact and human-readable
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
// Where a `%!v:` anchor LIVES — one rule, both directions (task 348)
// ---------------------------------------------------------------------------

/**
 * The anchor token itself — `%!v:ab12`. Nothing spells this by hand.
 */
export function uuidAnchorToken(uuid: string): string {
  return `%!v:${uuid}`;
}

/**
 * **The position rule.** A construct's `%!v:` anchor is APPENDED to the END of
 * that construct's serialized body, so it sits on the construct's LAST line —
 * and {@link detachUuidAnchor} takes it off the same place. The two are exact
 * inverses; neither side states the position independently.
 *
 * Every block emitter already obeyed this by accident (a paragraph, heading,
 * list, blockquote, figure and unmodeled-env carrier each append the anchor
 * after their own last byte). The `listItem` did not: it wrote the anchor after
 * the item's HEAD LINE and let tail children (a nested list, a second
 * paragraph) follow beneath it, while the reader kept looking at the end of the
 * whole item slice — so a bullet with a sub-list took its CHILD's uuid on every
 * save and the child was re-minted as a duplicate, forever, with no user edit
 * (task 348). A comment asserting the two positions agreed is what shipped.
 */
export function appendUuidAnchor(
  body: string,
  uuid: string | null | undefined,
): string {
  return `${body}${uuidAnchorSuffix(uuid)}`;
}

/**
 * The appended part on its own — `" %!v:ab12"`, or `""` for a uuid-less node.
 *
 * The block emitters that build their line as `${base}${anchor}${trailing}`
 * take this rather than {@link appendUuidAnchor}, because their anchor is not
 * the last thing on the line. Byte-identical either way; the point is that the
 * separator and the token are spelled ONCE, so an emitter cannot drift from the
 * detach that has to find it (task 348).
 */
export function uuidAnchorSuffix(uuid: string | null | undefined): string {
  return uuid ? ` ${uuidAnchorToken(uuid)}` : "";
}

/**
 * ONE trailing anchor, plus the optional user comment REMAINDER that may follow
 * it (task 347: the anchor is itself comment bytes, so a note typed after it in
 * the code pane is ordinary content, not a parse failure).
 *
 * Exactly one, deliberately — unlike the block-level `stripUuidAnchor`, which
 * consumes a whole RUN of them. A construct's last line can legitimately carry
 * its last CHILD's anchor as well as its own (`\end{itemize} %!v:child %!v:me`),
 * and swallowing the run there would destroy the child's identity to recover
 * the parent's. A block never has that shape: its inner children are serialized
 * with their uuids suppressed.
 *
 * The prefix is GREEDY, so the LAST anchor on the line wins — which is what
 * makes the stacked form unambiguous, innermost-first, without the reader
 * knowing anything about the construct's internal structure.
 */
const TRAILING_UUID_ANCHOR =
  /^([\s\S]*)[ \t]*%!v:([0-9a-f]{4})[ \t]*(%[^\n]*)?\s*$/;

export function detachUuidAnchor(text: string): {
  text: string;
  uuid: string | null;
} {
  const m = TRAILING_UUID_ANCHOR.exec(text);
  if (!m) return { text, uuid: null };
  const head = m[1].replace(/\s+$/, "");
  const remainder = m[3] ? m[3].replace(/\s+$/, "") : "";
  const cleaned = remainder ? (head ? `${head} ${remainder}` : remainder) : head;
  return { text: cleaned, uuid: m[2] };
}

/**
 * The LIST-ITEM read door: {@link detachUuidAnchor} plus one narrowly-scoped
 * legacy branch.
 *
 * Before task 348 a tail-bearing item's anchor was written at the end of its
 * head LINE. Reading such a file with the current rule alone would take the
 * slice-end anchor — the last child's — exactly as the pre-fix reader did, so
 * every existing bullet-with-a-sub-list would shuffle its identity ONE more
 * time on the upgrade save, orphaning the cards this task exists to protect.
 *
 * The legacy signature is precise: the item slice has more than one line AND
 * its FIRST line ends with an anchor. Under the current emitter the first line
 * of a tail-bearing item ends with the head's own prose, and a single-line item
 * has no second line — so neither can be mistaken for the legacy shape. It is
 * deliberately the FIRST line and not "any line but the last": a deep nesting
 * puts a grandchild's `\end{itemize} %!v:…` on a non-last line, and a looser
 * rule would steal it.
 *
 * Known gap, stated: a legacy item whose head paragraph itself wrapped across
 * lines put the anchor at the end of the head's LAST line, which this cannot
 * distinguish from a child's. Those degrade to the pre-fix behaviour once and
 * are stable after.
 */
export function detachItemAnchor(sliceText: string): {
  text: string;
  uuid: string | null;
} {
  const nl = sliceText.indexOf("\n");
  if (nl !== -1) {
    const firstLine = sliceText.slice(0, nl);
    const legacy = detachUuidAnchor(firstLine);
    if (legacy.uuid !== null) {
      const rest = sliceText.slice(nl + 1);
      return { text: `${legacy.text}\n${rest}`, uuid: legacy.uuid };
    }
  }
  return detachUuidAnchor(sliceText);
}

// ---------------------------------------------------------------------------
// Entity IDs (full v4 UUIDs for sidecar-only data)
// ---------------------------------------------------------------------------

/** Generate a full v4 UUID for sidecar-only entities. */
export function generateEntityId(): string {
  return crypto.randomUUID();
}
