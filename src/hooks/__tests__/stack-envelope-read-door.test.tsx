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
import { renderHook } from "@testing-library/react";
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

  it("a write that fails with items stored → full; with the Stack empty → no-room", () => {
    expect(addStackItem(textItem("resident"), NO_BIB).ok).toBe(true);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError();
    });
    expect(addStackItem(textItem("new"), NO_BIB)).toEqual({ ok: false, reason: "full" });
    set.mockRestore();

    localStorage.clear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError();
    });
    expect(addStackItem(textItem("new"), NO_BIB)).toEqual({ ok: false, reason: "no-room" });
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
      full: true,
      "no-room": true,
      foreign: true,
      "unreadable-storage": true,
      "quarantine-failed": true,
    };
    expect(Object.keys(STACK_ADD_REFUSAL_NOTICE).sort()).toEqual(Object.keys(reasons).sort());
  });

  it("only `full` tells the user to remove items — the one case the strip holds any", () => {
    for (const [reason, notice] of Object.entries(STACK_ADD_REFUSAL_NOTICE)) {
      const says = /remove some items/i.test(notice.message) || /full/i.test(notice.title);
      expect(says, `"${reason}" must not claim the Stack is full`).toBe(reason === "full");
    }
  });
});
