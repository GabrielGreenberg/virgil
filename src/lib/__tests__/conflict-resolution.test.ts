// **The conflict resolution's ORDER** — task 364.
//
// The two doors ("keep my version" / "load the disk version") differ only in
// which side they APPLY; what they share is the net, and the net is worthless
// unless it lands FIRST. That ordering is the whole reason
// `resolveExternalConflict` exists as one function rather than two handlers:
// per-door archiving is how the two would come to disagree about what gets
// kept, silently, with every behavioural leg green.
//
// So every leg here drives the REAL resolution against RECORDING ports and
// asserts the sequence, not just the effects. A test that only asserted "the
// archive was called" passes on an implementation that archives the OUTCOME.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveExternalConflict,
  type ConflictPorts,
} from "@/lib/conflict-resolution";
import type { ConflictArchive } from "@/lib/storage-types";

const ARCHIVE: ConflictArchive = {
  slot: "2026-08-18T00-00-00-000Z",
  disk: ["main.tex", "virgil.json"],
  mine: "unsaved-main.tex",
};

let order: string[];

/** A real await per port, so an implementation that fires them concurrently
 *  genuinely interleaves rather than winning on microtask ordering. */
const step = (name: string) => async () => {
  order.push(`${name}:start`);
  await new Promise((r) => setTimeout(r, 5));
  order.push(`${name}:end`);
};

function ports(over: Partial<ConflictPorts> = {}): ConflictPorts {
  return {
    archive: vi.fn(async () => {
      await step("archive")();
      return ARCHIVE;
    }),
    acknowledge: vi.fn(step("acknowledge")),
    keepMine: vi.fn(async () => {
      await step("keepMine")();
      return true;
    }),
    takeDisk: vi.fn(step("takeDisk")),
    ...over,
  };
}

beforeEach(() => {
  order = [];
});

describe("the net lands before either side is applied", () => {
  it("keep-mine: archive COMPLETES, then acknowledge, then the write", async () => {
    const p = ports();
    const out = await resolveExternalConflict("keep-mine", p);
    expect(order).toEqual([
      "archive:start",
      "archive:end",
      "acknowledge:start",
      "acknowledge:end",
      "keepMine:start",
      "keepMine:end",
    ]);
    expect(p.takeDisk).not.toHaveBeenCalled();
    expect(out).toEqual({ choice: "keep-mine", archive: ARCHIVE, applied: true });
  });

  it("take-disk: archive COMPLETES, then the reload", async () => {
    const p = ports();
    const out = await resolveExternalConflict("take-disk", p);
    expect(order).toEqual([
      "archive:start",
      "archive:end",
      "takeDisk:start",
      "takeDisk:end",
    ]);
    expect(p.keepMine).not.toHaveBeenCalled();
    expect(out.applied).toBe(true);
  });

  it("BOTH doors take the SAME net — which door was chosen cannot change it", async () => {
    const a = ports();
    await resolveExternalConflict("keep-mine", a);
    const b = ports();
    await resolveExternalConflict("take-disk", b);
    expect(a.archive).toHaveBeenCalledTimes(1);
    expect(b.archive).toHaveBeenCalledTimes(1);
    // Neither door passes anything that could make its net narrower.
    expect((a.archive as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([]);
    expect((b.archive as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([]);
  });
});

describe("keep-mine resolves the watcher BEFORE it writes", () => {
  it("acknowledge precedes the write — else the clobber guard holds it back", async () => {
    // This is not cosmetic ordering. `hasUnresolvedChange()` gates every save
    // path in useDocument; a write issued while the conflict still stands is
    // exactly the write the guard exists to stop.
    const p = ports();
    await resolveExternalConflict("keep-mine", p);
    expect(order.indexOf("acknowledge:end")).toBeLessThan(
      order.indexOf("keepMine:start"),
    );
  });

  it("take-disk does NOT acknowledge — the reload re-baselines on the load path", async () => {
    const p = ports();
    await resolveExternalConflict("take-disk", p);
    expect(p.acknowledge).not.toHaveBeenCalled();
  });
});

describe("failure directions", () => {
  it("a net that could NOT be taken does not cancel the resolution — it is REPORTED", async () => {
    // The user is mid-conflict with a paused autosave. Refusing to resolve
    // strands them with no way forward; the outcome carries the fact instead,
    // so the surface can say so rather than repeat a promise it cannot keep.
    const p = ports({ archive: vi.fn(async () => null) });
    const out = await resolveExternalConflict("keep-mine", p);
    expect(out.archive).toBeNull();
    expect(out.applied).toBe(true);
    expect(p.keepMine).toHaveBeenCalledTimes(1);
  });

  it("an archive that THROWS still resolves — the receipt is null, not an escape", async () => {
    const p = ports({
      archive: vi.fn(async () => {
        throw new Error("permission lost");
      }),
    });
    await expect(resolveExternalConflict("keep-mine", p)).rejects.toThrow();
    // Stated honestly: the storage door swallows its own failures and answers
    // `null` (see snapshotConflictSides), so a THROW here means a port the app
    // does not ship. The leg pins that this function does not silently swallow
    // one — a swallowed archive throw would look identical to "no net taken".
  });

  it("an apply that fails reports applied:false, with the net still taken", async () => {
    const p = ports({
      keepMine: vi.fn(async () => {
        throw new Error("write failed");
      }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await resolveExternalConflict("keep-mine", p);
    spy.mockRestore();
    expect(out.applied).toBe(false);
    expect(out.archive).toEqual(ARCHIVE);
  });
});
