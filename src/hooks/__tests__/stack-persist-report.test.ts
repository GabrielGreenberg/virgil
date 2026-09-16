// @vitest-environment jsdom
/**
 * **A Stack write REPORTS, and the cap is a BUDGET** (task 591).
 *
 * The defect had two halves that only look like one bug together:
 *
 *  1. `writeEnvelope` swallowed every `setItem` throw into a `console.error`
 *     and returned `void`. So `addStackItem` returned `void`, so
 *     `EditorPane.captureKeyToStack` returned `true` unconditionally — and
 *     THE REPORT IS THE PERMISSION (task 332): the float producer closed its
 *     popout, the lift producer tore down its overlay, and the strip opened on
 *     a capture that had never been persisted. The gesture looked accepted and
 *     nothing had happened.
 *  2. `STACK_MAX_ITEMS = 200` caps COUNT, under the stated premise that "200
 *     items × a few KB stays comfortably within budget". A `heading` payload is
 *     the whole dominated section as node JSON; a handful of chapter-sized
 *     captures reach the origin's quota while the count cap still reports
 *     plenty of room — and once over, the count cap can never make room,
 *     because it is not measuring what ran out.
 *
 * So the legs below are the two halves plus the seam: the write door answers,
 * the cap is applied in the unit the quota rations, and the item being added is
 * never the one evicted to make room for itself.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { addStackItem, readStackItem, useStack } from "../useStack";
import { fitStackItems } from "@/lib/stack/budget";
import {
  STACK_MAX_CHARS,
  STACK_MAX_ITEMS,
  STACK_STORAGE_KEY,
  type StackItem,
} from "@/lib/stack/types";
import type { StackBibCtx } from "@/lib/stack/bib-carry";
import { act, renderHook } from "@testing-library/react";

/** A doc with no bibliography still ANSWERS the task-235 question. */
const NO_BIB: StackBibCtx = {
  getBibEntry: () => undefined,
  getAnnotation: () => "",
};

function item(id: string, filler = ""): StackItem {
  return {
    id,
    capturedAt: "2026-09-15T00:00:00.000Z",
    source: { docId: "docA" },
    payload: {
      kind: "paragraph",
      node: { type: "paragraph", content: [{ type: "text", text: `x${filler}` }] },
    } as unknown as StackItem["payload"],
  };
}

function storedIds(): string[] {
  const raw = localStorage.getItem(STACK_STORAGE_KEY);
  if (!raw) return [];
  return (JSON.parse(raw).items as StackItem[]).map((it) => it.id);
}

/** A localStorage that rations CHARACTERS, the way a real origin does. */
function rationStorageAt(limitChars: number) {
  const real = Storage.prototype.setItem;
  return vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key: string, value: string) {
      if (value.length > limitChars) {
        const err = new Error("exceeded the quota");
        err.name = "QuotaExceededError";
        throw err;
      }
      return real.call(this, key, value);
    });
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("the add door reports whether the item actually landed", () => {
  it("returns true on an ordinary add, and the item is readable back", () => {
    expect(addStackItem(item("a"), NO_BIB)).toBe(true);
    expect(readStackItem("a")?.id).toBe("a");
  });

  it("returns FALSE when nothing can be persisted — and loses nothing", () => {
    expect(addStackItem(item("old"), NO_BIB)).toBe(true);
    // Every write throws from here on: not a budget the door can trim into,
    // just a storage that refuses.
    rationStorageAt(0);
    expect(addStackItem(item("new"), NO_BIB)).toBe(false);
    // A failed `setItem` does not modify the existing value, so the envelope
    // that was already there is intact — the capture is a copy, and refusing
    // it costs the user nothing but the gesture.
    expect(storedIds()).toEqual(["old"]);
    expect(readStackItem("new")).toBeNull();
  });

  it("makes room by FIFO eviction and then SUCCEEDS", () => {
    for (const id of ["oldest", "middle", "newest"]) {
      expect(addStackItem(item(id), NO_BIB)).toBe(true);
    }
    expect(storedIds()).toEqual(["newest", "middle", "oldest"]);
    // Room for three envelope entries, not four: the add must give something
    // up rather than refuse, and what it gives up is the OLD end.
    const three = localStorage.getItem(STACK_STORAGE_KEY)!.length;
    rationStorageAt(three);
    expect(addStackItem(item("fourth"), NO_BIB)).toBe(true);
    expect(storedIds()).toEqual(["fourth", "newest", "middle"]);
  });

  it("never evicts the item being added to make room for itself", () => {
    expect(addStackItem(item("resident"), NO_BIB)).toBe(true);
    // Not even one item fits. The honest answer is a refusal — a silent trim
    // to an empty Stack would be the same lie one layer down, and would also
    // destroy what was already captured.
    rationStorageAt(4);
    expect(addStackItem(item("huge"), NO_BIB)).toBe(false);
    expect(storedIds()).toEqual(["resident"]);
  });
});

describe("the cap is a budget: fitStackItems applies BOTH halves", () => {
  it("still caps the count", () => {
    const many = Array.from({ length: STACK_MAX_ITEMS + 5 }, (_, i) => item(`i${i}`));
    const fitted = fitStackItems(many);
    expect(fitted.items).toHaveLength(STACK_MAX_ITEMS);
    expect(fitted.evicted).toBe(5);
    // FIFO: the newest end survives.
    expect(fitted.items[0].id).toBe("i0");
  });

  it("evicts by CHARACTERS once the count cap has nothing to say", () => {
    // Three items well inside the 200-count cap that together bust the
    // serialized budget — exactly the whole-section-capture shape the count
    // cap cannot see.
    const big = "y".repeat(Math.ceil(STACK_MAX_CHARS * 0.45));
    const three = [item("new", big), item("mid", big), item("old", big)];
    expect(fitStackItems(three).items.map((i) => i.id)).toEqual(["new", "mid"]);
    expect(fitStackItems(three).evicted).toBe(1);
  });

  it("keeps the newest item even when it alone busts the budget", () => {
    const enormous = item("enormous", "z".repeat(STACK_MAX_CHARS + 10));
    const fitted = fitStackItems([enormous, item("old")]);
    expect(fitted.items.map((i) => i.id)).toEqual(["enormous"]);
  });

  it("the serialized string it returns is the one that should be written", () => {
    const fitted = fitStackItems([item("a"), item("b")]);
    expect(JSON.parse(fitted.serialized)).toEqual({ version: 1, items: fitted.items });
  });
});

describe("hook state follows the write, never leads it", () => {
  it("remove reports false and keeps the item when the write fails", () => {
    expect(addStackItem(item("a"), NO_BIB)).toBe(true);
    expect(addStackItem(item("b"), NO_BIB)).toBe(true);
    const { result } = renderHook(() => useStack());
    expect(result.current.items.map((i) => i.id)).toEqual(["b", "a"]);

    rationStorageAt(0);
    let reported: boolean | undefined;
    act(() => {
      reported = result.current.remove("a");
    });
    expect(reported).toBe(false);
    // Storage still has both, so React must still show both — otherwise the
    // strip shows a removal the next cross-window re-read silently undoes.
    expect(storedIds()).toEqual(["b", "a"]);
    expect(result.current.items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("clear reports false and keeps the items when the write fails", () => {
    expect(addStackItem(item("a"), NO_BIB)).toBe(true);
    const { result } = renderHook(() => useStack());
    rationStorageAt(0);
    let reported: boolean | undefined;
    act(() => {
      reported = result.current.clear();
    });
    expect(reported).toBe(false);
    expect(storedIds()).toEqual(["a"]);
    expect(result.current.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("…and both report true and take effect on a write that lands", () => {
    expect(addStackItem(item("a"), NO_BIB)).toBe(true);
    expect(addStackItem(item("b"), NO_BIB)).toBe(true);
    const { result } = renderHook(() => useStack());
    act(() => {
      expect(result.current.remove("a")).toBe(true);
    });
    expect(result.current.items.map((i) => i.id)).toEqual(["b"]);
    act(() => {
      expect(result.current.clear()).toBe(true);
    });
    expect(result.current.items).toEqual([]);
    expect(storedIds()).toEqual([]);
  });
});
