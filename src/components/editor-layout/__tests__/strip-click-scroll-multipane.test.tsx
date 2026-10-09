// @vitest-environment jsdom
// Task 1033 — a strip-icon click scrolls to the panel's selected card in the
// VISIBLE pane, never a hidden keep-alive pane's card with the same short id.
//
// Panel-entry ids are 4-hex short ids, unique only per DOCUMENT, so under
// multi-doc keep-alive two panes can both mount `[data-note-entry="ab12"]`.
// The hidden pane is `display:none` and may come FIRST in DOM order; the
// pre-1033 `document.querySelector(sel.selector)` took it and the scroll was a
// silent no-op on an invisible element. Measured to FAIL on the pre-fix source.
//
// jsdom reports `offsetHeight === 0` / `offsetParent === null` for everything,
// so visibility is stubbed per element (the `pane-dom-multipane` trick).

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { renderHook } from "@testing-library/react";
import { useStripHandlers } from "../drag-drop";
import type { ViewPrefs } from "@/hooks/useViewPrefs";
import type { SelectionsContextValue } from "../contexts/selections";

function stubVisible(el: HTMLElement, visible: boolean) {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get: () => (visible ? document.body : null),
  });
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    get: () => (visible ? 100 : 0),
  });
}

function mountEntry(visible: boolean): HTMLElement {
  const pane = document.createElement("div");
  const entry = document.createElement("div");
  entry.setAttribute("data-note-entry", "ab12");
  entry.scrollIntoView = vi.fn();
  stubVisible(entry, visible);
  pane.appendChild(entry);
  document.body.appendChild(pane);
  return entry;
}

const noop = () => {};

function selections(noteId: string | null): SelectionsContextValue {
  return new Proxy({ selectedNoteId: noteId } as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : k.toString().startsWith("set") ? noop : null),
  }) as unknown as SelectionsContextValue;
}

const PREFS = {
  dockStack: { left: [], right: [] },
  poppedOutPanels: [],
} as unknown as ViewPrefs;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("strip-click scroll under multi-pane keep-alive (task 1033)", () => {
  it("scrolls the VISIBLE pane's selected card, not a hidden pane's earlier twin", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const hidden = mountEntry(false); // first in DOM order
    const visible = mountEntry(true);
    const openPanelDocked = vi.fn();

    const { result } = renderHook(() =>
      useStripHandlers({
        prefs: PREFS,
        openPanelDocked,
        closePopout: noop,
        movePanel: noop,
        selections: selections("ab12"),
      }),
    );
    result.current.handleStripClick("notes", "left");
    expect(openPanelDocked).toHaveBeenCalledWith("notes", "left", undefined);

    // Two frames for the freshly opened band's list to render — the scroll
    // must not resolve before the second.
    while (frames.length) frames.shift()!(0);

    expect(visible.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(visible.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    expect(hidden.scrollIntoView).not.toHaveBeenCalled();
  });

  it("waits two frames before resolving (the list mounts in between)", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const { result } = renderHook(() =>
      useStripHandlers({
        prefs: PREFS,
        openPanelDocked: noop,
        closePopout: noop,
        movePanel: noop,
        selections: selections("ab12"),
      }),
    );
    result.current.handleStripClick("notes", "left");
    frames.shift()!(0);
    const entry = mountEntry(true); // mounts between frame 1 and frame 2
    frames.shift()!(0);
    expect(entry.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
