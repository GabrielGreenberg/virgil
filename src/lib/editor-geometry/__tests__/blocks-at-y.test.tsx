// @vitest-environment jsdom
/**
 * Wave-2 C1/C3 — `blocksAtY`: the hover-path query answered from the
 * near-zone cache (one host-rect read + arithmetic; zero per-block DOM
 * reads). Pins the three-way contract the two consumers rely on:
 *
 *   - null when the service CANNOT answer (engine not retained, hidden, or
 *     nothing observed yet) — callers fall back to their legacy scans;
 *   - [] when the answer is genuinely "no block at this Y" (a band gap);
 *   - hits carry the block's uuid + live node DOM, band-contained.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getOrCreateGeometry } from "../registry";

type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let liveIOs: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  cb: IOCallback;
  constructor(cb: IOCallback) {
    this.cb = cb;
    liveIOs.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    liveIOs = liveIOs.filter((io) => io !== this);
  }
  takeRecords() {
    return [];
  }
  fireEnter(els: Element[]) {
    this.cb(
      els.map(
        (el) =>
          ({ target: el, isIntersecting: true }) as unknown as IntersectionObserverEntry,
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

const UUIDS = ["ba1", "ba2", "ba3"];
/** Per-uuid stubbed viewport bands (non-overlapping, with gaps). */
const BANDS: Record<string, { top: number; bottom: number }> = {
  ba1: { top: 10, bottom: 30 },
  ba2: { top: 40, bottom: 60 },
  ba3: { top: 70, bottom: 90 },
};

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function mount(): { editor: Editor; els: HTMLElement[] } {
  const host = document.createElement("div");
  host.setAttribute("data-marginalia-host", "");
  host.getBoundingClientRect = () => rect(0, 1000);
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
  // The IO targets are the REAL node DOMs (they carry the data-uuid
  // decoration), with stubbed rects so `measureBlock` reads deterministic
  // bands in jsdom.
  let pos = 0;
  const els: HTMLElement[] = [];
  for (let i = 0; i < editor.state.doc.childCount; i++) {
    const node = editor.state.doc.child(i);
    const el = editor.view.nodeDOM(pos) as HTMLElement;
    const uuid = node.attrs.uuid as string;
    el.getBoundingClientRect = () => rect(BANDS[uuid].top, BANDS[uuid].bottom);
    els.push(el);
    pos += node.nodeSize;
  }
  return { editor, els };
}

let realIO: typeof IntersectionObserver;
let realRO: typeof ResizeObserver;
let realRaf: typeof requestAnimationFrame;
let realCaf: typeof cancelAnimationFrame;

beforeEach(() => {
  liveIOs = [];
  rafQueue = [];
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
  document.body.innerHTML = "";
});

describe("blocksAtY", () => {
  it("null before the engine starts; hits/gaps once the near-zone cache fills", () => {
    const { editor, els } = mount();
    const service = getOrCreateGeometry(editor);
    // Not retained → cannot answer.
    expect(service.blocksAtY(20)).toBeNull();

    const release = service.retain();
    flushRaf(); // prime
    expect(liveIOs.length).toBe(1);
    // Nothing observed yet → still null (fallback stays correct).
    expect(service.blocksAtY(20)).toBeNull();

    liveIOs[0].fireEnter(els);
    // Band containment answers from the cache.
    expect(service.blocksAtY(20)?.map((h) => h.uuid)).toEqual(["ba1"]);
    expect(service.blocksAtY(45)?.map((h) => h.uuid)).toEqual(["ba2"]);
    expect(service.blocksAtY(89)?.map((h) => h.uuid)).toEqual(["ba3"]);
    // A gap between bands is a REAL empty answer, not a fallback signal.
    expect(service.blocksAtY(35)).toEqual([]);
    // The hit carries the live node DOM.
    expect(service.blocksAtY(20)![0].el).toBe(els[0]);

    release();
    editor.destroy();
  });

  it("hidden (keep-alive) answers null — consumers must not read 0-boxes", () => {
    const { editor, els } = mount();
    const service = getOrCreateGeometry(editor);
    const release = service.retain();
    flushRaf();
    liveIOs[0].fireEnter(els);
    expect(service.blocksAtY(20)).not.toBeNull();
    service.setVisible(false);
    expect(service.blocksAtY(20)).toBeNull();
    service.setVisible(true);
    expect(service.blocksAtY(20)?.map((h) => h.uuid)).toEqual(["ba1"]);
    release();
    editor.destroy();
  });
});
