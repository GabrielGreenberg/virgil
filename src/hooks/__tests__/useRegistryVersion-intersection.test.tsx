// @vitest-environment jsdom
//
// Regression guard for the gutter "stale position on scroll-in" bug:
// `useRegistryVersion` used to snapshot `recomputes`, which bumps ONLY in
// `flushRecompute`. But the registry also `notify()`s (bumping `version`) when a
// block ENTERS the near-zone via the IntersectionObserver and is measured —
// WITHOUT bumping `recomputes`. So an intersection-only cache change did NOT
// re-render the gutter, leaving a marker at a stale position until some unrelated
// recompute fired. The fix snapshots `version`. This test drives an intersection
// ENTER and asserts the version snapshot advances while `recomputes` stays flat
// (so the OLD snapshot would have missed it).
//
// Mirrors the IO/RAF harness from useMarginaliaRegistry-observe-miss.test.tsx.
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

const resolveDomMock = vi.fn();
vi.mock("@/lib/marginalia-blocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marginalia-blocks")>();
  return {
    ...actual,
    resolveDomForUuid: (...args: Parameters<typeof actual.resolveDomForUuid>) =>
      resolveDomMock(...args),
  };
});

vi.mock("@/components/editor-layout/layout-scroll", () => ({
  findRowScroll: () => null,
  findEditorScrollFor: () => null,
}));

import { Editor } from "@tiptap/core";
import { renderHook, act } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useMarginaliaRegistry,
  useRegistryVersion,
} from "@/hooks/useMarginaliaRegistry";

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
  fireIntersecting(el: Element) {
    this.cb([
      { target: el, isIntersecting: true } as unknown as IntersectionObserverEntry,
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

function mountDoc(): { editor: Editor; uuid: string } {
  const uuid = "P-intersection";
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
        { type: "paragraph", attrs: { uuid }, content: [{ type: "text", text: "An observed paragraph." }] },
      ],
    },
  });
  return { editor, uuid };
}

describe("useRegistryVersion — intersection-only updates re-render (snapshots version, not recomputes)", () => {
  let realIO: typeof IntersectionObserver;
  let realRO: typeof ResizeObserver;
  let realRaf: typeof requestAnimationFrame;
  let realCaf: typeof cancelAnimationFrame;

  beforeEach(() => {
    liveIOs = [];
    rafQueue = [];
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

  it("an intersection ENTER bumps the version snapshot while recomputes stays flat", () => {
    const { editor, uuid } = mountDoc();
    const el = document.createElement("p");
    el.setAttribute("data-uuid", uuid);
    el.getBoundingClientRect = () =>
      ({ top: 10, left: 0, right: 100, bottom: 34, width: 100, height: 24 }) as DOMRect;
    resolveDomMock.mockReturnValue(el); // painted → observed on first sync

    const { result } = renderHook(() => {
      const registry = useMarginaliaRegistry(editor);
      const version = useRegistryVersion(registry);
      return { registry, version };
    });

    // Prime is RAF-deferred → first syncObservedSet observes the el.
    act(() => {
      flushRaf();
    });

    // `version` is what consumers (Marginalia gutter) re-render on; `stats()`
    // exposes both for the diagnostic contract.
    expect(typeof result.current.version).toBe("number");
    const r0 = result.current.registry.stats().recomputes;

    // Re-render the consumer view once so the version snapshot is captured AFTER
    // any prime-time measurement settles, then drive a fresh ENTER.
    const v0 = result.current.registry.stats().version;

    // Drive an intersection ENTER → onIntersection measures the block and
    // notify()s (bumps `version`), but does NOT touch `recomputes`.
    act(() => {
      liveIOs[0].fireIntersecting(el);
    });

    const v1 = result.current.registry.stats().version;
    const r1 = result.current.registry.stats().recomputes;

    // version advanced (so useRegistryVersion re-renders) ...
    expect(v1).toBeGreaterThan(v0);
    // ... while recomputes did NOT — i.e. the OLD `recomputes` snapshot would
    // have MISSED this update and left the gutter stale.
    expect(r1).toBe(r0);
    // And the hook's reactive value tracks `version`.
    expect(result.current.version).toBe(v1);

    editor.destroy();
  });
});
