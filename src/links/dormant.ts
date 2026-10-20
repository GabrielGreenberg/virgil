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
 * `archivedWith` field (pinned by `dormant-links-census.test.ts`). The WRITE
 * side that makes a link dormant arrives with its caller, the archive capture
 * (task 1194); this task ships the readers and the reviver.
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

/** Which of a card's links an archive capture took with it (task 1194). */
export interface CarriedKeys {
  /** Block uuids the capture removed WHOLE — a Mode-A link travels when every
   *  pid it names is among them. */
  pids?: ReadonlySet<string>;
  /** `linkedAnchor` ids whose WHOLE mark lies inside the capture — a Mode-B
   *  link travels by its mark only (the reviver's rule, mirrored). */
  anchorIds?: ReadonlySet<string>;
}

function isCarriedLink(link: Link, keys: CarriedKeys): boolean {
  if (link.anchor.type !== "textObject" || isDormantLink(link)) return false;
  if (isModeB(link)) {
    const anchorId = link.anchor.textRange?.anchorId;
    return !!anchorId && !!keys.anchorIds?.has(anchorId);
  }
  const pids = link.anchor.textObjectIds.filter(Boolean);
  return pids.length > 0 && pids.every((pid) => !!keys.pids?.has(pid));
}

/**
 * THE WRITER (task 1194): the archive capture took this card's text with it.
 * Every link `keys` names becomes dormant in `snippetId`; a link it does not
 * name stays live, so a card also anchored to surviving text stays active
 * there. When every anchor link is dormant in THIS snippet the card is
 * archived with it (`archived` + `archivedWith`), which every archived filter
 * already hides — unless the user had archived it by hand, which stays a
 * hand archive (revival must not unarchive what the user put away).
 *
 * Identity-preserving no-op when `keys` names none of the card's links.
 */
export function markDormant<T extends DormantCardShape>(
  card: T,
  snippetId: string,
  keys: CarriedKeys,
): T {
  const links = card.links;
  if (!snippetId || !links || !links.some((l) => isCarriedLink(l, keys))) return card;
  const next = links.map((l) =>
    isCarriedLink(l, keys) ? { ...l, archivedWith: snippetId } : l,
  );
  const out: T = { ...card, links: next };
  const anchors = next.filter((l) => l.anchor.type === "textObject");
  const allHere = anchors.every((l) => l.archivedWith === snippetId);
  const byHand = card.archived === true && !isArchivedWithText(card);
  if (allHere && !byHand) {
    out.archived = true;
    out.archivedWith = snippetId;
  }
  return out;
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

/**
 * A RESTORE WHOSE UUID COLLIDED (task 1194). When a returning block's uuid is
 * already live (the user archived a copy, or something since took the id),
 * the landing gives the returning block a FRESH uuid (`remap`: old → new) —
 * so a dormant Mode-A link naming the old uuid would otherwise never revive,
 * and the load reconcile would one day revive it onto the SQUATTER. This
 * rewrites every such link of `snippetId` to the new uuid and revives it in
 * the same write (the landing has just made the new uuid live). Mode-B links
 * are untouched: they revive by their mark, which the landing re-stamped.
 * Identity-preserving no-op when nothing names a remapped uuid.
 */
export function reviveRemapped<T extends DormantCardShape>(
  card: T,
  snippetId: string,
  remap: ReadonlyMap<string, string>,
): T {
  const links = card.links;
  if (!links || remap.size === 0) return card;
  let touched = false;
  const next = links.map((l) => {
    if (l.archivedWith !== snippetId || isModeB(l) || l.anchor.type !== "textObject") return l;
    const ids = l.anchor.textObjectIds;
    if (!ids.some((u) => remap.has(u))) return l;
    touched = true;
    return {
      ...l,
      anchor: { ...l.anchor, textObjectIds: ids.map((u) => remap.get(u) ?? u) },
    };
  });
  if (!touched) return card;
  const fresh = new Set(remap.values());
  return reviveLiveLinks({ ...card, links: next } as T, {
    isUuidLive: (u) => fresh.has(u),
    isAnchorIdLive: () => false,
  });
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
