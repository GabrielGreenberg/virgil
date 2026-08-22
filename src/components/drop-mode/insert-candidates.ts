/**
 * The between-blocks CANDIDATE SET — resolve, filter, choose (task 416).
 *
 * Gabriel: *"drag and drop within bullet pointed lists is an absolute mess. do
 * a full audit of moving things, in, out, over lists."*
 *
 * **A list row is not ONE insert position; it is several.** Hovering the second
 * item of a nested bullet list, every one of these is a legal place for a
 * dragged block to land:
 *
 *     • before / after the INNER item      (inside the inner list)
 *     • before / after the inner LIST      (inside the outer item)
 *     • before / after the OUTER item      (inside the outer list)
 *     • before / after the outer LIST      (at top level)
 *
 * The pre-416 hit-test answered "which SINGLE position is nearest?" with a
 * fixed rule — the innermost anchorable container (`resolveAnchorableBlock`
 * honours `DEFERRING_PARENTS`), a Y threshold at that block's TOP edge, and X
 * read for nothing — then painted a bar for whatever it collapsed to, whether
 * or not the commit would accept it. Three defects fell out of that one shape,
 * and a fourth out of the exemptions bolted on to work around it:
 *
 *  - **F0 — no bar at all over the list.** `between-blocks` matches the GAP
 *    only (`placement-policy.ts`), and a list has no top-level gaps between its
 *    items. The ONLY thing that made a list feel draggable was the R3
 *    `resolveSubItemPeerBlock` pre-switch resolver, which fires exclusively
 *    when the dragged payload is ITSELF a `listItem`. Dragging a paragraph, a
 *    heading, a figure or a `texBlock` over the same list offered nothing
 *    anywhere over its body.
 *  - **F1 — the item-MIDPOINT snap had one call site**, the same R3 path. Every
 *    other payload got the top-edge threshold, i.e. "before" only in a hairline.
 *  - **F2 — no axis chose the LEVEL.** The bar's WIDTH already encodes the scope
 *    the hit-test picked, so the user was SHOWN the level and could not CHOOSE
 *    it.
 *  - **F3 — a refused position still painted an inviting bar** and said nothing
 *    on release (`AGENTS.md`, "The feedback half" / "The proxy half").
 *
 * So the answer is the set, resolved once per frame in three steps that each
 * do one thing:
 *
 *  1. **RESOLVE** ({@link resolveInsertCandidates}) — walk the ancestor ladder
 *     outward from the innermost anchorable block and yield one candidate per
 *     level. This SUBSUMES `resolveSubItemPeerBlock`: a peer-item boundary is
 *     simply the candidate whose container is the list, reached for EVERY
 *     payload rather than only for a same-kind sub-item drag (which is what F4
 *     — the peer resolver's `node.type.name === sourceKind` gate — was).
 *  2. **FILTER** ({@link filterInsertCandidates}) — keep only the candidates
 *     whose container can hold the payload, through rungs 1 and 2 of the SSOT
 *     ladder `fitNodeInContainer` (`@/text-objects/drop-adapters`): the parent
 *     accepts the bare node, or a wrapper in `buildWrap`'s vocabulary is both
 *     valid there and able to hold it. That is pure schema arithmetic and
 *     O(depth) — it is **not** `planDrop`, which builds transactions and is what
 *     made task 321 call this a product decision. Reusing the ladder rather than
 *     re-deriving it is the whole point: the hover then answers from the SAME
 *     table the commit reads, which is the law tasks 258 / 321 / 332 state.
 *  3. **CHOOSE** ({@link chooseInsertCandidate}) — Y picks the boundary, at each
 *     candidate's own MIDPOINT (F1, uniformly); X picks the LEVEL among the
 *     survivors, shallowest as the cursor moves left, exactly as the bar's width
 *     already advertises (F2).
 *
 * With the set filtered, a level with no legal candidate is simply not offered
 * and **F3 dies by construction rather than by a warning**.
 *
 * COST. O(depth) — one `getBoundingClientRect` per ancestor level (≤ ~5 in a
 * real document), one `canReplaceWith` plus at most one `tryBuildWrap` per
 * level per payload node. No doc walk, no transaction, no `planDrop`. The
 * pre-416 path read ONE rect; this reads one per level, and that is the whole
 * increase. Everything here runs on the frame-coalesced pass, never per raw
 * pointer event (`AGENTS.md`, "The content half").
 *
 * RESIDUAL, stated rather than implied: the filter runs rungs 1 and 2 of the
 * fit and NOT rung 3 (the empirical `bareInsertIsSafe` probe, which builds a
 * trial transaction and is O(doc) — it cannot run per frame). So a candidate
 * that ONLY rung 3 would accept — the schema refuses the bare node, no wrapper
 * fits, and ProseMirror's fitter would nonetheless PAD the container harmlessly
 * — is not offered. That is the conservative direction (a missing affordance,
 * never a false one), and the one shipped rung-3 case is reached here by the
 * WRAP rung instead: a `displayMath` over a list item is offered the sibling-item
 * boundary wrapped in a fresh `listItem`, not the pad-into-index-0 landing.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { fitNodeInContainer } from "@/text-objects/drop-adapters";
import type { BlockDropPayload } from "./block-payload";

/**
 * One legal place a between-blocks payload could land, at one ancestor level.
 *
 * `refNode` is the node whose BOUNDARY the payload lands at; `container` is what
 * would receive it. The pair is what makes both halves of the choice cheap: Y
 * reads `refNode`'s own box, and the schema question is asked of `container`.
 */
export interface InsertCandidate {
  /** Position immediately before `refNode`'s open token. */
  refPos: number;
  /** The node whose boundary this candidate inserts at. */
  refNode: PMNode;
  /** ProseMirror depth of `refNode` — 1 for a top-level block. */
  refDepth: number;
  /** The container that would receive the payload. */
  container: PMNode;
  /** Child index in `container` at which the payload would land. */
  index: number;
  /** The resolved insert position. */
  insertPos: number;
  /** Did Y put the cursor above `refNode`'s midpoint? */
  insertBefore: boolean;
  /** `refNode`'s own DOM element — the bar's geometry AND the indent X. */
  dom: HTMLElement;
  /** `refNode`'s viewport box, read ONCE here and threaded onward. */
  rect: DOMRect;
}

/**
 * Every insert position the ancestor ladder offers at `floorPos`, innermost
 * first.
 *
 * `floorPos` is the innermost anchorable block — `resolveAnchorableBlock`'s
 * answer, which honours `DEFERRING_PARENTS`, so inside a list item the floor is
 * the ITEM and never its inner paragraph. That floor is deliberately kept: it is
 * what makes "into this item as content" NOT a candidate, so the default
 * (cursor deep in the text, deepest candidate wins) is byte-identical to the
 * level the pre-416 rule chose.
 *
 * A level whose node has no resolvable DOM is skipped — there is nothing to
 * paint a bar against and nothing to read an indent from.
 */
export function resolveInsertCandidates(
  editor: Editor,
  floorPos: number,
  cursorY: number,
  floorRect?: DOMRect,
): InsertCandidate[] {
  const doc = editor.state.doc;
  if (floorPos < 0 || floorPos > doc.content.size) return [];
  const out: InsertCandidate[] = [];
  let $ref = doc.resolve(floorPos);
  // Bounded by the doc's own depth; the loop always terminates at depth 0.
  for (;;) {
    const container = $ref.parent;
    const index = $ref.index();
    const refNode = container.maybeChild(index);
    if (!refNode) break;
    const refPos = $ref.pos;
    const dom = editor.view.nodeDOM(refPos);
    if (dom instanceof HTMLElement) {
      const rect =
        refPos === floorPos && floorRect
          ? floorRect
          : dom.getBoundingClientRect();
      // F1 — the MIDPOINT, for every payload and at every level. The pre-416
      // top-edge threshold meant "insert before" only fired in the hairline
      // above a block, so a list read as a stack of after-targets.
      const insertBefore = cursorY < rect.top + rect.height / 2;
      out.push({
        refPos,
        refNode,
        refDepth: $ref.depth + 1,
        container,
        index: insertBefore ? index : index + 1,
        insertPos: insertBefore ? refPos : refPos + refNode.nodeSize,
        insertBefore,
        dom,
        rect,
      });
    }
    if ($ref.depth === 0) break;
    $ref = doc.resolve($ref.before($ref.depth));
  }
  return out;
}

/**
 * Keep the candidates whose container can actually hold the payload.
 *
 * An EMPTY payload keeps everything: that is the answer for a session with no
 * block-shaped payload to judge (a card re-anchor, a plain-text slice), and it
 * leaves those gestures byte-identical to the pre-416 tree. A name the target
 * schema does not declare is SKIPPED rather than refused — that is the
 * VOCABULARY question (`schema-adopt.ts`, task 328), and answering it here would
 * be a second table for one question.
 */
export function filterInsertCandidates(
  editor: Editor,
  candidates: ReadonlyArray<InsertCandidate>,
  payload: BlockDropPayload,
): InsertCandidate[] {
  if (payload.length === 0) return [...candidates];
  const { schema } = editor.state;
  const probes: PMNode[] = [];
  for (const name of payload) {
    const type = schema.nodes[name];
    if (!type) continue; // vocabulary — not this question
    // A representative node of the payload's type. `createAndFill` supplies the
    // required content (a `listItem` needs its leading paragraph), so the probe
    // is a node the wrap rung can genuinely try to build. An untillable type
    // answers "no opinion" and is skipped, which fails OPEN.
    const probe = type.createAndFill();
    if (probe) probes.push(probe);
  }
  if (probes.length === 0) return [...candidates];
  return candidates.filter((cand) =>
    probes.every(
      (probe) =>
        fitNodeInContainer(cand.container, cand.index, probe, schema).kind !==
        "reject",
    ),
  );
}

/**
 * Which level the cursor's X is asking for (F2).
 *
 * Deeper levels sit further right — a list indents its items by one marker
 * band, so an inner item's box starts inboard of its list's, which starts
 * inboard of the column. So: the DEEPEST candidate whose box the cursor has
 * reached, and the shallowest when the cursor is left of them all. Monotone in
 * X by construction, and its right-hand limit is the pre-416 answer (cursor over
 * the text ⇒ innermost), so the default is unchanged and the new reach is
 * everything to the LEFT of it.
 *
 * A tie in `rect.left` — an inner LIST and its enclosing ITEM share a left edge,
 * since the list fills the item's content box — resolves to the deeper level,
 * which is the more specific of the two.
 */
export function chooseInsertCandidate(
  candidates: ReadonlyArray<InsertCandidate>,
  cursorX: number,
): InsertCandidate | null {
  if (candidates.length === 0) return null;
  const byDepth = [...candidates].sort((a, b) => b.refDepth - a.refDepth);
  for (const cand of byDepth) {
    if (cursorX >= cand.rect.left) return cand;
  }
  return byDepth[byDepth.length - 1] ?? null;
}

/**
 * TEST/DIAGNOSTIC — the fit verdict per candidate, without filtering. Used by
 * the matrix suite to classify a cell as offered / refused rather than merely
 * counting bars.
 */
export function candidateFits(
  editor: Editor,
  cand: InsertCandidate,
  payload: BlockDropPayload,
): boolean {
  return filterInsertCandidates(editor, [cand], payload).length === 1;
}
