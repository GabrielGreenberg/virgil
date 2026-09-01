// Task 2026-08-31-514 — the ABSORBED verdict re-homes through task 491's door.
//
// Gabriel's ruling: Backspace-merging two anchored paragraphs is a MERGE, so
// the absorbed block's card FOLLOWS the survivor. `rehomeAbsorbedAnchor` is the
// one place that says what a JOIN's re-home means; the 491 door
// (`retargetDisplacedAnchors`) is what performs it, so "a displaced Mode-A
// anchor moves onto ONE surviving block, converging, dropping only the consumed
// pid" stays one rule rather than two.
//
// The legs below drive the REAL door against a recording `AnchorRetargetApi`,
// because the two things that can go wrong here are both invisible to any test
// of `retargetDisplacedAnchors` itself: a survivor whose node type is not a
// text-object kind (the guard is registry-free by design, so the validation is
// this function's), and a degenerate self-target.
import { describe, expect, it } from "vitest";
import { rehomeAbsorbedAnchor } from "../retarget-anchors";
import type { AnchorRetargetApi, RetargetDisplacedAnchorsArgs } from "../retarget-anchors";
import type { BlockAbsorbedEvent } from "@/lib/tiptap/linked-anchor";

type Call = Omit<RetargetDisplacedAnchorsArgs, "handlers">;

function recorder(): { api: AnchorRetargetApi; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    api: {
      retarget(args) {
        calls.push(args);
        return 1;
      },
    },
  };
}

const evt = (
  absorbedUuid: string,
  survivorUuid: string,
  survivorType = "paragraph",
): BlockAbsorbedEvent => ({
  absorbed: { uuid: absorbedUuid, typeName: "paragraph" },
  survivor: { uuid: survivorUuid, typeName: survivorType },
});

describe("514 — rehomeAbsorbedAnchor", () => {
  it("moves the absorbed pid onto the survivor, with the survivor's snapshot", () => {
    const { api, calls } = recorder();
    const moved = rehomeAbsorbedAnchor({
      event: evt("P2", "P1"),
      retarget: api,
      snapshotFor: (uuid) => (uuid === "P1" ? "alpha beta" : null),
    });

    expect(moved).toBe(1);
    expect(calls).toHaveLength(1);
    expect([...calls[0].removed]).toEqual(["P2"]);
    expect(calls[0].target).toEqual({ uuid: "P1", kind: "paragraph" });
    // Self-healing on reload, exactly as 491's fresh links are.
    expect(calls[0].snapshot).toBe("alpha beta");
  });

  it("carries the survivor's own KIND, so a list-item join anchors to the item", () => {
    const { api, calls } = recorder();
    rehomeAbsorbedAnchor({
      event: evt("i2", "i1", "listItem"),
      retarget: api,
      snapshotFor: () => null,
    });
    expect(calls[0].target).toEqual({ uuid: "i1", kind: "listItem" });
  });

  it("REFUSES a survivor whose node type is not a text-object kind", () => {
    // The guard publishes the raw schema node name; a kind the registry does not
    // know has no anchor to offer, and handing the card that uuid would leave a
    // link nothing can resolve. The card keeps the ordinary orphan path.
    const { api, calls } = recorder();
    const moved = rehomeAbsorbedAnchor({
      event: evt("P2", "P1", "glossCell"),
      retarget: api,
      snapshotFor: () => null,
    });
    expect(moved).toBe(0);
    expect(calls).toEqual([]);
  });

  it("REFUSES a degenerate self-target", () => {
    const { api, calls } = recorder();
    expect(
      rehomeAbsorbedAnchor({
        event: evt("P1", "P1"),
        retarget: api,
        snapshotFor: () => null,
      }),
    ).toBe(0);
    expect(calls).toEqual([]);
  });

  it("a null snapshot is passed through rather than fabricated", () => {
    // An EMPTY survivor has no text to relocate by; the link is still valid
    // (its uuid is live), so the door must not invent a snapshot.
    const { api, calls } = recorder();
    rehomeAbsorbedAnchor({
      event: evt("P2", "P1"),
      retarget: api,
      snapshotFor: () => null,
    });
    expect(calls[0].snapshot).toBeNull();
  });
});
