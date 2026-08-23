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

/** The corpus member whose geometry task 412 accepted and pinned. */
const ROOF_CROSSER =
  "an outer edge clipping a roofed middle sibling (accepted + pinned, task 412)";

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
  // Task 412 — the ONE corpus shape whose outer edge clips a roofed sibling's
  // triangle. Both halves are load-bearing and neither is obvious: the roof has
  // to be a roofed LEAF (a roofed INTERNAL node is flattened into a roofed
  // ONLY-child one row down, so it can never be a middle sibling), and the left
  // label has to be wide enough (~46 chars under this suite's metric) to swing
  // the parent's centre past the triangle. Pinned, not fixed — see
  // "edges vs roofs" below and the roof-building comment in `layout.ts`.
  {
    name: ROOF_CROSSER,
    body: "[S [{a label long enough to push the left sibling out past five gaps}] [{x},roof] [z]]",
  },
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

/**
 * Task 412 — edges and roofs are built from the placed boxes in two loops that
 * do not know about each other, so an outer sibling's edge CAN clip a roofed
 * sibling's triangle. Gabriel's ruling (2026-08-21) was ACCEPT, not route — so
 * these legs exist to make the acceptance explicit and the geometry immovable.
 *
 * The sweep is an EXACT SET, not a floor: every corpus shape is asked, and the
 * one that crosses is the one that DECLARES it. A future layout change that
 * introduces a crossing anywhere else fails here rather than shipping quietly.
 *
 * Beware the obvious fixture. The memo that filed this proposed a roofed
 * INTERNAL middle child, which produces NO roof on the sibling row at all
 * (`flattenRoofs` gives such a node a synthesized roofed ONLY-child one row
 * down) and therefore no crossing — a worker following it would have measured a
 * false all-clear. That shape is a passing control below.
 */

/** The vertices of a roof triangle, apex first. */
function triangleOf(r: { apexX: number; apexY: number; leftX: number; rightX: number; baseY: number }) {
  return [
    { x: r.apexX, y: r.apexY },
    { x: r.rightX, y: r.baseY },
    { x: r.leftX, y: r.baseY },
  ];
}

/**
 * The length of the part of segment `e` that lies strictly INSIDE the triangle,
 * in px — 0 when it misses or merely touches.
 *
 * Exact convex clipping (each triangle side is a half-plane; the interior is
 * their intersection), deliberately NOT point sampling: a sampled probe reports
 * a grazing clip as a miss, or a real one as a hairline, purely from where its
 * samples happened to land. A pin decided by sampling density is not a pin.
 */
function chordInsideTriangle(
  e: { x1: number; y1: number; x2: number; y2: number },
  tri: { x: number; y: number }[],
): number {
  const dx = e.x2 - e.x1;
  const dy = e.y2 - e.y1;
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    const c = tri[(i + 2) % 3];
    // Normal to a→b, flipped so that "inside" (the side c is on) is n·(p−a) < 0.
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    if (nx * (c.x - a.x) + ny * (c.y - a.y) > 0) {
      nx = -nx;
      ny = -ny;
    }
    const num = nx * (e.x1 - a.x) + ny * (e.y1 - a.y);
    const den = nx * dx + ny * dy;
    if (Math.abs(den) < 1e-12) {
      if (num >= 0) return 0; // parallel and outside
      continue;
    }
    const t = -num / den;
    if (den > 0) t1 = Math.min(t1, t);
    else t0 = Math.max(t0, t);
    if (t0 >= t1) return 0;
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}

/** Every (edge, roof) pair of a layout whose edge passes through the roof. */
function edgeRoofCrossings(layout: ReturnType<typeof computeForestLayout>) {
  const out: { edge: number; roof: number; chord: number }[] = [];
  layout.roofs.forEach((r, ri) => {
    const tri = triangleOf(r);
    layout.edges.forEach((e, ei) => {
      const chord = chordInsideTriangle(e, tri);
      if (chord > 1e-9) out.push({ edge: ei, roof: ri, chord });
    });
  });
  return out;
}

describe("edges vs roofs — an ACCEPTED and PINNED crossing (task 412)", () => {
  it("across the whole corpus, exactly the DECLARED shape crosses a roof", () => {
    const crossing = CORPUS.filter(
      (c) => edgeRoofCrossings(layoutOf(c.body).layout).length > 0,
    ).map((c) => c.name);
    expect(crossing).toEqual([ROOF_CROSSER]);
  });

  it("the declared shape really does put a roof on the SIBLING row", () => {
    // The half the memo's fixture failed. Without this the crossing leg below
    // could pass for a reason unrelated to the shape it claims to describe.
    const body = CORPUS.find((c) => c.name === ROOF_CROSSER)!.body;
    const { t, layout } = layoutOf(body);
    const flat = flattenForestTree(t);
    const middle = t.children[1];
    const idx = flat.indexOf(middle);
    expect(t.children).toHaveLength(3);
    expect(layout.nodes[idx].roofed).toBe(true);
    expect(layout.roofs).toHaveLength(1);
    expect(layout.roofs[0].baseY).toBeCloseTo(layout.nodes[idx].y, 6);
    // …and it is a MIDDLE child, which is what makes an outer edge pass it.
    expect(flat.indexOf(t.children[0])).toBeLessThan(idx);
    expect(flat.indexOf(t.children[2])).toBeGreaterThan(idx);
  });

  it("pins the crossing geometry, so a layout change renegotiates it on purpose", () => {
    const body = CORPUS.find((c) => c.name === ROOF_CROSSER)!.body;
    const { layout } = layoutOf(body);
    const hits = edgeRoofCrossings(layout);
    expect(hits).toHaveLength(1);

    // The last child's edge, clipping the right flank of the middle roof.
    const edge = layout.edges[hits[0].edge];
    const roof = layout.roofs[hits[0].roof];
    expect(edge).toEqual({ x1: 374, y1: 18, x2: 521.5, y2: 57 });
    expect(roof).toEqual({
      apexX: 482.5,
      apexY: 44,
      leftX: 473,
      rightX: 492,
      baseY: 57,
    });
    expect(hits[0].chord).toBeCloseTo(4.2214, 4);
  });

  it("a short left sibling does NOT cross — the crossing needs the extreme shape", () => {
    // The control that keeps the sweep from passing vacuously: same tree,
    // same roofed middle leaf, a label too narrow to swing the parent past it.
    const { layout } = layoutOf("[S [{ab}] [{x},roof] [z]]");
    expect(layout.roofs).toHaveLength(1);
    expect(edgeRoofCrossings(layout)).toEqual([]);
  });

  it("a roofed INTERNAL middle child cannot cross — it puts no roof on that row", () => {
    // The memo's own proposed fixture, kept as a passing control so the false
    // all-clear it produces can never be mistaken for coverage again.
    const { t, layout } = layoutOf("[S [A] [NP,roof [Det [the]] [N [dog]]] [z]]");
    const flat = flattenForestTree(t);
    const middle = t.children[1];
    expect(layout.nodes[flat.indexOf(middle)].roofed).toBe(false);
    expect(middle.children).toHaveLength(1); // the synthesized roofed only-child
    expect(layout.nodes[flat.indexOf(middle.children[0])].roofed).toBe(true);
    expect(edgeRoofCrossings(layout)).toEqual([]);
  });

  it("an edge never enters its OWN child's roof — it terminates at the apex", () => {
    // A property, not a fixture fact: the triangle's interior lies strictly
    // BELOW the apex, and a roofed child's edge stops there.
    for (const c of CORPUS) {
      const { t, layout } = layoutOf(c.body);
      const flat = flattenForestTree(t);
      const indexOf = new Map(flat.map((n, i) => [n, i]));
      const roofByNode = new Map(
        layout.roofs.map((r) => [Math.round(r.apexX * 1e6) + ":" + Math.round(r.baseY * 1e6), r]),
      );
      let ei = 0;
      const walk = (node: ForestRenderNode) => {
        for (const kid of node.children) {
          const k = layout.nodes[indexOf.get(kid)!];
          const edge = layout.edges[ei++];
          if (k.roofed) {
            const r = roofByNode.get(
              Math.round((k.x + k.width / 2) * 1e6) + ":" + Math.round(k.y * 1e6),
            )!;
            expect(
              chordInsideTriangle(edge, triangleOf(r)),
              `${c.name}: an edge entered its own child's roof`,
            ).toBe(0);
          }
          walk(kid);
        }
      };
      walk(t);
    }
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
