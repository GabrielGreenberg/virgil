// @vitest-environment jsdom
//
// RC — list-item-note gutter-marker cull on a transient `walkAnchorableBlocks`
// exclusion.
//
// THE BUG
// A note anchored to a live `<li>` (listItem) renders a gutter marker: the
// registry observed + cached the li's uuid. Then a `syncObservedSet` runs whose
// `walkAnchorableBlocks` TRANSIENTLY excludes that still-live uuid (a mid-
// transaction / measure-time walk that momentarily didn't enumerate the li).
// Pre-fix, the drop loop `io.unobserve`'d it, dropped its cache, and folded it
// OUT of `lastUuidSet` — and because `lastUuidSet` ALSO doubled as the
// "already observing?" short-circuit, a later (recovered) walk that re-includes
// the uuid would re-attach it... but no later sync was ever triggered (the bus
// didn't fire — the block never actually left the doc), so the cull stuck until
// reload. The user saw exactly this on hovering a list-item note's marker.
//
// THE FIX restores the invariant: a live uuid (present in `walkAnchorableBlocks`)
// with a desired marker is NEVER left permanently un-observed. The short-circuit
// reads `attached` (the set `io.observe` was actually called for), not
// `lastUuidSet`; and a drop of a STILL-LIVE uuid schedules a bounded self-heal
// re-sync, so the recovered next walk re-observes it.
//
// THE TOOTH: after the transient-exclusion sync + a settle frame, the li uuid
// is OBSERVED + measured again (marker survives). Temp-reverting the fix (drop
// loop folds it out with no heal, short-circuit keyed on `lastUuidSet`) → it is
// never re-observed → RED.
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

// Control `walkAnchorableBlocks` (transiently exclude the li uuid on demand) and
// `resolveDomForUuid` (always resolves the li element — it never left the DOM),
// keeping everything else real.
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

/**
 * Append a paragraph at the doc end. This is a REAL structural insertion, so the
 * DocStructureObserver fires `onBlocksAdded` through the actual plugin, which is
 * what the registry subscribes to → it runs `syncObservedSet`. We don't care
 * about the new block (the walk is mocked); we only need the registry's real bus
 * subscription to fire a sync, with our controlled walk in effect for that run.
 */
function appendParagraph(editor: Editor) {
  const endPos = editor.state.doc.content.size;
  editor.view.dispatch(
    editor.state.tr.insert(
      endPos,
      editor.schema.nodes.paragraph.create(
        null,
        editor.schema.text("x"),
      ),
    ),
  );
}

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

/** A doc with a bullet list whose single item carries `LI_UUID`. */
function mountDoc(): { editor: Editor; host: HTMLElement; liEl: HTMLElement } {
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

  // The DOM element the registry resolves + measures for LI_UUID. It never
  // leaves the DOM in this scenario — only the WALK transiently omits it.
  const liEl = document.createElement("li");
  liEl.setAttribute("data-uuid", LI_UUID);
  liEl.getBoundingClientRect = () =>
    ({ top: 10, left: 0, right: 100, bottom: 34, width: 100, height: 24 }) as DOMRect;

  return { editor, host, liEl };
}

describe("useMarginaliaRegistry — transient walk-exclusion cull (list-item note RC)", () => {
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

  it("a live list-item uuid transiently dropped by an incomplete walk is re-observed + re-measured (marker survives), not permanently culled", () => {
    const { editor, liEl } = mountDoc();

    const liveBlocks = [{ uuid: LI_UUID, pos: 1, isAtom: false }];
    // The DOM element is ALWAYS resolvable — the li never leaves the DOM. (The
    // drop loop's still-live probe must see it to schedule the self-heal.)
    resolveDomMock.mockReturnValue(liEl);

    // Walk returns the live block normally...
    walkMock.mockReturnValue(liveBlocks);

    const { result } = renderHook(() => useMarginaliaRegistry(editor));

    // Prime (RAF-deferred) → first syncObservedSet → observe LI_UUID.
    act(() => {
      flushRaf();
    });
    const io = liveIOs[0];
    expect(io).toBeTruthy();
    expect(io.observed.has(liEl)).toBe(true);

    // It enters the near-zone → measured + cached (the marker renders).
    act(() => {
      io.fireIntersecting(liEl);
    });
    expect(result.current.getMetrics(LI_UUID)).not.toBeNull();

    // NOW the transient exclusion: the next syncObservedSet's walk momentarily
    // omits the still-live li (returns []). A real structural edit fires the
    // bus → the registry runs the sync, with the incomplete walk in effect for
    // that run only. (`mockReturnValueOnce` applies to the FIRST walk call the
    // sync makes; the drop-loop's still-live probe goes through `resolveDom`,
    // not the walk, so one override is exactly the transient-exclusion run.)
    walkMock.mockReturnValueOnce([]);
    act(() => {
      appendParagraph(editor);
    });

    // Settle: the bounded self-heal re-sync runs on the next frame and the
    // recovered walk re-observes the still-live li.
    act(() => {
      flushRaf();
    });
    act(() => {
      flushRaf();
    });

    // THE TOOTH: the li is observed again and (once it re-intersects) measured.
    expect(io.observed.has(liEl)).toBe(true);
    act(() => {
      io.fireIntersecting(liEl);
    });
    expect(result.current.getMetrics(LI_UUID)).not.toBeNull();

    editor.destroy();
  });

  it("a uuid that genuinely LEAVES the doc is reaped and NOT re-observed (the drop is still honored)", () => {
    // Guard the fix against over-correction: a real removal must still drop.
    const { editor, liEl } = mountDoc();
    const liveBlocks = [{ uuid: LI_UUID, pos: 1, isAtom: false }];
    walkMock.mockReturnValue(liveBlocks);
    // resolveDom returns the element while present, null once it's gone.
    let present = true;
    resolveDomMock.mockImplementation(() => (present ? liEl : null));

    const { result } = renderHook(() => useMarginaliaRegistry(editor));
    act(() => {
      flushRaf();
    });
    const io = liveIOs[0];
    act(() => {
      io.fireIntersecting(liEl);
    });
    expect(result.current.getMetrics(LI_UUID)).not.toBeNull();

    // The block genuinely leaves: walk no longer lists it AND its DOM is gone.
    present = false;
    walkMock.mockReturnValue([]);
    act(() => {
      appendParagraph(editor);
    });
    // Let any scheduled frames run — there must be no perpetual re-sync, and the
    // uuid must stay dropped.
    let guard = 0;
    while (rafQueue.length > 0 && guard < 20) {
      guard += 1;
      act(() => {
        flushRaf();
      });
    }

    expect(io.observed.has(liEl)).toBe(false);
    expect(result.current.getMetrics(LI_UUID)).toBeNull();
    expect(guard).toBeLessThan(20); // no perpetual loop

    editor.destroy();
  });
});
