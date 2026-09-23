// @vitest-environment jsdom
/**
 * Task 584 — an editor measures against, and listens to, the scroll container
 * of its OWN pane, never "whichever pane is visible".
 *
 * `findEditorScrollFor` used to fall through to `findRowScroll()`, the
 * keep-alive visibility ladder. Every doc pane (and the Library Reader) wraps
 * its editor in its own `[data-virgil-row-scroll]`, so the ladder is right
 * only while the ASKING editor is the visible one. The geometry engine captures
 * its IntersectionObserver root once per prime, and `useInTextPositions`
 * attaches its scroll-idle listener once — so a pane whose editor became ready
 * while hidden observed against ANOTHER pane's scroller for its whole life
 * (per the IO spec a non-descendant target never intersects: no margin
 * markers for the session).
 *
 * WHY NO PRE-584 SUITE COULD SEE THIS: every geometry fixture mounts ONE pane,
 * where "the visible pane's row scroll" and "the editor's own row scroll" are
 * the same element by construction. Every leg here builds TWO.
 *
 * jsdom reports `offsetParent === null` for everything, so visibility is
 * stubbed per element (the `pane-dom-multipane` trick).
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
import {
  findEditorScrollFor,
  findRowScroll,
  findRowScrollFor,
  resolveAlignScroll,
} from "@/components/editor-layout/layout-scroll";

function stubVisible(el: HTMLElement, visible: boolean) {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get: () => (visible ? document.body : null),
  });
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    get: () => (visible ? 100 : 0),
  });
}

/** One pane: its row scroll + an inner host the editor mounts into. */
function pane(visible: boolean): { row: HTMLElement; host: HTMLElement } {
  const row = document.createElement("div");
  row.setAttribute("data-virgil-row-scroll", "");
  stubVisible(row, visible);
  const host = document.createElement("div");
  row.appendChild(host);
  document.body.appendChild(row);
  return { row, host };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findEditorScrollFor resolves the view's OWN pane", () => {
  it("hidden pane FIRST in DOM order, visible second → the hidden view gets its own row", () => {
    const hidden = pane(false);
    const visible = pane(true);
    const view = document.createElement("div");
    hidden.host.appendChild(view);
    // Canary: the ladder really does answer with the OTHER pane here, so the
    // leg below cannot pass by the two answers being trivially equal.
    expect(findRowScroll()).toBe(visible.row);
    expect(findEditorScrollFor(view)).toBe(hidden.row);
  });

  it("the reverse order → still the view's own row", () => {
    const visible = pane(true);
    const hidden = pane(false);
    const view = document.createElement("div");
    hidden.host.appendChild(view);
    expect(findRowScroll()).toBe(visible.row);
    expect(findEditorScrollFor(view)).toBe(hidden.row);
  });

  it("a mirror scroll ancestor still wins over the row", () => {
    const p = pane(true);
    const mirror = document.createElement("div");
    mirror.setAttribute("data-virgil-mirror-scroll", "");
    p.host.appendChild(mirror);
    const view = document.createElement("div");
    mirror.appendChild(view);
    expect(findEditorScrollFor(view)).toBe(mirror);
  });

  it("CONTROL: a view with no row-scroll ancestor (a body-portaled float) takes the ladder", () => {
    pane(false);
    const visible = pane(true);
    const floatView = document.createElement("div");
    document.body.appendChild(floatView);
    expect(findEditorScrollFor(floatView)).toBe(visible.row);
    expect(findRowScrollFor(floatView)).toBe(visible.row);
    expect(findEditorScrollFor(null)).toBe(visible.row);
  });

  it("resolveAlignScroll reads the entry's own row, not the visible one", () => {
    const hidden = pane(false);
    pane(true);
    const entry = document.createElement("div");
    hidden.host.appendChild(entry);
    expect(resolveAlignScroll(entry)).toBe(hidden.row);
  });
});

// ── Service leg: the IO root is the pane's own scroller ────────────────────

let ioRoots: Array<Element | Document | null | undefined> = [];

class FakeIntersectionObserver {
  constructor(_cb: unknown, opts?: IntersectionObserverInit) {
    ioRoots.push(opts?.root);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

let realIO: typeof IntersectionObserver;
let realRO: typeof ResizeObserver;
let realRaf: typeof requestAnimationFrame;
let realCaf: typeof cancelAnimationFrame;
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  ioRoots = [];
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
});

describe("geometry engine primed while its pane is hidden", () => {
  it("constructs its IntersectionObserver with the pane's OWN scroller as root", () => {
    const hidden = pane(false);
    const visible = pane(true);
    const element = document.createElement("div");
    element.setAttribute("data-marginalia-host", "");
    hidden.host.appendChild(element);
    const editor = new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { uuid: "b1" },
            content: [{ type: "text", text: "Para one." }],
          },
        ],
      },
    });
    try {
      const release = getOrCreateGeometry(editor).retain();
      for (let i = 0; i < 8 && rafQueue.length > 0; i++) {
        const q = rafQueue;
        rafQueue = [];
        for (const cb of q) cb(0);
      }
      expect(ioRoots.length).toBeGreaterThan(0);
      expect(ioRoots.every((r) => r === hidden.row)).toBe(true);
      expect(ioRoots).not.toContain(visible.row);
      release();
    } finally {
      editor.destroy();
    }
  });
});
