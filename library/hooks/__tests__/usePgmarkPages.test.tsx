// @vitest-environment jsdom
//
// F#11 — usePgmarkPages was extracted out of PageScrollLozenge so the lozenge
// ("p. N" pill) and the header's page picker share ONE pages[]/current
// derivation. Pins:
//   1. It parses `\pgmark{label}` out of `.pgmark-chip` decorations in the
//      editor DOM into pages[] (literal printed-page LABELS, not 1..N).
//   2. currentLabel tracks the near-top probe line as scrollTop changes.
//   3. scrollToPage(label) scrolls the container to that page's docY; an
//      unknown label is a no-op.
//   4. A pgmark-less doc yields zero pages + null currentLabel.
//
// Keystroke sanctity: the hook recollects ONLY on editor create/docChanged,
// never per keystroke — asserted indirectly by re-collecting on a docChanged
// transaction and NOT on a non-docChanged one.

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { usePgmarkPages } from "@library/hooks/usePgmarkPages";

afterEach(() => cleanup());

// rAF runs synchronously so RAF-coalesced setState lands within act().
beforeEachRaf();
function beforeEachRaf() {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  // jsdom lacks ResizeObserver.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

/** Build a fake TipTap editor whose `view.dom` contains pgmark chips at the
 *  given document Ys, plus a scroll container with stubbed geometry. */
function makeFixture(
  chipSpecs: { label: string; docY: number }[],
  opts: { clientHeight?: number; scrollHeight?: number } = {},
) {
  const dom = document.createElement("div");
  const handlers: Record<string, ((arg: unknown) => void)[]> = {};

  for (const spec of chipSpecs) {
    const chip = document.createElement("span");
    chip.className = "pgmark-chip";
    chip.textContent = `\\pgmark{${spec.label}}`;
    // docY = rect.top - containerRect.top(0) + scrollTop(0) = rect.top.
    chip.getBoundingClientRect = () =>
      ({ top: spec.docY, left: 0, right: 0, bottom: spec.docY, width: 0, height: 0 }) as DOMRect;
    dom.appendChild(chip);
  }

  const editor = {
    isDestroyed: false,
    view: { dom },
    on: (evt: string, fn: (arg: unknown) => void) => {
      (handlers[evt] ||= []).push(fn);
    },
    off: (evt: string, fn: (arg: unknown) => void) => {
      handlers[evt] = (handlers[evt] || []).filter((f) => f !== fn);
    },
    __emit: (evt: string, arg: unknown) =>
      (handlers[evt] || []).forEach((f) => f(arg)),
  };

  const container = document.createElement("div");
  let _scrollTop = 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => _scrollTop,
    set: (v: number) => {
      _scrollTop = v;
    },
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    get: () => opts.clientHeight ?? 100,
    configurable: true,
  });
  container.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  container.scrollTo = ((arg: ScrollToOptions) => {
    if (arg && typeof arg.top === "number") _scrollTop = arg.top;
  }) as typeof container.scrollTo;

  return { editor, container };
}

describe("usePgmarkPages", () => {
  it("collects pgmark pages with literal labels and tracks current page on scroll", () => {
    const { editor, container } = makeFixture(
      [
        { label: "1", docY: 0 },
        { label: "2", docY: 500 },
        { label: "3", docY: 1000 },
      ],
      { clientHeight: 100 },
    );

    const { result } = renderHook(() =>
      usePgmarkPages(editor as never, container),
    );

    expect(result.current.pages.map((p) => p.label)).toEqual(["1", "2", "3"]);
    // probe = scrollTop(0) + 100*0.35 = 35 → only page 1 is at/above.
    expect(result.current.currentLabel).toBe("1");

    // Scroll down past page 2's anchor (probe = 500 + 35 = 535 ≥ 500).
    act(() => {
      container.scrollTop = 500;
      container.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.currentLabel).toBe("2");
  });

  it("scrollToPage(label) scrolls to the matching page; unknown label is a no-op", () => {
    const { editor, container } = makeFixture([
      { label: "10", docY: 0 },
      { label: "20", docY: 800 },
    ]);
    const { result } = renderHook(() =>
      usePgmarkPages(editor as never, container),
    );

    act(() => result.current.scrollToPage("20"));
    expect(container.scrollTop).toBe(800);

    act(() => result.current.scrollToPage("999"));
    expect(container.scrollTop).toBe(800); // unchanged — no match
  });

  it("yields zero pages and null currentLabel for a pgmark-less doc", () => {
    const { editor, container } = makeFixture([]);
    const { result } = renderHook(() =>
      usePgmarkPages(editor as never, container),
    );
    expect(result.current.pages).toEqual([]);
    expect(result.current.currentLabel).toBeNull();
    expect(result.current.currentIndex).toBe(-1);
  });

  it("recollects on a docChanged transaction (keystroke-sane re-scan gate)", () => {
    const { editor, container } = makeFixture([{ label: "1", docY: 0 }]);
    const { result } = renderHook(() =>
      usePgmarkPages(editor as never, container),
    );
    expect(result.current.pages).toHaveLength(1);

    // Add a second chip, then fire a NON-docChanged tx — must NOT re-scan.
    const chip = document.createElement("span");
    chip.className = "pgmark-chip";
    chip.textContent = "\\pgmark{2}";
    chip.getBoundingClientRect = () =>
      ({ top: 600, left: 0, right: 0, bottom: 600, width: 0, height: 0 }) as DOMRect;
    (editor as { view: { dom: HTMLElement } }).view.dom.appendChild(chip);

    act(() => {
      (editor as { __emit: (e: string, a: unknown) => void }).__emit("transaction", {
        transaction: { docChanged: false },
      });
    });
    expect(result.current.pages).toHaveLength(1); // not re-scanned

    act(() => {
      (editor as { __emit: (e: string, a: unknown) => void }).__emit("transaction", {
        transaction: { docChanged: true },
      });
    });
    expect(result.current.pages).toHaveLength(2); // re-scanned on docChanged
  });
});
