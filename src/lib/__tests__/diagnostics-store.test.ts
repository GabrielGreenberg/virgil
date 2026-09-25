import { describe, it, expect } from "vitest";
import { pruneDismissed } from "@/lib/diagnostics-store";

describe("pruneDismissed", () => {
  it("drops dismissed ids absent from the live set", () => {
    const dismissed = new Set(["a", "b", "c"]);
    const pruned = pruneDismissed(dismissed, ["a", "c", "d"]);
    expect([...pruned].sort()).toEqual(["a", "c"]);
  });

  it("returns the SAME reference when nothing changed (no needless re-render)", () => {
    const dismissed = new Set(["a", "b"]);
    const pruned = pruneDismissed(dismissed, ["a", "b", "z"]);
    expect(pruned).toBe(dismissed);
  });

  it("no-ops on an empty dismissed set", () => {
    const dismissed = new Set<string>();
    expect(pruneDismissed(dismissed, ["a"])).toBe(dismissed);
  });

  it("accepts a Set as liveIds", () => {
    const dismissed = new Set(["a", "b"]);
    const pruned = pruneDismissed(dismissed, new Set(["b"]));
    expect([...pruned]).toEqual(["b"]);
  });

  it("re-surfaces a re-occurring error (its new id isn't in the stale set)", () => {
    // A dismissed old-run id; the new run's id for the same logical error is
    // different (salt), so it's NOT in `dismissed` — the error re-surfaces.
    const dismissed = new Set(["compile:5:0:abc#r1:0"]);
    const liveIds = ["compile:5:0:abc#r2:0"];
    const pruned = pruneDismissed(dismissed, liveIds);
    // The stale id was pruned; the live id is not dismissed.
    expect(pruned.has("compile:5:0:abc#r1:0")).toBe(false);
    expect(pruned.has("compile:5:0:abc#r2:0")).toBe(false);
  });
});
