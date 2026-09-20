import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "@/lib/__tests__/_source-scan";
import {
  MARGINALIA_MIN_MARGIN_LEFT,
  MARGINALIA_MIN_MARGIN_RIGHT,
  resolveHorizontalMargin,
  resolveMarginaliaLane,
  type MarginaliaLaneInput,
} from "@/lib/marginalia";

/**
 * The marker-lane POLICY (task 2026-09-20-671).
 *
 * "Does this pane paint margin markers?" had two independent answers living
 * 800 lines apart in `EditorPane`:
 *
 *   render — `if (menuBar?.prefs.showMarginalia === false) return []`
 *   floor  — `!!menuBar && showMarginalia !== false && !zenMode && !compressX`
 *
 * The two extra terms in the floor were justified, in FIVE docstrings, by a
 * marker-hiding that no code performed — and they were wrong in opposite
 * directions. Zen painted every icon while dropping the floor that guarantees
 * them room (so narrowing the zen margin degraded them away silently, and
 * walked the left margin into the fold-chevron band of task 670). The Reader
 * did the inverse: `!!menuBar` meant "not the Reader" only until F#16 gave the
 * Reader a menu bundle, since when it has been forcing 184px of floored margin
 * onto a read-only paper view.
 *
 * `resolveMarginaliaLane` is the one answer. `hosted` is what the render gate
 * reads; `reserved` is `hosted` minus the single FLOOR-only exception (a
 * compressed code-split). The sibling `marginalia-right-margin-geometry`
 * suite pins the pure lane functions; this one pins the COMPOSITION, which
 * before 671 was pinned by nothing.
 */

// The matrix the task names: {zen, reader, compressX, showMarginalia off,
// all types hidden}. `showMarginalia: undefined` is a pane with no menu
// bundle at all — the DEFAULT (on), never "hide".
const CELLS: ReadonlyArray<{
  readonly name: string;
  readonly input: MarginaliaLaneInput;
  readonly hosted: boolean;
  readonly reserved: boolean;
}> = [
  {
    name: "normal editor",
    input: { showMarginalia: true, zenMode: false, compressX: false },
    hosted: true,
    reserved: true,
  },
  {
    name: "zen",
    input: { showMarginalia: true, zenMode: true, compressX: false },
    hosted: false,
    reserved: false,
  },
  {
    name: "zen + compressed code-split",
    input: { showMarginalia: true, zenMode: true, compressX: true },
    hosted: false,
    reserved: false,
  },
  {
    name: "Library Reader (menu bundle since F#16, pref defaults on)",
    input: { showMarginalia: undefined, zenMode: undefined, compressX: false },
    hosted: true,
    reserved: true,
  },
  {
    name: "Library Reader with the pref explicitly on",
    input: { showMarginalia: true, zenMode: undefined, compressX: false },
    hosted: true,
    reserved: true,
  },
  {
    name: "compressed code-split — icons still paint, floor yields",
    input: { showMarginalia: true, zenMode: false, compressX: true },
    hosted: true,
    reserved: false,
  },
  {
    name: "master Marginalia toggle off",
    input: { showMarginalia: false, zenMode: false, compressX: false },
    hosted: false,
    reserved: false,
  },
  {
    name: "master toggle off + compressed",
    input: { showMarginalia: false, zenMode: false, compressX: true },
    hosted: false,
    reserved: false,
  },
];

describe("resolveMarginaliaLane — the matrix", () => {
  for (const cell of CELLS) {
    it(`${cell.name}: hosted=${cell.hosted} reserved=${cell.reserved}`, () => {
      const lane = resolveMarginaliaLane(cell.input);
      expect(lane.hosted).toBe(cell.hosted);
      expect(lane.reserved).toBe(cell.reserved);
    });
  }

  it("reserved IMPLIES hosted, over the whole 2×3×2 input space", () => {
    // A floor for a lane nobody paints is wasted prose width — the Reader bug.
    for (const showMarginalia of [true, false, undefined]) {
      for (const zenMode of [true, false, undefined]) {
        for (const compressX of [true, false]) {
          const lane = resolveMarginaliaLane({ showMarginalia, zenMode, compressX });
          if (lane.reserved) expect(lane.hosted).toBe(true);
        }
      }
    }
  });

  it("the ONLY way hosted and reserved differ is a compressed code-split", () => {
    for (const showMarginalia of [true, false, undefined]) {
      for (const zenMode of [true, false, undefined]) {
        const loose = resolveMarginaliaLane({ showMarginalia, zenMode, compressX: false });
        expect(loose.reserved).toBe(loose.hosted);
      }
    }
  });
});

describe("the two gates, composed — what the pane paints vs. what it floors", () => {
  // The render gate, as `EditorPane` spells it (pinned structurally below).
  const paints = (lane: ReturnType<typeof resolveMarginaliaLane>, markerCount: number) =>
    lane.hosted ? markerCount : 0;
  // The floor gate, as `EditorPane` spells it.
  const flooredLeft = (lane: ReturnType<typeof resolveMarginaliaLane>, margin: number) =>
    resolveHorizontalMargin(margin, {
      compress: false,
      laneReserved: lane.reserved,
      floor: MARGINALIA_MIN_MARGIN_LEFT,
    });
  const flooredRight = (lane: ReturnType<typeof resolveMarginaliaLane>, margin: number) =>
    resolveHorizontalMargin(margin, {
      compress: false,
      laneReserved: lane.reserved,
      floor: MARGINALIA_MIN_MARGIN_RIGHT,
    });

  it("no pane is floored for a lane it does not paint", () => {
    const NARROW = 24; // MARGIN_MIN.right — the narrowest a drag reaches
    for (const cell of CELLS) {
      const lane = resolveMarginaliaLane(cell.input);
      if (paints(lane, 7) === 0) {
        expect(flooredLeft(lane, NARROW)).toBe(NARROW);
        expect(flooredRight(lane, NARROW)).toBe(NARROW);
      }
    }
  });

  it("zen paints nothing and keeps its margin freedom (its own comment, now true)", () => {
    const zen = resolveMarginaliaLane({ showMarginalia: true, zenMode: true, compressX: false });
    expect(paints(zen, 7)).toBe(0);
    expect(flooredRight(zen, 0)).toBe(0);
    expect(flooredLeft(zen, 0)).toBe(0);
  });

  it("the Reader paints markers, so its 184px of lane is earned, not stale", () => {
    // Settled one way at 671: the Reader HOSTS the lane. The bug was that it
    // reserved the lane while five docstrings said it reserved none.
    const reader = resolveMarginaliaLane({
      showMarginalia: undefined,
      zenMode: undefined,
      compressX: false,
    });
    expect(paints(reader, 3)).toBe(3);
    expect(flooredLeft(reader, 24) + flooredRight(reader, 24)).toBe(
      MARGINALIA_MIN_MARGIN_LEFT + MARGINALIA_MIN_MARGIN_RIGHT,
    );
  });

  it("a compressed code-split still paints icons — the lane DEGRADES, it does not vanish", () => {
    const split = resolveMarginaliaLane({
      showMarginalia: true,
      zenMode: false,
      compressX: true,
    });
    expect(paints(split, 7)).toBe(7);
    expect(split.reserved).toBe(false);
  });
});

describe("the composition is structural — EditorPane resolves the lane ONCE", () => {
  const editorPane = readFileSync(
    path.join(REPO_ROOT, "src/components/EditorPane.tsx"),
    "utf8",
  );

  it("exactly one resolveMarginaliaLane call site", () => {
    const calls = editorPane.match(/resolveMarginaliaLane\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("the RENDER gate reads the policy's hosted half", () => {
    expect(editorPane).toContain("if (!marginaliaLane.hosted) return [];");
  });

  it("the FLOOR gate reads the policy's reserved half, and derives nothing", () => {
    expect(editorPane).toContain(
      "const marginaliaLaneReserved = marginaliaLane.reserved;",
    );
  });

  it("neither gate re-spells the terms that drifted (`!!menuBar`, a bare zen read)", () => {
    // The pre-671 floor was `!!menuBar && menuBar.prefs.showMarginalia !== false
    // && !viewPrefs?.zenMode && !compressX`. Any return of that shape is the
    // second opinion this task removed.
    expect(editorPane).not.toMatch(/marginaliaLaneReserved\s*=\s*\n?\s*!!menuBar/);
    expect(editorPane).not.toMatch(/showMarginalia\s*===\s*false\)\s*return \[\]/);
  });
});

describe("the five docstrings say what ships", () => {
  const FILES = [
    "src/lib/marginalia.ts",
    "src/components/EditorPane.tsx",
    "src/components/EditorLayout.tsx",
    "src/hooks/useMarginEdit.ts",
    "src/hooks/useZenMode.ts",
  ] as const;

  it("nothing still claims the Library Reader hides the markers", () => {
    const offenders: string[] = [];
    for (const rel of FILES) {
      const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      src.split("\n").forEach((line, i) => {
        if (!/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // The claim shape: the Reader, the markers, and a hiding, in one
        // breath. A line that explicitly DENIES the claim is the fix, not the
        // bug.
        const claimsHiding =
          /reader/i.test(line) &&
          /marker|marginalia/i.test(line) &&
          /\bhide[sn]?\b|\bhiding\b/i.test(line) &&
          !/not\s+hide/i.test(line);
        // The other spelling of the same stale fact: `!!menuBar` standing in
        // for "this is the Reader". F#16 gave the Reader a menu bundle.
        const menuBarStandIn =
          /reader/i.test(line) && /\bno\s+`?menuBar/i.test(line) && !/no longer/i.test(line);
        if (claimsHiding || menuBarStandIn) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("zen's hiding claim is backed by the predicate that performs it", () => {
    const marginalia = readFileSync(path.join(REPO_ROOT, "src/lib/marginalia.ts"), "utf8");
    expect(marginalia).toContain("export function resolveMarginaliaLane(");
    const layout = readFileSync(
      path.join(REPO_ROOT, "src/components/EditorLayout.tsx"),
      "utf8",
    );
    expect(layout).toContain("resolveMarginaliaLane");
  });
});
