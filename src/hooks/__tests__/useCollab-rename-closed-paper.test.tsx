// @vitest-environment jsdom
//
// Task 1281 — renaming the collab identity migrated only the papers MOUNTED at
// that moment (task 1014's subscription). A paper that was closed kept the old
// name in its collab.json — pen holder, presence, roster — and the next open
// appended the new name beside it: a phantom duplicate collaborator, and an
// old-name pen that read as someone else's. The identity now carries a rename
// LEDGER (`saveIdentity` owns it) and every load folds it through ONE door,
// `adoptIdentity`, which the mounted migration also uses.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
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
import {
  COLLAB_PREVIOUS_NAMES_MAX,
  loadIdentity,
  saveIdentity,
} from "@/lib/collab";
import { adoptIdentity, COLLAB_RENAME_GRACE_MS } from "@/lib/collab-store";

const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:00:30.000Z";
const T0_MS = Date.parse(T0);

function presence(at: string) {
  return { lastHeartbeat: at, focusedCard: null, selectedCards: [], cursorParagraphId: null };
}

/** Ada holds the pen (a legacy, session-less record — e.g. the pagehide
 *  release was cut off), is present, and Bob has asked for the pen. */
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
    presence: { Ada: presence(T1), Bob: presence(T0) },
  };
}

const ADA2 = { name: "Ada Lovelace", color: "#778899" };

beforeEach(() => {
  localStorage.clear();
  disk.docs.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("saveIdentity keeps the rename ledger (task 1281)", () => {
  it("a rename records the outgoing name with when it was given up", () => {
    saveIdentity({ name: "Ada", color: "#112233" });
    saveIdentity(ADA2, () => T0_MS);
    expect(loadIdentity()).toEqual({
      ...ADA2,
      previousNames: [{ name: "Ada", until: T0 }],
    });
  });

  it("a colour-only change records nothing; a caller's stale copy can't drop the ledger", () => {
    saveIdentity({ name: "Ada", color: "#112233" });
    saveIdentity(ADA2, () => T0_MS);
    saveIdentity({ name: "Ada Lovelace", color: "#abcdef" }); // no previousNames passed
    expect(loadIdentity()?.previousNames).toEqual([{ name: "Ada", until: T0 }]);
  });

  it("renaming BACK drops the current name from the ledger; it stays bounded", () => {
    saveIdentity({ name: "Ada", color: "#112233" });
    saveIdentity(ADA2, () => T0_MS);
    saveIdentity({ name: "Ada", color: "#112233" }, () => T0_MS + 1000);
    expect(loadIdentity()?.previousNames).toEqual([
      { name: "Ada Lovelace", until: new Date(T0_MS + 1000).toISOString() },
    ]);
    for (let i = 0; i < COLLAB_PREVIOUS_NAMES_MAX + 4; i++) {
      saveIdentity({ name: `N${i}`, color: "#112233" }, () => T0_MS + 2000 + i);
    }
    const ledger = loadIdentity()?.previousNames ?? [];
    expect(ledger).toHaveLength(COLLAB_PREVIOUS_NAMES_MAX);
    expect(ledger[0].name).toBe(`N${COLLAB_PREVIOUS_NAMES_MAX + 2}`);
  });

  it("the ledger never reaches a paper's roster", async () => {
    saveIdentity({ name: "Ada", color: "#112233" });
    saveIdentity(ADA2, () => T0_MS);
    disk.docs.set("doc-1", { ...adaHolds(), participants: [], presence: {} });
    const { result } = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(result.current.identity?.name).toBe("Ada Lovelace"));
    await result.current.enableCollab();
    const roster = (disk.docs.get("doc-1") as CollabSidecar).participants;
    expect(roster).toEqual([
      expect.objectContaining({ name: "Ada Lovelace", color: "#778899" }),
    ]);
    expect(roster[0]).not.toHaveProperty("previousNames");
  });
});

describe("adoptIdentity — the one migration door (task 1281)", () => {
  const me = { ...ADA2, previousNames: [{ name: "Ada", until: T1 }] };

  it("folds a released name whose traces all predate its release", () => {
    const out = adoptIdentity(adaHolds(), me);
    expect(out.pen.holder).toBe("Ada Lovelace");
    expect(out.pen.requestedBy).toEqual([{ name: "Bob", requestedAt: T0 }]);
    expect(Object.keys(out.presence).sort()).toEqual(["Ada Lovelace", "Bob"]);
    expect(out.participants.map((p) => p.name)).toEqual(["Ada Lovelace", "Bob"]);
    expect(adoptIdentity(out, me)).toBe(out); // idempotent
  });

  it("leaves a released name alone once someone else has used it since", () => {
    const s = adaHolds();
    const later = new Date(Date.parse(T1) + COLLAB_RENAME_GRACE_MS + 1000).toISOString();
    s.presence.Ada = presence(later); // a different "Ada", after my rename
    expect(adoptIdentity(s, me)).toBe(s);
  });

  it("is prev itself when the sidecar already reflects me", () => {
    const s: CollabSidecar = { ...adaHolds(), participants: [], presence: {} };
    s.pen = { ...s.pen, holder: null };
    expect(adoptIdentity(s, me)).toBe(s);
  });
});

describe("useCollab — a paper CLOSED during the rename converges on open (task 1281)", () => {
  it("one roster entry under the new name, and the old-name pen is mine", async () => {
    saveIdentity({ name: "Ada", color: "#112233" });
    disk.docs.set("doc-closed", adaHolds());
    // Rename with NO hook mounted on doc-closed.
    saveIdentity(ADA2);

    const { result } = renderHook(() => useCollab("doc-closed"));
    await waitFor(() =>
      expect((disk.docs.get("doc-closed") as CollabSidecar).pen.holder).toBe("Ada Lovelace"),
    );
    const onDisk = disk.docs.get("doc-closed") as CollabSidecar;
    expect(onDisk.participants).toEqual([
      { name: "Ada Lovelace", color: "#778899", firstSeen: T0 },
      { name: "Bob", color: "#445566", firstSeen: T0 },
    ]);
    expect(onDisk.presence.Ada).toBeUndefined();
    expect(onDisk.presence["Ada Lovelace"]).toBeDefined();
    await waitFor(() => expect(result.current.iHavePen).toBe(true));
  });

  it("a colour-only change made while the paper was closed recolours its roster slot", async () => {
    saveIdentity({ name: "Ada", color: "#112233" });
    disk.docs.set("doc-closed", adaHolds());
    saveIdentity({ name: "Ada", color: "#abcdef" });

    renderHook(() => useCollab("doc-closed"));
    await waitFor(() =>
      expect((disk.docs.get("doc-closed") as CollabSidecar).participants[0]).toEqual({
        name: "Ada",
        color: "#abcdef",
        firstSeen: T0,
      }),
    );
  });

  it("an up-to-date paper is not written on open", async () => {
    saveIdentity(ADA2);
    const s: CollabSidecar = { ...adaHolds(), participants: [], presence: {} };
    s.pen = { ...s.pen, holder: null, requestedBy: [] };
    disk.docs.set("doc-1", s);
    const before = JSON.stringify(s);
    const { result } = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(result.current.identity?.name).toBe("Ada Lovelace"));
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.stringify(disk.docs.get("doc-1"))).toBe(before);
  });
});
