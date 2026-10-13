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
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  addStackItem,
  readStackItem,
  useStack,
  STACK_QUARANTINE_KEY,
} from "../useStack";
import { STACK_STORAGE_KEY, type StackItem } from "@/lib/stack/types";
import type { StackBibCtx } from "@/lib/stack/bib-carry";
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

    expect(addStackItem(textItem("new"), NO_BIB)).toBe(true);
    expect(readStackItem("keep")).not.toBeNull();
    expect(readStackItem("new")).not.toBeNull();
  });

  it("(b) another build's envelope is never overwritten — the add refuses", () => {
    const foreign = JSON.stringify({ version: 2, items: [{ id: "x" }] });
    store(foreign);

    expect(addStackItem(textItem("new"), NO_BIB)).toBe(false);
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

    expect(addStackItem(textItem("new"), NO_BIB)).toBe(true);
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
