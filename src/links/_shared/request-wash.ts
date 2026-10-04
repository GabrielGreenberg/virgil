/**
 * The persistent light-blue wash over the anchored region of an OPEN AI request
 * — the request-open twin of the applied `pending-ai-change` mark
 * (task 2026-07-03-021), re-carried as a DECORATION by task 667.
 *
 * THE CLASS IT SERVES. "AI-touched text has no durable in-text signal." An
 * applied suggestion has one; an OPEN request — a note / todo / report-request
 * / revision-comment / cutter-comment card whose `aiRequest` flag is set — is
 * the same need at the other end of the loop, and had only the Mode-A
 * paragraph rail.
 *
 * THE CARRIER BUG THIS FIXES (root-root, task 667). The wash used to be a real
 * `pending-ai-request` `linkedAnchor` MARK, stamped by a doc-walking reconcile
 * through `reanchorByText`. It is a VIEW-ONLY signal derived entirely from card
 * state, so `docs/agents/laws/transient-state-is-never-document-content.md`
 * names it in as many words: *a view-only signal painted over the document … is
 * a ProseMirror DECORATION replaced by a meta-only transaction. Never a mark.*
 * The document carrier was not a stylistic choice — it was paid for four times
 * over, and all four are retired here BY CONSTRUCTION rather than handled:
 *
 *   1. **Caret hijack.** `reanchorByText` stamps via
 *      `.setTextSelection(range).setMark(…).setTextSelection(from)`, so merely
 *      toggling a card's request flag yanked the user's caret to the start of
 *      the anchored paragraph, wherever they were typing. A decoration moves no
 *      selection.
 *   2. **`\vlid` residue in the user's `.tex`.** Every `linkedAnchor`
 *      round-trips its anchorId as a bare `\vlid` marker, so a flag the document
 *      does not own wrote itself into the user's only copy. Decorations do not
 *      serialize.
 *   3. **No wash at all for a Mode-B request card.** A card anchored to a
 *      SELECTION already carries its own `linkedAnchor`; a second one of the
 *      same mark type would CLOBBER it, so those cards were excluded — an
 *      exclusion forced by the carrier, not by the feature. A decoration cannot
 *      collide with a mark, so Mode-B is simply in scope now.
 *   4. **A pseudo-kind leaking into the anchor lifecycle.** The orphan reaper
 *      had to exempt the `pending-ai-*` family by name, because a mark with no
 *      card text-anchor is an orphan by every honest test. There is no mark to
 *      reap, so the exemption is gone.
 *
 * Plus the law's own bullets: the stamp was a `docChanged` transaction, so it
 * armed the autosaver and dirtied a document the user had not edited.
 *
 * The old module argued for "persistence via a real mark" — but its own reload
 * path re-derived every mark from the `aiRequest === true` records (the
 * serializer strips the rich attrs), so nothing durable was ever stored and the
 * persistence the argument bought was unused. Re-deriving from the records is
 * the whole lifecycle, and that is exactly what a decoration channel wants.
 *
 * WHERE IT PAINTS. `TransientHighlightDecorator`'s `ai-request` channel — its
 * own band set, so the search band's clear-on-close cannot erase the wash and
 * the wash's reconcile cannot erase the search band. `inclusive: true`, because
 * the band denotes a REGION ("this card's anchored paragraph"), not a range:
 * text typed into the washed paragraph is part of what the band means, which is
 * the one edge behaviour the mark carrier got for free.
 *
 * HOVER/SELECT. The old module also synthesized a Mode-B link at the request
 * mark's anchorId (`requestHighlightLink`) so hovering the card lit the mark's
 * span. That existed only to give the MARK a hover target, and it SUPPRESSED
 * the card's real links to do it. With the mark gone, every request card lights
 * the way its own anchor already does — a Mode-A card its paragraph halo and
 * rail, a Mode-B card its own span — so the synthesis is deleted, not ported.
 *
 * KEYSTROKE SANCTITY. There is no doc walk left at all: the wash resolves N
 * anchors (N = open requests) and dispatches one meta-only transaction, only
 * when the DESIRED set changes (`requestWashKey`). Typing changes neither the
 * card set nor its anchors, so it dispatches nothing; the decorations simply
 * forward-map. Cost strictly below the mark reconcile's two full doc walks.
 */

import { useEffect, useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { getBus, type StructureDiff } from "@/lib/tiptap/doc-structure";
import {
  getTextAnchor,
  getLinkedTextObjectIds,
  paragraphRangeByUuid,
  resolveTextRangeByAnchorId,
  type CardWithLinks,
} from "../links";
import { PENDING_AI_TINT } from "@/cards/legacy-token-crosswalk";
import {
  setTransientHighlights,
  type TransientHighlightChannel,
  type TransientHighlightTarget,
} from "@/lib/tiptap/transient-highlight";

/** The band set this wash owns (see `transient-highlight.ts` → channels). */
export const REQUEST_WASH_CHANNEL: TransientHighlightChannel = "ai-request";

/**
 * The painted background, pixel-identical to what the mark carrier produced.
 * `globals.css` paints a tint band as
 * `color-mix(in oklab, var(--tint-color) 35%, transparent)`; the hue is the
 * SAME light blue as an applied change (`PENDING_AI_TINT` — Gabriel's decision,
 * 2026-07-03: distinct signal, same colour), read from the one SSOT rather than
 * frozen here.
 */
export const REQUEST_WASH_COLOR = `color-mix(in oklab, ${PENDING_AI_TINT} 35%, transparent)`;

/** A card as this module reads it: its `aiRequest` flag plus its links. */
export type RequestWashCardLike = CardWithLinks & {
  kind?: string;
  aiRequest?: boolean;
};

/**
 * True when the card wants a wash: its `aiRequest` flag is set and it has an
 * anchor to wash — EITHER a Mode-B text range OR a Mode-A block anchor.
 *
 * Both modes qualify. The predecessor answered Mode-A only, and not because a
 * selection-anchored request is a different feature — purely because a second
 * `linkedAnchor` would have clobbered the card's own. That was the carrier
 * talking; the decoration has no such constraint.
 */
export function isRequestCard(card: RequestWashCardLike): boolean {
  if (card.aiRequest !== true) return false;
  return getTextAnchor(card) !== null || getLinkedTextObjectIds(card).length > 0;
}

/**
 * The card's anchor in the one vocabulary this module needs: a Mode-B range's
 * `anchorId`, else the Mode-A block `uuid`. Null when the card wants no wash.
 * Mode-B wins — a card that has a selection range is anchored to THAT, and its
 * block uuid is only the paragraph the range happens to live in.
 */
export function requestWashAnchor(
  card: RequestWashCardLike,
): { mode: "range"; anchorId: string } | { mode: "block"; uuid: string } | null {
  if (card.aiRequest !== true) return null;
  const range = getTextAnchor(card);
  if (range) return { mode: "range", anchorId: range.anchorId };
  const uuid = getLinkedTextObjectIds(card)[0];
  return uuid ? { mode: "block", uuid } : null;
}

/**
 * Stable identity of the DESIRED wash set — card ids paired with the anchor
 * each one washes. The reconcile's re-run gate: it must fire on flag on/off,
 * card add/delete and re-anchor, and NEVER on a keystroke or an unrelated card
 * edit (typing changes neither the ids nor the anchors).
 */
export function requestWashKey(
  cards: ReadonlyArray<RequestWashCardLike>,
): string {
  const parts: string[] = [];
  for (const c of cards) {
    const a = requestWashAnchor(c);
    if (!a) continue;
    parts.push(`${c.id}@${a.mode === "range" ? `r:${a.anchorId}` : `b:${a.uuid}`}`);
  }
  return parts.sort().join("|");
}

/**
 * Resolve the live band for every open request. A card whose anchor is gone
 * (paragraph deleted, range mark not present) contributes nothing — a graceful
 * no-op, the same shape the mark reconcile had for a missing paragraph.
 */
export function requestWashTargets(
  editor: Editor,
  cards: ReadonlyArray<RequestWashCardLike>,
): TransientHighlightTarget[] {
  const out: TransientHighlightTarget[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    const a = requestWashAnchor(c);
    if (!a) continue;
    const range =
      a.mode === "range"
        ? resolveTextRangeByAnchorId(editor, a.anchorId)
        : paragraphRangeByUuid(editor, a.uuid);
    if (!range || range.to <= range.from) continue;
    // Two cards washing the SAME region paint one band, not two stacked
    // (stacking would darken the tint and misreport "more AI attention here").
    const dedupe = `${range.from}:${range.to}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      from: range.from,
      to: range.to,
      color: REQUEST_WASH_COLOR,
      // A REGION band: it means "this card's anchored text", so it grows with
      // text typed into it. See `TransientHighlightTarget.inclusive`.
      inclusive: true,
    });
  }
  return out;
}

/**
 * Repaint the wash to exactly match `cards` (the `aiRequest === true` set).
 * ONE meta-only transaction — no doc change, no history entry, no autosave arm,
 * no structural emit, and no selection touched. Idempotent: always pass the
 * COMPLETE current set; an empty set clears the channel.
 *
 * Unlike its mark-stamping predecessor this is NOT destructive and therefore
 * needs no load-order data-loss gate: a run against transiently-empty card
 * collections paints nothing and the next run paints it back, where a run of
 * the old reconcile STRIPPED every live wash mark out of the document.
 */
export function paintRequestWash(
  editor: Editor,
  cards: ReadonlyArray<RequestWashCardLike>,
): void {
  if (!editor || editor.isDestroyed) return;
  setTransientHighlights(
    editor.view,
    requestWashTargets(editor, cards),
    REQUEST_WASH_CHANNEL,
  );
}

/**
 * True when a structural diff brings BACK an anchor some open request washes —
 * the re-entry half of the wash's lifecycle (task 936).
 *
 * Between repaints the bands only forward-map, and a mapped decoration whose
 * range is deleted is GONE: PM does not resurrect it when the text returns.
 * So "delete the washed paragraph, Cmd+Z" restored the paragraph under the
 * SAME uuid (and a Mode-B span under the same `anchorId`) — the desired set,
 * and therefore `requestWashKey`, never changed, nothing repainted, and the
 * wash stayed missing until reload. The same shape covers a block MOVE (drag,
 * cut+paste in one tx: delete+insert, uuid preserved → `changedBlocks`), whose
 * band mapping drops for the same reason.
 *
 * The question is answered from the diff alone: O(diff entries + open
 * requests), never a doc walk, and it is only ever asked on a STRUCTURAL emit
 * (`onAnyChange`), which a plain keystroke does not produce.
 */
export function requestWashAnchorReentered(
  diff: Pick<StructureDiff, "addedBlocks" | "changedBlocks" | "addedAnchors">,
  cards: ReadonlyArray<RequestWashCardLike>,
): boolean {
  if (
    diff.addedBlocks.length === 0 &&
    diff.changedBlocks.length === 0 &&
    diff.addedAnchors.length === 0
  ) {
    return false;
  }
  const uuids = new Set<string>();
  const anchorIds = new Set<string>();
  for (const c of cards) {
    const a = requestWashAnchor(c);
    if (!a) continue;
    if (a.mode === "range") anchorIds.add(a.anchorId);
    else uuids.add(a.uuid);
  }
  if (uuids.size === 0 && anchorIds.size === 0) return false;
  for (const b of diff.addedBlocks) if (uuids.has(b.uuid)) return true;
  for (const b of diff.changedBlocks) if (uuids.has(b.uuid)) return true;
  // A Mode-B span re-enters as its `linkedAnchor` id (`AnchorEntry.id`).
  for (const a of diff.addedAnchors) if (anchorIds.has(a.id)) return true;
  return false;
}

/**
 * Keep the wash painted for `cards` (the `aiRequest === true` set) for as long
 * as `ready` holds — the ONE owner of the wash's lifecycle in a pane.
 *
 * Two triggers, both event-driven:
 *   1. the DESIRED set changes (`requestWashKey`: flag on/off, card add/delete,
 *      re-anchor) or the editor/ready gate flips → repaint;
 *   2. a structural emit brings back an anchor the desired set wants
 *      (`requestWashAnchorReentered`: undo of a delete, a block move) → repaint.
 *
 * Typing reaches neither: the desired set is unchanged and a content-only diff
 * never fires `onAnyChange` (`emitCount` stays flat), so the bands just
 * forward-map. The repaint for (2) is deferred to a microtask because the bus
 * emits from inside the observer's plugin-view `update()`, where a nested
 * `dispatch` would re-enter the view's own state update; it is coalesced, so a
 * burst of emits paints once, and still lands before the next paint.
 */
export function useRequestWash(
  editor: Editor | null | undefined,
  cards: ReadonlyArray<RequestWashCardLike>,
  ready: boolean,
): void {
  const desired = useMemo(() => requestWashKey(cards), [cards]);
  // Read the live cards through a ref so an unrelated card edit that leaves
  // the desired set alone re-runs neither effect.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  useEffect(() => {
    if (!editor) return;
    // A CORRECTNESS gate, not a data-loss one: an anchor cannot resolve
    // against a document that has not parsed. Running early destroys nothing.
    if (!ready) return;
    paintRequestWash(editor, cardsRef.current);
  }, [editor, ready, desired]);

  // `desired === ""` means no open request: nothing can re-enter, so don't
  // even subscribe. Re-subscribes only on a desired-set change, never per
  // keystroke.
  const hasDesired = desired !== "";
  useEffect(() => {
    if (!editor || !ready || !hasDesired) return;
    const bus = getBus(editor);
    if (!bus) return;
    let scheduled = false;
    const unsubscribe = bus.onAnyChange((diff) => {
      if (scheduled) return;
      if (!requestWashAnchorReentered(diff, cardsRef.current)) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        paintRequestWash(editor, cardsRef.current);
      });
    });
    return unsubscribe;
  }, [editor, ready, hasDesired]);
}
