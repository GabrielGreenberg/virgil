// @vitest-environment jsdom
//
// Task 1014 — the collab identity is per-BROWSER, cached per PANE (every
// mounted `useCollab`) and PROJECTED onto each paper's collab.json (pen holder,
// presence, roster). `setIdentity` used to rename only the calling hook's
// cache: the pen holder kept the old name, so the user's own doc went
// read-only at once ("<old name> is editing"), and the other panes kept in the
// same window never heard the change at all (the native `storage` event never
// fires in the writing window).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import type { CollabSidecar } from "@/lib/collab";

/** One collab.json per doc, keyed by docId. */
const disk = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));

vi.mock("@/lib/storage", () => ({
  readSidecar: async (docId: string, _f: string, fallback: unknown) =>
    structuredClone(disk.docs.get(docId) ?? fallback),
  readTextFile: async () => null,
  mutateSidecar: async (
    h: { docId: string },
    _f: string,
    fallback: unknown,
    fn: (cur: unknown) => unknown,
  ) => {
    const next = fn(structuredClone(disk.docs.get(h.docId) ?? fallback));
    if (next === null) return null;
    disk.docs.set(h.docId, structuredClone(next));
    return next;
  },
}));

import { useCollab } from "../useCollab";
import { saveIdentity } from "@/lib/collab";
import { renameParticipant } from "@/lib/collab-store";

const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:00:30.000Z";

function presence(at: string) {
  return { lastHeartbeat: at, focusedCard: null, selectedCards: [], cursorParagraphId: null };
}

/** Ada holds the pen, is present with a focus claim; Bob has asked for it. */
function adaHolds(): CollabSidecar {
  return {
    enabled: true,
    participants: [
      { name: "Ada", color: "#112233", firstSeen: T0 },
      { name: "Bob", color: "#445566", firstSeen: T0 },
    ],
    pen: {
      holder: "Ada",
      since: T0,
      lastHeartbeat: T0,
      lastActivity: T0,
      requestedBy: [{ name: "Bob", requestedAt: T0 }],
    },
    presence: {
      Ada: {
        ...presence(T1),
        focusedCard: { panelKind: "notes", cardId: "n1", focusedAt: T0, lastHeartbeat: T1 },
      },
      Bob: presence(T0),
    },
  };
}

const ADA2 = { name: "Ada Lovelace", color: "#778899" };

describe("renameParticipant (task 1014)", () => {
  it("moves the holder, presence (with its claim) and roster slot onto the new name", () => {
    const out = renameParticipant(adaHolds(), "Ada", ADA2);
    expect(out.pen.holder).toBe("Ada Lovelace");
    expect(out.pen.since).toBe(T0);
    expect(out.presence.Ada).toBeUndefined();
    expect(out.presence["Ada Lovelace"].focusedCard?.cardId).toBe("n1");
    expect(out.presence.Bob).toEqual(presence(T0));
    expect(out.participants).toEqual([
      { name: "Ada Lovelace", color: "#778899", firstSeen: T0 },
      { name: "Bob", color: "#445566", firstSeen: T0 },
    ]);
  });

  it("renames a pending pen request (the renamer is not the holder)", () => {
    const out = renameParticipant(adaHolds(), "Bob", { name: "Robert", color: "#445566" });
    expect(out.pen.holder).toBe("Ada");
    expect(out.pen.requestedBy).toEqual([{ name: "Robert", requestedAt: T0 }]);
    expect(Object.keys(out.presence).sort()).toEqual(["Ada", "Robert"]);
  });

  it("is idempotent — a second application returns the same object", () => {
    const once = renameParticipant(adaHolds(), "Ada", ADA2);
    expect(renameParticipant(once, "Ada", ADA2)).toBe(once);
  });

  it("is a no-op for a name the sidecar does not carry", () => {
    const s = adaHolds();
    expect(renameParticipant(s, "Zed", { name: "Zoe", color: "#000000" })).toBe(s);
  });

  it("keeps the fresher presence when the new name already has a slot", () => {
    const s = adaHolds();
    s.presence["Ada Lovelace"] = presence(T0); // older stale slot
    const out = renameParticipant(s, "Ada", ADA2);
    expect(out.presence["Ada Lovelace"].lastHeartbeat).toBe(T1);
    expect(out.participants.filter((p) => p.name === "Ada Lovelace")).toHaveLength(1);
  });
});

describe("useCollab — identity change is a door (task 1014)", () => {
  beforeEach(() => {
    localStorage.clear();
    disk.docs.clear();
    saveIdentity({ name: "Ada", color: "#112233" });
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("renaming while holding the pen keeps the pen and editability", async () => {
    disk.docs.set("doc-1", adaHolds());
    const { result } = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(result.current.iHavePen).toBe(true));

    act(() => result.current.setIdentity(ADA2));

    expect(result.current.identity).toEqual(ADA2);
    expect(result.current.iHavePen).toBe(true);
    expect(result.current.canEditMainText).toBe(true);
    await waitFor(() =>
      expect((disk.docs.get("doc-1") as CollabSidecar).pen.holder).toBe("Ada Lovelace"),
    );
    const onDisk = disk.docs.get("doc-1") as CollabSidecar;
    expect(onDisk.presence.Ada).toBeUndefined();
    expect(onDisk.presence["Ada Lovelace"]).toBeDefined();
    // Bob's pending request survives the migration.
    expect(onDisk.pen.requestedBy).toEqual([{ name: "Bob", requestedAt: T0 }]);
  });

  it("every pane mounted in ONE window adopts the new name and migrates its own paper", async () => {
    disk.docs.set("doc-1", adaHolds());
    disk.docs.set("doc-2", adaHolds());
    const a = renderHook(() => useCollab("doc-1"));
    const b = renderHook(() => useCollab("doc-2"));
    const c = renderHook(() => useCollab("doc-1")); // a second pane on doc-1
    await waitFor(() => expect(b.result.current.iHavePen).toBe(true));

    act(() => a.result.current.setIdentity(ADA2));

    for (const h of [a, b, c]) {
      expect(h.result.current.identity).toEqual(ADA2);
      expect(h.result.current.iHavePen).toBe(true);
    }
    await waitFor(() => {
      for (const id of ["doc-1", "doc-2"]) {
        expect((disk.docs.get(id) as CollabSidecar).pen.holder).toBe("Ada Lovelace");
      }
    });
    // Two panes migrating doc-1 converge on one roster slot.
    const d1 = disk.docs.get("doc-1") as CollabSidecar;
    expect(d1.participants.map((p) => p.name)).toEqual(["Ada Lovelace", "Bob"]);
  });

  it("an unchanged identity writes nothing", async () => {
    disk.docs.set("doc-1", adaHolds());
    const { result } = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(result.current.iHavePen).toBe(true));
    const before = disk.docs.get("doc-1");
    act(() => result.current.setIdentity({ name: "Ada", color: "#112233" }));
    expect(disk.docs.get("doc-1")).toBe(before);
  });
});
