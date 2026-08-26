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
 * …and a fifth, which 416 left standing because its own harness could not
 * represent it (task 481 — audit 457, Gabriel's seed symptom 2, *"weird gaps
 * behind elements that don't correctly map the mouse position"*):
 *
 *  - **F5 — a nesting-transition GAP BAND mis-maps to the container.** The
 *    floor is a CONTAINMENT walk, so a boundary between two `listItem`s belongs
 *    to no item and resolves to the LIST, and a boundary between an item's head
 *    line and its nested list resolves to the ITEM. The ladder then walks
 *    OUTWARD only, so at those pixels there was exactly ONE candidate — the
 *    container's own boundary — placed by the container's SUBTREE-inclusive
 *    midpoint, i.e. nowhere near the gap the cursor was in. Every "put it
 *    between these two things" pixel in a nested list, at every X. The synthetic
 *    layout in `list-drop-matrix.test.ts` had no inter-child pixels at all, so
 *    the whole band was unrepresentable there — which is how it survived 416
 *    with 540 cells green.
 *
 * So the answer is the set, resolved once per frame in three steps that each
 * do one thing:
 *
 *  1. **RESOLVE** ({@link resolveInsertCandidates}) — walk the ancestor ladder
 *     outward from the innermost anchorable block and yield one candidate per
 *     level. This SUBSUMES `resolveSubItemPeerBlock`: a peer-item boundary is
 *     simply the candidate whose container is the list, reached for EVERY
 *     payload rather than only for a same-kind sub-item drag (which is what F4
 *     — the peer resolver's `node.type.name === sourceKind` gate — was). Since
 *     task 481 the walk also has a rung BELOW the floor
 *     ({@link resolveSubFloorBoundary}): a NESTING-TRANSITION gap resolves to
 *     the CONTAINER that owns those pixels, so walking outward from it skipped
 *     the boundary the gap line actually is. F5, below.
 *  2. **FILTER** ({@link filterInsertCandidates}) — keep only the LEGAL
 *     landings, which is two questions. The CONTAINER one runs rungs 1 and 2 of
 *     the SSOT ladder `fitNodeInContainer` (`@/text-objects/drop-adapters`): the
 *     parent accepts the bare node, or a wrapper in `buildWrap`'s vocabulary is
 *     both valid there and able to hold it. The IDENTITY one (task 480) drops a
 *     candidate that is the source's OWN gap, through `self-drop.ts` — because
 *     a `listItem`'s own gap line is also its list's boundary, and its list's
 *     item's, and each of those was a landing that MINTED a wrapper list and
 *     extracted the item from its own list. Both are pure arithmetic and
 *     O(depth) — neither is `planDrop`, which builds transactions and is what
 *     made task 321 call this a product decision. Reusing both ladders rather
 *     than re-deriving them is the whole point: the hover then answers from the
 *     SAME tables the commit reads, which is the law tasks 258 / 321 / 332
 *     state.
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
import { type DropSourceRange, isSelfDrop } from "./self-drop";

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
  rawPos: number,
  cursorY: number,
  floorRect?: DOMRect,
): InsertCandidate[] {
  const doc = editor.state.doc;
  if (floorPos < 0 || floorPos > doc.content.size) return [];
  const out: InsertCandidate[] = [];
  // The SUB-FLOOR rung (task 481) — the boundary between the floor's OWN block
  // children, which is the only rung that can coincide with a nesting-transition
  // gap band. `null` when there is nothing below the floor to offer, which is
  // every case the pre-481 ladder covered, so the walk below is unchanged there.
  const subFloor = resolveSubFloorBoundary(editor, floorPos, rawPos, cursorY);
  let $ref = doc.resolve(subFloor ?? floorPos);
  // Bounded by the doc's own depth; the loop always terminates at depth 0.
  for (;;) {
    const container = $ref.parent;
    let index = $ref.index();
    // At a container's TRAILING boundary there is no child AT `index`, so the
    // reference is the child BEFORE it — the row the gap line sits under. Only
    // the sub-floor rung can start there (an outward step always resolves to a
    // position before an existing node), and without this the whole ladder used
    // to break out on the first iteration and offer nothing at all.
    const trailing = index >= container.childCount;
    if (trailing) index -= 1;
    const refNode = container.maybeChild(index);
    if (!refNode) break;
    const refPos = trailing ? $ref.pos - refNode.nodeSize : $ref.pos;
    const dom = editor.view.nodeDOM(refPos);
    if (dom instanceof HTMLElement) {
      const rect =
        refPos === floorPos && floorRect
          ? floorRect
          : dom.getBoundingClientRect();
      // F1 — the MIDPOINT, for every payload and at every level. The pre-416
      // top-edge threshold meant "insert before" only fired in the hairline
      // above a block, so a list read as a stack of after-targets. At a
      // TRAILING boundary the answer is already known — the gap line is under
      // the last row — and asking the midpoint again could only disagree with
      // the position `posAtCoords` actually reported.
      const insertBefore = trailing
        ? false
        : cursorY < rect.top + rect.height / 2;
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
 * The SUB-FLOOR rung — the boundary between the FLOOR's own block children
 * (task 481), returned as the document position the ladder should start from,
 * or `null` when the floor has nothing below it to offer.
 *
 * > **A gap band's candidates come from the rows FLANKING the gap, not from the
 * > container that owns the pixels.**
 *
 * The ladder walks OUTWARD from `resolveAnchorableBlock`'s floor, and at a
 * nesting-transition gap that floor is the CONTAINER — `resolveAnchorableNode`
 * is a CONTAINMENT walk, so a boundary between two `listItem`s is contained by
 * no item and resolves to the LIST, and a boundary between a `listItem`'s head
 * paragraph and its nested list resolves to the ITEM. Walking outward from
 * there, the boundary the user is aiming at is not in the set at all: the whole
 * list's outer edges were the only offer, at whatever Y the container's
 * SUBTREE-inclusive midpoint put them. Those are exactly the "put it between
 * these two things" pixels, and they were the ones with no honest answer.
 *
 * Two readings, one rule — *which child boundary is the cursor asking for?*
 *
 *  - **GAP** (`$raw.depth === dFloor`): `posAtCoords` already answered. The
 *    cursor is directly inside the floor, between two of its children, and the
 *    index it resolved IS the boundary. Zero rect reads, and the offered
 *    boundary coincides with the visual gap line by construction rather than by
 *    a midpoint that might disagree with it.
 *  - **IN-TEXT** (`$raw.depth > dFloor`): the cursor is inside child `j`, so
 *    the boundary is `j` or `j+1` by THAT child's own midpoint — the head row's
 *    band rather than the container's subtree box, which is what made the lower
 *    half of a nested item's head row still read "above the whole item". ONE
 *    rect read, of the child the ladder is about to read anyway.
 *
 * **An IN-TEXT cursor is offered INTERIOR boundaries only, and that is task
 * 416's own decision preserved rather than an exemption.** The floor's leading
 * and trailing boundaries ARE the floor's own edges: same gap line, and for the
 * commonest shape by far — a `listItem` whose only child is its paragraph, a
 * `blockquote` with one paragraph, an `exampleItem` — the same bar, since
 * `resolveContentEdges` descends a container to exactly that first child. So
 * they are already offered one rung out, where 416 put them ("into this item as
 * content is not a candidate, and the default is byte-identical to the level
 * the pre-416 rule chose"). Offering them here would win the `rect.left` tie in
 * {@link chooseInsertCandidate} (which resolves to the deeper level) and
 * silently change the default landing of every list and quote drag to "inside
 * the item", from a bar the user cannot tell apart from the one they were
 * already being shown.
 *
 * A cursor in a genuine GAP has no such twin: the outward rung there paints the
 * container's own edge with the container's own span, which is a visibly
 * different bar at a different indent — "a new item at the end of this list"
 * versus "a new block after the list". Both are real, both are reachable, and X
 * chooses between them exactly as it does at every other level.
 *
 * COST: `null` (the pre-481 answer) for every floor that is a textblock, an
 * atom, or a block the cursor does not sit inside — so the common case pays one
 * `resolve` and nothing else. The GAP reading pays no DOM read at all; the
 * IN-TEXT reading pays ONE `getBoundingClientRect`, of a child the ladder then
 * reads again on its first iteration. Still O(depth) overall.
 */
function resolveSubFloorBoundary(
  editor: Editor,
  floorPos: number,
  rawPos: number,
  cursorY: number,
): number | null {
  const doc = editor.state.doc;
  if (rawPos < 0 || rawPos > doc.content.size) return null;
  // A node's own depth is one below the depth of the position before it.
  const dFloor = doc.resolve(floorPos).depth + 1;
  const $raw = doc.resolve(rawPos);
  // The floor must actually CONTAIN the cursor. It does not when
  // `resolveAnchorableBlock` took its top-level-gap fallback and picked the
  // nearest block by Y-distance — there is no child boundary to speak of there,
  // and the doc-level boundary the ladder already starts from is the answer.
  if ($raw.depth < dFloor) return null;
  if ($raw.before(dFloor) !== floorPos) return null;
  const floorNode = $raw.node(dFloor);
  // A textblock's children are inline; an atom has none. Neither has a child
  // boundary a block can land at.
  if (floorNode.isTextblock || floorNode.childCount === 0) return null;
  if (floorNode.firstChild?.isInline) return null;

  let index: number;
  if ($raw.depth === dFloor) {
    // GAP — `posAtCoords` resolved a boundary between the floor's children.
    index = $raw.index(dFloor);
  } else {
    // IN-TEXT — inside child `j`; its own midpoint picks the side.
    // The interior-only rule, asked BEFORE the rect read rather than after it:
    // a container with ONE child has no interior boundary at all, whichever
    // side the midpoint lands on. That is the commonest floor there is (a
    // `listItem` holding just its paragraph, a one-paragraph `blockquote`, an
    // `exampleItem`), so the rung costs it no DOM measurement whatsoever.
    if (floorNode.childCount === 1) return null;
    const j = $raw.index(dFloor);
    const childPos = $raw.posAtIndex(j, dFloor);
    const dom = editor.view.nodeDOM(childPos);
    if (!(dom instanceof HTMLElement)) return null;
    const rect = dom.getBoundingClientRect();
    index = cursorY < rect.top + rect.height / 2 ? j : j + 1;
    // INTERIOR only — see the rule above.
    if (index <= 0 || index >= floorNode.childCount) return null;
  }
  return $raw.posAtIndex(index, dFloor);
}

/**
 * Keep the candidates that are LEGAL LANDINGS for this session — two rungs,
 * asking two different questions.
 *
 * 1. **CONTAINER** — can this container hold the payload? An EMPTY payload
 *    keeps everything: that is the answer for a session with no block-shaped
 *    payload to judge (a card re-anchor, a plain-text slice), and it leaves
 *    those gestures byte-identical to the pre-416 tree. A name the target
 *    schema does not declare is SKIPPED rather than refused — that is the
 *    VOCABULARY question (`schema-adopt.ts`, task 328), and answering it here
 *    would be a second table for one question.
 * 2. **IDENTITY** — is this the source's OWN gap (task 480)? A `listItem`'s own
 *    visual gap line is also its list's boundary, and its list's item's, all the
 *    way out; each of those used to be a landing, and `listItemDropAdapter`
 *    answered `wrap` at every one of them — minting a fresh-uuid list and
 *    EXTRACTING the item from its own list. The rule is `self-drop.ts`'s, the
 *    same one this session's `planDrop` reads, so the hover and the commit
 *    cannot answer from two tables (tasks 258 / 321 / 332). A session with no
 *    in-document source (`null`) keeps every candidate.
 *
 * `sourceRange` is REQUIRED rather than defaulted: `null` is the ANSWER "this
 * session's payload does not live in a document", which is a claim only the
 * caller can make.
 */
export function filterInsertCandidates(
  editor: Editor,
  candidates: ReadonlyArray<InsertCandidate>,
  payload: BlockDropPayload,
  sourceRange: DropSourceRange | null,
): InsertCandidate[] {
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
  return candidates.filter((cand) => {
    // IDENTITY, rung a — releasing ON the source is nothing whatever the
    // payload is, so it is asked with no probe and needs none.
    if (isSelfDrop(editor, sourceRange, cand.insertPos, null)) return false;
    if (probes.length === 0) return true;
    // IDENTITY, rung b — the source's own gap LINE, which is a no-op only where
    // the landing would fabricate the container the source is already in. Asked
    // per probe and refused if ANY says so, mirroring the CONTAINER rung below,
    // which keeps a candidate only when EVERY probe fits.
    if (
      probes.some((probe) =>
        isSelfDrop(editor, sourceRange, cand.insertPos, probe),
      )
    ) {
      return false;
    }
    // CONTAINER.
    return probes.every(
      (probe) =>
        fitNodeInContainer(cand.container, cand.index, probe, schema).kind !==
        "reject",
    );
  });
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
  sourceRange: DropSourceRange | null,
): boolean {
  return (
    filterInsertCandidates(editor, [cand], payload, sourceRange).length === 1
  );
}
