// @vitest-environment jsdom
// Task 1392 — reload continuity is keyed by the CHECKED window id: a reload
// finds its dead predecessor sessions; a duplicated tab (whose claim re-mints
// the window id) finds none, so it cannot adopt the original's pen.

import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = { id: "w1", inheritedId: "w1" };
vi.mock("@/lib/multi-window/window-liveness", () => ({
  claimWindowIdentity: () => Promise.resolve(identity),
}));
vi.mock("@/lib/multi-window/window-id", () => ({
  getWindowId: () => identity.id,
}));

import {
  __resetCollabSessionsForTest,
  forgetCollabSession,
  holdLiveSession,
  inheritCollabSessions,
} from "@/lib/collab-session";

beforeEach(() => {
  sessionStorage.clear();
  __resetCollabSessionsForTest();
  identity.id = "w1";
  identity.inheritedId = "w1";
});

describe("collab session continuity (task 1392)", () => {
  it("a reload (same window id) inherits the dead predecessor", async () => {
    // Page 1: session s1 on paper P.
    const release = holdLiveSession("s1");
    expect(await inheritCollabSessions("P", "s1")).toEqual([]);
    // Reload: the page's live set is gone; the record survives.
    release();
    __resetCollabSessionsForTest();
    holdLiveSession("s2");
    expect(await inheritCollabSessions("P", "s2")).toEqual(["s1"]);
    // s2 now carries what s1 held; a further reload inherits s2, not s1.
    __resetCollabSessionsForTest();
    expect(await inheritCollabSessions("P", "s3")).toEqual(["s2"]);
  });

  it("a duplicated tab (re-minted window id) inherits nothing", async () => {
    holdLiveSession("s1");
    await inheritCollabSessions("P", "s1");
    // Duplicate tab: sessionStorage copied, but the claim re-mints the id.
    __resetCollabSessionsForTest();
    identity.id = "w2";
    identity.inheritedId = "w1";
    expect(await inheritCollabSessions("P", "s9")).toEqual([]);
  });

  it("a sibling pane's LIVE session is kept, never returned", async () => {
    holdLiveSession("s1");
    await inheritCollabSessions("P", "s1");
    holdLiveSession("s2");
    expect(await inheritCollabSessions("P", "s2")).toEqual([]);
  });

  it("a clean leave is forgotten — a later reload does not adopt it", async () => {
    const release = holdLiveSession("s1");
    await inheritCollabSessions("P", "s1");
    forgetCollabSession("P", "s1");
    release();
    expect(await inheritCollabSessions("P", "s2")).toEqual([]);
  });

  it("a hook that went away during the identity await registers nothing", async () => {
    expect(await inheritCollabSessions("P", "s1", () => false)).toEqual([]);
    expect(await inheritCollabSessions("P", "s2")).toEqual([]);
  });
});
