// @vitest-environment jsdom
//
// Task 2026-07-05-041 — marginalia markers must NOT jump on scroll.
//
// THE BUG
// The registry's metrics `cache` doubled as the render-visibility gate. On a
// genuine viewport-leave `onIntersection` DELETED the block's cache entry; on
// re-entry it re-measured FROM SCRATCH and, because `prev` was now undefined,
// short-circuited its equality guard (`!prev`) and `notify()`d unconditionally.
// If anything reflowed while the block was parked off-screen — or even just a
// sub-pixel DPR wobble — the fresh measure was committed as a NEW position, so
// the marker snapped the moment the block scrolled back into the near-zone.
//
// THE FIX (task 041)
// A genuine viewport-leave now MOVES the last-good metrics into a `parked`
// store (kept out of `cache`, so `getMetrics` still returns null → the block
// stays un-painted and the near-zone paint stays bounded). On re-entry the
// registry re-measures but, when the fresh value is within ε of the parked
// value, commits the PARKED value verbatim — a byte-identical scroll-back. Only
// a real reflow (beyond ε) commits the fresh measurement.
//
// THE TEETH
//   1. A block that did not reflow while off-screen re-enters at a BYTE-IDENTICAL
//      `top` (a sub-pixel wobble under ε is absorbed, not committed). Temp-revert
//      the fix (delete cache on leave, re-measure raw on enter) → the wobble is
//      committed → RED.
//   2. A REAL reflow while parked (> ε) IS reflected on re-entry (no over-
//      suppression) — the parked value is only reused when close.
//
// The storage stub guards the extension-barrel/@/lib/storage import gotcha the
// sibling registry tests document.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

// `walkAnchorableBlocks` always lists the single live block; `resolveDomForUuid`
// returns the current live element. Everything else real.
const walkMock = vi.fn();
const resolveDomMock = vi.fn();
vi.mock("@/lib/marginalia-blocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marginalia-blocks")>();
  return {
    ...actual,
    walkAnchorableBlocks: (...args: Parameters<typeof actual.walkAnchorableBlocks>) =>
      walkMock(...args),
    resolveDomForUuid: (...args: Parameters<typeof actual.resolveDomForUuid>) =>
      resolveDomMock(...args),
  };
});

vi.mock("@/components/editor-layout/layout-scroll", () => ({
  findRowScroll: () => null,
  findEditorScrollFor: () => null,
}));

// Keep the descent SSOT real but make the vertical primitive deterministic
// (jsdom has no canvas): a zero cap-band offset, so `measureBlock`'s prose
// optical center reduces to `targetRect.top - hostRect.top` and
// `top = that - lineHeight/2`.
vi.mock("@/lib/text-metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/text-metrics")>();
  return {
    ...actual,
    opticalCenterY: (lineTop: number) => lineTop,
  };
});

import { Editor } from "@tiptap/core";
import { renderHook, act } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { useMarginaliaRegistry } from "@/hooks/useMarginaliaRegistry";
import { resolveInlineContextElement } from "@/lib/text-metrics";

type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let liveIOs: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  cb: IOCallback;
  observed = new Set<Element>();
  constructor(cb: IOCallback) {
    this.cb = cb;
    liveIOs.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
    liveIOs = liveIOs.filter((io) => io !== this);
  }
  takeRecords() {
    return [];
  }
  fire(el: Element, isIntersecting: boolean) {
    this.cb([
      { target: el, isIntersecting } as unknown as IntersectionObserverEntry,
    ]);
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let rafQueue: FrameRequestCallback[] = [];
function flushRaf() {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(performance.now());
}

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

const P_UUID = "aa11";
const LINE_HEIGHT = 20;

/** The single paragraph's measured top is `rectTop.value` (mutable, so a test
 *  can simulate an off-screen reflow between leave and re-enter). */
const rectTop = { value: 100 };

function mountDoc(): { editor: Editor; paraEl: HTMLElement } {
  const host = document.createElement("div");
  host.setAttribute("data-marginalia-host", "");
  host.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  const element = document.createElement("div");
  host.appendChild(element);
  document.body.appendChild(host);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: P_UUID },
          content: [{ type: "text", text: "A paragraph." }],
        },
      ],
    },
  });
  // The element `measureBlock` observes/keys on is `nodeDOM(pos)` (the wrapper);
  // the element it MEASURES `top` from is `resolveInlineContextElement(wrapper)`
  // (an inner <p>). jsdom has no layout, so override BOTH rects + line-height,
  // all driven by `rectTop.value`, so `measureBlock` is deterministic and a test
  // can simulate an off-screen reflow by mutating `rectTop.value`.
  const paraEl = editor.view.nodeDOM(0) as HTMLElement;
  const target = resolveInlineContextElement(paraEl);
  const stubRect = (el: HTMLElement) => {
    el.style.lineHeight = `${LINE_HEIGHT}px`;
    el.getBoundingClientRect = () =>
      ({
        top: rectTop.value,
        left: 0,
        right: 100,
        bottom: rectTop.value + LINE_HEIGHT,
        width: 100,
        height: LINE_HEIGHT,
        x: 0,
        y: rectTop.value,
        toJSON() {},
      }) as DOMRect;
  };
  stubRect(paraEl);
  if (target !== paraEl) stubRect(target);
  return { editor, paraEl };
}

describe("useMarginaliaRegistry — retain metrics on viewport-leave (task 041 scroll-jump)", () => {
  let realIO: typeof IntersectionObserver;
  let realRO: typeof ResizeObserver;
  let realRaf: typeof requestAnimationFrame;
  let realCaf: typeof cancelAnimationFrame;

  beforeEach(() => {
    liveIOs = [];
    rafQueue = [];
    rectTop.value = 100;
    walkMock.mockReset();
    resolveDomMock.mockReset();
    realIO = globalThis.IntersectionObserver;
    realRO = globalThis.ResizeObserver;
    realRaf = globalThis.requestAnimationFrame;
    realCaf = globalThis.cancelAnimationFrame;
    globalThis.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = realIO;
    globalThis.ResizeObserver = realRO;
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCaf;
  });

  function primeAndEnter() {
    const { editor, paraEl } = mountDoc();
    walkMock.mockReturnValue([{ uuid: P_UUID, pos: 0, isAtom: false }]);
    resolveDomMock.mockReturnValue(paraEl);
    const { result } = renderHook(() => useMarginaliaRegistry(editor));
    act(() => {
      flushRaf();
    });
    const io = liveIOs[0];
    act(() => {
      io.fire(paraEl, true);
    });
    return { editor, paraEl, io, result };
  }

  it("TOOTH 1: a block that did not reflow (sub-ε wobble) re-enters at a BYTE-IDENTICAL top — no scroll-jump", () => {
    const { editor, paraEl, io, result } = primeAndEnter();
    const top0 = result.current.getMetrics(P_UUID)!.top;
    expect(top0).toBeCloseTo(90, 6); // 100 (rect) - 20/2 (lineHeight)

    // Scroll the block OUT of the near-zone.
    act(() => {
      io.fire(paraEl, false);
    });
    // Off-screen → not painted (metrics gate stays viewport-scoped).
    expect(result.current.getMetrics(P_UUID)).toBeNull();

    // A sub-pixel wobble happens while parked (DPR rounding), THEN it scrolls
    // back in. The marker must NOT move — the parked position is reused.
    rectTop.value = 100.3; // 0.3px < ε (0.5px)
    act(() => {
      io.fire(paraEl, true);
    });
    expect(result.current.getMetrics(P_UUID)!.top).toBe(top0);

    editor.destroy();
  });

  it("TOOTH 2: a REAL reflow (> ε) while parked IS reflected on re-entry (no over-suppression)", () => {
    const { editor, paraEl, io, result } = primeAndEnter();
    const top0 = result.current.getMetrics(P_UUID)!.top;

    act(() => {
      io.fire(paraEl, false);
    });
    expect(result.current.getMetrics(P_UUID)).toBeNull();

    // A genuine reflow shifts the block by 12px while it's off-screen.
    rectTop.value = 112;
    act(() => {
      io.fire(paraEl, true);
    });
    expect(result.current.getMetrics(P_UUID)!.top).toBeCloseTo(top0 + 12, 6);

    editor.destroy();
  });

  it("bounded sub-ε wobble across MANY leave→enter cycles never drifts (marker stays pinned to the original Y)", () => {
    const { editor, paraEl, io, result } = primeAndEnter();
    const top0 = result.current.getMetrics(P_UUID)!.top;

    // Each cycle wobbles ±0.3px around the anchor (never a sustained move past
    // ε), so the reused parked value is always within tolerance → zero drift.
    for (let i = 0; i < 6; i++) {
      act(() => {
        io.fire(paraEl, false);
      });
      rectTop.value = 100 + (i % 2 === 0 ? 0.3 : -0.3);
      act(() => {
        io.fire(paraEl, true);
      });
      expect(result.current.getMetrics(P_UUID)!.top).toBe(top0);
    }

    editor.destroy();
  });
});
