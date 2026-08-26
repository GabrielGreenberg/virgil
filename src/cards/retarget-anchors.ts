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
 * the range is precisely what left. Those cards keep the pre-491 path
 * (`cleanupLinksInRange` → the kind's `lifecycle.delete`), which the archive
 * and delete branches share, so widening here would silently change what
 * Delete does too. Task 393's equality leg still pins that half.
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
import type { TextObjectKind } from "@/text-objects/types";
import type { MarginItemHandlers, MarginItemKind } from "./delete-margin-item";

/** Where the displaced anchors go. Resolved ONCE per gesture by
 *  `resolveDisplacedAnchorTarget` so the snippet and every card it displaced
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
}

/**
 * Move every displaced Mode-A anchor onto `target`. Returns how many cards
 * moved (diagnostics / tests; callers ignore it).
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
}: RetargetDisplacedAnchorsArgs): number {
  if (!target || removed.size === 0) return 0;
  // A target inside the removal would hand every card a uuid that is about to
  // vanish — a no-op at best and a fresh orphan at worst. The resolver already
  // refuses that; re-check here so the door is safe for any caller.
  if (removed.has(target.uuid)) return 0;

  let moved = 0;
  for (const kind of Object.keys(handlers) as MarginItemKind[]) {
    const bundle = handlers[kind];
    for (const card of bundle.cards) {
      const pids = getLinkedTextObjectIds(card);
      const displaced = pids.filter((pid) => removed.has(pid));
      if (displaced.length === 0) continue;
      for (const pid of displaced) bundle.unanchor(card.id, pid);
      if (!pids.includes(target.uuid)) {
        bundle.reanchor(card.id, target.uuid, target.kind, snapshot);
      }
      moved += 1;
    }
  }
  return moved;
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
  retarget(args: Omit<RetargetDisplacedAnchorsArgs, "handlers">): number;
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
    }),
    [],
  );
}
