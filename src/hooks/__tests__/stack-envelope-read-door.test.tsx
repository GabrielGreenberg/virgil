// @vitest-environment jsdom
/**
 * **The Stack's read door tells "unreadable" from "empty" (task 1100).**
 *
 * `readEnvelope` used to answer the empty envelope for a corrupt blob, another
 * build's version, and any list holding one malformed item — and the add door
 * built `[newItem, ...thatEmptyList]` and WROTE it, replacing every stored clip
 * with the one new capture. Now: one bad item costs only itself; a foreign
 * envelope is never overwritten; a corrupt one is quarantined before the Stack
 * starts fresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  addStackItem,
  readStackItem,
  useStack,
  STACK_QUARANTINE_KEY,
} from "../useStack";
import { STACK_STORAGE_KEY, type StackItem } from "@/lib/stack/types";
import type { StackBibCtx } from "@/lib/stack/bib-carry";
import {
  STACK_ADD_REFUSAL_NOTICE,
  type StackAddRefusal,
} from "@/lib/stack/add-report";
import { summarizeStackItem } from "@/lib/stack/snapshot";
import { stackItemKindLabel } from "@/components/stack/StackThumbnail";

const NO_BIB: StackBibCtx = {
  getBibEntry: () => undefined,
  getAnnotation: () => "",
};

function textItem(id: string): StackItem {
  return {
    id,
    capturedAt: "2026-10-13T00:00:00.000Z",
    source: { docId: "docA" },
    payload: { kind: "text", slice: null, plain: `clip ${id}` },
  };
}

function store(value: unknown) {
  localStorage.setItem(
    STACK_STORAGE_KEY,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

describe("Stack read door — unreadable is not empty", () => {
  beforeEach(() => localStorage.clear());

  it("(a) a null entry costs only itself; the next add keeps the valid item", () => {
    store({ version: 1, items: [null, textItem("keep")] });

    const { result } = renderHook(() => useStack());
    expect(result.current.items.map((i) => i.id)).toEqual(["keep"]);

    expect(addStackItem(textItem("new"), NO_BIB).ok).toBe(true);
    expect(readStackItem("keep")).not.toBeNull();
    expect(readStackItem("new")).not.toBeNull();
  });

  it("(b) another build's envelope is never overwritten — the add refuses", () => {
    const foreign = JSON.stringify({ version: 2, items: [{ id: "x" }] });
    store(foreign);

    expect(addStackItem(textItem("new"), NO_BIB).ok).toBe(false);
    expect(localStorage.getItem(STACK_STORAGE_KEY)).toBe(foreign);
  });

  it("(b') a foreign envelope reads as empty and `remove` writes nothing", () => {
    const foreign = JSON.stringify({ version: 2, items: [textItem("x")] });
    store(foreign);
    const { result } = renderHook(() => useStack());
    expect(result.current.items).toEqual([]);
    expect(result.current.remove("x")).toBe(false);
    expect(localStorage.getItem(STACK_STORAGE_KEY)).toBe(foreign);
  });

  it("(c) a blob that does not parse is quarantined, then the Stack starts fresh", () => {
    store("not json");

    expect(addStackItem(textItem("new"), NO_BIB).ok).toBe(true);
    expect(localStorage.getItem(STACK_QUARANTINE_KEY)).toBe("not json");
    expect(readStackItem("new")).not.toBeNull();
  });

  it("(d) an item with no payload (or an unknown kind) is filtered; the strip renders", () => {
    store({
      version: 1,
      items: [
        { id: "no-payload", capturedAt: "x", source: { docId: null } },
        { id: "bad-kind", payload: { kind: "mystery" } },
        textItem("ok"),
      ],
    });

    const { result } = renderHook(() => useStack());
    expect(result.current.items.map((i) => i.id)).toEqual(["ok"]);
    for (const it of result.current.items) {
      expect(() => summarizeStackItem(it)).not.toThrow();
      expect(() => stackItemKindLabel(it)).not.toThrow();
    }
  });
});

/**
 * **Every refusal says WHY, and the notice is derived from it (task 1285).**
 * The add door returned a bare `false` for four reasons, and the terminal told
 * the user "The Stack is full — remove some items" for all of them, including
 * the ones where the strip is empty and nothing can be removed.
 */
/**
 * **An item this build cannot read is carried, not erased (task 1478).** The
 * read door used to drop a foreign payload kind for DISPLAY and the write
 * doors then built their write from that filtered list — so another build's
 * capture vanished on this build's next add or remove.
 */
describe("Stack write doors — a foreign-kind item rides along", () => {
  beforeEach(() => localStorage.clear());

  const future = {
    id: "future",
    capturedAt: "2026-10-13T00:00:00.000Z",
    source: { docId: "docA" },
    payload: { kind: "future-kind", data: { whatever: [1, 2] } },
  };
  function storedEntries(): unknown[] {
    return JSON.parse(localStorage.getItem(STACK_STORAGE_KEY)!).items;
  }

  it("addStackItem keeps the future item verbatim, in its place", () => {
    store({ version: 1, items: [textItem("old"), future] });
    expect(addStackItem(textItem("new"), NO_BIB)).toEqual({ ok: true });
    const entries = storedEntries() as { id: string }[];
    expect(entries.map((e) => e.id)).toEqual(["new", "old", "future"]);
    expect(entries[2]).toEqual(future);
  });

  it("remove deletes only the readable target and keeps the future item", () => {
    store({ version: 1, items: [future, textItem("gone"), textItem("stay")] });
    const { result } = renderHook(() => useStack());
    expect(result.current.items.map((i) => i.id)).toEqual(["gone", "stay"]);
    let ok = false;
    act(() => {
      ok = result.current.remove("gone");
    });
    expect(ok).toBe(true);
    expect(result.current.items.map((i) => i.id)).toEqual(["stay"]);
    expect(storedEntries()).toEqual([future, textItem("stay")]);
  });

  it("remove of a foreign-kind id writes nothing (the strip never offered it)", () => {
    store({ version: 1, items: [future] });
    const before = localStorage.getItem(STACK_STORAGE_KEY);
    const { result } = renderHook(() => useStack());
    expect(result.current.remove("future")).toBe(false);
    expect(localStorage.getItem(STACK_STORAGE_KEY)).toBe(before);
  });

  it("a structurally corrupt entry is still dropped on write", () => {
    store({ version: 1, items: [null, { id: "no-payload" }, { payload: { kind: "text" } }, textItem("ok")] });
    expect(addStackItem(textItem("new"), NO_BIB).ok).toBe(true);
    expect((storedEntries() as { id: string }[]).map((e) => e.id)).toEqual(["new", "ok"]);
  });
});

describe("Stack add door — a refusal carries its own reason", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  function quotaError() {
    const err = new Error("exceeded the quota");
    err.name = "QuotaExceededError";
    return err;
  }

  it("another build's envelope → foreign", () => {
    store({ version: 2, items: [] });
    expect(addStackItem(textItem("new"), NO_BIB)).toEqual({ ok: false, reason: "foreign" });
  });

  it("storage that throws on read → unreadable-storage (not foreign)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(addStackItem(textItem("new"), NO_BIB)).toEqual({
      ok: false,
      reason: "unreadable-storage",
    });
  });

  /**
   * A FAITHFUL quota (task 1477): `setItem` REPLACES the key's value, and the
   * quota is measured on what storage holds AFTER the replacement — the old
   * value's bytes are given back. An unconditional throw (the task-1285 shim)
   * made "remove some items" look like a remedy it can never be.
   */
  function fakeQuota(limit: number) {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      let total = 0;
      for (let i = 0; i < this.length; i++) {
        const k = this.key(i)!;
        if (k !== key) total += k.length + (this.getItem(k) ?? "").length;
      }
      if (total + key.length + value.length > limit) throw quotaError();
      return real.call(this, key, value);
    });
  }

  it("a write that fails even for the new item alone → too-large, whatever the strip holds", () => {
    expect(addStackItem(textItem("resident"), NO_BIB).ok).toBe(true);
    const stored = localStorage.getItem(STACK_STORAGE_KEY)!;
    // Room for the Stack exactly as it is, and nothing more.
    localStorage.setItem("virgil:other-prefs", "x".repeat(200));
    const used = STACK_STORAGE_KEY.length + stored.length + "virgil:other-prefs".length + 200;
    fakeQuota(used);
    const big = textItem("big");
    big.payload = { kind: "text", slice: null, plain: "y".repeat(stored.length * 3) };
    expect(addStackItem(big, NO_BIB)).toEqual({ ok: false, reason: "too-large" });

    // The remedy the old copy offered: empty the Stack, retry. Same refusal —
    // the final attempt had already written over every byte the Stack held.
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.removeItem(STACK_STORAGE_KEY);
    fakeQuota(used);
    expect(addStackItem(big, NO_BIB)).toEqual({ ok: false, reason: "too-large" });
  });

  it("the notice for that refusal never tells the user to remove items", () => {
    const notice = STACK_ADD_REFUSAL_NOTICE["too-large"];
    expect(notice.message).not.toMatch(/remove/i);
    expect(notice.title).not.toMatch(/full/i);
  });

  it("a quarantine that cannot land → quarantine-failed", () => {
    store("not json");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError();
    });
    expect(addStackItem(textItem("new"), NO_BIB)).toEqual({
      ok: false,
      reason: "quarantine-failed",
    });
  });

  it("a quarantine that fails for room drops the OLDER quarantine and retries — no wedge", () => {
    localStorage.setItem(STACK_QUARANTINE_KEY, "older damage");
    store("not json");
    const real = Storage.prototype.setItem;
    let thrown = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      // Room only once the older quarantine is gone.
      if (key === STACK_QUARANTINE_KEY && this.getItem(STACK_QUARANTINE_KEY) !== null) {
        thrown = true;
        throw quotaError();
      }
      return real.call(this, key, value);
    });
    expect(addStackItem(textItem("new"), NO_BIB)).toEqual({ ok: true });
    expect(thrown).toBe(true);
    expect(localStorage.getItem(STACK_QUARANTINE_KEY)).toBe("not json");
    expect(readStackItem("new")).not.toBeNull();
  });
});

describe("Stack refusal copy — derived per reason", () => {
  it("is exhaustive over the reason union", () => {
    const reasons: Record<StackAddRefusal, true> = {
      "too-large": true,
      foreign: true,
      "unreadable-storage": true,
      "quarantine-failed": true,
    };
    expect(Object.keys(STACK_ADD_REFUSAL_NOTICE).sort()).toEqual(Object.keys(reasons).sort());
  });

  it("no refusal tells the user to remove items — the add door refuses only after the new item ALONE failed", () => {
    for (const [reason, notice] of Object.entries(STACK_ADD_REFUSAL_NOTICE)) {
      const says = /remove some items/i.test(notice.message) || /full/i.test(notice.title);
      expect(says, `"${reason}" must not offer removing items as a remedy`).toBe(false);
    }
  });
});
