/**
 * Persistent inline highlight for an OPEN AI request — the request-open twin of
 * the applied `pending-ai-change` mark (task 2026-07-03-021).
 *
 * THE CLASS. "AI-touched text has no durable in-text signal." Applied
 * suggestions solved it once via a bespoke pair — a persistent
 * `pending-ai-change` `linkedAnchor` mark (always-on blue tint) plus an
 * `appliedChangeLink` reconciler synthesis (hover/select attention) on the SAME
 * span. An OPEN AI request (a note / todo / report-request / revision-comment /
 * cutter-comment card whose `aiRequest` flag is set) is the same need at the
 * OTHER end of the loop — the request is open, not yet applied — and got
 * NEITHER: it showed only the Mode-A paragraph rail, no text wash. This module
 * is the shared fork generalized: "an AI request/change over a region wants a
 * persistent, non-hover-gated inline tint AND marker-associated hover/select
 * lighting on the same span."
 *
 * TWO PARTS, mirroring apply-suggestion.ts + useAnchorHighlightReconciler.ts:
 *
 *   (A) PERSISTENCE via a real mark. `reconcileRequestMarks` stamps a blue
 *       `pending-ai-request` `linkedAnchor` mark over the WHOLE anchored
 *       paragraph of every Mode-A `aiRequest` card, and strips it when the flag
 *       clears / the card is deleted. A real doc mark is app-state (the
 *       serializer strips it on `.tex` export), so it's re-stamped from the
 *       `aiRequest===true` card records on load by the SAME reconcile — there is
 *       no separate reapply pass. The mark rides the reconciler's forward-map,
 *       so it is inherently keystroke-safe.
 *
 *   (B) MARKER-ASSOCIATION via the reconciler. `requestHighlightLink` (consumed
 *       by `linksForRef`) synthesizes a Mode-B link pointing at the request
 *       mark's deterministic anchorId, so hovering/selecting the card OR its
 *       gutter marker lights the same span through the existing raw
 *       `.linked-anchor` path — no new paragraph-as-wash decoration needed.
 *
 * SCOPE. Mode-A (paragraph-anchored) cards only. A Mode-B card (highlight, or a
 * note/todo created from a selection) already carries its OWN `linkedAnchor`
 * mark over its span; stamping a second `linkedAnchor` there would CLOBBER it
 * (same mark type ⇒ setMark replaces), so those are intentionally excluded here
 * (their existing span still lights on hover via their own links). Highlight-vs-
 * request tint precedence is the deferred Open question on the task.
 *
 * IDEMPOTENT. `reconcileRequestMarks` recomputes the desired mark set from the
 * card records every run and diffs it against what's live in the doc — the same
 * philosophy as `useAnchorHighlightReconciler`. Its single caller is a reactive
 * effect keyed on the `aiRequest` card set, so it fires on toggle / delete /
 * load, NEVER on a plain keystroke (typing changes neither the card set nor its
 * anchors), keeping `emitCount` flat.
 */

import type { Editor } from "@tiptap/react";
import {
  reanchorByText,
  removeLinkedAnchor,
  paragraphTextByUuid,
  getTextAnchor,
  getLinkedTextObjectIds,
  type Link,
  type CardWithLinks,
} from "../links";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";
import { anchorableUuidAt } from "@/lib/anchor-uuid";
import type { AnchoredCardRef } from "./anchored-card-store";

/** The `linkedAnchor.kind` namespace for an open-AI-request mark. */
const REQUEST_KIND = "pending-ai-request" as const;

/** The blue tint, single-sourced from the crosswalk so the mark, the reload
 *  re-stamp, and any future consumer all agree (`#bfdbfe`, identical to the
 *  applied-change tint by Gabriel's decision — distinct kind, same colour). */
const REQUEST_TINT = defaultTintForLinkedAnchorKind(REQUEST_KIND);

/** Deterministic anchorId for a card's request mark. Derived from the card id
 *  (no stored descriptor, unlike an applied change's `appliedChange.anchorId`)
 *  so the stamp, the flag-off strip, and the reload re-stamp all address the
 *  same mark, and the reconcile stays idempotent. The `airq-` prefix keeps it
 *  distinct from every card text-anchor id. */
export function requestAnchorId(cardId: string): string {
  return `airq-${cardId}`;
}

/** A card as this module reads it: its `aiRequest` flag plus its links (for the
 *  Mode-A/Mode-B classification via the shared link accessors). */
export type RequestMarkCardLike = CardWithLinks & {
  kind?: string;
  aiRequest?: boolean;
};

/** True when the card wants a whole-paragraph request wash: its `aiRequest`
 *  flag is set, it is Mode-A (no Mode-B text-range anchor), and it has at least
 *  one paragraph anchor to wash. Mode-B cards are excluded (see the module
 *  header — a second `linkedAnchor` would clobber their span mark). */
export function isModeARequestCard(card: RequestMarkCardLike): boolean {
  if (card.aiRequest !== true) return false;
  if (getTextAnchor(card) !== null) return false; // Mode-B → skip
  return getLinkedTextObjectIds(card).length > 0;
}

/** The paragraph uuid a Mode-A request card washes (its first anchor). */
function requestParagraphUuid(card: RequestMarkCardLike): string | null {
  return getLinkedTextObjectIds(card)[0] ?? null;
}

/**
 * (B) Synthesized Mode-B link for an OPEN AI request, mirroring
 * `appliedChangeLink`. Returns a link pointing at the card's request mark
 * (`requestAnchorId`) so the reconciler resolves it to the live `.linked-anchor`
 * span and lights it on hover/select of the card or its gutter marker. Returns
 * null unless `entity` is a Mode-A `aiRequest` card — every other card falls
 * back to its persisted links. `entity` is the reconciler's widened
 * `{id,kind?,links?}`; `aiRequest` is read through a narrow cast exactly like
 * `AppliedSuggestionEntity` reads `status`/`appliedChange`.
 */
export function requestHighlightLink(
  ref: AnchoredCardRef,
  entity: { id: string; kind?: string; links?: Link[] },
): Link | null {
  const card = entity as RequestMarkCardLike;
  if (!isModeARequestCard(card)) return null;
  const uuid = requestParagraphUuid(card);
  if (!uuid) return null;
  const anchorId = requestAnchorId(entity.id);
  return {
    id: anchorId,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [uuid],
      textRange: { anchorId, textSnapshot: "" },
    },
    target: { type: "card", ref: { kind: ref.kind, id: ref.id } },
    createdAt: "",
  };
}

/**
 * (A) Reconcile the live `pending-ai-request` marks to exactly match the set of
 * Mode-A `aiRequest` cards. Idempotent:
 *
 *   - DESIRED = one whole-paragraph mark (keyed by `requestAnchorId`) per Mode-A
 *     `aiRequest` card.
 *   - PRESENT = every live `pending-ai-request` `linkedAnchor` in the doc.
 *   - strip PRESENT∖DESIRED (flag turned off, or card deleted), stamp
 *     DESIRED∖PRESENT (flag turned on, or reload re-stamp).
 *
 * DESTRUCTIVE (it strips marks), so the CALLER must gate it on the same
 * load-order readiness the orphan reaper uses (`allCardSidecarsLoaded &&
 * docContentReady && !anyCardSidecarLoadError`); a run against transiently-empty
 * collections would strip every live request wash. Because both reapers skip the
 * `pending-ai-request` kind, this reconcile is the mark's SOLE lifecycle owner.
 */
export function reconcileRequestMarks(
  editor: Editor,
  cards: ReadonlyArray<RequestMarkCardLike>,
): void {
  if (!editor || editor.isDestroyed) return;

  // DESIRED: anchorId → the card + paragraph it should wash.
  const desired = new Map<string, { cardId: string; uuid: string; token: string }>();
  for (const c of cards) {
    if (!isModeARequestCard(c)) continue;
    const uuid = requestParagraphUuid(c);
    if (!uuid) continue;
    desired.set(requestAnchorId(c.id), {
      cardId: c.id,
      uuid,
      // Self-describing token: the owning card's real kind, so the mark's
      // `data-link-card` honestly names its card (the blue tint is fixed by
      // `data-tint-color`, so this drives no colour — it's for provenance).
      token: c.kind ?? "note",
    });
  }

  // PRESENT: every live request mark's anchorId → the ANCHORABLE uuid it sits in
  // (one scan, only on set change). The uuid is captured so a card RE-ANCHORED
  // while its request is open (mark now on the wrong paragraph) is detected and
  // moved, not left stale — the anchorId is stable (`airq-<cardId>`), so a naive
  // presence check alone would wrongly skip re-stamping. `anchorableUuidAt`
  // (deferral-aware) climbs to the CONTAINER uuid for a mark inside a
  // listItem/blockquote/exampleItem/exampleBlock, matching `desired` (whose uuid
  // is the card's container anchor). Reading the immediate text-parent uuid
  // instead resolves to the deferred inner paragraph's absent uuid `""`, which
  // never equals `desired` → the freshly-stamped container mark would be
  // stripped and re-stamped every reconcile (task 271 thrash).
  const present = new Map<string, string>();
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const uuid = anchorableUuidAt(editor.state.doc, pos) ?? "";
    for (const m of node.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      if (m.attrs.kind !== REQUEST_KIND) continue;
      const id = m.attrs.anchorId as string | undefined;
      if (id && !present.has(id)) present.set(id, uuid);
    }
    return true;
  });

  // Strip stale marks: flag off / card gone (not desired), OR the card was
  // re-anchored (present but on a different paragraph than desired).
  for (const [id, uuid] of present) {
    const d = desired.get(id);
    if (!d || d.uuid !== uuid) removeLinkedAnchor(editor, id);
  }

  // Stamp the WHOLE anchored paragraph for every desired mark not already
  // correctly placed, via the SAME uuid-scoped `reanchorByText` primitive
  // apply-suggestion uses — feeding the paragraph's full live text as the
  // snapshot. A graceful no-op if the anchor paragraph is gone or empty
  // (`paragraphTextByUuid` → null / "").
  for (const [anchorId, d] of desired) {
    if (present.get(anchorId) === d.uuid) continue; // already placed
    const text = paragraphTextByUuid(editor, d.uuid);
    if (!text) continue;
    reanchorByText(
      editor,
      REQUEST_KIND,
      text,
      anchorId,
      d.cardId,
      REQUEST_TINT,
      d.uuid,
      { linkCardToken: d.token },
    );
  }
}
