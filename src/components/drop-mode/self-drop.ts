/**
 * The SELF-DROP rule — one predicate, read by the hover and by every commit.
 *
 * Gabriel's seed symptom, three tasks running: *"grabbing and then dropping in
 * the same place — because you decided you didn't want to — should not change
 * anything."* Task 470 landed that for the DIVIDER family by putting the rule
 * in the shared engine rather than in ten consumers. This is the content-drag
 * half of the same law, and it has two independent statements because the
 * gesture has two independent ways of going nowhere:
 *
 *  - **the MODEL rule** ({@link isSelfGapInsert}) — the landing is the source's
 *    OWN gap, so the commit would put the payload back exactly where it is;
 *  - **the GESTURE rule** ({@link withinOriginDeadZone}) — the pointer never
 *    left the point it was grabbed at, so there is no drag to commit.
 *
 * ## The model rule
 *
 * Three specs each carried their own self-drop guard and all three tested the
 * SAME too-narrow thing: `insertPos` inside the payload's own `[from, to]`.
 * That is one LEVEL of a gap that exists at several. A `listItem`'s own visual
 * gap line is also the boundary of its LIST, and of that list's item, and of
 * that item's list, all the way out — and every one of those positions is
 * separated from the item's own boundary by nothing but its ancestors' open or
 * close tokens. Releasing at any of them is the same pixel, means the same
 * thing, and used to mean something very different: `listItemDropAdapter`
 * answered `wrap`, `buildWrap` minted a FRESH-uuid list, and the item was
 * EXTRACTED out of its own list into a brand-new one (task 480 / audit 457).
 *
 * So the test is stated as a property of the GAP:
 *
 * > An `insertPos` is the source's own GAP LINE iff the doc content between it
 * > and the source's own boundary is nothing but open/close tokens of the
 * > source's ANCESTORS.
 *
 * The implementation is arithmetic rather than a walk, and the arithmetic is
 * exact rather than a heuristic. Every unit step from one position to the next
 * changes `$pos.depth` by at most ±1 (an open token +1, a close token −1, a
 * text character 0). So a span of N positions whose depth rises by exactly N
 * can only be N open tokens, and one whose depth falls by exactly N can only be
 * N close tokens. Nothing else fits. And if every step from `insertPos` down to
 * `from` is an open token, the nodes opened are by construction the ancestor
 * chain containing the source — there is no separate "are these MY ancestors?"
 * question to get wrong.
 *
 * ### …and a gap line is only a NO-OP where the landing FABRICATES a wrapper
 *
 * The gap line alone is too strong, and the shipped `exampleItem` outdent is the
 * proof: dragging the last item of a NESTED example list onto the boundary of
 * its parent item is the same gap line, and it is a real, tested, useful move —
 * the item dedents by one level INTO the outer list, which already exists and
 * accepts it directly.
 *
 * What separates that from the reported corruption is what the landing has to
 * BUILD. Where the container accepts the node DIRECTLY, the item joins a
 * different, existing container and visibly dedents. Where nothing accepts it
 * bare, `fitNodeInContainer`'s wrap rung FABRICATES a wrapper — and the wrapper
 * it fabricates is the source's own parent KIND at the source's own indent, so
 * the document renders **identically** while the item's list identity changes
 * and (for an `orderedList`) its numbering silently restarts at 1. Gabriel's
 * nested repro is exactly that: `c.` became `a.` and nothing else moved.
 *
 * So the rule is the conjunction: **same gap line AND the fit says `wrap`.**
 * The verdict KIND is independent of the wrap vocabulary's ORDER (the rung
 * answers `wrap` iff SOME wrapper both belongs here and can hold the node), so
 * this asks the same question `planDrop`'s own fit will ask, with no `prefer`
 * to keep in step.
 *
 * ### Whole nodes only, and that scoping is load-bearing
 *
 * The rule presupposes the payload IS the node whose boundary it is. That is
 * true of a block move (`textobject.ts`, `util/block-move.ts`) and FALSE of a
 * text SLICE (`text-range-move.ts`): moving the first three words of a
 * paragraph into the gap immediately above it creates a new paragraph and is a
 * real change, even though the gap is one open token from the range's `from`.
 * A slice therefore keeps the narrow inside-the-range test, and says so at its
 * own site. Only a spec whose source is whole nodes declares
 * {@link DropSpec.sourceRangeFor}.
 *
 * ## The gesture rule
 *
 * The model rule cannot see the reported headline. Grabbing the SECOND item of
 * a four-item list and releasing at the grab point resolved the doc-level
 * candidate — the boundary above the whole list — which is a genuine outdent
 * with a real item between it and the source, so no model rule may refuse it.
 * What is wrong there is not the landing but the GESTURE: the pointer is where
 * it started. The grab handle sits in the margin, LEFT of every candidate box,
 * so `chooseInsertCandidate`'s fall-through hands every list-item drag the
 * shallowest level from the moment it begins — i.e. the band every gesture
 * STARTS in means "extract me to top level".
 *
 * The dead zone is applied to the AFFORDANCE, in the controller's one coalesced
 * move pass, so the indicator disappears as the pointer comes home and
 * hover ≡ commit still holds (tasks 258 / 321 / 332). It is also what finally
 * gives `DropSession.origin` a reader: the field has been written by every
 * producer and read by nothing since the controller shipped, which is the
 * dead-facet shape (`AGENTS.md`, "The field half") — WIRE-it or DELETE-it.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { fitNodeInContainer } from "@/text-objects/drop-adapters";

import { refuseOnThrow } from "./planned-spec";
import type { DropCtx, DropSpec } from "./types";

/**
 * Where THIS session's payload currently lives in the document — resolved once
 * per session, never per pointer event.
 *
 * The `editor` is carried because the hit-test runs over whichever editor the
 * cursor is above (a card body, the Reader's pane) and a position in another
 * document says nothing about this one. Every reader compares it first.
 */
export interface DropSourceRange {
  readonly editor: Editor;
  /** Position immediately before the source's first node's open token. */
  readonly from: number;
  /** Position immediately after the source's last node's close token. */
  readonly to: number;
}

/**
 * Is `insertPos` the source's OWN gap? See the header for the derivation.
 *
 * Two rungs, and the first subsumes the pre-480 guard byte-for-byte:
 *  1. INSIDE the range (inclusive at both ends) — releasing on itself.
 *  2. Separated from the range's own boundary by ancestor tokens ONLY — the
 *     same visual gap line, one or more levels out.
 */
export function isSelfGapInsert(
  doc: PMNode,
  range: { from: number; to: number },
  insertPos: number,
): boolean {
  if (insertPos < 0 || insertPos > doc.content.size) return false;
  if (insertPos >= range.from && insertPos <= range.to) return true;
  // A range whose endpoints the caller mis-resolved must not be able to throw
  // out of a per-frame filter; an unresolvable position is simply "not self".
  if (range.from < 0 || range.to > doc.content.size) return false;
  if (insertPos < range.from) {
    // Every step from insertPos to `from` must be an ancestor OPEN token: the
    // distance and the depth rise are then equal, and equality forces it.
    return (
      range.from - insertPos ===
      doc.resolve(range.from).depth - doc.resolve(insertPos).depth
    );
  }
  // …and mirror-image on the far side: every step from `to` to insertPos an
  // ancestor CLOSE token.
  return (
    insertPos - range.to ===
    doc.resolve(range.to).depth - doc.resolve(insertPos).depth
  );
}

/**
 * THE door — does this landing, in this editor, leave the payload where it
 * already is?
 *
 * `node` is the payload being judged (the filter's schema probe, or the spec's
 * own first source node). `null` asks only the INSIDE rung: releasing on
 * yourself is nothing whatever the payload is, while the gap-line rung needs a
 * node to know whether the landing would fabricate a wrapper.
 *
 * A source in ANOTHER document is never a self-drop here, which is what makes
 * this safe to ask from a spec that can run cross-editor.
 */
export function isSelfDrop(
  editor: Editor,
  range: DropSourceRange | null,
  insertPos: number,
  node: PMNode | null,
): boolean {
  if (!range || range.editor !== editor) return false;
  const doc = editor.state.doc;
  // Releasing ON yourself — always nothing, no payload question to ask.
  if (insertPos >= range.from && insertPos <= range.to) return true;
  if (!node) return false;
  if (!isSelfGapInsert(doc, range, insertPos)) return false;
  let $at;
  try {
    $at = doc.resolve(insertPos);
  } catch {
    return false;
  }
  // The same gap line is a NO-OP only where the landing has to FABRICATE the
  // container the source is already in — see the header. A `direct` landing on
  // the same line is a genuine outdent into a DIFFERENT existing container and
  // stays offered.
  return (
    fitNodeInContainer($at.parent, $at.index(), node, doc.type.schema).kind ===
    "wrap"
  );
}

/**
 * How far the pointer must leave the grab point before a release counts as a
 * drop rather than as a cancelled gesture.
 *
 * Sized from the producers' own drag thresholds — 5 px for the grab-handle lift
 * (`TextObjectGrabHandle`), 8 px for the in-text inline-atom grab — so it is
 * never SMALLER than the movement that turned the press into a drag in the
 * first place. A gesture that has come back inside the radius that started it
 * is, by its own producer's definition, no longer a drag.
 */
export const ORIGIN_DEAD_ZONE_PX = 10;

/** Is the live pointer still (or again) at the point the drag was grabbed at? */
export function withinOriginDeadZone(
  origin: { x: number; y: number },
  x: number,
  y: number,
): boolean {
  const dx = x - origin.x;
  const dy = y - origin.y;
  return dx * dx + dy * dy <= ORIGIN_DEAD_ZONE_PX * ORIGIN_DEAD_ZONE_PX;
}

/**
 * Resolve the session's source range ONCE, at `beginDropSession` — the twin of
 * `resolveSessionBlockPayload`, for the same reasons and with the same
 * containment.
 *
 * It walks the document, so it must never run per pointer event; and it cannot
 * be resolved lazily inside the hit-test, because the answer is a per-SESSION
 * fact (nothing edits the document during a hold gesture) and a per-frame walk
 * is exactly the cost the content-drag law forbids (`AGENTS.md`, "The content
 * half").
 *
 * A THROW is `null`, contained at the DOOR: `beginDropSession` runs from a
 * producer's mousedown with no catch, so an escaped throw would abort the
 * gesture before `installListeners` and leave the crosshair and the lift
 * overlay with no session to end them.
 */
export function resolveSessionSourceRange(
  spec: DropSpec,
  cardKey: string,
  ctx: DropCtx,
): DropSourceRange | null {
  if (!spec.sourceRangeFor) return null;
  return (
    refuseOnThrow("resolveSessionSourceRange", () =>
      spec.sourceRangeFor?.(cardKey, ctx),
    ) ?? null
  );
}
