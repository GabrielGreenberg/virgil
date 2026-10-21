// Task 1213 — pen + presence ownership is per holding SESSION (one pane of
// one window), not per identity NAME (which is per-browser). Before, window
// A's pagehide released the pen window B was writing under and deleted B's
// presence; and any session of the name could keep the pen fresh.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ mutateSidecar: vi.fn() }));
import {
  activityMutator,
  heartbeatMutator,
  passPenMutator,
  releaseSelf,
  takePenMutator,
} from "@/lib/collab-store";
import { COLLAB_TIMINGS, holdsPen, type CollabSidecar } from "@/lib/collab";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const A = { name: "Ada", session: "win-a" };
const B = { name: "Ada", session: "win-b" };

function adaInB(): CollabSidecar {
  return {
    enabled: true,
    participants: [{ name: "Ada", color: "#112233", firstSeen: iso(NOW - 1e6) }],
    pen: {
      holder: "Ada",
      holderSession: "win-b",
      since: iso(NOW - 1000),
      lastHeartbeat: iso(NOW - 1000),
      lastActivity: iso(NOW - 1000),
      requestedBy: [],
    },
    presence: {
      Ada: {
        lastHeartbeat: iso(NOW - 1000),
        focusedCard: null,
        selectedCards: [],
        cursorParagraphId: null,
        sessions: { "win-a": iso(NOW - 2000), "win-b": iso(NOW - 1000) },
      },
    },
  };
}

describe("collab ownership is the session, not the name (task 1213)", () => {
  it("releaseSelf(sessionA) leaves sessionB's pen and presence", () => {
    const next = releaseSelf(A, NOW)(adaInB());
    expect(next).not.toBeNull();
    expect(next!.pen.holder).toBe("Ada");
    expect(next!.pen.holderSession).toBe("win-b");
    expect(next!.presence.Ada).toBeDefined();
    expect(next!.presence.Ada.sessions).toEqual({ "win-b": iso(NOW - 1000) });
  });

  it("the holding session's release clears the pen; the entry goes with the last fresh session", () => {
    const afterB = releaseSelf(B, NOW)(adaInB())!;
    expect(afterB.pen.holder).toBeNull();
    expect(afterB.pen.holderSession).toBeNull();
    // A is still present on the paper.
    expect(afterB.presence.Ada.sessions).toEqual({ "win-a": iso(NOW - 2000) });
    const afterA = releaseSelf(A, NOW)(afterB)!;
    expect(afterA.presence.Ada).toBeUndefined();
  });

  it("a crashed sibling whose heartbeat aged out does not keep the entry alive", () => {
    const v = adaInB();
    v.presence.Ada.sessions = {
      "win-a": iso(NOW),
      "win-dead": iso(NOW - COLLAB_TIMINGS.penStaleMs - 1),
    };
    expect(releaseSelf(A, NOW)(v)!.presence.Ada).toBeUndefined();
  });

  it("a non-holding session's heartbeat never refreshes the pen", () => {
    const next = heartbeatMutator(A, () => NOW)(adaInB())!;
    expect(next.pen.lastHeartbeat).toBe(iso(NOW - 1000));
    // …but it does refresh its own presence session.
    expect(next.presence.Ada.sessions?.["win-a"]).not.toBe(iso(NOW - 2000));
    const held = heartbeatMutator(B, () => NOW)(adaInB())!;
    expect(held.pen.lastHeartbeat).toBe(iso(NOW));
  });

  it("pass and activity are refused for a sibling session", () => {
    expect(passPenMutator(A)(adaInB())).toBeNull();
    expect(activityMutator(A, NOW)(adaInB())).toBeNull();
    expect(passPenMutator(B)(adaInB())!.pen.holder).toBeNull();
  });

  it("a take by a sibling session of the same name MOVES the pen to it", () => {
    const next = takePenMutator({ name: "Ada", color: "#112233" }, "win-a", "take", () => NOW)(adaInB())!;
    expect(next.pen.holderSession).toBe("win-a");
    expect(holdsPen(next.pen, A)).toBe(true);
    expect(holdsPen(next.pen, B)).toBe(false);
  });

  it("migration: a legacy session-less pen is held by any session of the name until a heartbeat stamps one", () => {
    const legacy = adaInB();
    delete legacy.pen.holderSession;
    expect(holdsPen(legacy.pen, A)).toBe(true);
    expect(holdsPen(legacy.pen, B)).toBe(true);
    const stamped = heartbeatMutator(A, () => NOW)(legacy)!;
    expect(stamped.pen.holderSession).toBe("win-a");
    expect(holdsPen(stamped.pen, B)).toBe(false);
    // And a legacy presence entry (no sessions) is dropped by a release, as before.
    const legacyPresence = adaInB();
    delete legacyPresence.presence.Ada.sessions;
    expect(releaseSelf(A, NOW)(legacyPresence)!.presence.Ada).toBeUndefined();
  });
});
