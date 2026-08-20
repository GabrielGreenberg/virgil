/**
 * Task 384 — the tidy-tree LAYOUT engine, asserted as PROPERTIES over generated
 * trees rather than as hand-pinned pixels.
 *
 * The reason is the same one the marginalia grid packer's suite gives: a pinned
 * pixel tells you the numbers did not change, which is a fact about the last
 * commit, not about the drawing. What a reader of a tree needs is that no two
 * labels ever collide, that a parent sits over its children, and that a roof
 * covers the span it claims — and those are true of EVERY tree or of none, so
 * they are swept over a generated corpus that includes the shapes a
 * hand-written fixture never reaches (a wide subtree beside a deep one, a
 * single-child chain, a very long label under a very short parent).
 */
import { describe, it, expect } from "vitest";
import {
  computeForestLayout,
  flattenForestTree,
  DEFAULT_FOREST_LAYOUT,
  type ForestNodeSize,
} from "@/lib/forest/layout";
import { parseForestSource, type ForestRenderNode } from "@/lib/forest/grammar";

function tree(body: string): ForestRenderNode {
  const parse = parseForestSource(`\\begin{forest}\n${body}\n\\end{forest}`);
  if (!parse.ok) throw new Error(`fixture refused: ${parse.refusal.message}`);
  return parse.tree;
}

/** Deterministic per-label sizes — the view measures, the engine is handed the
 *  numbers, so a suite that generates them exercises exactly what ships. */
function sizes(root: ForestRenderNode, widthOf = (n: ForestRenderNode) => 12 + n.labelText.length * 7): ForestNodeSize[] {
  return flattenForestTree(root).map((n) => ({ width: widthOf(n), height: 18 }));
}

function layoutOf(body: string, widthOf?: (n: ForestRenderNode) => number) {
  const t = tree(body);
  return { t, layout: computeForestLayout(t, sizes(t, widthOf)) };
}

const CORPUS: { name: string; body: string }[] = [
  { name: "the standard syntax tree", body: "[S [NP [Det [the]] [N [dog]]] [VP [V [barks]]]]" },
  { name: "a single node", body: "[S]" },
  { name: "a single-child chain", body: "[A [B [C [D [E]]]]]" },
  { name: "a wide fan", body: "[S [a] [b] [c] [d] [e] [f]]" },
  { name: "a deep subtree beside a shallow one", body: "[S [A [B [C [D]]]] [Z]]" },
  { name: "a shallow subtree beside a deep one", body: "[S [Z] [A [B [C [D]]]]]" },
  { name: "two deep subtrees that must tuck", body: "[S [A [B] [C]] [D [E] [F]]]" },
  { name: "a very long label over short children", body: "[{a considerably longer label} [x] [y]]" },
  { name: "short parents over a long leaf", body: "[S [NP [{an extremely long terminal string here}]]]" },
  { name: "a roofed phrase", body: "[S [NP,roof [Det [the]] [N [dog]]] [VP [{barks}]]]" },
  { name: "a roofed leaf", body: "[S [{the dog},roof] [VP]]" },
  { name: "math labels", body: "[$\\alpha$ [$\\beta$] [$\\gamma$]]" },
];

function boxes(layout: ReturnType<typeof computeForestLayout>) {
  return layout.nodes;
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("layout properties", () => {
  for (const c of CORPUS) {
    it(`${c.name}: no two labels overlap`, () => {
      const { layout } = layoutOf(c.body);
      const bs = boxes(layout);
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          expect(
            overlaps(bs[i], bs[j]),
            `labels ${i} and ${j} overlap in ${c.name}`,
          ).toBe(false);
        }
      }
    });

    it(`${c.name}: a parent is centered over its children's span`, () => {
      const { t, layout } = layoutOf(c.body);
      const flat = flattenForestTree(t);
      const indexOf = new Map(flat.map((n, i) => [n, i]));
      for (const node of flat) {
        if (node.children.length === 0) continue;
        const me = layout.nodes[indexOf.get(node)!];
        const kids = node.children.map((k) => layout.nodes[indexOf.get(k)!]);
        const first = kids[0];
        const last = kids[kids.length - 1];
        const span =
          (first.x + first.width / 2 + (last.x + last.width / 2)) / 2;
        expect(me.x + me.width / 2).toBeCloseTo(span, 6);
      }
    });

    it(`${c.name}: every node sits inside the reported box`, () => {
      const { layout } = layoutOf(c.body);
      for (const n of layout.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(-1e-9);
        expect(n.x + n.width).toBeLessThanOrEqual(layout.width + 1e-9);
        expect(n.y + n.height).toBeLessThanOrEqual(layout.height + 1e-9);
      }
    });

    it(`${c.name}: children sit on the row below their parent`, () => {
      const { t, layout } = layoutOf(c.body);
      const flat = flattenForestTree(t);
      const indexOf = new Map(flat.map((n, i) => [n, i]));
      for (const node of flat) {
        const me = layout.nodes[indexOf.get(node)!];
        for (const kid of node.children) {
          const k = layout.nodes[indexOf.get(kid)!];
          expect(k.y).toBeGreaterThan(me.y + me.height);
        }
      }
    });

    it(`${c.name}: siblings keep at least the configured gap`, () => {
      const { t, layout } = layoutOf(c.body);
      const flat = flattenForestTree(t);
      const indexOf = new Map(flat.map((n, i) => [n, i]));
      for (const node of flat) {
        for (let i = 1; i < node.children.length; i++) {
          const l = layout.nodes[indexOf.get(node.children[i - 1])!];
          const r = layout.nodes[indexOf.get(node.children[i])!];
          expect(r.x - (l.x + l.width)).toBeGreaterThanOrEqual(
            DEFAULT_FOREST_LAYOUT.hGap - 1e-9,
          );
        }
      }
    });
  }
});

describe("edges", () => {
  it("draws one edge per parent→child link, parent bottom to child top", () => {
    const { t, layout } = layoutOf("[S [NP [x]] [VP]]");
    const flat = flattenForestTree(t);
    const links = flat.reduce((n, node) => n + node.children.length, 0);
    expect(layout.edges).toHaveLength(links);
    for (const e of layout.edges) expect(e.y2).toBeGreaterThan(e.y1);
  });

  it("terminates a roofed child's edge at the triangle APEX, not the label", () => {
    const { layout } = layoutOf("[NP [{the dog},roof]]");
    expect(layout.roofs).toHaveLength(1);
    const roof = layout.roofs[0];
    const edge = layout.edges[0];
    expect(edge.x2).toBeCloseTo(roof.apexX, 6);
    expect(edge.y2).toBeCloseTo(roof.apexY, 6);
  });
});

describe("roofs", () => {
  it("spans exactly the box it covers", () => {
    const { t, layout } = layoutOf("[NP,roof [Det [the]] [N [dog]]]");
    const flat = flattenForestTree(t);
    const baseIndex = flat.findIndex((n) => n.roofed);
    const base = layout.nodes[baseIndex];
    const roof = layout.roofs[0];
    expect(roof.leftX).toBeCloseTo(base.x, 6);
    expect(roof.rightX).toBeCloseTo(base.x + base.width, 6);
    expect(roof.baseY).toBeCloseTo(base.y, 6);
    expect(roof.apexX).toBeCloseTo(base.x + base.width / 2, 6);
    expect(roof.baseY - roof.apexY).toBeCloseTo(DEFAULT_FOREST_LAYOUT.roofHeight, 6);
  });

  it("reserves room ABOVE the roofed row so the triangle never reaches the row above", () => {
    const { t, layout } = layoutOf("[NP,roof [Det [the]] [N [dog]]]");
    const flat = flattenForestTree(t);
    const parent = layout.nodes[0];
    const roof = layout.roofs[0];
    expect(roof.apexY).toBeGreaterThanOrEqual(parent.y + parent.height);
    void flat;
  });

  it("a roofed ROOT still fits inside the box (the apex is not clipped)", () => {
    const { layout } = layoutOf("[{the dog},roof]");
    expect(layout.roofs[0].apexY).toBeGreaterThanOrEqual(0);
  });
});

describe("purity", () => {
  it("same tree + same sizes ⇒ identical output", () => {
    const t = tree("[S [NP [Det [the]] [N [dog]]] [VP [V [barks]]]]");
    const s = sizes(t);
    expect(computeForestLayout(t, s)).toEqual(computeForestLayout(t, s));
  });

  it("survives a size array shorter than the tree (a measure that lost a ref)", () => {
    const t = tree("[S [NP] [VP]]");
    expect(() => computeForestLayout(t, [])).not.toThrow();
  });
});
