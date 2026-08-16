// @vitest-environment jsdom
/**
 * Task 336 — the POINTER vs KEYBOARD modality SSOT.
 *
 * The rule it publishes: only pointer input may (re-)derive a pointer-derived
 * answer. The three properties a consumer leans on are all here, and each was a
 * real design decision rather than an implementation detail:
 *
 *   - a burst of keystrokes flips ONCE (the subscriber is a flip-edge
 *     subscriber, not a per-event one — otherwise the gate that removes
 *     per-keystroke work would schedule per-keystroke work of its own);
 *   - a PURE MODIFIER types nothing, so it must not flip — a Cmd-click on a
 *     grab handle begins with a `Meta` keydown, and a handle that unmounted on
 *     it would be gone before the click that wanted it landed;
 *   - the `keydown` listener is refcounted, so an app with no pointer-derived
 *     chrome mounted carries no listener at all.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  currentInputModality,
  isTypingModality,
  notePointerInput,
  subscribeInputModality,
} from "@/lib/input-modality";

const key = (k: string) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

let disposers: Array<() => void> = [];

beforeEach(() => {
  disposers = [];
  // The module is a singleton across the file; every test starts from the
  // shipped initial state (pointer) via the public door.
  notePointerInput();
});

afterEach(() => {
  for (const d of disposers) d();
  notePointerInput();
});

function subscribe(fn: (m: string) => void) {
  const d = subscribeInputModality(fn);
  disposers.push(d);
  return d;
}

describe("input modality (task 336)", () => {
  it("starts in pointer modality and flips on a real keydown", () => {
    subscribe(() => {});
    expect(isTypingModality()).toBe(false);
    key("a");
    expect(isTypingModality()).toBe(true);
    expect(currentInputModality()).toBe("keyboard");
  });

  it("a 40-character burst notifies exactly ONCE — the flip edge, never per event", () => {
    const seen: string[] = [];
    subscribe((m) => seen.push(m));
    for (let i = 0; i < 40; i += 1) key("x");
    expect(seen).toEqual(["keyboard"]);

    // …and the way back is one notify too, however many moves report it.
    for (let i = 0; i < 40; i += 1) notePointerInput();
    expect(seen).toEqual(["keyboard", "pointer"]);
  });

  it("a PURE MODIFIER types nothing and must not flip (the chorded-click case)", () => {
    subscribe(() => {});
    for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock"]) {
      key(k);
      expect(isTypingModality(), `${k} must not read as typing`).toBe(false);
    }
    // The chord's real key does.
    key("k");
    expect(isTypingModality()).toBe(true);
  });

  it("a NON-typing keystroke (Escape, an arrow) still counts as keyboard", () => {
    subscribe(() => {});
    key("Escape");
    expect(isTypingModality()).toBe(true);
    notePointerInput();
    key("ArrowDown");
    expect(isTypingModality()).toBe(true);
  });

  it("the keydown listener is installed with the first subscriber and removed with the last", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const countKeydown = (spy: typeof add) =>
      spy.mock.calls.filter((c) => c[0] === "keydown").length;

    const a = subscribeInputModality(() => {});
    const b = subscribeInputModality(() => {});
    expect(countKeydown(add), "installed once, not once per subscriber").toBe(1);

    a();
    expect(countKeydown(remove), "still one subscriber left").toBe(0);
    b();
    expect(countKeydown(remove)).toBe(1);

    // With nothing subscribed the module is inert: a keystroke changes nothing.
    notePointerInput();
    key("a");
    expect(isTypingModality()).toBe(false);

    add.mockRestore();
    remove.mockRestore();
  });

  it("unsubscribing stops that listener without stopping its peers", () => {
    const seenA: string[] = [];
    const seenB: string[] = [];
    const a = subscribeInputModality((m) => seenA.push(m));
    subscribe((m) => seenB.push(m));
    a();
    key("a");
    expect(seenA).toEqual([]);
    expect(seenB).toEqual(["keyboard"]);
  });
});
