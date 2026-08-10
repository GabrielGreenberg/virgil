/**
 * Task 258 — **every placement a drop spec declares must be one the hit-test
 * can actually return.**
 *
 * `stackPullDropSpec` declared `paragraph-side` from the day the Stack landed
 * (`c4f95034`, 2026-05-14) to 2026-08-10, and the priority loop could never
 * reach it: `inGap`/`inText` are an exact partition
 * of every cursor position, so a `paragraph-side` listed after BOTH partition
 * members is dead. Nothing typechecked wrong, nothing threw, no test failed —
 * the capability simply didn't exist, and the gesture painted an inline caret
 * over a commit that refused it. This census is the guard that catches that
 * shape, for every spec, before it ships.
 *
 * Two things make it more than a restatement of the bug:
 *
 *  - it reads the priority rule from `winningPlacementKind` — the SAME function
 *    the hit-test's switch calls — so the guard cannot drift from the loop; and
 *  - it censuses `placementsFor` specs through their PER-PAYLOAD lists, not
 *    their `allowedPlacements` envelope. Read as a priority order, stack-pull's
 *    envelope is STILL unreachable-complete (it is a union, deliberately), so a
 *    census that asked the envelope would either false-alarm or, if relaxed,
 *    walk straight past the next spec that answers per payload. The grep leg
 *    below is what keeps that door closed: a new `placementsFor` declaration
 *    with no published lists fails here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  unreachablePlacements,
  winningPlacementKind,
} from "../placement-policy";
import type { DropSpec, PlacementKind } from "../types";
import { textObjectDropSpec } from "../specs/textobject";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
import { inTextAtomGrabSpec } from "../specs/in-text-atom-grab";
import {
  stackPullDropSpec,
  STACK_PULL_PLACEMENT_LISTS,
} from "../specs/stack-pull";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
// Side-effect: fold every card kind's DropSpec onto CARD_REGISTRY[kind].dropSpec.
import "@/cards/drop-specs";

const DROP_MODE_DIR = join(process.cwd(), "src/components/drop-mode");

/**
 * Every spec a drag session can dispatch: the card kinds' folded specs plus the
 * four module-level ones (`registry.ts`'s whole dispatch surface).
 */
function allSpecs(): Array<{ name: string; spec: DropSpec }> {
  const out: Array<{ name: string; spec: DropSpec }> = [];
  for (const k of Object.keys(CARD_REGISTRY) as CardKind[]) {
    const spec = CARD_REGISTRY[k].dropSpec;
    if (spec) out.push({ name: `CARD_REGISTRY.${k}`, spec });
  }
  out.push({ name: "textObjectDropSpec", spec: textObjectDropSpec });
  out.push({ name: "textRangeMoveDropSpec", spec: textRangeMoveDropSpec });
  out.push({ name: "inTextAtomGrabSpec", spec: inTextAtomGrabSpec });
  out.push({ name: "stackPullDropSpec", spec: stackPullDropSpec });
  return out;
}

/** The per-payload lists published by each spec module that answers per
 *  payload. Keyed by path relative to `src/components/drop-mode/` — the grep
 *  leg asserts this key set IS the set of files declaring `placementsFor`. */
const PER_PAYLOAD_LISTS: Record<
  string,
  ReadonlyArray<ReadonlyArray<PlacementKind>>
> = {
  "specs/stack-pull.ts": STACK_PULL_PLACEMENT_LISTS,
};

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...tsFilesUnder(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("every declared placement is reachable", () => {
  const specs = allSpecs();

  it("censuses a non-trivial set of specs (the census isn't blind)", () => {
    expect(specs.length).toBeGreaterThanOrEqual(8);
    expect(specs.map((s) => s.name)).toContain("stackPullDropSpec");
  });

  it.each(specs.filter((s) => !s.spec.placementsFor).map((s) => [s.name, s.spec] as const))(
    "%s — allowedPlacements is walkable end to end",
    (_name, spec) => {
      expect(unreachablePlacements(spec.allowedPlacements)).toEqual([]);
    },
  );

  it("a spec answering PER PAYLOAD has every one of its lists reachable", () => {
    for (const [file, lists] of Object.entries(PER_PAYLOAD_LISTS)) {
      expect(lists.length).toBeGreaterThan(0);
      for (const list of lists) {
        expect({ file, list, dead: unreachablePlacements(list) }).toEqual({
          file,
          list,
          dead: [],
        });
      }
    }
  });

  it("a per-payload list never exceeds its spec's declared envelope", () => {
    for (const list of STACK_PULL_PLACEMENT_LISTS) {
      for (const kind of list) {
        expect(stackPullDropSpec.allowedPlacements).toContain(kind);
      }
    }
  });

  it("every file declaring `placementsFor` publishes its lists here", () => {
    const declaring: string[] = [];
    for (const file of tsFilesUnder(DROP_MODE_DIR)) {
      const src = readFileSync(file, "utf8");
      // The DECLARATION form (an object property on a spec), not the type
      // member in `types.ts` nor the read in `placement-policy.ts`.
      if (/^\s*placementsFor:/m.test(src)) {
        declaring.push(file.slice(DROP_MODE_DIR.length + 1));
      }
    }
    expect(declaring.sort()).toEqual(Object.keys(PER_PAYLOAD_LISTS).sort());
  });
});

describe("the priority rule itself", () => {
  it("CANARY — the pre-fix stack-pull declaration reports paragraph-side dead", () => {
    // The exact array `stackPullDropSpec` shipped before this task. If this
    // ever comes back empty the census has stopped being able to see the bug.
    expect(
      unreachablePlacements([
        "between-blocks",
        "inline-cursor",
        "paragraph-side",
      ]),
    ).toEqual(["paragraph-side"]);
  });

  it("between-blocks owns the gap, inline-cursor owns the text (an exact partition)", () => {
    expect(winningPlacementKind(["between-blocks"], "gap")).toBe(
      "between-blocks",
    );
    expect(winningPlacementKind(["between-blocks"], "text")).toBeNull();
    expect(winningPlacementKind(["inline-cursor"], "text")).toBe(
      "inline-cursor",
    );
    expect(winningPlacementKind(["inline-cursor"], "gap")).toBeNull();
  });

  it("paragraph-side matches EITHER geometry — which is why order decides it", () => {
    expect(winningPlacementKind(["paragraph-side"], "gap")).toBe(
      "paragraph-side",
    );
    expect(winningPlacementKind(["paragraph-side"], "text")).toBe(
      "paragraph-side",
    );
    // Behind between-blocks it still owns the text world (the fix's card list)…
    expect(
      winningPlacementKind(["between-blocks", "paragraph-side"], "text"),
    ).toBe("paragraph-side");
    expect(
      winningPlacementKind(["between-blocks", "paragraph-side"], "gap"),
    ).toBe("between-blocks");
    // …but behind BOTH partition members it owns nothing.
    expect(
      unreachablePlacements(["paragraph-side", "between-blocks"]),
    ).toEqual(["between-blocks"]);
  });

  it("an EMPTY list yields nothing anywhere (the honest no-drop payload)", () => {
    expect(winningPlacementKind([], "gap")).toBeNull();
    expect(winningPlacementKind([], "text")).toBeNull();
    expect(unreachablePlacements([])).toEqual([]);
  });
});
