/**
 * Drop spec for stack pulls (`stack-pull:${stackId}`).
 *
 * Looks the snapshot up in `localStorage` (via `readStackItem`), then
 * dispatches per-payload-kind:
 *  - text     → insert slice at inline-cursor or between-blocks
 *  - paragraph → insert single paragraph at between-blocks with fresh uuid
 *  - heading  → insert heading + body at between-blocks with fresh uuids
 *  - card     → upsert any sidecar bib entries, then materialize a fresh
 *               card via the per-doc factories on `ctx.stack` — anchored to
 *               the paragraph under the cursor (paragraph-side), or unanchored
 *               in a block gap (between-blocks).
 *
 * Which placements a pull may use is PER PAYLOAD, not per spec: see
 * `placementsForPayload` + `CARD_PLACEMENTS` below — the one table the
 * hit-test's affordance and this spec's commit-time validity check both read
 * (task 258).
 *
 * Stack pulls are paste-as-new — every id/uuid is regenerated. Block
 * uuids are reminted by `withFreshUuid`; Card-bearing inline-atom ids
 * (footnoteId / citationId, + the unified linkId mirror) by
 * `withFreshAtomIds`. Both run on the pull side so the snapshot stays a
 * faithful copy — the fresh identity is minted exactly where a fresh
 * presence is created. The source stack item is NOT removed (pulls are
 * copy, not pop); the X button on the thumbnail is the only deletion path.
 */

import { Node as PMNode, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/react";
import type {
  DropPlan,
  DropSpec,
  Placement,
  PlacementKind,
} from "../types";
import { fitNodesAtInsert } from "./drop-context";
import { plannedDropSpec } from "../planned-spec";
import { readStackItem } from "@/hooks/useStack";
import type {
  StackCardKind,
  StackItem,
  StackPayload,
} from "@/lib/stack/types";
import { applyBibCarry } from "@/lib/stack/bib-carry";
import { generateShortId } from "@/lib/uuid";
import { remintNestedAtomIds } from "@/lib/inline-content";
import { rangeSliceToBlocks } from "@/lib/linked-anchor-range";
import { atomMetaForNodeName } from "@/lib/tiptap/atom-registry";

/**
 * **The per-payload placement table — the ONE answer to "where may THIS
 * payload land?", read by the hit-test (the affordance) and by
 * `classifyDrop` (the commit). Nothing restates a placement rule: every other
 * site in this file DERIVES from these constants ({@link placementsForPayload},
 * {@link STACK_PULL_PLACEMENT_LISTS}, `ALLOWED_PLACEMENTS`).**
 *
 * Both derive from it; neither restates it. That is the whole of
 * task 258: the spec used to answer the same question twice, from a spec-wide
 * static priority order at hover time and from a per-payload switch at commit
 * time, and the two disagreed. Because `inGap`/`inText` partition every cursor
 * position, the spec-wide order `["between-blocks", "inline-cursor",
 * "paragraph-side"]` made `paragraph-side` structurally unreachable — so a CARD
 * dropped on paragraph text got an inline caret (which no card kind accepts),
 * the commit refused it, and the paragraph-anchored pull this spec advertises
 * was dead code. Per payload the answer is different over the SAME pixel, which
 * no single static order can express:
 *
 *  - `text` — a slice merges INTO the prose: the inline caret over text, the
 *    block form in a gap.
 *  - `paragraph` / `heading` — whole blocks; only a gap can hold them. Over
 *    text the list yields nothing, so no indicator paints at all (before, an
 *    inviting caret painted over a commit that would refuse it).
 *  - `card` — split once more, by card KIND (see {@link CARD_PLACEMENTS}): an
 *    attachment card anchors to a PARAGRAPH (`paragraph-side`, reachable now
 *    that it is not queued behind `inline-cursor`) or lands unanchored in a
 *    gap; a footnote/citation/bib pull has no paragraph anchor to take, so it
 *    is gap-only. `inline-cursor` fits no card kind.
 *
 * Order matters only against `paragraph-side`, which matches either geometry:
 * `between-blocks` must precede it so a gap still means "unanchored", leaving
 * the text world to the side placement. (`between-blocks` and `inline-cursor`
 * are mutually exclusive, so their relative order never bites.)
 */
const INTO_PROSE: ReadonlyArray<PlacementKind> = [
  "between-blocks",
  "inline-cursor",
];
/** Anchored to the paragraph under the cursor, or unanchored in a gap. */
const ANCHORABLE: ReadonlyArray<PlacementKind> = [
  "between-blocks",
  "paragraph-side",
];
/** A gap only — nothing this payload can do with a position inside prose. */
const GAP_ONLY: ReadonlyArray<PlacementKind> = ["between-blocks"];
/** Nowhere: this build cannot land the payload, so no bar may invite one. Since
 *  task 259 no *declared* payload answers NOWHERE — a card kind with no working
 *  pull is not in the Stack vocabulary at all — so this is exactly the
 *  untrusted-input answer (an unresolvable key, a payload shape or card kind
 *  from another build). */
const NOWHERE: ReadonlyArray<PlacementKind> = [];

/**
 * The card half of the table, keyed on `StackCardKind` so a new stackable card
 * kind is a COMPILE ERROR until someone states where its pull may land.
 *
 * The criterion is mechanical and checkable: a kind gets `paragraph-side` iff
 * its branch in {@link applyCardDrop} passes `paragraphId` to its `ctx.stack`
 * factory. The kinds that don't are not oversights — a footnote/citation
 * belongs to an inline atom and a bib entry to the `.bib`, so v1 pulls them in
 * as unanchored entries whatever the cursor is over, and a side bar would
 * promise an anchor that never arrives.
 * `stack-pull-placement-policy.test.ts` re-derives both groups by running the
 * REAL `applyDrop` against a recording `StackPullApi`, iterating THIS record's
 * keys (which is why it is exported) — so a kind the compiler forces someone to
 * declare here is a kind the suite then checks against its branch, and the
 * declaration and the branch cannot drift.
 *
 * Since task 259 no member may declare NOWHERE: a card kind whose pull does
 * nothing is not in `STACK_CARD_KINDS` at all, so it never reaches this table.
 * (`example` was the standing case — `stackable:true` with a null snapshot, an
 * empty placement list and a placeholder branch, i.e. stackable in name at every
 * link of the chain and in fact at none.)
 */
export const CARD_PLACEMENTS: Record<
  StackCardKind,
  ReadonlyArray<PlacementKind>
> = {
  note: ANCHORABLE,
  highlight: ANCHORABLE,
  todo: ANCHORABLE,
  archive: ANCHORABLE,
  "revision-comment": ANCHORABLE,
  "revision-suggestion": ANCHORABLE,
  "cutter-comment": ANCHORABLE,
  "cutter-suggestion": ANCHORABLE,
  footnote: GAP_ONLY,
  citation: GAP_ONLY,
  bibliography: GAP_ONLY,
};

/**
 * Every DISTINCT list `placementsFor` can return, for the reachability census
 * ([placement-reachability.test.ts](../__tests__/placement-reachability.test.ts)):
 * a spec that answers per payload can't be censused through its envelope, so it
 * publishes the lists a session can actually walk. Deduped by IDENTITY, which is
 * why the four are named constants and every branch below returns one of them —
 * a branch that inlined its own array would be invisible here.
 */
export const STACK_PULL_PLACEMENT_LISTS: ReadonlyArray<
  ReadonlyArray<PlacementKind>
> = [...new Set<ReadonlyArray<PlacementKind>>([
  INTO_PROSE,
  ANCHORABLE,
  GAP_ONLY,
  NOWHERE,
  ...Object.values(CARD_PLACEMENTS),
])];

/**
 * The ordered placements ONE payload may use — the table's reader, and the
 * only place a payload is turned into a placement rule.
 *
 * **Total by construction, because its input is UNTRUSTED.** A `StackItem`
 * comes back from `readEnvelope` (useStack.ts), which validates the envelope's
 * `version` and that `items` is an array and then casts — so a blob written by
 * an older build, or carrying a card kind since renamed or retired, arrives
 * here typed as something it is not. Both unknown-shape doors therefore answer
 * NOWHERE rather than `undefined`: the placement question has an honest answer
 * for a payload we don't understand ("nowhere"), and `undefined` would be read
 * two ways downstream — `resolveSessionPlacements` would fall back to the
 * ENVELOPE (restoring exactly the unreachable order this task removed) and
 * `isPlacementValidFor` would throw on `.includes` inside `classifyDrop`, which
 * the controller does not catch, wedging the whole drop session. The `never`
 * assignment keeps the union exhaustive as a COMPILE error, so a new
 * `StackPayload` kind still has to state where it may land.
 */
function placementsForPayload(
  payload: StackPayload,
): ReadonlyArray<PlacementKind> {
  switch (payload.kind) {
    case "text":
      return INTO_PROSE;
    case "paragraph":
    case "heading":
      return GAP_ONLY;
    case "card":
      return CARD_PLACEMENTS[payload.card.cardKind] ?? NOWHERE;
    default: {
      const unknown: never = payload;
      void unknown;
      return NOWHERE;
    }
  }
}

/**
 * The declared ENVELOPE — every placement some payload may use — derived from
 * the table above rather than hand-listed, so it cannot drift from it.
 *
 * Deliberately NOT a priority order: this spec resolves per payload through
 * `placementsFor`, and no session ever walks this union. (Read as an order it
 * would still make `paragraph-side` unreachable — which is exactly why the
 * reachability guard asks a `placementsFor` spec about its per-payload lists,
 * not about its envelope.)
 */
const ALLOWED_PLACEMENTS: ReadonlyArray<PlacementKind> = [
  ...new Set(STACK_PULL_PLACEMENT_LISTS.flat()),
];

/**
 * The ordered placements for ONE pull, by the payload behind `cardKey`.
 * Resolved once per session (`resolveSessionPlacements`, at
 * `beginDropSession`) — never per pointermove, since `lookup` parses the
 * Stack's whole localStorage envelope.
 *
 * An unresolvable key returns `[]` — the honest answer both at mousedown (a
 * dead key offers no landing site) and later, since the item can be removed
 * from the Stack DURING the drag. The choice is frozen at mousedown by design;
 * the payload's continued existence is not guaranteed, which is exactly why
 * `classifyDrop` re-reads and re-validates at commit rather than trusting a
 * list minted a gesture ago.
 */
export function stackPullPlacementsFor(
  cardKey: string,
): ReadonlyArray<PlacementKind> {
  const item = lookup(cardKey);
  if (!item) return NOWHERE;
  return placementsForPayload(item.payload);
}

export const stackPullDropSpec: DropSpec = plannedDropSpec({
  allowedPlacements: ALLOWED_PLACEMENTS,
  placementsFor: stackPullPlacementsFor,
  targetScope: "main-only",
  postDrop: "keep",
  /**
   * ONE resolution, two doors (task 321). This spec's `postDrop` is `"keep"`,
   * so a refused pull never lost a float — but the drift was the same one: a
   * rehydrate that threw, a slice that converted to no blocks, a container fit
   * that rejected, an unwired `ctx.stack` (Reader mode) each returned quietly
   * from `applyDrop` while `classifyDrop` had already said `apply`. Every one is
   * resolved here, so a pull that cannot land is a `no-op` decision.
   */
  planDrop(placement, cardKey, ctx): DropPlan | null {
    const item = lookup(cardKey);
    if (!item) return null;
    const main = ctx.mainEditor;
    if (!main) return null;
    if (placement.editor !== main) return null;
    if (!isPlacementValidFor(item.payload, placement)) return null;
    const p = item.payload;

    // Exhaustive over `StackPayload` (task 259), for the same reason the card
    // switch below is: an if-chain with no final arm makes a new payload kind a
    // drop that paints its bar, runs its commit and inserts nothing. The unknown
    // arm refuses quietly rather than throwing — the payload comes from a
    // persisted envelope `readEnvelope` validates only shallowly, and the
    // hit-test has already refused it a placement (`placementsForPayload`).
    const inner = ((): DropPlan | null => {
      switch (p.kind) {
        case "text":
          return planInsertText(main, placement, p);
        case "paragraph":
          return planInsertParagraph(main, placement, p);
        case "heading":
          return planInsertHeading(main, placement, p);
        case "card":
          return planCardDrop(item, placement, ctx);
        default: {
          const unhandled: never = p;
          void unhandled;
          return null;
        }
      }
    })();
    if (!inner) return null;
    return withBibUpsert(item, ctx, inner);
  },
});

/**
 * **The bib half of every pull, discharged in ONE place (task 235).**
 *
 * Wrapping the resolved plan — rather than repeating an upsert inside each
 * payload branch — is the whole of the fix's pull side: the card branch was
 * bib-complete since task 069 and the three CONTENT branches silently were not,
 * although a `\cite` rides a text slice just as readily as it rides a citation
 * card. Here no branch can be forgotten, because no branch is asked.
 *
 * The upsert runs inside `commit`, never in the plan: a plan is pure and runs
 * twice per gesture (once per door), so writing the destination's `.bib` from
 * it would upsert on the classify pass too.
 *
 * **A carry we cannot discharge REFUSES.** `ctx.stack` is absent only in a host
 * with no citation/bib hooks wired at all; landing the content there anyway is
 * exactly the dangling-`\cite` outcome this task closes, so the pull becomes a
 * `no-op` decision instead — the same "decline rather than fall back" the card
 * branch already takes for a missing sub-bag, and it costs the user nothing
 * (a pull is a copy; the item stays on the Stack).
 */
function withBibUpsert(
  item: StackItem,
  ctx: import("../types").DropCtx,
  inner: DropPlan,
): DropPlan | null {
  const carry = item.bib;
  if (!carry) return inner;
  const stack = ctx.stack;
  if (!stack) return null;
  return {
    commit: () => {
      // Before the payload lands, so a pulled cite is never momentarily
      // dangling. Idempotent — a same-doc pull re-upserts entries that are
      // already there and writes nothing new.
      applyBibCarry(carry, stack);
      inner.commit();
    },
  };
}

function lookup(cardKey: string): StackItem | null {
  const sep = cardKey.indexOf(":");
  if (sep <= 0) return null;
  const id = cardKey.slice(sep + 1);
  return readStackItem(id);
}

/**
 * The COMMIT half of the one question, read off the same table the hit-test
 * walked. It stays as a distinct check rather than being assumed: the hit-test
 * resolved the list at mousedown, and a payload can be evicted from the Stack
 * mid-drag — so the commit re-reads and refuses rather than trusting a list
 * minted a gesture ago.
 */
function isPlacementValidFor(
  payload: StackPayload,
  placement: Placement,
): boolean {
  return placementsForPayload(payload).includes(placement.kind);
}

// ── Text payload ──────────────────────────────────────────────────────
function planInsertText(
  editor: import("@tiptap/react").Editor,
  placement: Placement,
  payload: Extract<StackPayload, { kind: "text" }>,
): DropPlan | null {
  if (placement.kind !== "inline-cursor" && placement.kind !== "between-blocks") {
    return null;
  }
  // Remint any Card-bearing inline atoms in the slice content so a pulled
  // footnote/citation can't share the source atom's id (the text path is the
  // headline case — select text spanning a footnote → add to Stack → pull).
  const seen = collectAtomIds(editor.state.doc);
  const rawSlice = payload.slice as
    | ({ content?: JSONContent[] } & Record<string, unknown>)
    | null
    | undefined;
  const sliceJson =
    rawSlice && Array.isArray(rawSlice.content)
      ? { ...rawSlice, content: rawSlice.content.map((n) => withFreshAtomIds(n, seen)) }
      : rawSlice;
  let slice: Slice;
  try {
    slice = Slice.fromJSON(
      editor.state.schema,
      sliceJson as Parameters<typeof Slice.fromJSON>[1],
    );
  } catch (err) {
    console.error("[stack-pull] failed to rehydrate text slice:", err);
    return null;
  }
  // An EMPTY slice is a refusal, not an insert (task 321). Its two siblings in
  // `text-range-move.ts` already guarded this and this branch did not, so the
  // two doors failed in different WRONG directions: in a gap
  // `rangeSliceToBlocks` falls back to a fresh empty paragraph, so the pull
  // landed a blank block and reported success; at a caret `tr.replace` with an
  // empty slice dispatched a transaction that changed nothing.
  if (slice.size === 0) return null;
  if (placement.kind === "between-blocks") {
    // In a block gap the slice lands as BLOCK content — the same payload shape,
    // and the same container question, as the text-range move's between-blocks
    // branch, so it uses the same two primitives: `rangeSliceToBlocks` for the
    // block form (an inline run → one paragraph, a multi-block range → its
    // blocks) and the container fit for where those blocks may go. Left as an
    // open-slice `tr.replace` it tore its container exactly like the bare-node
    // inserts did (task 257): a pull into an expex item gap SPLIT the
    // `exampleItemList` in two, so the example grew a second item list — its
    // sub-numbering restarting — with the pulled text demoted to body prose
    // between the halves.
    const blocks = rangeSliceToBlocks(slice, editor.state.schema);
    if (blocks.length === 0) return null;
    const fit = fitNodesAtInsert(editor, placement.insertPos, blocks);
    if (fit.kind === "reject") return null;
    const blockTr = editor.state.tr;
    let cursor = placement.insertPos;
    for (const n of fit.nodes) {
      // Advance by what ACTUALLY landed, not by `n.nodeSize`: rule 3 of the
      // container fit sanctions an insert the fitter PADS, which adds more
      // than the node itself — advancing by the node's size alone would put
      // the next block inside or before this one (task 257 review).
      const before = blockTr.doc.content.size;
      blockTr.insert(cursor, n);
      cursor += blockTr.doc.content.size - before;
    }
    selectInserted(blockTr, placement.insertPos, cursor - placement.insertPos);
    return {
      commit: () => {
        editor.view.dispatch(blockTr);
        editor.view.focus();
      },
    };
  }
  const target = placement.pos;
  // container-fit-exempt: the INLINE-CURSOR branch — an open slice merging with
  // the text around a caret is exactly what ProseMirror's fitter is for, and no
  // container is being entered. The between-blocks branch above goes through the
  // fit (the region-level guard cannot tell the two branches apart, so this says
  // which one is which).
  const tr = editor.state.tr.replace(target, target, slice);
  // Try to select what was inserted so the user can see the landing point.
  try {
    const after = tr.doc.resolve(Math.min(tr.doc.content.size, target + slice.size));
    const $start = tr.doc.resolve(target);
    tr.setSelection(TextSelection.between($start, after));
  } catch {
    /* ignore selection failure — content is in regardless */
  }
  return {
    commit: () => {
      editor.view.dispatch(tr);
      editor.view.focus();
    },
  };
}

// ── Paragraph payload ─────────────────────────────────────────────────
function planInsertParagraph(
  editor: import("@tiptap/react").Editor,
  placement: Placement,
  payload: Extract<StackPayload, { kind: "paragraph" }>,
): DropPlan | null {
  if (placement.kind !== "between-blocks") return null;
  const seen = collectAtomIds(editor.state.doc);
  const json = withFreshAtomIds(withFreshUuid(payload.node), seen);
  let node: PMNode | null = null;
  try {
    node = editor.state.schema.nodeFromJSON(
      json as Parameters<typeof editor.state.schema.nodeFromJSON>[0],
    );
  } catch (err) {
    console.error("[stack-pull] failed to rehydrate paragraph:", err);
    return null;
  }
  if (!node) return null;
  // Container fit (task 257) — a pull is an INSERT with no source delete, but a
  // bare paragraph spliced into an `exampleItemList` / `bulletList` corrupts the
  // container it lands in exactly as a move does (the fitter splits it, both
  // halves keeping one uuid). Fit or refuse; refusing costs nothing, since the
  // stack item is a copy that stays in the stack.
  const fit = fitNodesAtInsert(editor, placement.insertPos, [node]);
  if (fit.kind === "reject") return null;
  const fitted = fit.nodes[0];
  const tr = editor.state.tr.insert(placement.insertPos, fitted);
  selectInserted(tr, placement.insertPos, fitted.nodeSize);
  return {
    commit: () => {
      editor.view.dispatch(tr);
      editor.view.focus();
    },
  };
}

// ── Heading payload ───────────────────────────────────────────────────
function planInsertHeading(
  editor: import("@tiptap/react").Editor,
  placement: Placement,
  payload: Extract<StackPayload, { kind: "heading" }>,
): DropPlan | null {
  if (placement.kind !== "between-blocks") return null;
  const seen = collectAtomIds(editor.state.doc);
  const nodes: PMNode[] = [];
  for (const j of payload.nodes) {
    try {
      const n = editor.state.schema.nodeFromJSON(
        withFreshAtomIds(withFreshUuid(j), seen) as Parameters<
          typeof editor.state.schema.nodeFromJSON
        >[0],
      );
      if (n) nodes.push(n);
    } catch (err) {
      // ATOMIC over the run (task 321): this loop used to swallow a per-node
      // failure and carry on, so a heading whose body could not be rehydrated
      // landed as a PARTIAL section — the one non-atomic door in a file whose
      // every other refusal (and the container fit itself) is all-or-nothing.
      // A pull is a copy, so refusing costs the user nothing: the item stays on
      // the Stack.
      console.error("[stack-pull] heading node rehydrate failed:", err);
      return null;
    }
  }
  if (nodes.length === 0) return null;
  // Same container fit as the paragraph payload — atomic over the whole
  // heading+body run (one unfittable node refuses the pull rather than landing
  // a partial section).
  const fit = fitNodesAtInsert(editor, placement.insertPos, nodes);
  if (fit.kind === "reject") return null;
  const fitted = fit.nodes;
  const tr = editor.state.tr.insert(placement.insertPos, fitted as PMNode[]);
  const totalSize = fitted.reduce((s, n) => s + n.nodeSize, 0);
  selectInserted(tr, placement.insertPos, totalSize);
  return {
    commit: () => {
      editor.view.dispatch(tr);
      editor.view.focus();
    },
  };
}

function selectInserted(
  tr: import("@tiptap/pm/state").Transaction,
  pos: number,
  size: number,
) {
  const start = pos + 1;
  const end = pos + size - 1;
  if (end <= start) return;
  try {
    const $start = tr.doc.resolve(start);
    const $end = tr.doc.resolve(end);
    tr.setSelection(TextSelection.between($start, $end));
  } catch {
    /* ignore */
  }
}

/** Recursively replace `attrs.uuid` with a freshly-generated value on the
 *  outer node AND any nested anchorable children. */
function withFreshUuid(json: import("@tiptap/react").JSONContent): import("@tiptap/react").JSONContent {
  if (!json || typeof json !== "object") return json;
  const next: import("@tiptap/react").JSONContent = { ...json };
  if (next.attrs && typeof next.attrs === "object") {
    const attrs = { ...(next.attrs as Record<string, unknown>) };
    if ("uuid" in attrs) attrs.uuid = generateShortId();
    next.attrs = attrs;
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map(withFreshUuid);
  }
  return next;
}

// ── Inline-atom identity remint ───────────────────────────────────────
/** Every Card-bearing inline-atom id currently live in `doc` — the
 *  `footnoteId`/`citationId` (via the ATOM_REGISTRY `idAttr`) plus its unified
 *  `linkId` mirror. Seeds the remint avoidance-set: on a SAME-doc pull the
 *  source atom stays in the doc (pull is copy, not pop), so its id lives here —
 *  which is exactly the collision `withFreshAtomIds` must never reproduce. */
function collectAtomIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const meta = atomMetaForNodeName(node.type.name);
    if (meta?.idAttr) {
      const own = node.attrs[meta.idAttr];
      if (typeof own === "string" && own) ids.add(own);
      const linkId = node.attrs.linkId;
      if (typeof linkId === "string" && linkId) ids.add(linkId);
    }
    return true;
  });
  return ids;
}

/**
 * Remint every Card-bearing inline-atom id (footnoteId / citationId, plus the
 * unified linkId mirror kept in lock-step) inside a rehydrated blob, so a Stack
 * pull can never introduce a second atom that shares the SOURCE atom's id — a
 * same-doc paste-as-new would otherwise strand two footnote/citation atoms on
 * ONE id, and every id-keyed consumer (jump / edit / delete / pop-key, the
 * DocStructureObserver footnote/citation maps) resolves ambiguously to the
 * wrong atom. Atom kinds that own no cloneable Card identity (inlineMath /
 * labelRef → `idAttr: null`) are left untouched. `seen` accumulates every id
 * already live in the destination doc AND every id minted so far in this pull,
 * so no two atoms — existing or freshly-pulled — collide.
 *
 * The atom-id twin of `withFreshUuid`: block uuids and inline-atom ids are the
 * two identity axes a paste-as-new must regenerate. Reuses `remintNestedAtomIds`
 * so a `\cite` nested inside a footnote body (`attrs.content`) is reached the
 * same way the live editor reads it.
 */
function withFreshAtomIds(json: JSONContent, seen: Set<string>): JSONContent {
  return remintNestedAtomIds(json, (typeName) => {
    const meta = atomMetaForNodeName(typeName);
    if (!meta?.idAttr) return null; // ref / inline-math own no Card identity
    const fresh = generateShortId(seen);
    seen.add(fresh);
    return fresh;
  }).content;
}

// ── Card payload ──────────────────────────────────────────────────────
/**
 * Resolve a card pull: which factory would run, with which anchor. Returns
 * `null` — a `no-op` decision — when this doc has no `ctx.stack` sub-bag
 * (Reader / paper-render mode) or the snapshot carries a card kind this build
 * doesn't know. Both used to be bare `return`s inside the apply path, so a pull
 * into a doc that cannot host cards reported success for EVERY kind (task 321).
 *
 * The bib upserts and the factory call are side effects, so they live in
 * `commit` — a plan runs at classify time too, and on the confirm path before
 * the user has agreed to anything.
 */
function planCardDrop(
  item: StackItem,
  placement: Placement,
  ctx: import("../types").DropCtx,
): DropPlan | null {
  const stack = ctx.stack;
  if (!stack) return null;
  const p = item.payload;
  if (p.kind !== "card") return null;
  const card = p.card;
  // The anchor the pull lands on. `paragraph-side` was unreachable until task
  // 258 (the hit-test's static order handed every in-text cursor to
  // `inline-cursor`, which no card kind accepts), so this whole branch — and
  // every `paragraphId` argument below — was dead code and a pulled card could
  // only ever land unanchored. Whether a kind can USE it is declared in
  // `CARD_PLACEMENTS`, which is re-derived from these very calls in CI.
  const paragraphId =
    placement.kind === "paragraph-side" ? placement.paragraphId : null;

  // Which factory this kind's pull runs, resolved WITHOUT running it. A kind
  // this build doesn't know returns null and the whole pull becomes a `no-op`
  // decision, instead of a gesture that reports success and creates nothing.
  const create = ((): (() => void) | null => {
    switch (card.cardKind) {
      case "note":
        return () =>
          void stack.addNote(paragraphId, {
            title: card.data.title,
            content: card.data.content,
          });
      case "highlight":
        // Highlights ride a text-range mark in the source doc — we have no mark
        // to attach here, so v1 creates a paragraph-anchored (or unanchored)
        // placeholder. `addHighlight` is REQUIRED on `StackPullApi` since task
        // 259: it was optional, and an optional per-KIND factory is the same
        // silent-loss vector as a missing switch case — a host that omitted it
        // made every highlight pull do nothing, with no error anywhere.
        return () => void stack.addHighlight(paragraphId);
      case "footnote":
        return () => void stack.addFootnote(card.data);
      case "citation":
        return () => void stack.addCitation(card.data);
      case "bibliography":
        // The entry IS this card's payload, so it is upserted here as the
        // card's own action, not as a reference. Its user-authored annotation
        // rides `item.bib` like every other referenced key's does and is
        // re-attached by `withBibUpsert` before this runs (task 235).
        return () => void stack.upsertBibEntry(card.data);
      case "todo":
        return () => void stack.addTodo(paragraphId, { text: card.data.text });
      case "archive":
        return () =>
          void stack.addArchive(paragraphId, {
            title: card.data.title,
            content: card.data.content,
          });
      case "revision-comment":
        return () => void stack.addRevisionComment(paragraphId, card.data);
      case "revision-suggestion":
        return () => void stack.addRevisionSuggestion(paragraphId, card.data);
      case "cutter-comment":
        return () => void stack.addCutterComment(paragraphId, card.data);
      case "cutter-suggestion":
        return () => void stack.addCutterSuggestion(paragraphId, card.data);
      default: {
        // **The silent-loss backstop (task 259).** Every case above ends in a
        // `ctx.stack` call, so a kind with no case here dropped onto the Stack
        // fine and VANISHED on pull: no compile error (the switch was
        // non-exhaustive and the function returns void), no runtime error, no
        // failing test. A member added to `STACK_CARD_KINDS` without a branch is
        // now a compile error at this line.
        //
        // The runtime refusal still matters: `readEnvelope` validates the
        // envelope and then casts, so a persisted item written by another build
        // — or carrying a kind since retired — arrives typed as something it is
        // not. It is refused rather than crashing the drop session, matching
        // `placementsForPayload`'s unknown-shape door (the hit-test already
        // offered it no placement, so this is unreachable through the UI). Since
        // task 321 that refusal also reaches `classifyDrop`, so the gesture
        // cancels rather than reporting a pull that never happened.
        const unhandled: never = card;
        void unhandled;
        return null;
      }
    }
  })();
  if (!create) return null;

  // No bib handling here (task 235). A citation card's referenced entries +
  // annotations used to be upserted in this commit, from fields only the card
  // payload carried — which is why a `\cite` riding a TEXT slice arrived
  // dangling. Both now ride `item.bib` and are discharged by `withBibUpsert`
  // for every payload family alike.
  return { commit: create };
}
