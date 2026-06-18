// @vitest-environment jsdom
//
// RC — list-item-note gutter-marker cull on HOVER (the real trigger).
//
// THE BUG (root-caused live, 2026-06-17)
// A note anchored to a live `<li>` (listItem) renders a gutter marker; the
// registry observed + cached the li's uuid. Hovering that marker writes
// `data-card-hovered` / `data-paragraph-kind` / `data-margin-side` onto the
// anchored block via `useAnchorHighlightReconciler` (a raw `setAttribute`, not
// a transaction). For paragraphs/headings that's harmless — they have React
// NodeViews with `ignoreMutation`. But `listItem` has NO NodeView: ProseMirror
// owns its `<li>` directly, and reconciling those foreign attributes against
// its `data-uuid` node-decoration makes PM REDRAW the node — it swaps the old
// `<li>` for a FRESH one with the same `data-uuid`.
//
// The OLD `<li>` (the one `io.observe` was called on, the one in `observed`)
// is now detached → it collapses to 0×0 → the IntersectionObserver fires a
// `!isIntersecting` (LEAVE) callback for it. Pre-fix, `onIntersection`'s LEAVE
// branch treated this like a viewport-leave: it dropped the uuid from
// `observed` + `cache` but left it in `attached`. Because the
// `syncObservedSet` short-circuit skips any uuid in `attached`, the FRESH
// `<li>` is then NEVER re-observed — `getMetrics` stays null and the marker is
// culled, sticky until reload. (No bus event fires: the block never left the
// doc, so nothing re-syncs.) This is exactly what the user saw on hover.
//
// THE FIX restores the invariant: a live anchorable block with a desired marker
// is NEVER left culled. A LEAVE for a DETACHED element (`!el.isConnected`) is
// recognized as a node swap, not a viewport-leave: the uuid is evicted from
// `attached` (retry budget reset) and a bounded self-heal re-sync is armed, so
// the fresh element is re-observed. The cache is kept (the block didn't move)
// to avoid a one-frame flicker.
//
// THE TOOTH: after the detach LEAVE + a settle frame, the li uuid is OBSERVED
// (on the FRESH element) and measured again — marker survives. Temp-reverting
// the fix (LEAVE drops observed/cache but keeps `attached`, no heal) → the
// fresh element is never re-observed → RED.
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

// `walkAnchorableBlocks` always lists the live li (it NEVER leaves the doc —
// only its DOM element is swapped). `resolveDomForUuid` returns the CURRENT
// live element (the swap flips which element that is). Everything else real.
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

import { Editor } from "@tiptap/core";
import { renderHook, act } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { useMarginaliaRegistry } from "@/hooks/useMarginaliaRegistry";

// ---------------------------------------------------------------------------
// Controllable IntersectionObserver + RAF (mirrors the observe-miss harness).
// ---------------------------------------------------------------------------

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
  /** Simulate `el` leaving (detached node → 0×0 → !isIntersecting). */
  fireLeave(el: Element) {
    this.cb([
      { target: el, isIntersecting: false } as unknown as IntersectionObserverEntry,
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

const LI_UUID = "ffb8";

function makeLiEl(): HTMLElement {
  const li = document.createElement("li");
  li.setAttribute("data-uuid", LI_UUID);
  li.getBoundingClientRect = () =>
    ({ top: 10, left: 0, right: 100, bottom: 34, width: 100, height: 24 }) as DOMRect;
  return li;
}

/** A doc with a bullet list whose single item carries `LI_UUID`. */
function mountDoc(): { editor: Editor; host: HTMLElement } {
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
          type: "bulletList",
          content: [
            {
              type: "listItem",
              attrs: { uuid: LI_UUID },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "An item." }] },
              ],
            },
          ],
        },
      ],
    },
  });
  return { editor, host };
}

describe("useMarginaliaRegistry — node-swap detach cull (list-item note hover RC)", () => {
  let realIO: typeof IntersectionObserver;
  let realRO: typeof ResizeObserver;
  let realRaf: typeof requestAnimationFrame;
  let realCaf: typeof cancelAnimationFrame;

  beforeEach(() => {
    liveIOs = [];
    rafQueue = [];
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

  it("an observed li element detached by a PM node swap fires a LEAVE → the FRESH element is re-observed + re-measured (marker survives), not permanently culled", () => {
    const { editor } = mountDoc();
    const liveBlocks = [{ uuid: LI_UUID, pos: 1, isAtom: false }];
    walkMock.mockReturnValue(liveBlocks);

    // Start with the original element attached + live.
    const originalLi = makeLiEl();
    document.body.appendChild(originalLi); // isConnected === true
    let currentLi = originalLi;
    // resolveDomForUuid always returns the CURRENT live element.
    resolveDomMock.mockImplementation(() => currentLi);

    const { result } = renderHook(() => useMarginaliaRegistry(editor));

    // Prime → first sync → observe the original element.
    act(() => {
      flushRaf();
    });
    const io = liveIOs[0];
    expect(io).toBeTruthy();
    expect(io.observed.has(originalLi)).toBe(true);

    // It enters the near-zone → measured + cached (marker renders).
    act(() => {
      io.fireIntersecting(originalLi);
    });
    expect(result.current.getMetrics(LI_UUID)).not.toBeNull();

    // ---- THE TRIGGER: PM redraws the listItem on hover ------------------
    // The original <li> is detached and a FRESH <li> (same data-uuid) replaces
    // it. The IntersectionObserver then fires a LEAVE for the detached one.
    document.body.removeChild(originalLi); // originalLi.isConnected === false
    const freshLi = makeLiEl();
    document.body.appendChild(freshLi);
    currentLi = freshLi; // resolveDomForUuid now yields the fresh element

    act(() => {
      io.fireLeave(originalLi);
    });

    // The bounded self-heal re-sync runs on the next frame and re-observes the
    // FRESH element (the original was un-attached, so the short-circuit no
    // longer skips the uuid).
    act(() => {
      flushRaf();
    });

    // THE TOOTH: the fresh element is observed; the stale one is not.
    expect(io.observed.has(freshLi)).toBe(true);
    expect(io.observed.has(originalLi)).toBe(false);

    // And once the fresh element intersects, metrics are non-null again.
    act(() => {
      io.fireIntersecting(freshLi);
    });
    expect(result.current.getMetrics(LI_UUID)).not.toBeNull();

    editor.destroy();
  });

  it("a genuine viewport-leave (element still connected) drops the cache but KEEPS the element IO-observed (re-enters on scroll-back) and triggers no self-heal", () => {
    // Guard the fix against over-correction: a real scroll-away must drop the
    // cache (off-screen blocks resolve to null by design) WITHOUT detaching the
    // still-connected element from the IO — otherwise it could never fire ENTER
    // again — and WITHOUT arming a self-heal re-sync (no node swap happened).
    const { editor } = mountDoc();
    const liveBlocks = [{ uuid: LI_UUID, pos: 1, isAtom: false }];
    walkMock.mockReturnValue(liveBlocks);

    const li = makeLiEl();
    document.body.appendChild(li); // stays connected throughout
    resolveDomMock.mockReturnValue(li);

    const { result } = renderHook(() => useMarginaliaRegistry(editor));
    act(() => {
      flushRaf();
    });
    const io = liveIOs[0];
    act(() => {
      io.fireIntersecting(li);
    });
    expect(result.current.getMetrics(LI_UUID)).not.toBeNull();

    // Scroll away: a LEAVE for the STILL-CONNECTED element.
    act(() => {
      io.fireLeave(li);
    });
    // Off-screen → metrics null (correct: its anchor isn't visible either).
    expect(result.current.getMetrics(LI_UUID)).toBeNull();

    // No perpetual self-heal loop scheduled by a mere viewport-leave.
    let guard = 0;
    while (rafQueue.length > 0 && guard < 20) {
      guard += 1;
      act(() => {
        flushRaf();
      });
    }
    expect(guard).toBe(0); // nothing was scheduled

    // The element stays IO-observed so it can re-enter the near-zone and
    // re-measure when scrolled back into view.
    expect(io.observed.has(li)).toBe(true);
    act(() => {
      io.fireIntersecting(li);
    });
    expect(result.current.getMetrics(LI_UUID)).not.toBeNull();

    editor.destroy();
  });
});
