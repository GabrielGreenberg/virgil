/**
 * The ONE door a whole-block surface (an example card, every block float)
 * writes its edit back to MAIN through — task 1170.
 *
 * Every such surface used to hand-roll the same tail: resolve the source,
 * check the float doc's first node is the right type, rebuild, `replaceWith`,
 * tag `addToHistory:false` + `FLOAT_WRITE_META`, dispatch — and end every
 * failure in a bare `return;` or `catch { /* swallow *\/ }`. A refused write
 * was therefore SILENT: the surface kept showing the user's text while the
 * paper never received it, and the next re-seed (collapse, foreign edit)
 * erased it. The Example card alone had grown a banner (EX-F5-03) for one of
 * those exits; its floats had none.
 *
 * The door returns a typed outcome instead of returning nothing, so a caller
 * cannot drop a refusal on the floor without saying so:
 *
 *  - `landed`    — the write reached main; `from`/`to` is the extent it now
 *                  occupies (a caller that tracks its own hint re-stamps it).
 *  - `unchanged` — the rebuild equals what main already holds.
 *  - `no-source` — the source no longer resolves. NOT a refusal to report:
 *                  `SourceMissingBanner` already owns that fact.
 *  - `refused`   — the edit could not be written (wrong root shape, a node
 *                  that fails the schema), OR main did not ADMIT the dispatch
 *                  (task 1546 — its `readOnlyEnforcer` drops every doc change
 *                  on a read-only paper, silently). The surface must SHOW
 *                  `reason`. "Landed" is MEASURED after the dispatch, never
 *                  assumed from having dispatched.
 *
 * The plan builder may throw (a `nodeFromJSON` schema failure) or return
 * `refuseWrite(reason)`; both become `refused`. Nothing here walks the doc —
 * the builder resolves its own source through its hinted resolver, so the
 * door is O(edit) per keystroke like the code it replaced.
 */
import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { FLOAT_WRITE_META } from "@/lib/float-sync";
import { dispatchLanded } from "@/components/drop-mode/commit-seam";
import type { SourceRange } from "@/lib/float-source-range";

export interface FloatWritePlan {
  /** The main-doc range the edit replaces. */
  from: number;
  to: number;
  /** What replaces it. */
  content: PMNode | readonly PMNode[];
}

export interface FloatWriteRefusal {
  refused: string;
}

export type FloatWriteOutcome =
  | { status: "landed"; from: number; to: number }
  | { status: "unchanged" }
  | { status: "no-source" }
  | { status: "refused"; reason: string };

/** A plan builder's way to refuse with a stated reason. */
export function refuseWrite(reason: string): FloatWriteRefusal {
  return { refused: reason };
}

/** The reason a write main did not admit is reported under (task 1546). Its
 *  one filter that drops a float's write is the read-only enforcer, so say
 *  that — shared with every door that measures a float write. */
export const MAIN_REFUSED_WRITE_REASON =
  "This edit wasn't saved — the paper is read-only right now.";

/** The reason a root-shape mismatch is reported under. Shared so every
 *  surface words the same failure the same way. */
export function wrongRootReason(expected: string): string {
  return `This edit couldn't be saved — it no longer forms a single ${expected}.`;
}

/** The reason a section float's edit is refused when it would leave the
 *  section without the heading that addresses it (task 1565). */
export const SECTION_LOST_HEADING_REASON =
  "This edit couldn't be saved — a section has to begin with its heading.";

/**
 * The section float's write, or its refusal. The float's first block must still
 * be a heading: the section is ADDRESSED by that heading's uuid, so a write
 * without it would erase the identity every later write and undo resolves
 * through (task 1565). The source heading's attrs, uuid included, carry over;
 * only the level and content come from the float.
 */
export function planSectionWrite(
  schema: Schema,
  range: { start: number; end: number; nodes: readonly PMNode[] },
  incoming: readonly JSONContent[],
): FloatWritePlan | FloatWriteRefusal {
  if (incoming.length === 0) return refuseWrite(wrongRootReason("section"));
  const newNodes = incoming.map((j) => schema.nodeFromJSON(j));
  const [written] = newNodes;
  if (written.type.name !== "heading") return refuseWrite(SECTION_LOST_HEADING_REASON);
  const sourceHeading = range.nodes[0];
  newNodes[0] = schema.nodes.heading.create(
    { ...sourceHeading.attrs, level: written.attrs.level ?? sourceHeading.attrs.level },
    written.content,
    written.marks,
  );
  return { from: range.start, to: range.end, content: newNodes };
}

function contentSize(content: PMNode | readonly PMNode[]): number {
  if (Array.isArray(content)) {
    let n = 0;
    for (const c of content as readonly PMNode[]) n += c.nodeSize;
    return n;
  }
  return (content as PMNode).nodeSize;
}

/**
 * WHERE a float writes (task 1399). A plan resolves its target from the
 * source's IDENTITY (a uuid → that node's extent; a heading uuid → its
 * section) — but after the float's own previous write main may hold MORE of
 * the float's content than that identity spans: an Enter-split in a list-item
 * float wrote the item plus a new sibling; a pasted `<h1>` at the end of a
 * section float wrote a heading that now ENDS the section. Re-deriving the
 * identity's extent then shrinks the target, and writing every float block
 * into it duplicates the rest in main.
 *
 * So the target is the span the float LAST WROTE (`written`, tracked by
 * `useFloatMainSync`) whenever it still begins at the identity the plan
 * resolved — the identity check — and reaches at least as far. Otherwise
 * (no own write since the last re-read, or the identity moved) the plan's own
 * range stands. O(1).
 */
export function writeTarget(
  plan: { from: number; to: number },
  written: SourceRange | null | undefined,
  docSize: number,
): { from: number; to: number } {
  if (
    written &&
    written.from === plan.from &&
    written.to > plan.to &&
    written.to <= docSize
  ) {
    return { from: plan.from, to: written.to };
  }
  return { from: plan.from, to: plan.to };
}

/**
 * Land a whole-block surface's edit on MAIN.
 *
 * `plan` returns `null` when the source is gone (→ `no-source`), a
 * `refuseWrite(...)` when the edit has no faithful representation in main,
 * or the range + content to write. A throw inside `plan` (or in the
 * replace itself) is a refusal carrying the error's message.
 */
export function landFloatWrite(
  main: Editor | null | undefined,
  floatId: string,
  plan: (main: Editor) => FloatWritePlan | FloatWriteRefusal | null,
  /** The span this float's own last write occupies — `useFloatMainSync`'s
   *  `writtenRangeRef.current` (see `writeTarget`). */
  written?: SourceRange | null,
): FloatWriteOutcome {
  if (!main) return { status: "no-source" };
  try {
    const planned = plan(main);
    if (planned === null) return { status: "no-source" };
    if ("refused" in planned) return { status: "refused", reason: planned.refused };
    const p = {
      ...planned,
      ...writeTarget(planned, written, main.state.doc.content.size),
    };
    const content = p.content as PMNode | PMNode[];
    // An echo of what main already holds (the surface re-emitting unchanged
    // content) dispatches nothing. O(block), the same order as the rebuild.
    if (main.state.doc.slice(p.from, p.to).content.eq(Fragment.from(content))) {
      return { status: "unchanged" };
    }
    const tr = main.state.tr.replaceWith(p.from, p.to, content);
    if (!tr.docChanged) return { status: "unchanged" };
    tr.setMeta("addToHistory", false);
    tr.setMeta(FLOAT_WRITE_META, floatId);
    if (!dispatchLanded(main, tr)) {
      return { status: "refused", reason: MAIN_REFUSED_WRITE_REASON };
    }
    return { status: "landed", from: p.from, to: p.from + contentSize(p.content) };
  } catch (err) {
    return {
      status: "refused",
      reason:
        err instanceof Error && err.message
          ? `This edit couldn't be saved (${err.message}).`
          : "This edit couldn't be saved — it produced invalid content.",
    };
  }
}

/** Fold an outcome into a surface's "rejected edit" message: a refusal sets
 *  it; a landed write OR an `unchanged` one clears it — both mean the surface
 *  now equals what main holds, so no rejected edit is left to describe (task
 *  1223: undoing a refused edit back to main's content is an `unchanged` echo).
 *  `no-source` leaves it as it is (SourceMissingBanner owns that state). */
export function nextWriteRefusal(
  prev: string | null,
  outcome: FloatWriteOutcome,
): string | null {
  if (outcome.status === "refused") return outcome.reason;
  if (outcome.status === "landed" || outcome.status === "unchanged") return null;
  return prev;
}
