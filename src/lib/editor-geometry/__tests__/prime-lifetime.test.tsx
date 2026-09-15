// @vitest-environment jsdom
/**
 * Task 586 — the engine's deferred prime belongs to the start that armed it.
 *
 * `tryPrime` RAF-defers `prime()`, which constructs the engine's ONE
 * IntersectionObserver + ONE ResizeObserver. Pre-586 the RAF handle was not
 * kept and the callback asked only `editor.isDestroyed`, so a stop inside the
 * same frame (React StrictMode's retain → release → retain effect double-
 * invoke, or any quick mount/unmount) still primed: observers built for a
 * STOPPED engine, never disconnected, and — on the StrictMode path — a second
 * live pair that doubled every RO delivery.
 *
 * WHY NO PRE-586 SUITE COULD SEE THIS: every geometry / marginalia fixture
 * retains ONCE and flushes, where "the prime" and "the live start's prime"
 * are the same callback by construction. Every leg here stops before the RAF.
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

vi.mock("@/components/editor-layout/layout-scroll", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/editor-layout/layout-scroll")>();
  return { ...actual, findRowScroll: () => null, findEditorScrollFor: () => null };
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { createEditorGeometryService } from "../service";

interface Tracked {
  disconnected: boolean;
}
let ios: Tracked[] = [];
let ros: Tracked[] = [];

class FakeIO implements Tracked {
  disconnected = false;
  constructor() {
    ios.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
}
class FakeRO implements Tracked {
  disconnected = false;
  constructor() {
    ros.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

// A RAF queue whose handles CANCEL — the fix's cancel is otherwise invisible.
let nextRaf = 1;
let rafQueue = new Map<number, FrameRequestCallback>();
function flushRaf() {
  for (let guard = 0; guard < 10 && rafQueue.size; guard++) {
    const q = rafQueue;
    rafQueue = new Map();
    for (const cb of q.values()) cb(performance.now());
  }
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

function mountEditor(): Editor {
  const host = document.createElement("div");
  host.setAttribute("data-marginalia-host", "");
  const element = document.createElement("div");
  host.appendChild(element);
  document.body.appendChild(host);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "P-prime" },
          content: [{ type: "text", text: "A paragraph." }],
        },
      ],
    },
  });
}

describe("geometry engine — deferred prime is bound to its start (task 586)", () => {
  const saved = {
    io: globalThis.IntersectionObserver,
    ro: globalThis.ResizeObserver,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
  };
  let editor: Editor;

  beforeEach(() => {
    ios = [];
    ros = [];
    rafQueue = new Map();
    globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = nextRaf++;
      rafQueue.set(id, cb);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      rafQueue.delete(id);
    }) as typeof cancelAnimationFrame;
    editor = mountEditor();
  });

  afterEach(() => {
    editor.destroy();
    document.body.innerHTML = "";
    globalThis.IntersectionObserver = saved.io;
    globalThis.ResizeObserver = saved.ro;
    globalThis.requestAnimationFrame = saved.raf;
    globalThis.cancelAnimationFrame = saved.caf;
  });

  it("control: one retain + flush primes exactly one observer pair", () => {
    const svc = createEditorGeometryService(editor);
    const release = svc.retain();
    flushRaf();
    expect(ios).toHaveLength(1);
    expect(ros).toHaveLength(1);
    release();
    expect(ios.every((o) => o.disconnected)).toBe(true);
    expect(ros.every((o) => o.disconnected)).toBe(true);
  });

  it("a stop before the RAF constructs NO observers", () => {
    const svc = createEditorGeometryService(editor);
    const release = svc.retain();
    release();
    flushRaf();
    expect(ios).toHaveLength(0);
    expect(ros).toHaveLength(0);
  });

  it("StrictMode retain → release → retain constructs ONE pair, all disconnected on the final release", () => {
    const svc = createEditorGeometryService(editor);
    svc.retain()();
    const release = svc.retain();
    flushRaf();
    expect(ios).toHaveLength(1);
    expect(ros).toHaveLength(1);
    release();
    expect(ios.every((o) => o.disconnected)).toBe(true);
    expect(ros.every((o) => o.disconnected)).toBe(true);
  });
});
