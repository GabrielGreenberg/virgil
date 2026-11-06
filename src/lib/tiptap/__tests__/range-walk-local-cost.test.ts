// @vitest-environment jsdom
/**
 * Task 1497 — a one-character edit at block N costs the same in the per-step
 * range walks whatever N is.
 *
 * `Fragment.nodesBetween` scans the parent's children from index 0 until it
 * passes `to`, so a "what starts in this step's range?" walk over a keystroke's
 * one-character range paid for every top-level block ABOVE the caret. The
 * walks — the block-uuid backfill's `forEachAnchorableStart` and the
 * DocStructureObserver's `collectRange` / `shapeNodesStartingIn` /
 * `noteContentSpan` — now go through `nodesBetweenLocal` (changed-ranges.ts),
 * which answers a range inside one textblock from that textblock alone.
 *
 * Two halves: the primitive visits exactly what `doc.nodesBetween` would for
 * every node a caller may ask about (nodes STARTING in the range, inline
 * content), and the real plugin pair — observer + backfill — performs NO
 * top-level `nodesBetween` scan for a keystroke, a Backspace or a mark step
 * deep in a long paper.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { nodesBetweenLocal } from "@/lib/tiptap/changed-ranges";
import { blockUuidBackfillPlugin } from "@/lib/tiptap/block-uuid-backfill";
import {
  docStructureKey,
  docStructureStateSpec,
  type PluginState as DocStructurePluginState,
} from "@/lib/tiptap/doc-structure/observer-plugin";
import {
  doc,
  footnoteNode,
  paragraph,
  testSchema,
} from "../doc-structure/__tests__/fixtures";

const BLOCKS = 500;

function longDoc(): PMNode {
  const blocks: PMNode[] = [];
  for (let i = 0; i < BLOCKS; i++) {
    if (i % 7 === 3) {
      blocks.push(
        testSchema.nodes.paragraph.create({ uuid: `p${i}` }, [
          testSchema.text(`before ${i} `),
          footnoteNode(`fn${i}`, i),
          testSchema.text(" after"),
        ]),
      );
    } else {
      blocks.push(paragraph(`p${i}`, `paragraph number ${i}`));
    }
  }
  return doc(...blocks);
}

/** Start of block `i`'s content. */
function contentStart(d: PMNode, i: number): number {
  let pos = 0;
  for (let k = 0; k < i; k++) pos += d.child(k).nodeSize;
  return pos + 1;
}

type Visit = [string, number, string | null];

function visits(
  walk: (f: (n: PMNode, pos: number, parent: PMNode | null) => void) => void,
  keep: (n: PMNode, pos: number) => boolean,
): Visit[] {
  const out: Visit[] = [];
  walk((n, pos, parent) => {
    if (keep(n, pos)) out.push([n.type.name, pos, parent?.type.name ?? null]);
  });
  return out;
}

describe("nodesBetweenLocal — same answers as doc.nodesBetween", () => {
  const d = longDoc();
  const size = d.content.size;
  // Ranges of every shape: inside one textblock (the fast path), around an
  // inline atom, across a block boundary, between blocks, whole document.
  const p3 = contentStart(d, 3);
  const p40 = contentStart(d, 40);
  const ranges: Array<[number, number]> = [
    [p40 + 2, p40 + 3],
    [p40 + 2, p40 + 2 + 5],
    [p3, p3 + d.child(3).content.size],
    [p3 + 9, p3 + 12],
    [p40 - 3, p40 + 3],
    [p40 - 1, p40 - 1 + 1],
    [p40 - 1, p40 + d.child(40).nodeSize],
    [0, size],
  ];

  for (const [from, to] of ranges) {
    it(`[${from}, ${to})`, () => {
      // What a caller may ask about: a node that STARTS in the range, or inline
      // content (which `collectRange` reads by overlap).
      const keep = (n: PMNode, pos: number) =>
        n.isInline || (pos >= from && pos < to);
      const expected = visits((f) => d.nodesBetween(from, to, f), keep);
      const actual = visits((f) => nodesBetweenLocal(d, from, to, f), keep);
      expect(actual).toEqual(expected);
    });
  }
});

// ── The real plugins: no top-level scan per keystroke ───────────────────────

const realNodesBetween = Fragment.prototype.nodesBetween;
afterEach(() => {
  Fragment.prototype.nodesBetween = realNodesBetween;
});

/** Count `nodesBetween` scans over a fragment as wide as the document's top
 *  level — the scan whose cost is the caret block's INDEX. */
function countTopLevelScans(run: () => void): number {
  let scans = 0;
  Fragment.prototype.nodesBetween = function (this: Fragment, ...args) {
    if (this.childCount >= BLOCKS) scans++;
    return realNodesBetween.apply(this, args as Parameters<typeof realNodesBetween>);
  } as typeof realNodesBetween;
  try {
    run();
  } finally {
    Fragment.prototype.nodesBetween = realNodesBetween;
  }
  return scans;
}

function makeState(): EditorState {
  return EditorState.create({
    schema: testSchema,
    doc: longDoc(),
    plugins: [
      new Plugin<DocStructurePluginState>({
        key: docStructureKey,
        state: docStructureStateSpec(),
      }),
      blockUuidBackfillPlugin(),
    ],
  });
}

describe("observer + backfill: a keystroke deep in a long paper scans no top level", () => {
  const at = 450;

  it("typing a character", () => {
    const state = makeState();
    const p = contentStart(state.doc, at) + 4;
    const tr = state.tr.insertText("x", p);
    const scans = countTopLevelScans(() => state.applyTransaction(tr));
    expect(scans).toBe(0);
  });

  it("Backspace", () => {
    const state = makeState();
    const p = contentStart(state.doc, at) + 4;
    const tr = state.tr.delete(p - 1, p);
    const scans = countTopLevelScans(() => state.applyTransaction(tr));
    expect(scans).toBe(0);
  });

  it("a mark step inside one paragraph", () => {
    const state = makeState();
    const p = contentStart(state.doc, at);
    // Built OUTSIDE the count: `tr.addMark` walks with `nodesBetween` itself,
    // which is ProseMirror's cost, not the plugins'.
    const tr = state.tr.addMark(p + 1, p + 6, testSchema.marks.bold.create());
    const scans = countTopLevelScans(() => state.applyTransaction(tr));
    expect(scans).toBe(0);
  });

  it("…and still sees what the edit inserts (an inline atom typed mid-paper)", () => {
    const state = makeState();
    const p = contentStart(state.doc, at) + 4;
    const { state: next } = state.applyTransaction(
      state.tr.insert(p, footnoteNode("typed-fn", 99)),
    );
    const structure = docStructureKey.getState(next)!;
    expect(JSON.stringify(structure)).toContain("typed-fn");
  });
});
