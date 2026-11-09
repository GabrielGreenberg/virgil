// @vitest-environment jsdom
//
// Task 1536 — WHICH presence of a multiply-rendered card takes the caret is a
// stated ladder (`pickCardPresence`), not DOM order. A toolbar-created card is
// popped at its anchor; its docked twin stays live in an open panel, and the
// float portals to <body> AFTER the app root — so "first visible match" put
// the caret in the dock while the user looked at the float.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { focusNewCard } from "../focus-new-card";
import { FLOAT_PRESENCE_ATTR, pickCardPresence } from "../card-presence";
import { createViewLifetime } from "../tiptap/view-lifetime";

const KEY = "float:card:note:n1";

function cardWithBody(key = KEY): { card: HTMLElement; body: HTMLElement } {
  const card = document.createElement("div");
  card.setAttribute("data-card-key", key);
  const body = document.createElement("div");
  body.setAttribute("contenteditable", "true");
  card.appendChild(body);
  return { card, body };
}

/** The docked panel list, inside the app root (EARLIER in DOM order). */
function mountDocked(): HTMLElement {
  const root = document.createElement("div");
  root.id = "app-root";
  const { card, body } = cardWithBody();
  root.appendChild(card);
  document.body.appendChild(root);
  return body;
}

/** A floating `FloatingPanel` window, portalled to <body> AFTER the root. */
function mountFloat(floatKey = KEY): HTMLElement {
  const win = document.createElement("div");
  win.setAttribute("data-floating-panel", "true");
  win.setAttribute("data-panel-shell-mode", "floating");
  win.setAttribute(FLOAT_PRESENCE_ATTR, floatKey);
  const { card, body } = cardWithBody();
  win.appendChild(card);
  document.body.appendChild(win);
  return body;
}

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
    handles.set(h, cb);
    rafQueue.push((t) => {
      if (handles.delete(h)) cb(t);
    });
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

describe("focusNewCard — the popped float takes the caret over its docked twin", () => {
  it("docked + float of the same card → caret in the float", () => {
    const docked = mountDocked();
    const float = mountFloat();
    focusNewCard(KEY, createViewLifetime());
    flushFrames(3);
    expect(document.activeElement).toBe(float);
    expect(document.activeElement).not.toBe(docked);
  });

  it("no float → the docked copy", () => {
    const docked = mountDocked();
    focusNewCard(KEY, createViewLifetime());
    flushFrames(3);
    expect(document.activeElement).toBe(docked);
  });

  it("a float of ANOTHER card does not count as this card's float", () => {
    const docked = mountDocked();
    // A whole-panel float (or another card's window) that happens to contain
    // a copy of this card: not the float this card was popped into.
    mountFloat("float:card:note:other");
    const p = pickCardPresence(
      Array.from(document.querySelectorAll<HTMLElement>(`[data-card-key="${KEY}"]`)),
      KEY,
    );
    expect(p?.isFloat).toBe(false);
    expect(p?.el.contains(docked)).toBe(true);
  });

  it("awaitFloat: waits for the float to mount instead of settling on the dock", () => {
    mountDocked();
    focusNewCard(KEY, createViewLifetime(), { awaitFloat: true });
    flushFrames(3);
    // Only the dock exists yet — the caller is about to pop the card.
    expect(document.activeElement).toBe(document.body);
    const float = mountFloat();
    flushFrames(1);
    expect(document.activeElement).toBe(float);
  });

  it("awaitFloat: the dock is still the last-attempt fallback (never no caret)", () => {
    const docked = mountDocked();
    focusNewCard(KEY, createViewLifetime(), { awaitFloat: true });
    flushFrames(20);
    expect(document.activeElement).toBe(docked);
  });
});
