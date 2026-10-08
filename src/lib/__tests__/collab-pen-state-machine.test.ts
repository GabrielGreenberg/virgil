// Task 1015 — the pen transitions re-ask their precondition of the FRESH disk
// value. The pill offers Pass / Take / Take over from a state up to one poll
// old; without the check a stale-UI Pass erased a partner's freshly-held pen
// and the second of two near-simultaneous Takes silently stole the first.

import { describe, it, expect, vi } from "vitest";

// The store module also exports the write door; the mutators under test are pure.
vi.mock("@/lib/storage", () => ({ mutateSidecar: vi.fn() }));
import {
  canTakePen,
  passPenMutator,
  takePenMutator,
} from "@/lib/collab-store";
import { COLLAB_TIMINGS, type CollabSidecar } from "@/lib/collab";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const ADA = { name: "Ada", color: "#112233" };

function sidecar(holder: string | null, heartbeatAgoMs = 0): CollabSidecar {
  const hb = holder ? iso(NOW - heartbeatAgoMs) : null;
  return {
    enabled: true,
    participants: [
      { name: "Ada", color: "#112233", firstSeen: iso(NOW - 1e6) },
      { name: "Bob", color: "#445566", firstSeen: iso(NOW - 1e6) },
    ],
    pen: {
      holder,
      since: hb,
      lastHeartbeat: hb,
      lastActivity: hb,
      requestedBy: [{ name: "Ada", requestedAt: iso(NOW - 1000) }],
    },
    presence: {},
  };
}

const clock = () => NOW;
const STALE = COLLAB_TIMINGS.penStaleMs + 1000;

describe("pen state machine — preconditions on the fresh read (task 1015)", () => {
  it("pass by a non-holder is refused (a partner's take-over survives)", () => {
    expect(passPenMutator("Ada")(sidecar("Bob"))).toBeNull();
    expect(passPenMutator("Ada")(sidecar(null))).toBeNull();
  });

  it("pass by the holder clears the pen", () => {
    const next = passPenMutator("Ada")(sidecar("Ada"));
    expect(next?.pen).toEqual({
      holder: null,
      since: null,
      lastHeartbeat: null,
      lastActivity: null,
      requestedBy: [],
    });
  });

  it("take on a pen a partner holds is refused — even a stale one", () => {
    expect(takePenMutator(ADA, "take", clock)(sidecar("Bob"))).toBeNull();
    expect(takePenMutator(ADA, "take", clock)(sidecar("Bob", STALE))).toBeNull();
  });

  it("take on a free pen (or my own) succeeds and drops my request", () => {
    for (const holder of [null, "Ada"]) {
      const next = takePenMutator(ADA, "take", clock)(sidecar(holder));
      expect(next?.pen.holder).toBe("Ada");
      expect(next?.pen.lastHeartbeat).toBe(iso(NOW));
      expect(next?.pen.requestedBy).toEqual([]);
      expect(next?.presence.Ada).toBeTruthy();
    }
  });

  it("take-over on a FRESH partner pen is refused (they heartbeated since the poll)", () => {
    expect(takePenMutator(ADA, "take-over", clock)(sidecar("Bob", 1000))).toBeNull();
  });

  it("take-over on a stale partner pen succeeds", () => {
    const next = takePenMutator(ADA, "take-over", clock)(sidecar("Bob", STALE));
    expect(next?.pen.holder).toBe("Ada");
  });

  it("canTakePen reads the same staleness clock the pill reads", () => {
    const edge = sidecar("Bob", COLLAB_TIMINGS.penStaleMs);
    expect(canTakePen(edge, "Ada", "take-over", NOW)).toBe(true);
    const fresh = sidecar("Bob", COLLAB_TIMINGS.penStaleMs - 1);
    expect(canTakePen(fresh, "Ada", "take-over", NOW)).toBe(false);
  });
});
