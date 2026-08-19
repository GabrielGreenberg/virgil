/**
 * Task 391 — the emergency mirror's own contract.
 *
 * The mirror exists for the states in which a disk write CANNOT land, so every
 * leg here drives the real arming predicate and the real ticker against the
 * real unsaved-work channel. The behaviour that matters is not "does it write a
 * record" — it is WHEN it writes and, just as load-bearing, when it does NOT:
 * a mirror that ticks while saves are landing is a per-5-second IndexedDB write
 * on every open paper, and one that stays silent under a standing refusal is
 * the 2026-08-19 incident with extra machinery.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { JSONContent } from "@tiptap/react";

import {
  MIRROR_ARM_AFTER_MS,
  createMirrorTicker,
  shouldMirror,
  type EmergencyMirrorEntry,
} from "@/lib/emergency-mirror";
import {
  clearUnsavedWork,
  getUnsavedWork,
  noteSaveBlocked,
  noteSaveLanded,
  noteUnsavedEdit,
  hasUnlandedWork,
  docsWithUnlandedWork,
  subscribeUnsavedWork,
  unsavedAgeMs,
} from "@/lib/unsaved-work";

const DOC = "paper-a";
const T0 = 1_000_000;

function doc(text: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

beforeEach(() => {
  clearUnsavedWork();
});

describe("the unsaved-work channel", () => {
  it("is clean until a real edit, and clean again only on a LANDED write", () => {
    expect(hasUnlandedWork(DOC)).toBe(false);
    noteUnsavedEdit(DOC, T0);
    expect(hasUnlandedWork(DOC)).toBe(true);

    // A refusal must NOT clear it — that was the pre-391 hole: the debounce
    // handle was nulled before the write, so a refused write read as clean.
    noteSaveBlocked(DOC, "preservation", T0 + 100);
    expect(hasUnlandedWork(DOC)).toBe(true);
    expect(getUnsavedWork(DOC)?.reason).toBe("preservation");
    // …and the dirty clock is NOT restarted by the refusal.
    expect(getUnsavedWork(DOC)?.dirtySince).toBe(T0);

    noteSaveLanded(DOC, T0 + 200);
    expect(hasUnlandedWork(DOC)).toBe(false);
    expect(getUnsavedWork(DOC)?.reason).toBe(null);
    expect(getUnsavedWork(DOC)?.lastLandedAt).toBe(T0 + 200);
  });

  it("notifies on the clean→dirty EDGE only — a typing burst is one notification", () => {
    let fires = 0;
    const off = subscribeUnsavedWork(() => fires++);
    for (let i = 0; i < 50; i++) noteUnsavedEdit(DOC, T0 + i);
    expect(fires).toBe(1);
    // A standing block re-attempted every 1500 ms must not re-render the topbar.
    for (let i = 0; i < 20; i++) noteSaveBlocked(DOC, "conflict", T0 + 100 + i);
    expect(fires).toBe(2); // the reason CHANGED once, then held
    off();
  });

  it("reports age, and the app-wide door sees BACKGROUND docs too", () => {
    noteUnsavedEdit("bg-paper", T0);
    expect(unsavedAgeMs("bg-paper", T0 + 47 * 60_000)).toBe(47 * 60_000);
    expect(docsWithUnlandedWork().map((d) => d.docId)).toEqual(["bg-paper"]);
    noteSaveLanded("bg-paper", T0 + 1);
    expect(docsWithUnlandedWork()).toEqual([]);
  });

  it("a block on a doc with no recorded edit still marks it dirty (the mint-flush shape)", () => {
    // `flushNow` writes without any typing, so a refusal there is the FIRST
    // thing that knows the model is unlanded.
    noteSaveBlocked(DOC, "error", T0);
    expect(hasUnlandedWork(DOC)).toBe(true);
    expect(getUnsavedWork(DOC)?.dirtySince).toBe(T0);
  });
});

describe("shouldMirror — the arming predicate", () => {
  it("never arms on a clean doc, however old", () => {
    expect(shouldMirror(null, T0)).toBe(false);
    noteSaveLanded(DOC, T0);
    expect(shouldMirror(getUnsavedWork(DOC), T0 + 10 * 60_000)).toBe(false);
  });

  it("arms IMMEDIATELY on a blocked doc — this is the incident's state", () => {
    noteUnsavedEdit(DOC, T0);
    noteSaveBlocked(DOC, "conflict", T0);
    expect(shouldMirror(getUnsavedWork(DOC), T0)).toBe(true);
  });

  it("holds an unblocked doc until it AGES, so ordinary typing never mirrors", () => {
    noteUnsavedEdit(DOC, T0);
    expect(shouldMirror(getUnsavedWork(DOC), T0 + 1500)).toBe(false);
    expect(shouldMirror(getUnsavedWork(DOC), T0 + MIRROR_ARM_AFTER_MS)).toBe(true);
  });

  it("`force` bypasses AGING but never the dirty test — a door may not mirror clean work", () => {
    noteUnsavedEdit(DOC, T0);
    expect(shouldMirror(getUnsavedWork(DOC), T0 + 10, true)).toBe(true);
    noteSaveLanded(DOC, T0 + 20);
    expect(shouldMirror(getUnsavedWork(DOC), T0 + 30, true)).toBe(false);
  });
});

describe("the ticker", () => {
  function harness(model: () => JSONContent | null) {
    const writes: EmergencyMirrorEntry[] = [];
    const ticker = createMirrorTicker({
      docId: DOC,
      getModel: model,
      windowId: "w1",
      write: async (e) => {
        writes.push(e);
      },
    });
    return { ticker, writes };
  }

  it("writes nothing while saves are landing", async () => {
    let text = "a";
    const { ticker, writes } = harness(() => doc(text));
    noteSaveLanded(DOC, T0);
    for (let i = 0; i < 10; i++) {
      text = `a${i}`;
      expect(await ticker.tick({ now: T0 + i * 5000 })).toBe("not-armed");
    }
    expect(writes).toEqual([]);
  });

  it("writes once on a blocked doc, then EQUALITY-BAILS until the model changes", async () => {
    let text = "one";
    const { ticker, writes } = harness(() => doc(text));
    noteUnsavedEdit(DOC, T0);
    noteSaveBlocked(DOC, "conflict", T0);

    expect(await ticker.tick({ now: T0 })).toBe("written");
    expect(await ticker.tick({ now: T0 + 5000 })).toBe("unchanged");
    expect(await ticker.tick({ now: T0 + 10000 })).toBe("unchanged");
    text = "two";
    expect(await ticker.tick({ now: T0 + 15000 })).toBe("written");

    expect(writes).toHaveLength(2);
    expect(writes[0].reason).toBe("conflict");
    expect(writes[0].windowId).toBe("w1");
    expect(writes[1].content).toEqual(doc("two"));
    expect(writes[1].savedAt).toBe(T0 + 15000);
  });

  it("carries the metadata a recovery decision needs", async () => {
    const { ticker, writes } = harness(() => doc("x"));
    noteSaveLanded(DOC, T0 - 60_000);
    noteUnsavedEdit(DOC, T0);
    noteSaveBlocked(DOC, "preservation", T0);
    await ticker.tick({ now: T0 });
    expect(writes[0].lastLandedAt).toBe(T0 - 60_000);
    expect(writes[0].reason).toBe("preservation");
    expect(writes[0].hash).toBeTruthy();
  });

  it("a failed IndexedDB write is a NET failing, never a gate — it does not throw", async () => {
    const ticker = createMirrorTicker({
      docId: DOC,
      getModel: () => doc("x"),
      windowId: "w1",
      write: async () => {
        throw new Error("QuotaExceededError");
      },
    });
    noteUnsavedEdit(DOC, T0);
    noteSaveBlocked(DOC, "error", T0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(ticker.tick({ now: T0 })).resolves.toBe("unchanged");
    warn.mockRestore();
  });

  it("reset() re-writes at identical content — a cleared slot must be refilled", async () => {
    const { ticker, writes } = harness(() => doc("same"));
    noteUnsavedEdit(DOC, T0);
    noteSaveBlocked(DOC, "conflict", T0);
    await ticker.tick({ now: T0 });
    expect(await ticker.tick({ now: T0 + 5000 })).toBe("unchanged");
    ticker.reset(); // what a landed save does, alongside clearing the slot
    expect(await ticker.tick({ now: T0 + 10000 })).toBe("written");
    expect(writes).toHaveLength(2);
  });

  it("an editor that is gone reports no-model rather than mirroring nothing over the work", async () => {
    const { ticker, writes } = harness(() => null);
    noteUnsavedEdit(DOC, T0);
    noteSaveBlocked(DOC, "conflict", T0);
    expect(await ticker.tick({ now: T0 })).toBe("no-model");
    expect(writes).toEqual([]);
  });
});
