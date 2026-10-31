// Task 1392 — the residual members of task 1213's class: the focus claim was
// still owned by the NAME (a sibling session's heartbeat kept a closed
// window's claim fresh forever, and a sibling's release cleared a live one),
// a reload stranded the pen under the dead session, and every sweep rewrote
// collab.json whether or not anything was stale.

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ mutateSidecar: vi.fn() }));
import {
  adoptSessionsMutator,
  claimCardMutator,
  heartbeatMutator,
  releaseClaimMutator,
  releaseSelf,
  sweepMutator,
} from "@/lib/collab-store";
import {
  COLLAB_TIMINGS,
  findClaim,
  holdsClaim,
  holdsPen,
  sweepStalePresence,
  type CollabSidecar,
} from "@/lib/collab";

const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const A = { name: "Ada", session: "win-a" };
const B = { name: "Ada", session: "win-b" };
const clock = () => NOW;

// `touchPresence` stamps the wall clock; pin it to the fixture's NOW.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

function base(): CollabSidecar {
  return {
    enabled: true,
    participants: [
      { name: "Ada", color: "#112233", firstSeen: iso(NOW - 1e6) },
      { name: "Bo", color: "#445566", firstSeen: iso(NOW - 1e6) },
    ],
    pen: {
      holder: null,
      holderSession: null,
      since: null,
      lastHeartbeat: null,
      lastActivity: null,
      requestedBy: [],
    },
    presence: {
      Ada: {
        lastHeartbeat: iso(NOW - 1000),
        focusedCard: null,
        selectedCards: [],
        cursorParagraphId: null,
        sessions: { "win-a": iso(NOW - 1000), "win-b": iso(NOW - 1000) },
      },
    },
  };
}

describe("the focus claim is the session's, not the name's (task 1392)", () => {
  it("a claim stamps the claiming session", () => {
    const next = claimCardMutator(A, "notes", "n1", clock)(base())!;
    const claim = next.presence.Ada.focusedCard!;
    expect(claim.session).toBe("win-a");
    expect(holdsClaim(claim, A)).toBe(true);
    expect(holdsClaim(claim, B)).toBe(false);
  });

  it("a sibling session's heartbeat does not refresh the claim — it ages out once A stops", () => {
    const claimed = claimCardMutator(A, "notes", "n1", () => NOW - 2 * COLLAB_TIMINGS.cardStaleMs)(base())!;
    const beat = heartbeatMutator(B, clock)(claimed)!;
    const claim = beat.presence.Ada.focusedCard!;
    expect(claim.lastHeartbeat).toBe(claimed.presence.Ada.focusedCard!.lastHeartbeat);
    // The partner is no longer locked out of n1.
    expect(findClaim(beat, "Bo", "notes", "n1", NOW)).toBeNull();
  });

  it("the claiming session's heartbeat does refresh it", () => {
    const claimed = claimCardMutator(A, "notes", "n1", () => NOW - 5000)(base())!;
    const beat = heartbeatMutator(A, clock)(claimed)!;
    expect(beat.presence.Ada.focusedCard!.lastHeartbeat).toBe(iso(NOW));
    expect(findClaim(beat, "Bo", "notes", "n1", NOW)?.holder).toBe("Ada");
  });

  it("a sibling session's releaseClaim leaves the live claim", () => {
    const claimed = claimCardMutator(A, "notes", "n1", clock)(base())!;
    expect(releaseClaimMutator(B)(claimed)).toBeNull();
    const released = releaseClaimMutator(A)(claimed)!;
    expect(released.presence.Ada.focusedCard).toBeNull();
  });

  it("closing A (releaseSelf) takes A's claim even while B keeps the entry", () => {
    const claimed = claimCardMutator(A, "notes", "n1", clock)(base())!;
    const next = releaseSelf(A, NOW)(claimed)!;
    expect(next.presence.Ada).toBeDefined();
    expect(next.presence.Ada.sessions).toEqual({ "win-b": iso(NOW - 1000) });
    expect(next.presence.Ada.focusedCard).toBeNull();
  });

  it("closing B leaves A's claim", () => {
    const claimed = claimCardMutator(A, "notes", "n1", clock)(base())!;
    const next = releaseSelf(B, NOW)(claimed)!;
    expect(next.presence.Ada.focusedCard?.cardId).toBe("n1");
  });

  it("migration: a legacy session-less claim is held by any session of the name until a heartbeat stamps it", () => {
    const legacy = base();
    legacy.presence.Ada.focusedCard = {
      panelKind: "notes",
      cardId: "n1",
      focusedAt: iso(NOW - 5000),
      lastHeartbeat: iso(NOW - 5000),
    };
    expect(holdsClaim(legacy.presence.Ada.focusedCard, B)).toBe(true);
    const stamped = heartbeatMutator(B, clock)(legacy)!;
    expect(stamped.presence.Ada.focusedCard!.session).toBe("win-b");
    expect(holdsClaim(stamped.presence.Ada.focusedCard, A)).toBe(false);
  });
});

describe("a reload's new session adopts what its dead predecessor held (task 1392)", () => {
  const R = { name: "Ada", session: "win-a-reloaded" };

  function heldByA(): CollabSidecar {
    const s = claimCardMutator(A, "notes", "n1", clock)(base())!;
    return {
      ...s,
      pen: {
        holder: "Ada",
        holderSession: "win-a",
        since: iso(NOW - 9000),
        lastHeartbeat: iso(NOW - 1000),
        lastActivity: iso(NOW - 1000),
        requestedBy: [],
      },
    };
  }

  it("the pen, the claim and the session stamp move to the new session", () => {
    const next = adoptSessionsMutator(R, ["win-a"], clock)(heldByA())!;
    expect(holdsPen(next.pen, R)).toBe(true);
    expect(holdsPen(next.pen, A)).toBe(false);
    expect(next.pen.since).toBe(iso(NOW - 9000));
    expect(holdsClaim(next.presence.Ada.focusedCard, R)).toBe(true);
    expect(next.presence.Ada.sessions).toEqual({
      "win-b": iso(NOW - 1000),
      "win-a-reloaded": iso(NOW),
    });
  });

  it("adopts nothing a sibling session holds", () => {
    const s = heldByA();
    s.pen = { ...s.pen, holderSession: "win-b" };
    const next = adoptSessionsMutator(R, ["win-a"], clock)(s)!;
    expect(next.pen.holderSession).toBe("win-b");
  });

  it("is a no-op once adopted (two panes of one reload race through the queue)", () => {
    const once = adoptSessionsMutator(R, ["win-a"], clock)(heldByA())!;
    const R2 = { name: "Ada", session: "win-a-reloaded-pane-2" };
    expect(adoptSessionsMutator(R2, ["win-a"], clock)(once)).toBeNull();
  });

  it("never adopts a partner's pen", () => {
    const s = heldByA();
    s.pen = { ...s.pen, holder: "Bo", holderSession: "win-a" };
    const next = adoptSessionsMutator(R, ["win-a"], clock)(s)!;
    expect(next.pen.holder).toBe("Bo");
    expect(next.pen.holderSession).toBe("win-a");
  });
});

describe("an idle sweep writes nothing (task 1392)", () => {
  it("sweepStalePresence returns the same object when nothing is stale", () => {
    const s = base();
    expect(sweepStalePresence(s, NOW)).toBe(s);
    expect(sweepMutator(clock)(s)).toBeNull();
  });

  it("still sweeps a stale entry", () => {
    const s = base();
    s.presence.Bo = {
      lastHeartbeat: iso(NOW - COLLAB_TIMINGS.penStaleMs - 1),
      focusedCard: null,
      selectedCards: [],
      cursorParagraphId: null,
    };
    const next = sweepMutator(clock)(s)!;
    expect(next.presence.Bo).toBeUndefined();
    expect(next.presence.Ada).toBeDefined();
  });
});
