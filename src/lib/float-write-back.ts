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
 *                  that fails the schema). The surface must SHOW `reason`.
 *
 * The plan builder may throw (a `nodeFromJSON` schema failure) or return
 * `refuseWrite(reason)`; both become `refused`. Nothing here walks the doc —
 * the builder resolves its own source through its hinted resolver, so the
 * door is O(edit) per keystroke like the code it replaced.
 */
import type { Editor } from "@tiptap/react";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { FLOAT_WRITE_META } from "@/lib/float-sync";

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

/** The reason a root-shape mismatch is reported under. Shared so every
 *  surface words the same failure the same way. */
export function wrongRootReason(expected: string): string {
  return `This edit couldn't be saved — it no longer forms a single ${expected}.`;
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
): FloatWriteOutcome {
  if (!main) return { status: "no-source" };
  try {
    const p = plan(main);
    if (p === null) return { status: "no-source" };
    if ("refused" in p) return { status: "refused", reason: p.refused };
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
    main.view.dispatch(tr);
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
