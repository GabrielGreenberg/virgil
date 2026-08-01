// @vitest-environment jsdom
//
// Task 2026-08-01-267 — the marginalia registry must re-measure on an
// `onFontReady` wave.
//
// THE BUG
// `measureBlock` seats every marker on the block's OPTICAL cap-band center
// (`opticalCenterY` → cap-height / ascent / descent, all font-FAMILY dependent),
// then the registry CACHES the resolved `top`. A runtime font-family swap at
// unchanged font-size + line-height (the Fonts… picker) re-lays out no block box,
// so no RO / IO / window-resize / structural trigger fires — and the registry had
// no `onFontReady` subscription, so the marker kept its OLD-font `top` while the
// grab handle + in-text deck (both of which DO subscribe) re-snapped. The markers
// visibly drifted from their row-mates until an unrelated reflow.
//
// THE FIX
// The wiring effect now subscribes to `onFontReady` and re-measures the whole
// observed set on the wave (`recomputeAllObserved`), disposing the subscription
// on cleanup — mirroring `useInTextPositions` / `TextObjectGrabHandle`.
//
// THE TEETH
//   1. Firing the registered `onFontReady` callback after a font swap re-derives
//      the marker `top` to the NEW font's optical center. Temp-revert the
//      subscription → the callback is never registered → the marker keeps the old
//      `top` → RED.
//   2. The disposer unregisters the callback on unmount (no closure leak).
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

// Capture the callbacks the registry registers with `onFontReady`, and make
// `opticalCenterY` a MUTABLE offset so a test can simulate a font-family swap
// (a new font's cap-band center) and then fire the captured callback.
const fontReadyCbs = new Set<() => void>();
const opticalState = { offset: 0 };
function fireFontReady() {
  for (const cb of Array.from(fontReadyCbs)) cb();
}
vi.mock("@/lib/text-metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/text-metrics")>();
  return {
    ...actual,
    opticalCenterY: (lineTop: number) => lineTop + opticalState.offset,
    onFontReady: (cb: () => void) => {
      fontReadyCbs.add(cb);
      return () => {
        fontReadyCbs.delete(cb);
      };
    },
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

describe("useMarginaliaRegistry — re-measures on onFontReady (task 267 FOUT corrector)", () => {
  let realIO: typeof IntersectionObserver;
  let realRO: typeof ResizeObserver;
  let realRaf: typeof requestAnimationFrame;
  let realCaf: typeof cancelAnimationFrame;

  beforeEach(() => {
    liveIOs = [];
    rafQueue = [];
    rectTop.value = 100;
    opticalState.offset = 0;
    fontReadyCbs.clear();
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
    const rendered = renderHook(() => useMarginaliaRegistry(editor));
    act(() => {
      flushRaf();
    });
    const io = liveIOs[0];
    act(() => {
      io.fire(paraEl, true);
    });
    return { editor, paraEl, io, ...rendered };
  }

  it("TOOTH 1: firing the registered onFontReady callback re-measures to the NEW font's optical center", () => {
    const { editor, result } = primeAndEnter();
    // offset 0 → top = opticalCenterY(100) - 20/2 = 100 - 10 = 90.
    expect(result.current.getMetrics(P_UUID)!.top).toBeCloseTo(90, 6);
    // The registry registered exactly one FOUT corrector.
    expect(fontReadyCbs.size).toBe(1);

    // A runtime font-family swap: the new face's cap-band center sits +6px lower.
    // The block box did NOT rewrap (rectTop unchanged) — only the optical metric
    // moved. No RO/IO/resize fires; ONLY the onFontReady wave can correct it.
    opticalState.offset = 6;
    act(() => {
      fireFontReady();
      flushRaf();
    });
    // Re-measured: top = opticalCenterY(100) - 10 = 106 - 10 = 96.
    expect(result.current.getMetrics(P_UUID)!.top).toBeCloseTo(96, 6);

    editor.destroy();
  });

  it("TOOTH 2: the disposer unregisters the callback on unmount (no closure leak)", () => {
    const { editor, unmount } = primeAndEnter();
    expect(fontReadyCbs.size).toBe(1);
    act(() => {
      unmount();
    });
    expect(fontReadyCbs.size).toBe(0);
    editor.destroy();
  });
});
