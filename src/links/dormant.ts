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
 *   - card `archivedWith`  — set exactly while EVERY anchor link of the card
 *     is dormant ({@link isFullyDormant}), in whichever snippets: it names the
 *     snippet whose capture COMPLETED the dormancy (task 1254 — a card whose
 *     anchors went into two different snippets is as fully dormant as one
 *     whose anchors went into one). The card is then also `archived: true`, so
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

/** The dormancy field's NAME, for a table that must classify it without
 *  reading or writing it — the Stack pull's `FIELD_FATES` (task 1298), which
 *  keeps it behind because it names a snippet in the SOURCE paper. Exported
 *  so that table keys by this constant rather than spelling the field. */
export const DORMANT_CARD_FIELD = "archivedWith" as const;

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
  /** Block uuids the capture removed WHOLE — a Mode-A link travels by the
   *  pids it names that are among them (task 1270: per pid, see
   *  {@link splitCarried}). */
  pids?: ReadonlySet<string>;
  /** `linkedAnchor` ids whose WHOLE mark lies inside the capture — a Mode-B
   *  link travels by its mark only (the reviver's rule, mirrored). */
  anchorIds?: ReadonlySet<string>;
}

/**
 * THE travel question, per link (task 1270): which part of `link` did the
 * capture take? `carried` is the part that goes dormant, `kept` the part that
 * stays live — each null when empty. A Mode-B link is indivisible (it travels
 * by its mark). A Mode-A link travels PER PID: one naming `[P, Q]` whose P
 * left whole splits into a dormant `[P]` and a live `[Q]`, exactly as a card
 * with one link per paragraph already behaves. Before, a Mode-A link went
 * dormant only when EVERY pid left, while the capture's other legs asked
 * whether SOME did — so a partly-archived link was neither carried nor
 * re-homed, and the orphan sweep then stripped P for good.
 */
function splitCarried(link: Link, keys: CarriedKeys): { carried: string[]; kept: string[] } | null {
  if (link.anchor.type !== "textObject" || isDormantLink(link)) return null;
  if (isModeB(link)) {
    const anchorId = link.anchor.textRange?.anchorId;
    return anchorId && keys.anchorIds?.has(anchorId)
      ? { carried: link.anchor.textObjectIds, kept: [] }
      : null;
  }
  const carried: string[] = [];
  const kept: string[] = [];
  for (const pid of link.anchor.textObjectIds) {
    if (pid && keys.pids?.has(pid)) carried.push(pid);
    else kept.push(pid);
  }
  return carried.length > 0 ? { carried, kept } : null;
}

/** Does `keys` take any part of this link? The ONE answer every capture leg
 *  shares with the writer — `some`, per pid (task 1270). */
export function isCarriedLink(link: Link, keys: CarriedKeys): boolean {
  return splitCarried(link, keys) !== null;
}

/** A split's two halves keep the Mode-A id convention (`<cardId>@<pid>`, the
 *  `makeAnchorLink` mint): the half holding the pid the original id was
 *  minted for keeps it, the other half is minted for its own first pid. */
function splitIds(
  cardId: string,
  link: Link,
  carried: string[],
  kept: string[],
  taken: ReadonlySet<string>,
): { carriedId: string; keptId: string } {
  const unique = (id: string) => (taken.has(id) && id !== link.id ? `${id}#${link.id}` : id);
  const mintedFor = carried.some((pid) => link.id === `${cardId}@${pid}`);
  return mintedFor
    ? { carriedId: link.id, keptId: unique(`${cardId}@${kept[0] ?? ""}`) }
    : { carriedId: unique(`${cardId}@${carried[0] ?? ""}`), keptId: link.id };
}

/**
 * THE WRITER (task 1194): the archive capture took this card's text with it.
 * Every link `keys` names becomes dormant in `snippetId` — a Mode-A link only
 * in the pids `keys` names, its surviving pids split off as a live link (task
 * 1270); a link it does not name stays live, so a card also anchored to
 * surviving text stays active there. When this capture leaves EVERY anchor
 * link dormant — here or in an earlier snippet: the card-level state is
 * {@link isFullyDormant}, the same predicate the resolver and omni rows read
 * (task 1254) — the card is archived with this, the completing snippet
 * (`archived` + `archivedWith`), which every archived filter already hides —
 * unless the user had archived it by hand, which stays a hand archive
 * (revival must not unarchive what the user put away).
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
  const taken = new Set(links.map((l) => l.id));
  const next: Link[] = [];
  for (const l of links) {
    const split = splitCarried(l, keys);
    if (!split) {
      next.push(l);
      continue;
    }
    if (split.kept.length === 0 || l.anchor.type !== "textObject") {
      next.push({ ...l, archivedWith: snippetId });
      continue;
    }
    const { carriedId, keptId } = splitIds(card.id, l, split.carried, split.kept, taken);
    taken.add(carriedId).add(keptId);
    next.push(
      { ...l, id: keptId, anchor: { ...l.anchor, textObjectIds: split.kept } },
      {
        ...l,
        id: carriedId,
        anchor: { ...l.anchor, textObjectIds: split.carried },
        archivedWith: snippetId,
      },
    );
  }
  const out: T = { ...card, links: next };
  const byHand = card.archived === true && !isArchivedWithText(card);
  if (isFullyDormant(out) && !byHand) {
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
  return reviveWhere(card, live, () => true);
}

/** {@link reviveLiveLinks} over the dormant links `which` admits only. */
function reviveWhere<T extends DormantCardShape>(
  card: T,
  live: AnchorLiveness,
  which: (link: Link) => boolean,
): T {
  const links = card.links;
  if (!links || !links.some(isDormantLink)) return card;
  let revived = false;
  const next = links.map((l) => {
    if (!isDormantLink(l) || !which(l) || !isTargetLive(l, live)) return l;
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

/** A restore's old → fresh identity maps (structurally `IdentityRemap` from
 *  `slice-capture.ts` — one per identity space a carried link can name). */
export interface ReturningRemap {
  uuids: ReadonlyMap<string, string>;
  anchorIds: ReadonlyMap<string, string>;
}

/**
 * A RESTORE WHOSE IDENTITY COLLIDED (task 1194 → 1269). When a returning
 * block's uuid, or a carried mark's anchorId, is already live (the user
 * archived a copy, a doc Undo revived the original, or something since took
 * the id), the landing gives the returning one a FRESH id (`remap`: old →
 * new) — so a dormant link naming the old id would otherwise never revive,
 * or revive onto the SQUATTER. This rewrites every such link of `snippetId`
 * onto the new ids and revives it in the same write (the landing has just
 * made them live): a Mode-A link by its pids, a Mode-B link by its anchorId
 * (its pids follow the uuid map too, so the paragraph it names is the one
 * that came back). Identity-preserving no-op when nothing names a remapped id.
 */
export function reviveRemapped<T extends DormantCardShape>(
  card: T,
  snippetId: string,
  remap: ReturningRemap,
): T {
  const links = card.links;
  if (!links || (remap.uuids.size === 0 && remap.anchorIds.size === 0)) return card;
  let touched = false;
  const next = links.map((l) => {
    if (l.archivedWith !== snippetId || l.anchor.type !== "textObject") return l;
    const ids = l.anchor.textObjectIds;
    if (isModeB(l)) {
      const range = l.anchor.textRange;
      const fresh = range?.anchorId ? remap.anchorIds.get(range.anchorId) : undefined;
      if (!fresh || !range) return l;
      touched = true;
      return {
        ...l,
        anchor: {
          ...l.anchor,
          textObjectIds: ids.map((u) => remap.uuids.get(u) ?? u),
          textRange: { ...range, anchorId: fresh },
        },
      };
    }
    if (!ids.some((u) => remap.uuids.has(u))) return l;
    touched = true;
    return {
      ...l,
      anchor: { ...l.anchor, textObjectIds: ids.map((u) => remap.uuids.get(u) ?? u) },
    };
  });
  if (!touched) return card;
  const freshUuids = new Set(remap.uuids.values());
  const freshAnchors = new Set(remap.anchorIds.values());
  return reviveLiveLinks({ ...card, links: next } as T, {
    isUuidLive: (u) => freshUuids.has(u),
    isAnchorIdLive: (a) => freshAnchors.has(a),
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

// ---------------------------------------------------------------------------
// The two sides of the link, made visible (task 1195)
// ---------------------------------------------------------------------------

/**
 * The PASSAGE a card belongs to: the snippet its text was archived into. The
 * card-level field while the card is archived WITH its text; otherwise the
 * snippet of its first dormant link — so a card the user unarchived on its own
 * (its passage still archived, see {@link setArchivedFlag}) still names its
 * passage. Null for a card with no dormant link.
 */
export function passageOf(card: DormantCardShape): string | null {
  const own = dormantSnippetOf(card);
  if (own) return own;
  for (const l of card.links ?? []) if (isDormantLink(l)) return l.archivedWith!;
  return null;
}

/**
 * THE per-card archive toggle for a kind that can travel (task 1195). Every
 * card hook's `setArchived` writes through this, so a hand toggle can never
 * leave the card-level field claiming "archived with its text" when it is not:
 *
 *  - UNARCHIVE: the card leaves the archive; `archivedWith` is cleared, its
 *    dormant LINKS are kept — its text is still archived, so it reads PARKED
 *    (`resolveAnchorState`'s `parked` intent: neutral, never the red
 *    `orphaned`) and re-attaches by itself if the passage is restored.
 *  - ARCHIVE by hand: a hand archive (no `archivedWith`), which revival never
 *    undoes.
 *
 * Identity-preserving when the flag already reads `archived` — so a repeated
 * archive of a card archived WITH its text keeps it so.
 */
export function setArchivedFlag<T extends DormantCardShape>(card: T, archived: boolean): T {
  if (!!card.archived === archived) return card;
  const out: T = { ...card, archived };
  delete out.archivedWith;
  return out;
}

/**
 * The passage was DELETED for good (task 1195): nothing can revive these
 * links any more. Drop every link dormant in `snippetId`; the card itself is
 * never deleted. Its `archivedWith` follows the links, never the snippet id
 * alone (task 1254): when the card is STILL fully dormant — its other links
 * wait in another snippet — it stays archived with that one (the first
 * remaining dormant link's), so restoring it still brings the card back;
 * otherwise the field is cleared and an archived card stays an ordinary
 * archived card, an active one reads unanchored. Identity-preserving when the
 * card names nothing in that snippet.
 */
export function releaseFromSnippet<T extends DormantCardShape>(card: T, snippetId: string): T {
  const links = card.links;
  const linked = !!links && links.some((l) => l.archivedWith === snippetId);
  const owned = card.archivedWith === snippetId;
  if (!linked && !owned) return card;
  const out: T = { ...card };
  if (linked) out.links = links!.filter((l) => l.archivedWith !== snippetId);
  if (owned) {
    const still = isFullyDormant(out)
      ? (out.links ?? []).find((l) => l.anchor.type === "textObject")?.archivedWith
      : undefined;
    if (still) out.archivedWith = still;
    else delete out.archivedWith;
  }
  return out;
}

/** Can snippet `snippetId` still bring its text back? The CALLER answers,
 *  because only it knows: Restore's end edge knows the snippet it just
 *  retired; a later reader cannot tell a retired snippet from one the user
 *  set aside by hand (one `archived` flag, and un-setting it makes either
 *  restorable again), so load and reinstate strand only a MISSING one. */
export type IsPassageRestorable = (snippetId: string) => boolean;

/** Is every link a record the dormancy predicates can read? A reinstated
 *  card arrives as an unvalidated sidecar record (task 712). */
function hasReadableLinks(card: DormantCardShape): boolean {
  const links: unknown = card.links;
  if (links === undefined) return true;
  if (!Array.isArray(links)) return false;
  return links.every((l) => {
    if (!l || typeof l !== "object") return false;
    const anchor = (l as { anchor?: unknown }).anchor;
    if (!anchor || typeof anchor !== "object") return false;
    const ids = (anchor as { textObjectIds?: unknown }).textObjectIds;
    return (anchor as { type?: unknown }).type !== "textObject" || Array.isArray(ids);
  });
}

/**
 * THE dormancy invariant (task 1329): **a link dormant in snippet S has a way
 * back** — S is in the Archive, unretired, and restoring it revives the link.
 * A link dormant in a snippet that can no longer do that (RETIRED by a Restore
 * that could not place its carried word run or paragraph, or MISSING — deleted
 * while the card sat in `archive.json`) is SETTLED here: revived when its
 * target is live in the document (the Restore did bring it back, under the
 * same id), otherwise RELEASED by {@link releaseFromSnippet}'s rule — the card
 * reads unanchored, or stays an ordinary archived card. Never deletes a card.
 *
 * Links dormant in a restorable snippet are untouched, and the revival is
 * scoped to the stranded links, so a dormant link of a still-archived passage
 * is never revived onto a squatter holding its id. Identity-preserving when
 * nothing is stranded (and for a record whose links it cannot read). Every
 * door that can end a snippet's restorability settles through this
 * (`EditorPane`): Restore's end edge (the snippet it just retired), the
 * archive-origin reinstate and the load reconcile (snippets no longer in the
 * Archive — which also heals a sidecar left pinned to a deleted passage); a
 * passage delete keeps its direct `release`.
 */
export function settleDormancy<T extends DormantCardShape>(
  card: T,
  restorable: IsPassageRestorable,
  live: AnchorLiveness,
): T {
  if (!hasReadableLinks(card)) return card;
  const stranded = new Set<string>();
  for (const l of card.links ?? []) {
    if (isDormantLink(l) && !restorable(l.archivedWith!)) stranded.add(l.archivedWith!);
  }
  const own = dormantSnippetOf(card);
  if (own && !restorable(own)) stranded.add(own);
  if (stranded.size === 0) return card;
  let out = reviveWhere(card, live, (l) => stranded.has(l.archivedWith!));
  for (const snippetId of stranded) out = releaseFromSnippet(out, snippetId);
  return out;
}

/** A card that travelled with a passage, as the two surfaces read it. */
export interface TravelledCard<K extends string = string, C extends DormantCardShape = DormantCardShape> {
  kind: K;
  card: C;
  /** Still archived (the card's own Archives view) — false once the user
   *  unarchived it on its own and it reads parked. */
  archived: boolean;
}

/** One card store: its cards and how to name each one's kind. */
export interface TravelSource<K extends string, C extends DormantCardShape> {
  cards: readonly C[];
  kindOf: (card: C) => K;
}

/**
 * THE derivation (task 1195): which cards travelled with which passage. Built
 * from the card stores alone — no snippet-side list exists, so deleting or
 * re-archiving a card updates both surfaces with no second write. O(cards);
 * built when a store changes, never per document keystroke.
 */
export function cardsArchivedWith<K extends string, C extends DormantCardShape>(
  sources: readonly TravelSource<K, C>[],
): ReadonlyMap<string, readonly TravelledCard<K, C>[]> {
  const out = new Map<string, TravelledCard<K, C>[]>();
  for (const { cards, kindOf } of sources) {
    for (const card of cards) {
      const snippet = passageOf(card);
      if (!snippet) continue;
      let list = out.get(snippet);
      if (!list) out.set(snippet, (list = []));
      list.push({ kind: kindOf(card), card, archived: card.archived === true });
    }
  }
  return out;
}
