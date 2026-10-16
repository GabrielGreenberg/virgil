// @vitest-environment jsdom
//
// Task 1146 — `focusNewCard`'s retry chain is OWNED by the caller's
// `ViewLifetime`: it can never outlive the surface that asked for the focus.
// The unowned chain it replaces (up to 14 free-running RAFs) kept firing after
// an unmount — under a loaded full run, after jsdom teardown, where
// `CSS.escape` threw and turned the gate red.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { focusNewCard, hasPendingCardFocus } from "../focus-new-card";
import { createViewLifetime } from "../tiptap/view-lifetime";

const KEY = "float:card:note:n1";

function mountCard(key = KEY): HTMLElement {
  const card = document.createElement("div");
  card.setAttribute("data-card-key", key);
  const body = document.createElement("div");
  body.setAttribute("contenteditable", "true");
  body.textContent = "hello";
  card.appendChild(body);
  document.body.appendChild(card);
  return body;
}

/** Drive N animation frames deterministically. */
let rafQueue: FrameRequestCallback[] = [];
function flushFrames(n: number) {
  for (let i = 0; i < n; i++) {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(0);
  }
}

beforeEach(() => {
  rafQueue = [];
  let id = 0;
  const handles = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const h = ++id;
    const wrapped: FrameRequestCallback = (t) => {
      if (handles.delete(h)) cb(t);
    };
    handles.set(h, cb);
    rafQueue.push(wrapped);
    return h;
  });
  vi.stubGlobal("cancelAnimationFrame", (h: number) => {
    handles.delete(h);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("focusNewCard — the caller owns the retry", () => {
  it("lands the caret in a card that mounts after the request", () => {
    const owner = createViewLifetime();
    focusNewCard(KEY, owner);
    flushFrames(3);
    const body = mountCard();
    flushFrames(2);
    expect(document.activeElement).toBe(body);
    expect(hasPendingCardFocus()).toBe(false);
    expect(owner.pending).toBe(0);
  });

  it("a card that never mounts + owner disposal → nothing armed, nothing fires", () => {
    const owner = createViewLifetime();
    const qsa = vi.spyOn(document, "querySelectorAll");
    focusNewCard(KEY, owner);
    flushFrames(3);
    const huntsBefore = qsa.mock.calls.length;
    owner.dispose();
    expect(owner.pending).toBe(0);
    expect(hasPendingCardFocus()).toBe(false);
    // Even if the card mounts now, a disposed owner's request never focuses it.
    const body = mountCard();
    expect(() => flushFrames(20)).not.toThrow();
    expect(qsa.mock.calls.length).toBe(huntsBefore);
    expect(document.activeElement).not.toBe(body);
  });

  it("gives up after its wall-clock bound without leaving a frame armed", () => {
    const owner = createViewLifetime();
    focusNewCard(KEY, owner);
    flushFrames(40);
    expect(owner.pending).toBe(0);
    expect(hasPendingCardFocus()).toBe(false);
  });

  it("a newer request supersedes the pending one", () => {
    const a = createViewLifetime();
    const b = createViewLifetime();
    focusNewCard(KEY, a);
    flushFrames(1);
    focusNewCard("float:card:note:n2", b);
    expect(a.pending).toBe(0);
    mountCard(KEY);
    const second = mountCard("float:card:note:n2");
    flushFrames(3);
    expect(document.activeElement).toBe(second);
  });

  it("a request on an already-disposed owner arms nothing", () => {
    const owner = createViewLifetime();
    owner.dispose();
    focusNewCard(KEY, owner);
    expect(hasPendingCardFocus()).toBe(false);
    expect(rafQueue.length).toBe(0);
  });
});
