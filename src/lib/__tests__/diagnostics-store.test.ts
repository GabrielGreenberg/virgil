import { describe, it, expect } from "vitest";
import {
  createOrdinalMinter,
  mintDiagnosticId,
  pruneDismissed,
} from "@/lib/diagnostics-store";

describe("createOrdinalMinter", () => {
  it("returns a monotonic sequence starting at 0", () => {
    const m = createOrdinalMinter();
    expect(m.next()).toBe(0);
    expect(m.next()).toBe(1);
    expect(m.next()).toBe(2);
  });
});

describe("mintDiagnosticId — id uniqueness", () => {
  it("mints distinct ids for identical (source,line,col,message) tuples", () => {
    const m = createOrdinalMinter();
    const parts = { source: "compile" as const, line: 0, message: "boom" };
    const a = mintDiagnosticId(m, parts);
    const b = mintDiagnosticId(m, parts);
    const c = mintDiagnosticId(m, parts);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("folds the salt into the id so the same tuple differs across runs", () => {
    const parts = { source: "compile" as const, line: 5, message: "x" };
    const run1 = mintDiagnosticId(createOrdinalMinter(), { ...parts, salt: "r1:" });
    const run2 = mintDiagnosticId(createOrdinalMinter(), { ...parts, salt: "r2:" });
    expect(run1).not.toBe(run2);
  });

  it("is stable for the same (tuple, ordinal, salt)", () => {
    const parts = { source: "lint" as const, line: 3, column: 2, message: "m", salt: "s:" };
    const a = mintDiagnosticId({ next: () => 7 }, parts);
    const b = mintDiagnosticId({ next: () => 7 }, parts);
    expect(a).toBe(b);
  });
});

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
