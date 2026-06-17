// @vitest-environment jsdom
//
// CHIP-B — registry first-paint observe-miss fix (RC2.b).
//
// When `syncObservedSet` runs before a freshly-added block's decoration DOM
// has painted, `resolveDomForUuid` returns null and `io.observe` is skipped.
// The PRE-FIX behavior folded that uuid into `lastUuidSet` anyway, so the
// `if (lastUuidSet.has(uuid)) continue` short-circuit meant it was NEVER
// re-observed — the marker's metrics stayed null forever and the card
// vanished (RC2.b "appears then never paints").
//
// The fix tracks an unresolved new uuid in `pendingObserve` (NOT
// `lastUuidSet`) and retries it — both on the next structural sync AND via a
// self-driven RAF retry — until the DOM resolves and it gets observed +
// measured.
//
// The TOOTH: `resolveDomForUuid` returns null on the FIRST sync and non-null
// on a later one → the uuid must EVENTUALLY be observed (and, once it
// intersects, measured to non-null metrics). Temp-reverting the fix
// (re-record in `lastUuidSet` on a miss) → it's never re-observed → RED.
//
// The storage stub guards the extension-barrel/@/lib/storage gotcha.
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

// Control `resolveDomForUuid` (null first, non-null later) and keep
// `walkAnchorableBlocks` real.
const resolveDomMock = vi.fn();
vi.mock("@/lib/marginalia-blocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marginalia-blocks")>();
  return {
    ...actual,
    resolveDomForUuid: (...args: Parameters<typeof actual.resolveDomForUuid>) =>
      resolveDomMock(...args),
  };
});

// findRowScroll → null (IO root falls back to viewport, fine for the test).
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
import { useMarginaliaRegistry } from "@/hooks/useMarginaliaRegistry";

// ---------------------------------------------------------------------------
// Controllable IntersectionObserver + RAF
// ---------------------------------------------------------------------------

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

interface FakeIO {
  cb: IOCallback;
  observed: Set<Element>;
}
let liveIOs: FakeIO[] = [];

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
  /** Test helper: simulate `el` entering the near-zone. */
  fireIntersecting(el: Element) {
    this.cb([
      {
        target: el,
        isIntersecting: true,
      } as unknown as IntersectionObserverEntry,
    ]);
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Manual RAF queue so the test drives the registry's RAF-deferred prime +
// observe-retry deterministically.
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

function mountDoc(): { editor: Editor; host: HTMLElement; uuid: string } {
  const uuid = "P-observe-miss";
  // A marginalia host ancestor is required by `resolveHost`.
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
          attrs: { uuid },
          content: [{ type: "text", text: "An observed paragraph." }],
        },
      ],
    },
  });
  return { editor, host, uuid };
}

describe("useMarginaliaRegistry — first-paint observe-miss retry (CHIP-B)", () => {
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

  it("resolveDomForUuid null on first sync, non-null on a later one → uuid is EVENTUALLY observed + measured (not stuck)", () => {
    const { editor, uuid } = mountDoc();

    // The real DOM element the registry would observe + measure.
    const el = document.createElement("p");
    el.setAttribute("data-uuid", uuid);
    el.getBoundingClientRect = () =>
      ({ top: 10, left: 0, right: 100, bottom: 34, width: 100, height: 24 }) as DOMRect;
    // measureBlock reads computed line-height; jsdom returns "" → it falls
    // back to fontSize*1.2, which is finite. Give it a measurable child path:
    // the registry calls coordsAtPos for a prose node when measureEl === dom;
    // simplest is to let the measure path bail gracefully and still cache.
    // We assert OBSERVATION (the tooth) regardless of the exact metrics math.

    // FIRST resolve → null (decoration not painted yet); ALL later → el.
    let calls = 0;
    resolveDomMock.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? null : el;
    });

    const { result } = renderHook(() => useMarginaliaRegistry(editor));

    // Prime is RAF-deferred. Flush the prime RAF → first syncObservedSet runs
    // (resolveDom #1 = null → observe skipped, uuid goes to pendingObserve,
    // and a retry RAF is scheduled).
    act(() => {
      flushRaf();
    });

    // After the FIRST sync, the uuid was NOT observed (DOM was null).
    expect(liveIOs.length).toBe(1);
    const io = liveIOs[0] as unknown as FakeIntersectionObserver;
    expect(io.observed.has(el)).toBe(false);

    // Flush the self-driven retry RAF → second syncObservedSet → resolveDom
    // #2 = el → io.observe(el). THE TOOTH: the uuid is no longer stuck.
    act(() => {
      flushRaf();
    });
    expect(io.observed.has(el)).toBe(true);

    // And once it intersects, it measures to non-null metrics (not culled).
    act(() => {
      io.fireIntersecting(el);
    });
    expect(result.current.getMetrics(uuid)).not.toBeNull();

    editor.destroy();
  });
});
