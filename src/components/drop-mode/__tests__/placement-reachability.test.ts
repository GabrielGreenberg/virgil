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
 *    the hit-test's switch calls — so the guard cannot drift from that switch
 *    (scope: the switch is step 6; see the residual in `placement-policy.ts`
 *    about the two resolvers that run before it); and
 *  - it censuses `placementsFor` specs through their PER-PAYLOAD lists, not
 *    their `allowedPlacements` envelope. Read as a priority order, stack-pull's
 *    envelope is STILL unreachable-complete (it is a union, deliberately), so a
 *    census that asked the envelope would either false-alarm or, if relaxed,
 *    walk straight past the next spec that answers per payload.
 *
 * That second point opens a hole, and the hole is closed from the RUNTIME side:
 * every spec that declares `placementsFor` must publish its lists here, checked
 * by object identity off the live specs. A source grep would have been the
 * obvious move and would have been wrong twice over — it would miss the ES
 * method-shorthand form (`placementsFor(key) {…}`, the idiom `stackPullDropSpec`
 * already uses for `classifyDrop`/`applyDrop`), and 13 of the ~17 censused specs
 * are authored in `src/panels/<Panel>/drop-spec.ts`, outside any drop-mode-
 * directory scan. Asking the objects has neither hole.
 */

import { describe, expect, it } from "vitest";
import {
  resolveSessionPlacements,
  unreachablePlacements,
  winningPlacementKind,
} from "../placement-policy";
import type { DropSpec, PlacementKind } from "../types";
import { MODULE_DROP_SPECS } from "../registry";
import {
  stackPullDropSpec,
  STACK_PULL_PLACEMENT_LISTS,
} from "../specs/stack-pull";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
// Side-effect: fold every card kind's DropSpec onto CARD_REGISTRY[kind].dropSpec.
import "@/cards/drop-specs";

/**
 * Every spec a drag session can dispatch: the card kinds' folded specs plus the
 * module-level ones. The second half comes from `registry.ts`'s own
 * `MODULE_DROP_SPECS` rather than a list kept here — this file and
 * `planned-decision-guardrail.test.ts` each used to keep a copy, and a copy is
 * only as complete as whoever adds the next transient spec remembers to be.
 */
function allSpecs(): Array<{ name: string; spec: DropSpec }> {
  const out: Array<{ name: string; spec: DropSpec }> = [];
  for (const k of Object.keys(CARD_REGISTRY) as CardKind[]) {
    const spec = CARD_REGISTRY[k].dropSpec;
    if (spec) out.push({ name: `CARD_REGISTRY.${k}`, spec });
  }
  out.push(...MODULE_DROP_SPECS);
  return out;
}

/** The per-payload lists published by each spec that answers per payload,
 *  keyed by the SPEC OBJECT — so the "did you publish?" leg is a lookup on the
 *  live spec rather than a guess about where its source lives or how its
 *  function member is spelled. */
const PER_PAYLOAD_LISTS = new Map<
  DropSpec,
  ReadonlyArray<ReadonlyArray<PlacementKind>>
>([[stackPullDropSpec, STACK_PULL_PLACEMENT_LISTS]]);

describe("every declared placement is reachable", () => {
  const specs = allSpecs();

  it("censuses a non-trivial set of specs (the census isn't blind)", () => {
    expect(specs.length).toBeGreaterThanOrEqual(8);
    expect(specs.map((s) => s.name)).toContain("stack-pull");
  });

  it.each(specs.filter((s) => !s.spec.placementsFor).map((s) => [s.name, s.spec] as const))(
    "%s — allowedPlacements is walkable end to end",
    (_name, spec) => {
      expect(unreachablePlacements(spec.allowedPlacements)).toEqual([]);
    },
  );

  it("EVERY spec declaring placementsFor publishes its per-payload lists", () => {
    // The leg that keeps leg 1's `!placementsFor` filter from being an escape
    // hatch: a spec that opts out of the envelope check must opt IN to this one.
    const perPayload = specs.filter((s) => s.spec.placementsFor);
    expect(perPayload.length).toBeGreaterThan(0);
    for (const { name, spec } of perPayload) {
      expect({ name, published: PER_PAYLOAD_LISTS.has(spec) }).toEqual({
        name,
        published: true,
      });
    }
  });

  it("EVERY spec that can offer an inline caret declares its inline PAYLOAD", () => {
    // Task 414's census, and it belongs here because this file already has the
    // enumeration: `inlinePayloadFor` is the input to the inline CONTAINER
    // question, so a spec that offers an `inline-cursor` placement without one
    // resolves to the empty (text-only) payload and its caret paints inside a
    // `codeBlock` / `latexComment` — which the release then splices, TRUNCATING
    // the block and EJECTING its tail (for a `latexComment`, promoting a
    // commented-out line into live printed prose).
    //
    // Asked of the LIVE spec objects for the two reasons the header gives about
    // `placementsFor`: the ES method-shorthand form is invisible to a grep, and
    // most specs are authored outside this directory. ALLOWLIST EMPTY — a hit is
    // DECLARE-it. A spec that can never produce an inline caret needs nothing.
    const offersInlineCaret = ({ spec }: { spec: DropSpec }): boolean => {
      const lists = PER_PAYLOAD_LISTS.get(spec) ?? [spec.allowedPlacements];
      return lists.some((l) => l.includes("inline-cursor"));
    };
    const inlineSpecs = specs.filter(offersInlineCaret);
    // The census can SEE the family (a filter matching nothing passes vacuously).
    expect(inlineSpecs.length).toBeGreaterThanOrEqual(3);
    expect(
      inlineSpecs.filter((s) => !s.spec.inlinePayloadFor).map((s) => s.name),
      "a spec offering an inline caret with no inlinePayloadFor — DECLARE it " +
        "(the hit-test cannot ask the container question without one); never " +
        "allowlist it",
    ).toEqual([]);
  });

  it("every published per-payload list is reachable end to end", () => {
    for (const [spec, lists] of PER_PAYLOAD_LISTS) {
      expect(lists.length).toBeGreaterThan(0);
      const name =
        specs.find((s) => s.spec === spec)?.name ?? "(unregistered spec)";
      for (const list of lists) {
        expect({ name, list, dead: unreachablePlacements(list) }).toEqual({
          name,
          list,
          dead: [],
        });
      }
    }
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

  it("a placementsFor that answers with NOTHING fails CLOSED, not back to the envelope", () => {
    // Unreachable through the type, reachable through untrusted persisted data
    // (stack-pull's payload comes out of a cast localStorage blob). Falling
    // back to `allowedPlacements` here would restore the exact union in which
    // paragraph-side is dead — the defect, for the payload nobody understood.
    const rogue = {
      allowedPlacements: [
        "between-blocks",
        "inline-cursor",
        "paragraph-side",
      ] as ReadonlyArray<PlacementKind>,
      placementsFor: () => undefined as unknown as ReadonlyArray<PlacementKind>,
    } as unknown as DropSpec;
    expect(resolveSessionPlacements(rogue, "whatever:1")).toEqual([]);
    // …while a spec that declares NO per-payload policy still uses its list.
    const plain = {
      allowedPlacements: ["between-blocks"] as ReadonlyArray<PlacementKind>,
    } as unknown as DropSpec;
    expect(resolveSessionPlacements(plain, "whatever:1")).toEqual([
      "between-blocks",
    ]);
  });

  it("an EMPTY list yields nothing anywhere (the honest no-drop payload)", () => {
    expect(winningPlacementKind([], "gap")).toBeNull();
    expect(winningPlacementKind([], "text")).toBeNull();
    expect(unreachablePlacements([])).toEqual([]);
  });
});
