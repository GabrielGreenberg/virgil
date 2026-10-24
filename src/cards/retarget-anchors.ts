"use client";

/**
 * **A destructive capture RE-HOMES the margin context it displaces; a
 * destructive DELETE orphans it** (task 491).
 *
 * Gabriel, from a real paper: *"when you archive a passage that has an archive
 * card, you loose the original archive card. they should just stack up on the
 * preceeding paragraph."*
 *
 * The pre-491 behaviour was a DECIDED contract, not an accident — task 393
 * pinned it as an EQUALITY with a plain Delete over the same range. What that
 * equality missed is that the two actions mean different things. **A delete
 * genuinely removes the context, so a card that pointed at it has nowhere to
 * be. An archive SETS THE TEXT ASIDE** — the passage still exists, one panel
 * over — so the reader's marginalia has somewhere to be: the surviving
 * neighbour, which is exactly where the archive snippet itself lands. Post-410
 * an orphaned card is not literally lost (it reaches the pod header's
 * "N unanchored" chip), but it leaves the margin, which is what Gabriel
 * experiences as loss.
 *
 * ## The scope is the CLASS, and it is drawn at the ANCHOR MODE
 *
 * Every **Mode-A paragraph-anchored** card — note, archive, todo, report /
 * report-request, revision / revision-suggestion, cutter comment / suggestion —
 * re-homes, because its anchor is a paragraph IDENTITY that the capture
 * consumed and the neighbour can carry. Membership is
 * {@link MarginItemKind}, derived from `MarkerType`, so a new margin-bearing
 * card kind inherits this by declaring itself.
 *
 * **Mode-B (`linkedAnchor`) anchors deliberately do NOT re-home**, and that is
 * a statement rather than an omission: a Mode-B anchor names a TEXT RANGE, and
 * the range is precisely what left. Those cards go through
 * `cleanupLinksInRange`, which the archive and delete branches share — Delete
 * deletes them, Archive CARRIES them (task 1194).
 *
 * **Since task 1194 only `archive` cards still re-home.** Every kind that
 * declares `lifecycle.carry` travels INTO the snippet instead — its link goes
 * dormant and comes back on Restore ({@link carryDisplacedAnchors}); the
 * archive gesture hands {@link retargetDisplacedAnchors} that predicate as
 * `keep`. The join re-home (task 514) passes no `keep` and is unchanged.
 *
 * ## Why the sweep asks the COLLECTION
 *
 * A Mode-A anchor lives on the CARD, not in the document — nothing in the
 * removed slice marks it — so it cannot be found by walking the doc the way
 * `cleanupLinksInRange` finds atoms and marks. The question has to be asked
 * from the other side: *which cards name a uuid this capture is about to
 * remove?* That is why {@link MarginItemHandlers} carries its kind's whole
 * collection alongside the by-id lookup the delete path uses — one bundle,
 * both directions, built by the one builder every consumer already shares.
 *
 * Cost: O(cards × anchors-per-card) on a discrete user action. Never a
 * keystroke.
 */

import { useMemo, useRef } from "react";
import { getLinkedTextObjectIds } from "@/links/links";
import { isAnchorableBlock } from "@/text-objects/anchor-resolution";
import type { TextObjectKind } from "@/text-objects/types";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { CarriedMarkRecord, DisplacedAnchorRecord } from "@/lib/types";
import type { JSONContent } from "@tiptap/react";
import {
  NO_IDENTITY_REMAP,
  freshenReturningIdentities,
  isEmptyRemap,
  withCarriedMarks,
  type IdentityRemap,
} from "@/lib/tiptap/slice-capture";
import { collectBlockUuids, collectLinkedAnchorIds } from "@/lib/tiptap/node-identity";
import type { BlockAbsorbedEvent } from "@/lib/tiptap/linked-anchor";
import type { MarginItemHandlers, MarginItemKind } from "./delete-margin-item";
import type { CardWithLinks } from "@/links/links";
import type { CardKind } from "./types";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { CARD_REGISTRY } from "./card-registry";
import { cardKindFromRecord } from "./predicates";
import { panelForMarkerType } from "./marker-meta";

/** Where the displaced anchors go. Resolved ONCE per gesture by
 *  `resolveDisplacedAnchorPlacement` so the snippet and every card it displaced
 *  land on the same paragraph — which is what "stack up" means. */
export interface AnchorRetargetTarget {
  uuid: string;
  kind: TextObjectKind;
}

export interface RetargetDisplacedAnchorsArgs {
  /** The per-kind bundle — the SAME `Record<MarginItemKind, …>` the margin's
   *  delete path reads, so the two can never disagree about which hook owns a
   *  kind. */
  handlers: Record<MarginItemKind, MarginItemHandlers>;
  /** Anchor uuids the capture is about to remove from the document
   *  (`collectRemovedAnchorUuids`). */
  removed: ReadonlySet<string>;
  /** The surviving neighbour, or `null` when nothing survives — in which case
   *  this is a NO-OP and every card keeps the ordinary orphan path. */
  target: AnchorRetargetTarget | null;
  /** The target paragraph's normalized text, so the fresh Mode-A link is
   *  self-healing on reload exactly as the re-anchor gesture's is. */
  snapshot: string | null;
  /** Cards this sweep leaves where they are because they TRAVEL with the
   *  capture instead (task 1194 — {@link carryDisplacedAnchors}). Absent for
   *  the join re-home, which has no snippet to travel into. */
  keep?: (kind: MarginItemKind, card: CardWithLinks) => boolean;
}

/**
 * Move every displaced Mode-A anchor onto `target`. Returns one
 * {@link DisplacedAnchorRecord} per card moved — the archive capture records
 * them on its snippet so Restore can hand the cards back (task 1079); the join
 * re-home has no inverse and only counts them.
 *
 * Per card:
 *  - drop ONLY the consumed pids — a multi-anchor card keeps every anchor the
 *    capture did not touch, per the task-369 rows vocabulary;
 *  - add `target` once, and only if the card is not already anchored there
 *    (repeated adjacent archives converge on one neighbour, and a second
 *    identical link would render a duplicate marker on it).
 *
 * MUST run BEFORE the capture's `tr.delete` is dispatched. Not for position
 * reasons — these are sidecar writes — but because the deferred
 * `virgil-textobject-orphaned` sweep fires off that transaction and strips any
 * link still naming a vanished uuid. Retarget first and the sweep finds
 * nothing to strip, by construction rather than by racing it.
 */
export function retargetDisplacedAnchors({
  handlers,
  removed,
  target,
  snapshot,
  keep,
}: RetargetDisplacedAnchorsArgs): DisplacedAnchorRecord[] {
  if (!target || removed.size === 0) return [];
  // A target inside the removal would hand every card a uuid that is about to
  // vanish — a no-op at best and a fresh orphan at worst. The resolver already
  // refuses that; re-check here so the door is safe for any caller.
  if (removed.has(target.uuid)) return [];

  const moved: DisplacedAnchorRecord[] = [];
  for (const kind of Object.keys(handlers) as MarginItemKind[]) {
    const bundle = handlers[kind];
    for (const card of bundle.cards) {
      if (keep?.(kind, card)) continue;
      const pids = getLinkedTextObjectIds(card);
      const displaced = pids.filter((pid) => removed.has(pid));
      if (displaced.length === 0) continue;
      for (const pid of displaced) bundle.unanchor(card.id, pid);
      const added = !pids.includes(target.uuid);
      if (added) {
        bundle.reanchor(card.id, target.uuid, target.kind, snapshot);
      }
      moved.push({ kind, id: card.id, from: displaced, to: target.uuid, added });
    }
  }
  return moved;
}

/** The spine kind of a card in a margin bundle — `cut` / `revision` /
 *  `report` bundles hold two kinds each, told apart by the record's own
 *  `kind`. */
export function marginCardKind(kind: MarginItemKind, card: CardWithLinks): CardKind {
  return cardKindFromRecord(card as { kind?: string }, panelForMarkerType(kind));
}

/** Does an ARCHIVE carry this margin card with the passage (task 1194)? Its
 *  kind's declared `lifecycle.carry` — the predicate the capture hands
 *  {@link retargetDisplacedAnchors} as `keep`, so a card is either carried or
 *  re-homed, never both. `archive` declares no carry: an archive card inside
 *  the passage still stacks on the preceding paragraph (task 491). */
export function travelsWithArchive(kind: MarginItemKind, card: CardWithLinks): boolean {
  return CARD_REGISTRY[marginCardKind(kind, card)]?.lifecycle.carry === true;
}

export interface CarryDisplacedAnchorsArgs {
  handlers: Record<MarginItemKind, MarginItemHandlers>;
  /** Block uuids the capture removed whole (`collectRemovedAnchorUuids`). */
  removed: ReadonlySet<string>;
  /** The snippet the passage now lives in. */
  snippetId: string;
  /** The per-doc lifecycle table — its `carry` op is the write. */
  lifecycle: CardLifecycleApi;
}

/**
 * **An archive CARRIES the Mode-A cards of its passage** (task 1194) — the
 * replacement, for every travelling kind, of the 491 re-home above. A card
 * whose paragraph left WHOLE goes into the archive with it: the link that
 * named that paragraph turns dormant in `snippetId` (the paragraph's uuid
 * rides the capture and comes back on Restore, which revives the link by
 * liveness), and a card with no live anchor left is archived with the
 * snippet. A link to SURVIVING text is untouched, so a multi-anchor card stays
 * active there. Nothing is written onto the neighbour and nothing goes in the
 * snippet's `displaced` record — there is nothing to hand back.
 *
 * Returns how many cards it carried. O(cards × anchors) on a click.
 */
export function carryDisplacedAnchors({
  handlers,
  removed,
  snippetId,
  lifecycle,
}: CarryDisplacedAnchorsArgs): number {
  if (removed.size === 0 || !snippetId) return 0;
  let carried = 0;
  for (const kind of Object.keys(handlers) as MarginItemKind[]) {
    for (const card of handlers[kind].cards) {
      if (!travelsWithArchive(kind, card)) continue;
      if (!getLinkedTextObjectIds(card).some((pid) => removed.has(pid))) continue;
      const carry = lifecycle.get(marginCardKind(kind, card))?.carry;
      if (!carry) continue;
      carry(card.id, snippetId, { pids: removed });
      carried += 1;
    }
  }
  return carried;
}

/**
 * The stable API the drag-handle dispatcher holds.
 *
 * Identity-stable for the pane's lifetime (the same ref-behind-a-memo shape
 * `useCardLifecycleApi` uses): the handler bundle re-memoizes on every sidecar
 * edit, and threading that identity into the dispatcher's `useCallback` deps
 * would churn `dispatch` — and with it every consumer memo — on every card
 * change.
 */
export interface AnchorRetargetApi {
  retarget(args: Omit<RetargetDisplacedAnchorsArgs, "handlers">): DisplacedAnchorRecord[];
  /** The archive's Mode-A CARRY (task 1194) — see {@link carryDisplacedAnchors}. */
  carry(args: Omit<CarryDisplacedAnchorsArgs, "handlers">): number;
  /** The inverse, for Restore (task 1079) — see {@link returnDisplacedAnchors}. */
  returnDisplaced(args: Omit<ReturnDisplacedAnchorsArgs, "handlers">): number;
}

/** Wrap a live (re-memoizing) handler bundle in an identity-stable
 *  {@link AnchorRetargetApi}. See that type for why stability is load-bearing. */
export function useAnchorRetargetApi(
  handlers: Record<MarginItemKind, MarginItemHandlers>,
): AnchorRetargetApi {
  const ref = useRef(handlers);
  ref.current = handlers;
  return useMemo<AnchorRetargetApi>(
    () => ({
      retarget: (args) =>
        retargetDisplacedAnchors({ ...args, handlers: ref.current }),
      carry: (args) => carryDisplacedAnchors({ ...args, handlers: ref.current }),
      returnDisplaced: (args) =>
        returnDisplacedAnchors({ ...args, handlers: ref.current }),
    }),
    [],
  );
}

/**
 * **A JOIN re-homes the margin context it absorbs** (task 514) — the second
 * producer of the displacement this module exists for.
 *
 * Gabriel's ruling, 2026-08-31: Backspace-merging two anchored paragraphs is a
 * MERGE, not a delete. The absorbed block's words are still on screen, inside
 * the survivor, so the card that pointed at them FOLLOWS the survivor rather
 * than orphaning to the pod header's "N unanchored" chip. That is exactly the
 * answer task 491 already chose for the sibling gesture (an archive capture
 * displacing a neighbour's card), so it runs through the SAME door — which is
 * what makes "a displaced Mode-A anchor moves onto ONE surviving block,
 * converging, dropping only the consumed pid" one rule instead of two.
 *
 * Ordering, for free: `TextObjectOrphanGuard` publishes the ABSORBED verdict
 * INSTEAD of the `virgil-textobject-orphaned` event, never both, so the sweep
 * that strips a link naming a vanished uuid cannot race the re-home. 491 had to
 * order the two by hand ("retarget BEFORE the delete"); here the two are
 * mutually exclusive by construction.
 *
 * Returns whether anything moved (diagnostics / tests; the caller ignores it).
 */
export function rehomeAbsorbedAnchor({
  event,
  retarget,
  snapshotFor,
}: {
  event: BlockAbsorbedEvent;
  retarget: Pick<AnchorRetargetApi, "retarget">;
  /** Normalized text of the survivor, so the fresh Mode-A link is self-healing
   *  on reload exactly as the re-anchor gesture's is. */
  snapshotFor: (uuid: string) => string | null;
}): number {
  const { absorbed, survivor } = event;
  // The guard is registry-free by design (it reads the schema, not the text-
  // object vocabulary), so the KIND is validated here. A survivor whose type is
  // not a text-object kind has no anchor to offer, and the card keeps the
  // ordinary orphan path rather than being handed a uuid nothing can resolve.
  if (!isAnchorableBlock(survivor.typeName, survivor.uuid)) return 0;
  if (absorbed.uuid === survivor.uuid) return 0;
  return retarget.retarget({
    removed: new Set([absorbed.uuid]),
    target: { uuid: survivor.uuid, kind: survivor.typeName },
    snapshot: snapshotFor(survivor.uuid),
  }).length;
}

export interface ReturnDisplacedAnchorsArgs {
  handlers: Record<MarginItemKind, MarginItemHandlers>;
  displaced: ReadonlyArray<DisplacedAnchorRecord>;
  /** Where a CAPTURED uuid came back — the live uuid it landed under (its own,
   *  or the fresh one a collision gave it), with that block's kind + snapshot —
   *  or `null` when the restore did not bring it back (see {@link returnedBlocks}). */
  returned: (
    uuid: string,
  ) => { uuid: string; kind: TextObjectKind; snapshot: string | null } | null;
}

/**
 * **Restore hands back the margin the archive displaced** (task 1079) — the
 * inverse of {@link retargetDisplacedAnchors}, and what makes Archive → Restore
 * a round trip for the cards as well as the text.
 *
 * Task 965 made Restore land the passage at its RETURN ADDRESS, carrying its
 * original block uuids. But since task 491 nothing is anchored to those uuids
 * any more — the capture moved every Mode-A card onto the neighbour — so the
 * re-established identity had nothing pointing at it, and the user's notes
 * stayed stacked on the wrong paragraph. Which cards moved, and from where, is
 * a fact only the CAPTURE can see (the same argument as `returnBefore`), so it
 * records them on the snippet (`ArchivedSnippet.displaced`) and this reads
 * them back.
 *
 * Per record:
 *  - a card that no longer exists is skipped;
 *  - a card the capture ADDED to the neighbour but that is no longer there has
 *    been moved by the user since — their choice wins, and it is left alone;
 *  - only a `from` uuid the restore itself RETURNED (`returned(uuid)` non-null)
 *    is re-anchored — onto the uuid it came back UNDER. On a collision (the
 *    captured uuid already live, naming someone else's block) the landing gave
 *    the returning block a fresh id and recorded old → new (task 1194's
 *    `freshenReturningUuids`, owned by {@link landReturningDisplaced}), so the
 *    card follows its block to the fresh id — the same id the dormant cards of
 *    that restore revive on (task 1253). A `from` the restore did not bring
 *    back at all leaves the card where it is;
 *  - the neighbour link is dropped only if the capture added it.
 *
 * Re-anchor BEFORE unanchor, so the card never passes through zero anchors.
 * Returns how many cards moved back.
 */
export function returnDisplacedAnchors({
  handlers,
  displaced,
  returned,
}: ReturnDisplacedAnchorsArgs): number {
  let moved = 0;
  for (const rec of displaced) {
    const bundle = (handlers as Partial<Record<string, MarginItemHandlers>>)[rec.kind];
    const card = bundle?.findCard(rec.id);
    if (!bundle || !card) continue;
    const pids = getLinkedTextObjectIds(card);
    if (rec.added && !pids.includes(rec.to)) continue;
    let back = false;
    for (const uuid of rec.from) {
      const block = returned(uuid);
      if (!block) continue;
      back = true;
      if (!pids.includes(block.uuid)) {
        bundle.reanchor(rec.id, block.uuid, block.kind, block.snapshot);
      }
    }
    if (!back) continue;
    if (rec.added && !rec.from.includes(rec.to)) bundle.unanchor(rec.id, rec.to);
    moved += 1;
  }
  return moved;
}

/**
 * The uuids a landing RETURNED to the document: live in `after`, absent from
 * `before`, on an anchorable block. A captured uuid is first translated through
 * the landing's collision `remap` (old → fresh), so a block that came back
 * under a new id is found under it. O(doc) twice — Restore is a click.
 */
export function returnedBlocks(
  before: PMNode,
  after: PMNode,
  snapshotOf: (uuid: string) => string | null,
  remap: ReadonlyMap<string, string> = new Map(),
): ReturnDisplacedAnchorsArgs["returned"] {
  const wasLive = collectBlockUuids(before);
  const kinds = new Map<string, string>();
  after.descendants((node) => {
    const u = node.attrs?.uuid;
    if (typeof u === "string" && u && !wasLive.has(u)) kinds.set(u, node.type.name);
    return true;
  });
  return (captured) => {
    const uuid = remap.get(captured) ?? captured;
    const kind = kinds.get(uuid);
    if (kind === undefined || !isAnchorableBlock(kind, uuid)) return null;
    return { uuid, kind, snapshot: snapshotOf(uuid) };
  };
}

/**
 * The ONE restore door for an excerpt: re-stamp the carried marks, answer an
 * identity COLLISION, run `land`, and if it landed, hand every card the
 * restore carries back to the blocks it returned. Shared by the pane's
 * Restore and its tests, so the ordering is stated once.
 *
 * IDENTITY (task 1253 → 1269): the carried `linkedAnchor` runs go back on
 * FIRST (`withCarriedMarks`, placed by their words), so the ONE identity pass
 * that follows (`freshenReturningIdentities`) sees every id the landing will
 * bring: a returning block uuid OR anchorId that is already live gets a fresh
 * one before `land` sees the content, and the one remap answers EVERY
 * population the restore carries: the displaced (re-homed) cards through
 * `returnDisplaced` (uuids), the dormant ones through `onRemap` (both). A
 * single Restore can no longer split its cards across two ids, nor leave two
 * runs sharing one anchorId. With no live document (`doc()` null) there is
 * nothing to stamp against or collide with, and the content lands as-is.
 */
export function landReturningDisplaced({
  doc,
  content,
  carriedMarks,
  land,
  onRemap,
  displaced,
  retarget,
  snapshotOf,
}: {
  /** Reads the LIVE document (called before and after `land`). */
  doc: () => PMNode | null;
  /** The excerpt as archived, carrying its original block uuids. */
  content: JSONContent;
  /** The snippet's carried Mode-B runs (`ArchivedSnippet.carriedMarks`). */
  carriedMarks?: readonly CarriedMarkRecord[];
  /** Lands the (stamped, collision-freshened) content; `true` when it landed. */
  land: (content: JSONContent) => boolean;
  /** The landing's old → fresh maps, when non-empty and it landed — the
   *  dormant cards' door (`reviveRemapped`). */
  onRemap?: (remap: IdentityRemap) => void;
  displaced: ReadonlyArray<DisplacedAnchorRecord> | undefined;
  retarget: Pick<AnchorRetargetApi, "returnDisplaced">;
  snapshotOf: (uuid: string) => string | null;
}): boolean {
  const before = doc();
  const { content: fresh, remap } = before
    ? freshenReturningIdentities(withCarriedMarks(before.type.schema, content, carriedMarks), {
        uuids: collectBlockUuids(before),
        anchorIds: collectLinkedAnchorIds(before),
      })
    : { content, remap: NO_IDENTITY_REMAP };
  if (!land(fresh)) return false;
  if (!isEmptyRemap(remap)) onRemap?.(remap);
  const after = before && displaced?.length ? doc() : null;
  if (before && after && displaced) {
    retarget.returnDisplaced({
      displaced,
      returned: returnedBlocks(before, after, snapshotOf, remap.uuids),
    });
  }
  return true;
}
