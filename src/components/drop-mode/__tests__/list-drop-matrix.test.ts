// @vitest-environment jsdom
/**
 * Task 416 — **the list drag/drop MATRIX.** Gabriel: *"drag and drop within
 * bullet pointed lists is an absolute mess. do a full audit of moving things,
 * in, out, over lists. practice sequences of moves, etc."*
 *
 * Every other suite in this directory drives ONE cell — one source kind over
 * one target shape at one geometry — which is exactly why a list, the densest
 * stack of gaps a document has, could accumulate four independent defects with
 * all of them green. This suite is the audit deliverable: it drives the REAL
 * `hitTest` over a SYNTHETIC LAYOUT (jsdom answers an all-zero rect for
 * everything, so a layout model is the only way to ask a geometry question at
 * all) and then the REAL spec `planDrop` at whatever the hover offered, and
 * records per cell:
 *
 *   (a) does a bar paint,  (b) does the document change,  (c) where did the
 *   payload land,  (d) is the source gone,  (e) is every uuid conserved.
 *
 * The four shapes it is aimed at, all confirmed against the pre-416 code:
 *   F0 — `between-blocks` matches the GAP only, and a list has no top-level
 *        gaps between its items, so the ONLY payload offered anything anywhere
 *        over a list body was one that was itself a `listItem` (the R3
 *        `resolveSubItemPeerBlock` pre-switch resolver). A paragraph, a
 *        heading, a figure or a `texBlock` over the same rows saw nothing.
 *   F1 — the item-MIDPOINT snap had ONE call site, that same resolver's, so
 *        every other payload could only say "before" in a hairline.
 *   F2 — no axis chose the nesting LEVEL: `insertPos` was a pure function of Y
 *        and of the innermost anchorable container, and X was read for nothing.
 *   F3 — a position the commit REFUSES still painted an inviting bar.
 *
 * The layout model mirrors the real one closely enough for those questions:
 * every textblock is one row, a list indents its children by one marker band
 * (the 2em `.tiptap ul/ol` band, task 382), and top-level blocks are separated
 * by a real gap.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { getSchema } from "@tiptap/core";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { hitTest } from "../hit-test";
import { registerDropTarget } from "../target-registry";
import { lookupSpec } from "../registry";
import { TEXT_ONLY_PAYLOAD } from "../inline-host";
import { NO_BLOCK_PAYLOAD, resolveSessionBlockPayload } from "../block-payload";
import { textObjectPopoutKey } from "@/text-objects/text-object-registry";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import type { DropCtx, Placement } from "../types";

// ─────────────────────────────────────────────────────────────────────
// Real schema
// ─────────────────────────────────────────────────────────────────────

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

// ─────────────────────────────────────────────────────────────────────
// Synthetic layout
// ─────────────────────────────────────────────────────────────────────

const COL_LEFT = 100;
const COL_WIDTH = 500;
const LINE_H = 20;
/** The `.tiptap ul/ol` marker band (2em at a 16px root — AGENTS.md, task 382). */
const INDENT = 32;
/** Vertical gap between top-level blocks — the hairline the pre-416 rule needs. */
const BLOCK_GAP = 10;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Node types that indent their children by one marker band. */
const INDENTING = new Set(["bulletList", "orderedList", "exampleItemList"]);

interface LayoutEntry {
  pos: number;
  node: PMNode;
  box: Box;
  el: HTMLElement;
}

class Layout {
  readonly byPos = new Map<number, LayoutEntry>();
  /** Textblock rows in document order — what `posAtCoords` hit-tests. */
  readonly rows: LayoutEntry[] = [];
  /** Top-level children, for the gap fallback. */
  readonly topLevel: LayoutEntry[] = [];

  constructor(doc: PMNode) {
    let y = 0;
    doc.forEach((child, offset) => {
      const h = this.place(child, offset, COL_LEFT, y);
      const entry = this.byPos.get(offset);
      if (entry) this.topLevel.push(entry);
      y += h + BLOCK_GAP;
    });
  }

  private place(node: PMNode, pos: number, left: number, top: number): number {
    const el = document.createElement("div");
    el.setAttribute("data-node-type", node.type.name);
    if (node.attrs?.uuid) el.setAttribute("data-uuid", String(node.attrs.uuid));
    const box: Box = {
      top,
      left,
      width: COL_WIDTH - (left - COL_LEFT),
      height: 0,
    };
    this.byPos.set(pos, { pos, node, box, el });

    if (node.isTextblock || node.isLeaf) {
      box.height = LINE_H;
      this.rows.push(this.byPos.get(pos)!);
    } else {
      const childLeft = INDENTING.has(node.type.name) ? left + INDENT : left;
      let y = top;
      node.forEach((child, offset) => {
        y += this.place(child, pos + 1 + offset, childLeft, y);
      });
      box.height = Math.max(y - top, LINE_H);
    }
    stubRect(el, box);
    return box.height;
  }

  /** The entry for a uuid-bearing node, by uuid. */
  find(uuid: string): LayoutEntry {
    for (const e of this.byPos.values()) {
      if (e.node.attrs?.uuid === uuid) return e;
    }
    throw new Error(`layout: no node with uuid ${uuid}`);
  }
}

function stubRect(el: HTMLElement, box: Box) {
  el.getBoundingClientRect = () =>
    ({
      top: box.top,
      bottom: box.top + box.height,
      left: box.left,
      right: box.left + box.width,
      width: box.width,
      height: box.height,
      x: box.left,
      y: box.top,
      toJSON() {},
    }) as DOMRect;
  el.getClientRects = () =>
    [el.getBoundingClientRect()] as unknown as DOMRectList;
}

// ─────────────────────────────────────────────────────────────────────
// A fake editor over the layout
// ─────────────────────────────────────────────────────────────────────

interface Harness {
  editor: Editor;
  layout: Layout;
  ctx: DropCtx;
  doc(): PMNode;
}

function makeHarness(doc: PMNode): Harness {
  let layout = new Layout(doc);
  let state = EditorState.create({ schema, doc });

  const root = document.createElement("div");
  root.classList.add("ProseMirror");
  document.body.appendChild(root);
  stubRect(root, { top: 0, left: COL_LEFT, width: COL_WIDTH, height: 4000 });

  const editor = {
    isEditable: true,
    get state() {
      return state;
    },
    view: {
      dom: root,
      get state() {
        return state;
      },
      nodeDOM: (pos: number) => layout.byPos.get(pos)?.el ?? null,
      dispatch: (tr: Transaction) => {
        state = state.apply(tr);
        // Re-lay-out after a commit so a SEQUENCE of moves hit-tests against
        // the document it actually produced, not the one it started from.
        layout = new Layout(state.doc);
      },
      focus: () => {},
      posAtCoords: ({ left, top }: { left: number; top: number }) =>
        posAtCoords(layout, left, top),
    },
  } as unknown as Editor;

  registerDropTarget(editor);
  document.elementsFromPoint = () => [root];

  return {
    editor,
    get layout() {
      return layout;
    },
    ctx: { mainEditor: editor } as unknown as DropCtx,
    doc: () => state.doc,
  } as Harness;
}

/**
 * The layout's own hit-test. A `top` inside a row resolves INSIDE that
 * textblock (offset chosen from `left`); a `top` in a top-level gap resolves to
 * the boundary between the two blocks, at depth 0 — the shape the real
 * `posAtCoords` produces there, and the one `resolveAnchorableBlock`'s gap
 * fallback exists for.
 */
function posAtCoords(
  layout: Layout,
  left: number,
  top: number,
): { pos: number; inside: number } | null {
  for (const row of layout.rows) {
    if (top >= row.box.top && top <= row.box.top + row.box.height) {
      const frac = Math.max(
        0,
        Math.min(1, (left - row.box.left) / Math.max(row.box.width, 1)),
      );
      const inner = Math.round(frac * row.node.content.size);
      return { pos: row.pos + 1 + inner, inside: row.pos };
    }
  }
  let boundary = 0;
  for (const tl of layout.topLevel) {
    if (tl.box.top + tl.box.height <= top) boundary = tl.pos + tl.node.nodeSize;
  }
  return { pos: boundary, inside: -1 };
}

// ─────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────

function para(text: string, uuid: string): PMNode {
  return schema.nodes.paragraph.create(
    { uuid },
    text ? schema.text(text) : undefined,
  );
}
function item(text: string, uuid: string, extra: PMNode[] = []): PMNode {
  return schema.nodes.listItem.create({ uuid }, [
    para(text, `${uuid}-p`),
    ...extra,
  ]);
}
function bullets(uuid: string, items: PMNode[]): PMNode {
  return schema.nodes.bulletList.create({ uuid }, items);
}
function ordered(uuid: string, items: PMNode[]): PMNode {
  return schema.nodes.orderedList.create({ uuid }, items);
}
function heading(text: string, uuid: string): PMNode {
  return schema.nodes.heading.create({ level: 2, uuid }, schema.text(text));
}
function quote(uuid: string, children: PMNode[]): PMNode {
  return schema.nodes.blockquote.create({ uuid }, children);
}
function exampleOf(uuid: string, texts: string[]): PMNode {
  const items = texts.map((t, i) =>
    schema.nodes.exampleItem.create({ uuid: `${uuid}-i${i}` }, [
      para(t, `${uuid}-ip${i}`),
    ]),
  );
  return schema.nodes.exampleBlock.create({ uuid }, [
    schema.nodes.exampleItemList.create({}, items),
  ]);
}
function docOf(...children: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, children);
}

// ─────────────────────────────────────────────────────────────────────
// Cell driver
// ─────────────────────────────────────────────────────────────────────

type Verdict = "correct" | "no-target" | "silently-refused" | "corrupting";

interface Cell {
  bar: boolean;
  /** Did the offered position lie inside the SOURCE's own range? Releasing a
   *  block back where it already is is a declared no-op in every between-blocks
   *  spec, so such a cell is not a false affordance — it is the user asking for
   *  nothing. Tracked so INV1 can say so rather than counting it as a lie. */
  selfDrop: boolean;
  insertPos: number | null;
  /** The container the offered position would insert INTO — the level X chose. */
  containerType: string | null;
  changed: boolean;
  landedIn: string[] | null;
  sourceGone: boolean;
  uuidsConserved: boolean;
  verdict: Verdict;
}

function uuidsOf(d: PMNode): string[] {
  const out: string[] = [];
  d.descendants((n) => {
    const uuid = n.attrs?.uuid as string | undefined;
    if (uuid) out.push(uuid);
  });
  return out;
}

/** The container path down to `uuid`, or null when it is gone. */
function pathOf(d: PMNode, uuid: string): string[] | null {
  let found: string[] | null = null;
  const walk = (node: PMNode, trail: string[]) => {
    node.forEach((child) => {
      if (found) return;
      if (child.attrs?.uuid === uuid) {
        found = [...trail, child.type.name];
        return;
      }
      walk(child, [...trail, child.type.name]);
    });
  };
  walk(d, []);
  return found;
}

/** The source block's own range in `d`, or null. */
function rangeOf(d: PMNode, uuid: string): { from: number; to: number } | null {
  let out: { from: number; to: number } | null = null;
  d.descendants((n, pos) => {
    if (out) return false;
    if (n.attrs?.uuid === uuid) {
      out = { from: pos, to: pos + n.nodeSize };
      return false;
    }
    return true;
  });
  return out;
}

function hoverOnly(
  h: Harness,
  cardKey: string,
  x: number,
  y: number,
  /** Pass `NO_BLOCK_PAYLOAD` to drive the PRE-416 rule: no ladder, no filter,
   *  `between-blocks` in the top-level hairline gap only. */
  payloadOverride?: readonly string[],
) {
  const spec = lookupSpec(cardKey);
  if (!spec) throw new Error(`no spec for ${cardKey}`);
  return hitTest(
    x,
    y,
    spec,
    spec.placementsFor?.(cardKey) ?? spec.allowedPlacements,
    cardKey,
    h.editor,
    TEXT_ONLY_PAYLOAD,
    payloadOverride ?? resolveSessionBlockPayload(spec, cardKey, h.ctx),
  );
}

/** Hover then release at (x, y), and report everything the cell says. */
function drop(
  h: Harness,
  cardKey: string,
  x: number,
  y: number,
  sourceUuid: string,
  payloadOverride?: readonly string[],
): Cell {
  const spec = lookupSpec(cardKey)!;
  const before = h.doc();
  const placement = hoverOnly(h, cardKey, x, y, payloadOverride);
  if (!placement) {
    return {
      bar: false,
      selfDrop: false,
      insertPos: null,
      containerType: null,
      changed: false,
      landedIn: null,
      sourceGone: false,
      uuidsConserved: true,
      verdict: "no-target",
    };
  }
  const plan = spec.planDrop?.(placement, cardKey, h.ctx);
  if (plan) plan.commit();
  const after = h.doc();
  const changed = !after.eq(before);
  const afterUuids = uuidsOf(after);
  const beforeUuids = uuidsOf(before);
  const dupes = afterUuids.length !== new Set(afterUuids).size;
  const lost = beforeUuids.filter((id) => !afterUuids.includes(id));
  const uuidsConserved = !dupes && lost.length === 0;
  const insertPos = (
    placement as Extract<Placement, { kind: "between-blocks" }>
  ).insertPos;
  const srcRange = rangeOf(before, sourceUuid);
  return {
    bar: true,
    selfDrop:
      srcRange !== null &&
      insertPos >= srcRange.from &&
      insertPos <= srcRange.to,
    insertPos,
    containerType: before.resolve(insertPos).parent.type.name,
    changed,
    landedIn: pathOf(after, sourceUuid),
    sourceGone: false,
    uuidsConserved,
    verdict: !uuidsConserved
      ? "corrupting"
      : changed
        ? "correct"
        : "silently-refused",
  };
}

// ─────────────────────────────────────────────────────────────────────
// The document under test
// ─────────────────────────────────────────────────────────────────────
//
//   pIntro    "intro"
//   ul1
//     li1     "one"
//     li2     "two"  +  ul2 (nested)
//                        li2a "alpha"
//                        li2b "beta"
//     li3     "three"
//   bq        blockquote > "quoted"
//   ex        exampleBlock > "ex one"
//   ol1       orderedList > "num one"
//   pOutro    "outro"
//   …then whichever SOURCE block the cell drags.
function fixture(...sources: PMNode[]): PMNode {
  return docOf(
    para("intro", "pIntro"),
    bullets("ul1", [
      item("one", "li1"),
      item("two", "li2", [
        bullets("ul2", [item("alpha", "li2a"), item("beta", "li2b")]),
      ]),
      item("three", "li3"),
    ]),
    quote("bq", [para("quoted", "pq")]),
    exampleOf("ex", ["ex one"]),
    ordered("ol1", [item("num one", "oli1")]),
    para("outro", "pOutro"),
    ...sources,
  );
}

const SOURCES = [
  { name: "paragraph", uuid: "SRC", node: () => para("moved", "SRC") },
  { name: "heading", uuid: "SRCH", node: () => heading("Moved", "SRCH") },
  {
    name: "listItem",
    uuid: "SRCLI",
    node: () => bullets("SRCUL", [item("moved", "SRCLI")]),
  },
  {
    name: "exampleBlock",
    uuid: "SRCEX",
    node: () => exampleOf("SRCEX", ["moved"]),
  },
] as const;

function keyFor(name: string, uuid: string): string {
  return textObjectPopoutKey({
    kind: name as Parameters<typeof textObjectPopoutKey>[0]["kind"],
    id: uuid,
  });
}

/** The five geometries the task names, as a fraction of the row's height. */
const FRACTIONS = [0.1, 0.25, 0.5, 0.75, 0.9] as const;
/** Three cursor X positions: left of the column, at the column edge, deep in. */
const X_POSITIONS = [COL_LEFT - 40, COL_LEFT + 2, COL_LEFT + 300] as const;
/** Every target row the matrix hovers, by uuid of the node whose ROW it is. */
const TARGET_ROWS = [
  "pIntro",
  "li1",
  "li2",
  "li2a",
  "li2b",
  "li3",
  "pq",
  "ol1",
  "pOutro",
] as const;

beforeEach(() => {
  document.body.innerHTML = "";
});

// ─────────────────────────────────────────────────────────────────────
// The audit
// ─────────────────────────────────────────────────────────────────────

interface Row {
  source: string;
  target: string;
  frac: number;
  x: number;
  cell: Cell;
}

function sweep(payloadOverride?: readonly string[]): Row[] {
  const rows: Row[] = [];
  for (const src of SOURCES) {
    for (const target of TARGET_ROWS) {
      for (const frac of FRACTIONS) {
        for (const x of X_POSITIONS) {
          const h = makeHarness(fixture(src.node()));
          // The row of the target: its own textblock's box for a textblock,
          // else the first row inside it.
          const entry = h.layout.find(target);
          const box = entry.node.isTextblock
            ? entry.box
            : h.layout.rows.find(
                (r) => r.box.top >= entry.box.top && r.box.top < entry.box.top + entry.box.height,
              )!.box;
          const y = box.top + box.height * frac;
          rows.push({
            source: src.name,
            target,
            frac,
            x,
            cell: drop(
              h,
              keyFor(src.name, src.uuid),
              x,
              y,
              src.uuid,
              payloadOverride,
            ),
          });
        }
      }
    }
  }
  return rows;
}

describe("the audit — every source × target × geometry", () => {
  const rows = sweep();

  it("prints the classification (the task's `## Findings` deliverable)", () => {
    const counts: Record<Verdict, number> = {
      correct: 0,
      "no-target": 0,
      "silently-refused": 0,
      corrupting: 0,
    };
    for (const r of rows) counts[r.cell.verdict] += 1;
    const perSource: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      (perSource[r.source] ??= {})[r.cell.verdict] =
        (perSource[r.source]?.[r.cell.verdict] ?? 0) + 1;
    }
    console.log(
      `[416 matrix] cells=${rows.length}`,
      JSON.stringify(counts),
      JSON.stringify(perSource),
    );
    expect(rows.length).toBeGreaterThan(400);
  });

  it("MEASURED — the PRE-416 rule over the SAME 540 cells", () => {
    // The defect leg for the whole task. `NO_BLOCK_PAYLOAD` is exactly the
    // pre-416 hit-test for these sources: no ladder, no filter, and
    // `between-blocks` reachable only in the top-level hairline GAP
    // (`winningPlacementKind`). The R3 sub-item resolver that used to sit in
    // front of it is retired, which is why `listItem` collapses here too.
    const before = sweep(NO_BLOCK_PAYLOAD);
    const counts: Record<Verdict, number> = {
      correct: 0,
      "no-target": 0,
      "silently-refused": 0,
      corrupting: 0,
    };
    for (const r of before) counts[r.cell.verdict] += 1;
    console.log(`[416 matrix · PRE-416] cells=${before.length}`, JSON.stringify(counts));
    // The headline, stated precisely. EVERY cell in this sweep samples INSIDE a
    // block's row (the fractions are of the row's own height) — which is where
    // a cursor is for essentially the whole of a drag over a dense list — and
    // the pre-416 rule offered a bar in NONE of them, because `between-blocks`
    // matched only the hairline BETWEEN top-level blocks. The gaps themselves
    // are the leg below, and they are unchanged.
    expect(before.every((r) => !r.cell.bar)).toBe(true);
    // …and the ladder answers every one of the 540.
    expect(rows.every((r) => r.cell.bar)).toBe(true);
    // The one payload that DID get something over a list pre-416 was a
    // `listItem`, through the R3 `resolveSubItemPeerBlock` resolver — which
    // this baseline cannot show, because 416 retires that resolver into the
    // ladder. Its behaviour is what INV3's `listItem` rows preserve.
    expect(
      rows.filter((r) => r.source === "listItem" && r.cell.verdict === "correct")
        .length,
    ).toBe(135);
  });

  it("the top-level GAPS are unchanged — the pre-416 rule's own world", () => {
    // Non-regression: the hairline between two top-level blocks answered
    // `between-blocks` before and answers it now, at the same boundary.
    for (const src of SOURCES) {
      const h = makeHarness(fixture(src.node()));
      const ul = h.layout.find("ul1");
      const gapY = ul.box.top - BLOCK_GAP / 2; // between pIntro and the list
      const key = keyFor(src.name, src.uuid);
      const now = hoverOnly(h, key, COL_LEFT + 300, gapY);
      const then = hoverOnly(h, key, COL_LEFT + 300, gapY, NO_BLOCK_PAYLOAD);
      expect(now?.kind).toBe("between-blocks");
      expect(then?.kind).toBe("between-blocks");
      expect(
        (now as Extract<Placement, { kind: "between-blocks" }>).insertPos,
      ).toBe((then as Extract<Placement, { kind: "between-blocks" }>).insertPos);
    }
  });

  it("INV1 — every bar that PAINTS is a drop the commit ACCEPTS (F3)", () => {
    // Excluding the SELF-DROP, which every between-blocks spec declares a no-op
    // ("no-op if the drop position is inside the source's own range"): releasing
    // a block back where it already sits is the user asking for nothing, not the
    // hover promising something the commit refuses. Its own leg is below.
    const lying = rows.filter(
      (r) => r.cell.bar && !r.cell.changed && !r.cell.selfDrop,
    );
    expect(
      lying.map((r) => `${r.source}@${r.target}:${r.frac}:${r.x}`),
    ).toEqual([]);
  });

  it("the SELF-DROP is the one no-op that still paints — and it is honest", () => {
    // Stated rather than implied: a bar over the source's own position paints
    // and changes nothing. Closing it would need the hit-test to know the
    // source's RANGE, which is a spec-level fact (`planDrop`'s own guard); it
    // is recorded here so the count in `## Findings` is not mistaken for F3.
    const selfies = rows.filter((r) => r.cell.selfDrop);
    expect(selfies.length).toBeGreaterThan(0);
    expect(selfies.every((r) => !r.cell.changed)).toBe(true);
  });

  it("INV2 — no cell duplicates or loses a uuid (task 320)", () => {
    const broken = rows.filter((r) => !r.cell.uuidsConserved);
    expect(
      broken.map((r) => `${r.source}@${r.target}:${r.frac}:${r.x}`),
    ).toEqual([]);
  });

  it("INV3 — over a list item, BOTH boundaries are reachable by Y (F1)", () => {
    // Pre-416 only a `listItem` payload could say "before": every other
    // payload's threshold was the block's TOP edge, so every geometry inside
    // the row meant "after".
    for (const src of SOURCES) {
      // `li1` / `li3` only: `li2` CONTAINS the nested list, so its box is three
      // rows tall while its own text row is the top one — every fraction of
      // that row sits above the item's midpoint, and "before" is the correct
      // answer for all of them. The two-boundary question is about a row that
      // IS its item.
      for (const target of ["li1", "li3"] as const) {
        const inRow = rows.filter(
          (r) =>
            r.source === src.name &&
            r.target === target &&
            r.x === COL_LEFT + 300 &&
            r.cell.bar &&
            // …and only where the level X chose IS the list, so the boundary
            // the row's Y governs is the ITEM's own. A `heading` cannot be a
            // list item at all, so its ladder answers at the list's OUTER
            // level, whose midpoint is the whole list's — an honest answer, and
            // not the question this leg asks.
            r.cell.containerType === "bulletList",
        );
        if (inRow.length === 0) continue;
        const positions = new Set(inRow.map((r) => r.cell.insertPos));
        expect(
          positions.size,
          `${src.name} over ${target} offered ${positions.size} boundary/ies`,
        ).toBeGreaterThan(1);
      }
    }
  });

  it("INV4 — X walks the level OUTWARD, and the bar's scope with it (F2)", () => {
    // At one row and one Y, a cursor further LEFT may only ever choose a
    // SHALLOWER container — never a deeper one.
    const depthOf = (path: string[] | null) => (path ? path.length : -1);
    for (const src of SOURCES) {
      for (const target of TARGET_ROWS) {
        const at = (x: number) =>
          rows.find(
            (r) =>
              r.source === src.name &&
              r.target === target &&
              r.frac === 0.5 &&
              r.x === x,
          )!;
        const [far, edge, deep] = X_POSITIONS.map((x) => depthOf(at(x).cell.landedIn));
        expect(
          far <= edge && edge <= deep,
          `${src.name} over ${target}: depths ${far}/${edge}/${deep} are not monotone in X`,
        ).toBe(true);
      }
    }
  });

  it("INV5 — a nested list row offers MORE than one level as X moves", () => {
    // The whole point of F2: over `li2a` (an item of the nested list inside
    // `li2` of the outer list) the ladder has four levels, and at least two of
    // them must be reachable by moving the cursor horizontally.
    const paths = new Set(
      rows
        .filter((r) => r.source === "paragraph" && r.target === "li2a" && r.frac === 0.5)
        .map((r) => JSON.stringify(r.cell.landedIn)),
    );
    expect(paths.size).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sequences — "practice sequences of moves, etc."
// ─────────────────────────────────────────────────────────────────────

/**
 * The `.tex` must be a FIXED POINT — nothing accumulates across saves.
 *
 * Measured from cycle 2, not cycle 1, because of a PRE-EXISTING asymmetry this
 * audit found and did not fix: the serializer appends a `bulletList`'s own
 * `%!v:<uuid>` anchor after `\end{itemize}` and `parseList` does not harvest it,
 * so a whole-list uuid does not survive one save/reload. That is task 348's
 * position law with a reader missing, it is entirely independent of the drop
 * gesture (a document nobody drags loses it too), and it is filed rather than
 * folded in here. What a MOVE must not do is accumulate, and that is what this
 * measures.
 */
function roundTripsClean(d: PMNode): boolean {
  const t1 = serializeBodyOnly(d.toJSON());
  const t2 = serializeBodyOnly(parseLatex(t1));
  const t3 = serializeBodyOnly(parseLatex(t2));
  return t2 === t3;
}

describe("sequences of moves", () => {
  function rowY(h: Harness, uuid: string, frac: number): number {
    const entry = h.layout.find(uuid);
    const box = entry.node.isTextblock
      ? entry.box
      : h.layout.rows.find(
          (r) =>
            r.box.top >= entry.box.top &&
            r.box.top < entry.box.top + entry.box.height,
        )!.box;
    return box.top + box.height * frac;
  }

  it("pull an item OUT to top level, then back IN — uuids conserved, bytes a fixed point", () => {
    const h = makeHarness(
      docOf(
        para("intro", "pIntro"),
        bullets("ul1", [item("one", "li1"), item("two", "li2"), item("three", "li3")]),
        para("outro", "pOutro"),
      ),
    );
    const key = keyFor("listItem", "li2");
    // OUT: release over the trailing paragraph, deep in the text.
    const out = drop(h, key, COL_LEFT + 300, rowY(h, "pOutro", 0.75), "li2");
    expect(out.verdict).toBe("correct");
    expect(pathOf(h.doc(), "li2")).toEqual(["bulletList", "listItem"]);
    // It left the original list, which now has two items.
    expect(h.doc().nodeAt(h.layout.find("ul1").pos)!.childCount).toBe(2);
    // BACK IN: release over item 1, upper half.
    const back = drop(h, key, COL_LEFT + 300, rowY(h, "li1", 0.25), "li2");
    expect(back.verdict).toBe("correct");
    expect(uuidsOf(h.doc()).filter((u) => u === "li2")).toHaveLength(1);
    expect(roundTripsClean(h.doc())).toBe(true);
  });

  it("move the SOLE item of a list out — the residue case", () => {
    const h = makeHarness(
      docOf(
        para("intro", "pIntro"),
        bullets("ul1", [item("only", "liOnly")]),
        para("outro", "pOutro"),
      ),
    );
    const cell = drop(
      h,
      keyFor("listItem", "liOnly"),
      COL_LEFT + 300,
      rowY(h, "pIntro", 0.25),
      "liOnly",
    );
    expect(cell.verdict).toBe("correct");
    expect(cell.uuidsConserved).toBe(true);
    expect(roundTripsClean(h.doc())).toBe(true);
  });

  it("reorder three items into reverse order, one move at a time", () => {
    const h = makeHarness(
      docOf(
        bullets("ul1", [item("one", "a"), item("two", "b"), item("three", "c")]),
        para("outro", "pOutro"),
      ),
    );
    const texts = () =>
      h
        .doc()
        .nodeAt(h.layout.find("ul1").pos)!
        .children.map((n: PMNode) => n.textContent);
    expect(texts()).toEqual(["one", "two", "three"]);
    // c above a, then b above a → three, two, one.
    expect(
      drop(h, keyFor("listItem", "c"), COL_LEFT + 300, rowY(h, "a", 0.25), "c")
        .verdict,
    ).toBe("correct");
    expect(
      drop(h, keyFor("listItem", "b"), COL_LEFT + 300, rowY(h, "a", 0.25), "b")
        .verdict,
    ).toBe("correct");
    expect(texts()).toEqual(["three", "two", "one"]);
    expect(uuidsOf(h.doc()).length).toBe(new Set(uuidsOf(h.doc())).size);
    expect(roundTripsClean(h.doc())).toBe(true);
  });

  it("move an item INTO a nested list and back OUT", () => {
    const h = makeHarness(
      docOf(
        bullets("ul1", [
          item("one", "li1"),
          item("two", "li2", [
            bullets("ul2", [item("alpha", "li2a"), item("beta", "li2b")]),
          ]),
          item("three", "li3"),
        ]),
        para("outro", "pOutro"),
      ),
    );
    const key = keyFor("listItem", "li3");
    // Deep X over the nested item → the nested list.
    const inn = drop(h, key, COL_LEFT + 300, rowY(h, "li2a", 0.75), "li3");
    expect(inn.verdict).toBe("correct");
    expect(pathOf(h.doc(), "li3")).toEqual([
      "bulletList",
      "listItem",
      "bulletList",
      "listItem",
    ]);
    // Back out: over item 1, at the OUTER list's indent.
    const out = drop(h, key, COL_LEFT + INDENT + 2, rowY(h, "li1", 0.25), "li3");
    expect(out.verdict).toBe("correct");
    expect(pathOf(h.doc(), "li3")).toEqual(["bulletList", "listItem"]);
    expect(uuidsOf(h.doc()).length).toBe(new Set(uuidsOf(h.doc())).size);
    expect(roundTripsClean(h.doc())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cost — the ladder is O(depth), never O(doc)
// ─────────────────────────────────────────────────────────────────────

describe("the ladder's per-FRAME cost", () => {
  it("one rect read per ancestor LEVEL, and the count does not grow with the DOCUMENT", () => {
    // The pre-416 hit-test read ONE rect (the resolved block's). The ladder
    // reads one per level so it can place a bar at each and read its indent —
    // bounded by the document's DEPTH, which is ~4 in a nested list and does not
    // move when the paper gets longer. That is the whole increase, and it runs
    // on the frame-coalesced pass, never per raw pointer event.
    const count = (extraParagraphs: number) => {
      const filler: PMNode[] = [];
      for (let i = 0; i < extraParagraphs; i++) {
        filler.push(para(`filler ${i}`, `f${i}`));
      }
      const h = makeHarness(
        docOf(
          ...filler,
          bullets("ul1", [
            item("one", "li1"),
            item("two", "li2", [
              bullets("ul2", [item("alpha", "li2a"), item("beta", "li2b")]),
            ]),
          ]),
          para("outro", "pOutro"),
          para("moved", "SRC"),
        ),
      );
      const target = h.layout.find("li2a");
      let reads = 0;
      for (const entry of h.layout.byPos.values()) {
        const real = entry.el.getBoundingClientRect.bind(entry.el);
        entry.el.getBoundingClientRect = () => {
          reads += 1;
          return real();
        };
      }
      hoverOnly(
        h,
        keyFor("paragraph", "SRC"),
        COL_LEFT + 300,
        target.box.top + target.box.height / 2,
      );
      return reads;
    };
    const small = count(1);
    const large = count(80);
    expect(small).toBe(large);
    // doc > bulletList > listItem > bulletList > listItem — five levels, of
    // which the ladder places a bar at four (the floor is the inner item).
    expect(small).toBeLessThanOrEqual(6);
  });

  it("the ladder walks no DOCUMENT — its cost is the ancestor chain alone", () => {
    // A `descendants` walk here would be the keystroke-sanctity class one
    // gesture over: the pass runs once per frame for the whole drag.
    const h = makeHarness(fixture(para("moved", "SRC")));
    const doc = h.doc();
    let walks = 0;
    // Count on the PROTOTYPE, so any node the ladder reaches is seen.
    const proto = Object.getPrototypeOf(doc) as {
      descendants: PMNode["descendants"];
    };
    const realProto = proto.descendants;
    proto.descendants = function (
      this: PMNode,
      ...args: Parameters<PMNode["descendants"]>
    ) {
      walks += 1;
      return realProto.apply(this, args);
    };
    try {
      const li2a = h.layout.find("li2a");
      hoverOnly(
        h,
        keyFor("paragraph", "SRC"),
        COL_LEFT + 300,
        li2a.box.top + li2a.box.height / 2,
      );
    } finally {
      proto.descendants = realProto;
    }
    expect(walks).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// The layout model itself
// ─────────────────────────────────────────────────────────────────────

describe("the layout model", () => {
  it("rows, tops and the marker band", () => {
    const h = makeHarness(
      docOf(
        para("intro", "p0"),
        bullets("ul1", [item("one", "li1"), item("two", "li2")]),
        para("outro", "pEnd"),
      ),
    );
    expect(h.layout.rows.map((r) => r.node.textContent)).toEqual([
      "intro",
      "one",
      "two",
      "outro",
    ]);
    expect(h.layout.rows.map((r) => r.box.top)).toEqual([0, 30, 50, 80]);
    expect(h.layout.find("li1").box.left).toBe(COL_LEFT + INDENT);
    expect(h.layout.find("ul1").box.left).toBe(COL_LEFT);
  });
});
