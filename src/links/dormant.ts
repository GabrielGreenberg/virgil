/**
 * DORMANT links — "archived with its text" (task 1193, foundation of the
 * 1193 → 1194 → 1195 archive-carries-its-cards arc).
 *
 * A card link is DORMANT when the text it is anchored to is not dead but
 * ARCHIVED: it sits inside an archive snippet, which keeps the block uuids it
 * captured whole (and, from 1194, the `linkedAnchor` marks) so that restoring
 * the snippet puts the very same anchors back in the document. A dormant link
 * therefore names something that is ABSENT on purpose and will come back:
 *
 *   - `Link.archivedWith`  — the snippet id this one link's text lives in;
 *   - card `archivedWith`  — set only while EVERY anchor link of the card is
 *     dormant in that snippet. The card is then also `archived: true`, so
 *     every existing archived filter (panels, omni, markers, the unanchored
 *     chip, the scripts) hides it with no new branch.
 *
 * Every reader of a card's anchors honours the state through THIS module:
 *   - the resolver (`resolve-card-anchor.ts`) skips a dormant link on every
 *     rung — so it is never snapshot-rebound onto a duplicate paragraph and
 *     never reported orphaned — and resolves an all-dormant card `dormant`;
 *   - the row authority (`card-anchor-rows.ts`) draws no row for one;
 *   - the load reconcile never rewrites one;
 *   - the link helpers the dead-pid / dead-mark sweeps go through
 *     (`removeTextObjectLink`, `clearTextAnchorLink`, `getTextAnchor`,
 *     `getLinkedTextObjectIds`) never strip, convert or re-apply one.
 *
 * Revival is by LIVENESS, never by a button: a dormant link whose target is
 * live in the document again — its uuid is back as a block (Mode A), its
 * `anchorId` mark is back (Mode B) — is revived by {@link reviveLiveLinks}.
 * Two seams call it: the load reconcile (an agent-side restore, or any restore
 * that happened while the app was closed) and the insert-driven reviver
 * (`useDormantRevival`, fed by the observer diff's added blocks/anchors) — so
 * Restore, doc Undo of an archive and the agent's restore door are all
 * correct by construction rather than each remembering to call a hook.
 *
 * OWNERSHIP: nothing outside this module reads or writes either
 * `archivedWith` field (pinned by `dormant-links-census.test.ts`).
 */

import type { Link } from "./_shared/types";
import { isModeB } from "./_shared/types";

/** The card shape the predicates read. Structural, so every card kind fits. */
export interface DormantCardShape {
  id: string;
  links?: Link[];
  archived?: boolean;
  archivedWith?: string;
}

/** Liveness answers the reviver needs — both O(1) against an index. */
export interface AnchorLiveness {
  isUuidLive: (uuid: string) => boolean;
  isAnchorIdLive: (anchorId: string) => boolean;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** Is this link's text inside an archived passage? */
export function isDormantLink(link: Link): boolean {
  return typeof link.archivedWith === "string" && link.archivedWith.length > 0;
}

/** The snippet a dormant link lives in, or null. */
export function dormantSnippetOfLink(link: Link): string | null {
  return isDormantLink(link) ? (link.archivedWith as string) : null;
}

/** The snippet a card was archived WITH (every link dormant there), or null. */
export function dormantSnippetOf(card: DormantCardShape): string | null {
  return typeof card.archivedWith === "string" && card.archivedWith.length > 0
    ? card.archivedWith
    : null;
}

/** True when the card was archived with its text (not archived by hand). */
export function isArchivedWithText(card: DormantCardShape): boolean {
  return dormantSnippetOf(card) !== null;
}

/** Does any of the card's links name archived text? */
export function hasDormantLinks(card: { links?: Link[] }): boolean {
  return (card.links ?? []).some(isDormantLink);
}

/** True when the card HAS anchor links and every one of them is dormant. */
export function isFullyDormant(card: { links?: Link[] }): boolean {
  const anchors = (card.links ?? []).filter((l) => l.anchor.type === "textObject");
  return anchors.length > 0 && anchors.every(isDormantLink);
}

/** The card's links with every dormant link removed — the LIVE view every
 *  anchor reader resolves against. Identity-preserving when nothing is
 *  dormant, so a memo keyed on the card object still hits. */
export function withoutDormantLinks<T extends { links?: Link[] }>(card: T): T {
  const links = card.links;
  if (!links || !links.some(isDormantLink)) return card;
  return { ...card, links: links.filter((l) => !isDormantLink(l)) };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/**
 * Mark the card's anchor links dormant in `snippetId` — every anchor link,
 * or only those whose id is in `linkIds`. When that leaves EVERY anchor link
 * dormant in the one snippet, the card itself is archived with the text.
 * Returns the input unchanged when nothing changes.
 */
export function markDormant<T extends DormantCardShape>(
  card: T,
  snippetId: string,
  linkIds?: ReadonlySet<string>,
): T {
  if (!snippetId) return card;
  const links = card.links ?? [];
  let changed = false;
  const next = links.map((l) => {
    if (l.anchor.type !== "textObject") return l;
    if (linkIds && !linkIds.has(l.id)) return l;
    if (l.archivedWith === snippetId) return l;
    changed = true;
    return { ...l, archivedWith: snippetId };
  });
  if (!changed) return card;
  const out: T = { ...card, links: next };
  const anchors = next.filter((l) => l.anchor.type === "textObject");
  if (anchors.length > 0 && anchors.every((l) => l.archivedWith === snippetId)) {
    out.archived = true;
    out.archivedWith = snippetId;
  }
  return out;
}

/** Is a dormant link's target live in the document again? Mode B answers by
 *  its MARK only: its stored pids name the paragraph the highlight was born
 *  in, which a partial capture leaves live — reviving on those would revive
 *  a highlight whose words are still in the archive. */
function isTargetLive(link: Link, live: AnchorLiveness): boolean {
  if (link.anchor.type !== "textObject") return false;
  if (isModeB(link)) {
    const anchorId = link.anchor.textRange?.anchorId;
    return !!anchorId && live.isAnchorIdLive(anchorId);
  }
  return link.anchor.textObjectIds.some((pid) => !!pid && live.isUuidLive(pid));
}

function stripLinkDormancy(link: Link): Link {
  const { archivedWith: _drop, ...rest } = link;
  void _drop;
  return rest;
}

/**
 * Revive every dormant link whose target is live again. A card archived WITH
 * its text stops being so the moment any of its links revives (its card-level
 * fields mean "every link is dormant", which is then false): `archived` and
 * `archivedWith` are cleared together. Identity-preserving no-op otherwise.
 */
export function reviveLiveLinks<T extends DormantCardShape>(
  card: T,
  live: AnchorLiveness,
): T {
  const links = card.links;
  if (!links || !links.some(isDormantLink)) return card;
  let revived = false;
  const next = links.map((l) => {
    if (!isDormantLink(l) || !isTargetLive(l, live)) return l;
    revived = true;
    return stripLinkDormancy(l);
  });
  if (!revived) return card;
  const out: T = { ...card, links: next };
  if (isArchivedWithText(card)) {
    delete out.archivedWith;
    delete out.archived;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The reviver's index — O(cards) to build, O(1) per inserted key to consult
// ---------------------------------------------------------------------------

/** Every dormant key a card set is waiting on. */
export interface DormantKeys {
  uuids: ReadonlySet<string>;
  anchorIds: ReadonlySet<string>;
}

export const NO_DORMANT_KEYS: DormantKeys = { uuids: new Set(), anchorIds: new Set() };

/** Build the dormant-key index for a card set. Built when the cards change
 *  (a sidecar write), never per keystroke. */
export function dormantKeysOf(cards: readonly { links?: Link[] }[]): DormantKeys {
  let uuids: Set<string> | null = null;
  let anchorIds: Set<string> | null = null;
  for (const card of cards) {
    for (const l of card.links ?? []) {
      if (!isDormantLink(l) || l.anchor.type !== "textObject") continue;
      if (isModeB(l)) {
        const a = l.anchor.textRange?.anchorId;
        if (a) (anchorIds ??= new Set()).add(a);
      } else {
        for (const pid of l.anchor.textObjectIds) if (pid) (uuids ??= new Set()).add(pid);
      }
    }
  }
  if (!uuids && !anchorIds) return NO_DORMANT_KEYS;
  return { uuids: uuids ?? new Set(), anchorIds: anchorIds ?? new Set() };
}

/** Does an insertion carrying these keys touch anything dormant? O(inserted). */
export function insertionTouchesDormant(
  keys: DormantKeys,
  inserted: { uuids: readonly string[]; anchorIds: readonly string[] },
): boolean {
  if (keys === NO_DORMANT_KEYS) return false;
  return (
    inserted.uuids.some((u) => keys.uuids.has(u)) ||
    inserted.anchorIds.some((a) => keys.anchorIds.has(a))
  );
}
