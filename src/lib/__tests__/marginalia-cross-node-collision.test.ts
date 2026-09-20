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
import { PREFERENCES_TREE, isLeaf, type PrefNode } from "@/lib/preferences-tree";
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
    //
    // TWO fixtures, because the first one alone made this leg VACUOUS for the
    // case that actually broke it (task 673). Its blocks all share a 10px
    // pitch, so their anchors run strictly downward and the restart test
    // (`anchoredTop > crowdAnchorY + DRIFT`) — which is ONE-SIDED — is always
    // asked of the larger value. The second fixture breaks that: a textless
    // block measures with `lineHeight` = its full height (`measureBlock`), so
    // a figure anchors at its vertical CENTRE, BELOW the caption that prints
    // under it. Ordering by raw `node.top` then hands the walk a non-monotone
    // anchor sequence and a node whose anchor lands ABOVE the open pill's
    // joins unconditionally: one pill at y=283 keyed on "fig", standing in for
    // anchors 169, 101 and 117 — a span of 68 against a bound of 44.
    const fixtures: Array<{ nodes: AnchorNodeMetrics[]; markers: MarginaliaMarker[] }> = [
      (() => {
        const nodes = [
          block("a-tall", 0, 10, 6),
          ...Array.from({ length: 7 }, (_, i) => block(`b${i}`, 60 + i * 10, 10)),
        ];
        return {
          nodes,
          markers: [
            ...Array.from({ length: 6 }, (_, i) => marker(`t${i}`, "a-tall")),
            ...Array.from({ length: 7 }, (_, i) => marker(`m${i}`, `b${i}`)),
          ],
        };
      })(),
      (() => {
        const nodes = [
          block("p-tight", 0, 12, 12),
          block("fig", 100, 160, 1), // textless: lineHeight = full height
          block("cap", 104, 16),
          block("p2", 120, 16),
        ];
        return {
          nodes,
          markers: [
            ...Array.from({ length: 12 }, (_, i) => marker(`t${i}`, "p-tight")),
            ...["fig", "cap", "p2"].flatMap((id) => [
              marker(`${id}-1`, id),
              marker(`${id}-2`, id),
            ]),
          ],
        };
      })(),
    ];

    for (const [i, { nodes, markers }] of fixtures.entries()) {
      const { positioned, overflowGroups } = computeMarkerPositions(
        lookup(nodes),
        markers,
        {},
        { left: 1, right: 1 },
      );

      expect(overflowGroups.length).toBeGreaterThan(1);
      expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);

      const anchorOf = new Map(
        nodes.map((n) => [n.id, n.top + (n.lineHeight - MARGINALIA_ICON_SIZE) / 2]),
      );
      for (const g of overflowGroups) {
        const tops = g.hidden.map((m) => anchorOf.get(m.textObjectId)!);
        expect(
          `fixture ${i} · ${g.textObjectId} span ${Math.max(...tops) - Math.min(...tops)}`,
        ).toBe(
          `fixture ${i} · ${g.textObjectId} span ${Math.min(
            Math.max(...tops) - Math.min(...tops),
            MARGINALIA_MAX_MARKER_DRIFT,
          )}`,
        );
      }
    }
  });
});

// ── The bound is asked at EVERY row, not only at row 0 (task 673) ──────────

describe("the drift bound is measured at EVERY row", () => {
  it("a tall node with a tight line pitch ENDS its grid at the bound and rides its own +K pill", () => {
    // 8 lines at a 14px pitch, one marker per line. Each row is displaced a
    // further (24 − 14) = 10px, so rows 0..4 land within
    // MARGINALIA_MAX_MARKER_DRIFT (44) and row 5 would not.
    //
    // Pre-673 the bound was asked at row 0 only: all 8 rows placed, the last
    // one 60px below its own line, and the frontier left 60px below the
    // block's bottom where it pushed (or folded) the node next door. The
    // reasoning was that a lower row is "still beside its own block" — which
    // stops being true exactly when the cumulative displacement outruns the
    // block, i.e. below a 24px pitch, which the preference sliders reach.
    //
    // Now the grid simply ENDS at the last row it can place on its own line
    // and the surplus rides the node's OWN "+K" pill — the R16 affordance,
    // not a folded crowd: nothing the reader can see beside its line is
    // hidden, and the grid stops overstating its capacity.
    const nodes = [block("p1", 0, 14, 8)];
    const markers = Array.from({ length: 8 }, (_, i) => marker(`m${i}`, "p1"));
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );

    expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);
    // Its OWN pill (R16), keyed on the node — not a crowd pill standing in
    // for a node that could not be placed at all.
    expect(overflowGroups).toHaveLength(1);
    expect(overflowGroups[0].textObjectId).toBe("p1");
    expect(positioned).toHaveLength(4); // rows 0..3; row 4 carries the pill
    expect(overflowGroups[0].hidden).toHaveLength(4);
    // and every marker that DID place is within the bound of its own line.
    for (const pm of positioned) {
      const r = pm.cell.row;
      const itsLine = r * 14 + (14 - MARGINALIA_ICON_SIZE) / 2;
      expect(pm.cell.y - itsLine).toBeLessThanOrEqual(
        MARGINALIA_MAX_MARKER_DRIFT,
      );
    }
  });
});

// ── The pitch the byte-identity claim holds at (task 673) ──────────────────

describe("the walk is total over the pitches the preference sliders allow", () => {
  /** The tightest body pitch a user can dial in, derived from the preference
   *  SSOT rather than hand-copied — if a slider's floor moves, this sweep
   *  moves with it (and the module's stated 24px threshold is re-judged). */
  function minBodyPitchPx(): number {
    const sliders = new Map<string, number>();
    const walk = (nodes: PrefNode[]) => {
      for (const n of nodes) {
        if (!isLeaf(n)) walk(n.children);
        else if (n.type === "slider") sliders.set(n.key, n.min);
      }
    };
    walk(PREFERENCES_TREE);
    const remPx = 16;
    return sliders.get("editorFontSize")! * remPx * sliders.get("editorLineHeight")!;
  }

  it("the minimum the sliders allow really is below the 24px threshold", () => {
    // The premise of this whole describe: if it ever stops holding, the
    // module's byte-identity claim is unconditional again and these legs are
    // documenting a shape the app can no longer reach.
    expect(minBodyPitchPx()).toBeLessThan(
      MARGINALIA_ICON_SIZE + MARGINALIA_ROW_MIN_GAP,
    );
    expect(minBodyPitchPx()).toBeCloseTo(19.04, 5);
  });

  it("no marker drifts past the bound at any pitch in the slider band", () => {
    for (const lh of [minBodyPitchPx(), 21, 23, 24]) {
      const nodes = [block("p1", 0, lh, 10)];
      const markers = Array.from({ length: 10 }, (_, i) => marker(`m${i}`, "p1"));
      const { positioned, overflowGroups } = computeMarkerPositions(
        lookup(nodes),
        markers,
        {},
        { left: 1, right: 1 },
      );
      expect(overlaps(boxes(positioned, overflowGroups, "right"))).toEqual([]);
      for (const pm of positioned) {
        const itsLine = pm.cell.row * lh + (lh - MARGINALIA_ICON_SIZE) / 2;
        expect(
          `lh=${lh} row=${pm.cell.row} drift=${pm.cell.y - itsLine}`,
        ).toBe(
          `lh=${lh} row=${pm.cell.row} drift=${Math.min(
            pm.cell.y - itsLine,
            MARGINALIA_MAX_MARKER_DRIFT,
          )}`,
        );
      }
      // Every marker still comes back exactly once — placed, or named by the
      // node's own pill.
      const seen = [
        ...positioned.map((pm) => pm.entityId),
        ...overflowGroups.flatMap((g) => g.hidden.map((m) => m.entityId)),
      ];
      expect(new Set(seen).size).toBe(10);
    }
  });

  it("a 24px pitch is still byte-identical: the walk is a no-op", () => {
    const nodes = [block("p1", 0, 24, 10)];
    const markers = Array.from({ length: 10 }, (_, i) => marker(`m${i}`, "p1"));
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    expect(overflowGroups).toEqual([]);
    expect(positioned.map((pm) => pm.cell.y)).toEqual(
      Array.from({ length: 10 }, (_, r) => r * 24 + (24 - MARGINALIA_ICON_SIZE) / 2),
    );
  });

  it("a tight block does not fold the block BELOW it — the frontier stays near its own bottom", () => {
    // The user-visible half of member (1): pre-673 the tight block's frontier
    // ran ~50px past its own bottom, so the next paragraph's row 0 failed the
    // bound and its markers disappeared into a crowd pill.
    const lh = minBodyPitchPx();
    const nodes = [block("p1", 0, lh, 10), block("p2", 10 * lh, lh, 1)];
    const markers = [
      ...Array.from({ length: 10 }, (_, i) => marker(`m${i}`, "p1")),
      marker("next", "p2"),
    ];
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    const next = positioned.find((pm) => pm.entityId === "next");
    expect(next).toBeDefined();
    expect(
      overflowGroups.some((g) =>
        g.hidden.some((m) => m.entityId === "next"),
      ),
    ).toBe(false);
    const itsLine = 10 * lh + (lh - MARGINALIA_ICON_SIZE) / 2;
    expect(next!.cell.y - itsLine).toBeLessThanOrEqual(
      MARGINALIA_MAX_MARKER_DRIFT,
    );
  });
});

// ── The walk is TOTAL over its declared input type (task 673) ──────────────

describe("one unusable measurement costs one node, never the side", () => {
  for (const bad of [NaN, Infinity, -Infinity] as const) {
    it(`a ${bad} lineHeight on one node leaves every other node on the side finite`, () => {
      const nodes = [
        block("b0", 0, 24),
        { ...block("bad", 100, 24), lineHeight: bad },
        block("b2", 200, 24),
      ];
      const markers = [
        marker("m0", "b0"),
        marker("mbad", "bad"),
        marker("m2", "b2"),
      ];
      const { positioned, overflowGroups } = computeMarkerPositions(
        lookup(nodes),
        markers,
        {},
        { left: 1, right: 1 },
      );
      for (const pm of positioned) expect(Number.isFinite(pm.cell.y)).toBe(true);
      for (const g of overflowGroups) expect(Number.isFinite(g.cell.y)).toBe(true);
      // The healthy neighbours keep their own anchored rows, unmoved.
      const y = (id: string) => positioned.find((pm) => pm.entityId === id)?.cell.y;
      expect(y("m0")).toBe(0 + (24 - MARGINALIA_ICON_SIZE) / 2);
      expect(y("m2")).toBe(200 + (24 - MARGINALIA_ICON_SIZE) / 2);
      // The unusable node's marker is simply not placed — the same treatment
      // as a block the registry has not measured.
      expect(y("mbad")).toBeUndefined();
    });
  }

  it("a NaN top on one node does not reorder or poison the rest of the side", () => {
    const nodes = [
      block("b0", 0, 24),
      { ...block("bad", 100, 24), top: NaN },
      block("b2", 200, 24),
    ];
    const markers = [marker("m0", "b0"), marker("mbad", "bad"), marker("m2", "b2")];
    const { positioned } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    expect(positioned.map((pm) => pm.entityId)).toEqual(["m0", "m2"]);
    for (const pm of positioned) expect(Number.isFinite(pm.cell.y)).toBe(true);
  });

  it("a fractional lineCount never renders a marker twice, nor a pill at a fractional column", () => {
    // `lineCount` is integral today only because `measureBlock` rounds it.
    // Un-rounded, capacity 1.6 gave visibleCount 0.6 — one marker positioned
    // at row 0, a pill at COLUMN 0.6 on top of it, and `items.slice(0.6)`
    // listing that same marker again in the pill's popover.
    const nodes = [{ ...block("p1", 0, 24, 1), lineCount: 1.6 }];
    const markers = [marker("a", "p1"), marker("b", "p1")];
    const { positioned, overflowGroups } = computeMarkerPositions(
      lookup(nodes),
      markers,
      {},
      { left: 1, right: 1 },
    );
    const placed = positioned.map((pm) => pm.entityId);
    const hidden = overflowGroups.flatMap((g) => g.hidden.map((m) => m.entityId));
    expect(placed.filter((id) => hidden.includes(id))).toEqual([]);
    expect([...placed, ...hidden].sort()).toEqual(["a", "b"]);
    for (const g of overflowGroups) {
      expect(Number.isInteger(g.cell.col)).toBe(true);
      expect(Number.isInteger(g.cell.row)).toBe(true);
    }
    for (const pm of positioned) {
      expect(Number.isInteger(pm.cell.col)).toBe(true);
      expect(Number.isInteger(pm.cell.row)).toBe(true);
    }
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
