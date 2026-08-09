// @vitest-environment jsdom
//
// Phase 3 (MEMO_INSTANT_SWITCH.md §3): the per-IO-batch doc-walk hoist.
//
// THE COST: `onIntersection` resolved each ENTER entry's position by calling
// `walkAnchorableBlocks(editor)` (a full `doc.descendants()` walk) INSIDE the
// per-entry loop — O(K × doc) for a K-entry batch. On a keep-alive re-show the
// browser fires one batched IO callback for every near-zone block at once, so
// this detonated into K full doc walks.
//
// THE FIX: build ONE posByUuid map per batch (lazily) and look each entry up —
// O(doc + K). This pins it: a K-entry ENTER batch performs exactly ONE walk.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

const walkMock = vi.fn();
vi.mock("@/lib/marginalia-blocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marginalia-blocks")>();
  return {
    ...actual,
    walkAnchorableBlocks: (...args: Parameters<typeof actual.walkAnchorableBlocks>) =>
      walkMock(...args),
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

type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let liveIOs: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  cb: IOCallback;
  observed = new Set<Element>();
  constructor(cb: IOCallback) {
    this.cb = cb;
    liveIOs.push(this);
  }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); liveIOs = liveIOs.filter((io) => io !== this); }
  takeRecords() { return []; }
  /** Fire ONE batched callback with all entries entering at once. */
  fireBatchIntersecting(els: Element[]) {
    this.cb(
      els.map(
        (el) => ({ target: el, isIntersecting: true }) as unknown as IntersectionObserverEntry,
      ),
    );
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

const UUIDS = ["aaa1", "bbb2", "ccc3", "ddd4"];

function mountDoc(): { editor: Editor; els: HTMLElement[] } {
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
      content: UUIDS.map((uuid) => ({
        type: "paragraph",
        attrs: { uuid },
        content: [{ type: "text", text: `Para ${uuid}.` }],
      })),
    },
  });
  // DOM elements the IO entries point at.
  const els = UUIDS.map((uuid) => {
    const el = document.createElement("div");
    el.setAttribute("data-uuid", uuid);
    el.getBoundingClientRect = () =>
      ({ top: 10, left: 0, right: 100, bottom: 34, width: 100, height: 24 }) as DOMRect;
    return el;
  });
  return { editor, els };
}

describe("useMarginaliaRegistry — IO batch resolves positions with ONE walk (hoist)", () => {
  let realIO: typeof IntersectionObserver;
  let realRO: typeof ResizeObserver;
  let realRaf: typeof requestAnimationFrame;
  let realCaf: typeof cancelAnimationFrame;

  beforeEach(() => {
    liveIOs = [];
    rafQueue = [];
    walkMock.mockReset();
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

  it("a K-entry ENTER batch performs ZERO walkAnchorableBlocks (bus-resolved; was K, then 1)", () => {
    const { editor, els } = mountDoc();
    walkMock.mockReturnValue(
      UUIDS.map((uuid, i) => ({ uuid, pos: 1 + i * 6, isAtom: false })),
    );

    renderHook(() => useMarginaliaRegistry(editor));
    act(() => { flushRaf(); }); // prime → first sync (1 walk)
    const io = liveIOs[0];
    expect(io).toBeTruthy();

    // The re-show storm: every near-zone block enters in ONE batched callback.
    walkMock.mockClear();
    act(() => {
      io.fireBatchIntersecting(els);
    });

    // THE TOOTH, strengthened by wave-2 S3b: measurement positions resolve
    // from the DocStructure snapshot (this harness mounts the full main
    // extension set, so the bus is live and covers UUIDS), so the batch pays
    // ZERO doc walks — the walk survives only as the observer-less-editor
    // fallback (still exercised by the transient-walk-cull suite through
    // `syncObservedSet`, which deliberately keeps the walk as its source).
    expect(walkMock).toHaveBeenCalledTimes(0);

    editor.destroy();
  });

  it("a pure viewport-LEAVE batch performs ZERO walks (lazy builder)", () => {
    const { editor, els } = mountDoc();
    walkMock.mockReturnValue(
      UUIDS.map((uuid, i) => ({ uuid, pos: 1 + i * 6, isAtom: false })),
    );
    renderHook(() => useMarginaliaRegistry(editor));
    act(() => { flushRaf(); });
    const io = liveIOs[0];

    // First, enter them so they're observed/cached.
    act(() => { io.fireBatchIntersecting(els); });

    // Now a LEAVE-only batch: no positions need resolving → the lazy map is
    // never built → zero walks.
    walkMock.mockClear();
    act(() => {
      io.cb(
        els.map(
          (el) => ({ target: el, isIntersecting: false }) as unknown as IntersectionObserverEntry,
        ),
      );
    });
    expect(walkMock).toHaveBeenCalledTimes(0);

    editor.destroy();
  });
});
