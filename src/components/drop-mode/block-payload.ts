/**
 * The BLOCK-payload declaration — the twin of `InlineDropPayload` (task 414),
 * for the between-blocks half of the same question (task 416).
 *
 * Two things need to know what a drop would place as WHOLE BLOCKS, and both run
 * on the affordance side where nothing may build a transaction:
 *
 *  - **the FILTER** (`insert-candidates.ts`) — which of the ancestor ladder's
 *    insert positions can hold it, so a level the commit would refuse is never
 *    offered;
 *  - **the REACH** — whether a between-blocks bar may appear over a block's TEXT
 *    at all, not merely in the hairline gap between top-level blocks.
 *
 * That second one is the F0 half of task 416 and it is the reason this is a
 * DECLARATION and not an inference. `winningPlacementKind` models an exact
 * partition — `between-blocks` matches the gap, `inline-cursor` matches the text
 * — and that partition is right for the payloads it was written for: a text
 * SLICE merges into the prose (the caret) and only a gap can hold its block
 * form; a CARD anchors to the paragraph side. It is wrong for a payload that is
 * a whole BLOCK, which has no inline reading at all — over a list, where there
 * are no top-level gaps between the items, it meant **no bar anywhere over the
 * list body** unless the R3 sub-item resolver happened to fire.
 *
 * So the reach is per PAYLOAD, resolved once per session, exactly as the
 * placement LIST itself is (task 258) and the inline payload is (task 414):
 *
 *   EMPTY  → no block-shaped payload. `between-blocks` keeps its gap-only reach
 *            and the filter keeps every candidate. Byte-identical to pre-416 for
 *            a card pull, a plain-text slice and a paragraph-side re-anchor.
 *   NAMES  → this session drags whole blocks of these types. The ladder is
 *            offered over TEXT as well as in gaps, and every candidate is
 *            filtered against these types.
 *
 * Names rather than `NodeType`s for the reason `InlineDropPayload` gives: a
 * payload may be resolved from a source editor, from persisted JSON, or from a
 * spec's static configuration, while the question is asked against the TARGET
 * schema — and two schemas built from one extension list hold DISTINCT
 * `NodeType` objects (task 328). A name is the one currency both ends share.
 *
 * A spec that declares no resolver answers EMPTY, which changes nothing. The
 * census in `placement-reachability.test.ts` asks the LIVE spec objects for the
 * implication *declares `between-blocks` ⇒ declares `blockPayloadFor`*, so a new
 * between-blocks spec must state its answer rather than inherit a default
 * nobody chose.
 */

import { refuseOnThrow } from "./planned-spec";
import type { DropCtx, DropSpec } from "./types";

/** Schema node names a between-blocks drop would place as whole blocks. */
export type BlockDropPayload = readonly string[];

/** The shared "no block-shaped payload" answer — an ANSWER, not a don't-know. */
export const NO_BLOCK_PAYLOAD: BlockDropPayload = [];

/**
 * Resolve the session's block payload ONCE, at `beginDropSession`.
 *
 * A THROW is EMPTY, contained at the DOOR rather than at each call site — the
 * rule `resolveSessionInlinePayload` states about its own resolution, and for
 * the same reason: `beginDropSession` runs from a producer's mousedown with no
 * catch, so an escaped throw would abort the gesture before `installListeners`
 * and leave the crosshair and the lift overlay with no session to end them.
 */
export function resolveSessionBlockPayload(
  spec: DropSpec,
  cardKey: string,
  ctx: DropCtx,
): BlockDropPayload {
  if (!spec.blockPayloadFor) return NO_BLOCK_PAYLOAD;
  return (
    refuseOnThrow("resolveSessionBlockPayload", () =>
      spec.blockPayloadFor?.(cardKey, ctx),
    ) ?? NO_BLOCK_PAYLOAD
  );
}
