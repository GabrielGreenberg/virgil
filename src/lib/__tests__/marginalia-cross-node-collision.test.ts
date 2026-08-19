/**
 * Task 366 — the marker grid resolves collisions ACROSS anchor nodes, not just
 * within one.
 *
 * Pre-366 `computeMarkerPositions` placed each node's grid independently at
 * that node's own `top`. That is safe only while consecutive block tops sit
 * further apart than an icon is tall; a title/author/date stack, a run of short
 * headings or any small-print block breaks it, and the two grids simply print
 * on top of each other (Gabriel's screenshot, 2026-08-18).
 *
 * WHY NO PRE-366 SUITE COULD SEE THIS: every marginalia fixture in the repo
 * drives ONE node ("p1"). Two nodes' grids disagreeing is unrepresentable in
 * all of them, which is how the hole shipped with the grid suites green. Every
 * fixture here is therefore MULTI-node, and the invariant legs are asserted as
 * a sweep over the placed cells rather than against hand-computed pixels, so a
 * future change to the packing rule is judged on the property, not the number.
 */
import { describe, it, expect } from "vitest";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import {
  MARGINALIA_ICON_SIZE,
  MARGINALIA_MAX_MARKER_DRIFT,
  MARGINALIA_ROW_MIN_GAP,
  marginaliaEffectiveCols,
  type AnchorNodeMetrics,
  type MarginaliaMarker,
  type MarkerOverflowGroup,
  type PositionedMarker,
} from "@/lib/marginalia";

const BOTH_FIT = {
  left: marginaliaEffectiveCols("left"),
  right: marginaliaEffectiveCols("right"),
} as const;

/** A block: `id` at `top`, `lines` lines of `lh` pitch. */
function block(
  id: string,
  top: number,
  lh: number,
  lines = 1,
  domTop = top,
): AnchorNodeMetrics {
  return {
    id,
    top,
    domTop,
    height: lines * lh,
    lineHeight: lh,
    lineCount: lines,
    isAtom: false,
  };
}

function marker(
  id: string,
  textObjectId: string,
  side: "left" | "right" = "right",
): MarginaliaMarker {
  return {
    id: `${id}:${textObjectId}`,
    entityId: id,
    entityKind: "note",
    type: "note",
    textObjectId,
    side,
  };
}

function lookup(nodes: AnchorNodeMetrics[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (uuid: string) => byId.get(uuid) ?? null;
}

/** Every rendered box on `side`: the placed cells AND the "+K" pills, which
 *  occupy an icon-sized cell of their own and must clear the grid too. */
function boxes(
  positioned: PositionedMarker[],
  overflowGroups: MarkerOverflowGroup[],
  side: "left" | "right",
): Array<{ x: number; y: number; label: string }> {
  return [
    ...positioned
      .filter((p) => p.side === side)
      .map((p) => ({ x: p.cell.x, y: p.cell.y, label: p.entityId })),
    ...overflowGroups
      .filter((g) => g.side === side)
      .map((g) => ({ x: g.cell.x, y: g.cell.y, label: `pill:${g.textObjectId}` })),
  ];
}

/** Pairwise overlaps among icon-sized boxes (both axes must overlap). */
function overlaps(
  bs: Array<{ x: number; y: number; label: string }>,
): string[] {
  const hits: string[] = [];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      const xHit =
        a.x < b.x + MARGINALIA_ICON_SIZE && b.x < a.x + MARGINALIA_ICON_SIZE;
      const yHit =
        a.y < b.y + MARGINALIA_ICON_SIZE && b.y < a.y + MARGINALIA_ICON_SIZE;
      if (xHit && yHit) hits.push(`${a.label} ⨯ ${b.label}`);
    }
  }
  return hits;
}

/** Every input marker comes back exactly once — placed or hidden. Nothing the
 *  collision pass moves may be dropped on the way. */
function conservation(
  markers: MarginaliaMarker[],
  positioned: PositionedMarker[],
  overflowGroups: MarkerOverflowGroup[],
): string[] {
  return [
    ...positioned.map((p) => p.id),
    ...overflowGroups.flatMap((g) => g.hidden.map((m) => m.id)),
  ].sort();
}

// ── The reported defect ─────────────────────────────────────────────────────

describe("cross-node collision — the crowded document top", () => {
  // A real title/author/date stack: three short adjacent blocks whose tops sit
  // 18px apart while the icon is 22px tall, each carrying markers.
  const TITLE_STACK = [
    block("title", 0, 18),
    block("author", 18, 18),
    block("date", 36, 18),
  ];

  it("three short adjacent blocks pack with ZERO pairwise overlaps", () => {
    const markers = [
      marker("m-title", "title"),
      marker("m-author", "author"),
      marker("m-date", "date"),
    ];
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(TITLE_STACK),
      markers,
      {},
      BOTH_FIT,
    );

    expect(positioned).toHaveLength(3);
    expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);
  });

  // A BOUNDS PIN, not a defect leg, and it says so: the pre-366 grid places
  // these three at their anchors, so drift 0 satisfies it too. Its teeth are in
  // the fold section below, where the same bound is asserted with reachability.
  it("…and each pushed marker stays within the stated drift bound of its own line", () => {
    const markers = [
      marker("m-title", "title"),
      marker("m-author", "author"),
      marker("m-date", "date"),
    ];
    const { positioned } = computeMarkerPositions(
      lookup(TITLE_STACK),
      markers,
      {},
      BOTH_FIT,
    );

    const byNode = new Map(TITLE_STACK.map((n) => [n.id, n]));
    for (const p of positioned) {
      const n = byNode.get(p.textObjectId)!;
      const anchored = n.top + (n.lineHeight - MARGINALIA_ICON_SIZE) / 2;
      const drift = p.cell.y - anchored;
      // Never ABOVE its line, and never past the bound below it.
      expect(drift).toBeGreaterThanOrEqual(0);
      expect(drift).toBeLessThanOrEqual(MARGINALIA_MAX_MARKER_DRIFT);
    }
  });

  it("the two sides pack independently — a left marker never pushes a right one", () => {
    const markers = [
      marker("m-title-L", "title", "left"),
      marker("m-author-L", "author", "left"),
      marker("m-date-L", "date", "left"),
      marker("m-title-R", "title", "right"),
    ];
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(TITLE_STACK),
      markers,
      {},
      BOTH_FIT,
    );

    expect(overlaps(boxes(positioned, overflowGroups, "left"))).toEqual([]);
    expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);
    // The right side has one marker on the FIRST block, so nothing above it:
    // it stays exactly on its own line however crowded the left lane is.
    const right = positioned.find((p) => p.entityId === "m-title-R")!;
    expect(right.cell.y).toBe(0 + (18 - MARGINALIA_ICON_SIZE) / 2);
  });
});

// ── The property that must not move ─────────────────────────────────────────

describe("the uncrowded corpus is untouched", () => {
  it("well-separated blocks keep their anchored positions exactly", () => {
    const nodes = [
      block("p1", 100, 24, 2),
      block("p2", 200, 24, 1),
      block("p3", 260, 28, 1),
    ];
    const markers = [
      marker("a", "p1"),
      marker("b", "p2"),
      marker("c", "p3"),
    ];
    const { positioned } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      BOTH_FIT,
    );
    const y = (id: string) => positioned.find((p) => p.entityId === id)!.cell.y;
    expect(y("a")).toBe(100 + (24 - MARGINALIA_ICON_SIZE) / 2);
    expect(y("b")).toBe(200 + (24 - MARGINALIA_ICON_SIZE) / 2);
    expect(y("c")).toBe(260 + (28 - MARGINALIA_ICON_SIZE) / 2);
  });

  it("the canonical 24px line's own row rhythm is NOT re-spaced (a 3-row grid keeps its line pitch)", () => {
    // 24px line − 22px icon = the min gap exactly, so the walk must not fire:
    // this is the boundary the byte-identity claim rests on.
    const nodes = [block("p1", 0, 24, 3)];
    const markers = [marker("a", "p1"), marker("b", "p1"), marker("c", "p1")];
    const { positioned } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    expect(positioned.map((p) => p.cell.y)).toEqual([1, 25, 49]);
    expect(24 - MARGINALIA_ICON_SIZE).toBe(MARGINALIA_ROW_MIN_GAP);
  });
});

// ── Uniformity: the walk does not care whose rows collide ───────────────────

describe("the walk is uniform over intra- and inter-node rows", () => {
  it("a node whose own line pitch is tighter than an icon stops self-overlapping", () => {
    const nodes = [block("p1", 0, 18, 3)];
    const markers = [marker("a", "p1"), marker("b", "p1"), marker("c", "p1")];
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);
  });

  it("a roomy node re-settles onto its own lines after a push (displacement is not carried down)", () => {
    // p0 pushes p1's first row down; p1's lines are roomy (40px), so its
    // second row must land back on its anchored line rather than inherit the
    // offset.
    const nodes = [block("p0", 0, 18), block("p1", 10, 40, 2)];
    const markers = [marker("a", "p0"), marker("b", "p1"), marker("c", "p1")];
    const { positioned } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    // The premise: p1's FIRST row really was pushed (its anchored y is 9, the
    // frontier puts it at 22). Without this the leg would pass on an
    // implementation that never pushes at all.
    const b = positioned.find((p) => p.entityId === "b")!;
    expect(b.cell.y).toBeGreaterThan(10 + (40 - MARGINALIA_ICON_SIZE) / 2);
    const c = positioned.find((p) => p.entityId === "c")!;
    expect(c.cell.y).toBe(10 + 40 + (40 - MARGINALIA_ICON_SIZE) / 2);
  });
});

// ── The fold ────────────────────────────────────────────────────────────────

describe("past the drift bound the crowd folds into ONE '+K' pill", () => {
  /** N one-line blocks at a 14px pitch — a crowd no packing can spread. */
  function crowdOf(n: number) {
    const nodes = Array.from({ length: n }, (_, i) =>
      block(`b${i}`, i * 14, 14),
    );
    const markers = nodes.map((nd) => marker(`m${nd.id}`, nd.id));
    return { nodes, markers };
  }

  it("a deep crowd never places a cell past the bound, and never overlaps", () => {
    const { nodes, markers } = crowdOf(30);
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );

    expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);
    const byNode = new Map(nodes.map((n) => [n.id, n]));
    for (const p of positioned) {
      const n = byNode.get(p.textObjectId)!;
      const anchored = n.top + (n.lineHeight - MARGINALIA_ICON_SIZE) / 2;
      expect(p.cell.y - anchored).toBeLessThanOrEqual(
        MARGINALIA_MAX_MARKER_DRIFT,
      );
    }
    // The bound is reachable: some markers really did fold.
    expect(overflowGroups.length).toBeGreaterThan(0);
    expect(positioned.length).toBeLessThan(markers.length);
  });

  it("the fold COLLAPSES the crowd rather than laddering it (few pills, not one per node)", () => {
    const { nodes, markers } = crowdOf(30);
    const { overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    // Consecutive folded nodes share a pill; a new one opens only when the
    // crowd has run further than the bound from the open pill's own anchor.
    // Either way it is a small fraction of the 30 nodes, never one each — and
    // never ZERO, or the leg would pass on an implementation that folds nothing.
    expect(overflowGroups.length).toBeGreaterThan(0);
    expect(overflowGroups.length).toBeLessThan(nodes.length / 3);
    for (const g of overflowGroups) {
      expect(g.hidden.length).toBeGreaterThan(0);
    }
  });

  it("no marker is lost to the fold — every input comes back placed or hidden, once", () => {
    const { nodes, markers } = crowdOf(30);
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    expect(conservation(markers, positioned, overflowGroups)).toEqual(
      markers.map((m) => m.id).sort(),
    );
  });

  it("a folded marker keeps its identity, so the pill's popover still resolves its card", () => {
    // The click path is by (entityKind, entityId) — never by Y — so what the
    // fold must preserve is identity, not position.
    const { nodes, markers } = crowdOf(30);
    const { overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    const hidden = overflowGroups.flatMap((g) => g.hidden);
    expect(hidden.length).toBeGreaterThan(0);
    for (const h of hidden) {
      const src = markers.find((m) => m.id === h.id)!;
      expect(h.entityId).toBe(src.entityId);
      expect(h.entityKind).toBe(src.entityKind);
      expect(h.type).toBe(src.type);
    }
  });

  it("an R16 pill and a folded-crowd pill coexist on one side, with distinct React keys", () => {
    const { nodes, markers } = crowdOf(30);
    // Give the FIRST block an over-full grid of its own (3 markers into a
    // 1-cell grid) so the side carries both pill producers at once. b0 is
    // first, where the frontier is -Infinity, so it can never fold — its pill
    // is an R16 pill by construction.
    markers.unshift(marker("extra1", "b0"), marker("extra2", "b0"));
    const { overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );

    // Both producers really are present — the point of the fixture, and the
    // half the key assertion alone cannot see (key uniqueness is structural:
    // pass 1 keys groups by (textObjectId, side) and a folded group emits no
    // R16 pill, so it holds on every implementation, pre-366 included).
    // capacity 1 → visibleCount 0: the single cell IS the pill, all three hide.
    const r16 = overflowGroups.find((g) => g.textObjectId === "b0");
    expect(r16?.hidden.map((m) => m.entityId)).toEqual([
      "extra1",
      "extra2",
      "mb0",
    ]);
    expect(overflowGroups.length).toBeGreaterThan(1);

    const keys = overflowGroups.map((g) => `${g.side}:${g.textObjectId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a pill never collects markers whose anchors span more than the drift bound", () => {
    // The crowd-RESTART rule: an open pill stops accepting nodes once the crowd
    // has run further than the bound from the anchor the pill was minted for,
    // so a pill can never stand in for markers scattered down the page.
    //
    // Reaching it needs a TALL grid at a tight pitch to shove the frontier far
    // below its own block, then short blocks underneath that fold while sliding
    // past the open pill's anchor — which `crowdOf` (one line per node) cannot
    // produce, since there the frontier only ever runs ~50px ahead.
    const nodes = [
      block("a-tall", 0, 10, 6),
      ...Array.from({ length: 7 }, (_, i) => block(`b${i}`, 60 + i * 10, 10)),
    ];
    const markers = [
      ...Array.from({ length: 6 }, (_, i) => marker(`t${i}`, "a-tall")),
      ...Array.from({ length: 7 }, (_, i) => marker(`m${i}`, `b${i}`)),
    ];
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );

    expect(overflowGroups.length).toBeGreaterThan(1); // the restart fired
    expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);

    const anchorOf = new Map(
      nodes.map((n) => [n.id, n.top + (n.lineHeight - MARGINALIA_ICON_SIZE) / 2]),
    );
    for (const g of overflowGroups) {
      const tops = g.hidden.map((m) => anchorOf.get(m.textObjectId)!);
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(
        MARGINALIA_MAX_MARKER_DRIFT,
      );
    }
  });
});

// ── Stated limit (a passing leg that documents the bound's scope) ───────────

describe("the drift bound is measured at a grid's FIRST row", () => {
  it("a tall node with a tight line pitch walks its own lower rows past the bound, and does NOT fold", () => {
    // 8 lines at a 14px pitch, one marker per line: rows re-settle against the
    // frontier one at a time, so the last one ends up 60px below its own line
    // — past MARGINALIA_MAX_MARKER_DRIFT (44). Deliberate: it is still beside
    // its OWN block, which is what the bound protects, and folding a whole
    // multi-line node because its last row drifted would hide markers the
    // reader can see perfectly well. This leg documents the limit; it is not a
    // defect leg, and it says so.
    const nodes = [block("p1", 0, 14, 8)];
    const markers = Array.from({ length: 8 }, (_, i) => marker(`m${i}`, "p1"));
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );

    expect(overflowGroups).toEqual([]); // nothing folded
    expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);
    const last = positioned[positioned.length - 1];
    const itsLine = 7 * 14 + (14 - MARGINALIA_ICON_SIZE) / 2;
    expect(last.cell.y - itsLine).toBeGreaterThan(MARGINALIA_MAX_MARKER_DRIFT);
  });
});

// ── Determinism ─────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("the pack is independent of the order the panels emitted their markers", () => {
    const nodes = [
      block("title", 0, 18),
      block("author", 18, 18),
      block("date", 36, 18),
      block("body", 60, 24, 3),
    ];
    const markers = [
      marker("a", "title"),
      marker("b", "author"),
      marker("c", "date"),
      marker("d", "body"),
      marker("e", "body"),
    ];
    const forward = computeMarkerPositions(lookup(nodes), markers, {}, BOTH_FIT);
    const reversed = computeMarkerPositions(
      lookup(nodes),
      [...markers].reverse(),
      {},
      BOTH_FIT,
    );

    // The GEOMETRY of the pack — which cells the side occupies, and each
    // node's own row band — is what the cross-node walk decides, and it must
    // not depend on which panel's markers arrived first. Which of a node's OWN
    // markers takes which cell inside its grid still follows builder order;
    // that is the pre-366 fill rule and is deliberately not renegotiated here.
    const occupied = (r: typeof forward) =>
      r.positioned.map((p) => `${p.cell.x},${p.cell.y}`).sort();
    const bands = (r: typeof forward) => {
      const m = new Map<string, number[]>();
      for (const p of r.positioned) {
        const ys = m.get(p.textObjectId) ?? [];
        ys.push(p.cell.y);
        m.set(p.textObjectId, ys);
      }
      return Object.fromEntries(
        [...m].map(([k, ys]) => [k, [...new Set(ys)].sort((a, b) => a - b)]),
      );
    };

    expect(occupied(reversed)).toEqual(occupied(forward));
    expect(bands(reversed)).toEqual(bands(forward));
  });

  it("two nodes at the SAME top pack by domTop, whichever panel emitted first", () => {
    // A real shape: an atom and the prose block that resolve to one anchor.
    // The ids are chosen so uuid order (the last rung) DISAGREES with domTop
    // order, or the leg would pass with the domTop rung deleted.
    const nodes = [block("z-upper", 0, 18, 1, 0), block("a-lower", 0, 18, 1, 4)];
    const ms = [marker("mz", "z-upper"), marker("ma", "a-lower")];
    const y = (markers: MarginaliaMarker[], id: string) =>
      computeMarkerPositions(lookup(nodes), markers, {}, { left: 1, right: 1 })
        .positioned.find((p) => p.entityId === id)!.cell.y;

    expect(y(ms, "mz")).toBeLessThan(y(ms, "ma"));
    expect(y([...ms].reverse(), "mz")).toBeLessThan(y([...ms].reverse(), "ma"));
  });

  it("a FULL geometric tie is still emission-independent (the order is arbitrary, the pack is not)", () => {
    // A `bulletList` and its first `listItem` are both uuid-bearing and can
    // measure to the same top AND domTop. There is no document order left in
    // the metrics, so the walk falls to the anchor uuid — arbitrary between the
    // two, but INTRINSIC. Falling through to Array#sort's stability instead
    // would order them by whichever panel emitted first, and the pack would
    // reshuffle when an unrelated panel's marker list changed.
    const nodes = [block("list", 0, 18), block("item", 0, 18)];
    const ms = [marker("mlist", "list"), marker("mitem", "item")];
    const bandsOf = (markers: MarginaliaMarker[]) =>
      Object.fromEntries(
        computeMarkerPositions(lookup(nodes), markers, {}, { left: 1, right: 1 })
          .positioned.map((p) => [p.textObjectId, p.cell.y]),
      );

    expect(bandsOf([...ms].reverse())).toEqual(bandsOf(ms));
  });
});
