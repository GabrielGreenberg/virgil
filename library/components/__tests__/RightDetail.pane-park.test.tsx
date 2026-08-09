// @vitest-environment jsdom
//
// PHASE-4 WIRING (plan §P3, defense-in-depth parks): RightDetail's two
// per-frame feedback paths must route through `parkDuringLayoutGesture`, driven
// here through REAL LayoutGestureBus edges — the park calls are silent wiring
// whose deletion no other suite would surface (the primitive has its own
// unit suite; this pins the CONSUMER sites):
//
//   1. pdf.js page-state feedback (PdfView → onPdfPageStateChange): events
//      arriving MID-drag (an async rasterize completing, a pagechanging
//      settling) must not re-render RightDetail per pointer frame — they
//      park (latest wins) and apply once on the end edge.
//   2. the text-mode [data-pod-frame] ResizeObserver → textPodRect measure:
//      an RO fire mid-drag parks; the end edge reconciles ONCE into the
//      setTextPodRect → PaperHeader podAlign chain.
//
// (The third consumer site, usePgmarkPages' RO park, is pinned in
// library/hooks/__tests__/usePgmarkPages.test.tsx.) Same stub-the-heavy-
// children setup as RightDetail.pane-freeze, with capture-mocks instead of
// inert stubs.

import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { BibEntry } from "@library/lib/types";
import type { CatalogEntry } from "@library/lib/catalog";
import { __resetViewSessionForTests } from "@library/lib/view-session-store";
import {
  beginLayoutGesture,
  endLayoutGesture,
  __resetLayoutGestureBusForTest,
  type LayoutGestureInfo,
} from "@/lib/pane-resize/layout-gesture-bus";
import type { PdfPageState } from "@library/lib/pdf-pgmark-adapter";
import type { PgmarkPages } from "@library/hooks/usePgmarkPages";

const memStore = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
      setItem: (k: string, v: string) => void memStore.set(k, v),
      removeItem: (k: string) => void memStore.delete(k),
      clear: () => memStore.clear(),
    },
  });
});

// Mock-factory state must be vi.hoisted: the factories execute while
// RightDetail's import graph loads, before this module's body runs.
const cap = vi.hoisted(() => ({
  /** Every PaperHeader render's props, in order — the parked paths are
   *  observable as prop changes (pgmarkPages for pdf, textPodRect for text). */
  headerProps: [] as Array<Record<string, unknown>>,
  /** PdfView's lifted page-state callback (the pdf.js eventBus stand-in). */
  onPdfPageState: null as
    | null
    | ((s: { pagesCount: number; currentPage: number }, nav: (p: number) => void) => void),
  /** Handed up through PaperRender's onReaderRefs so the textPodRect RO
   *  effect runs against controllable geometry. */
  readerScrollEl: null as HTMLElement | null,
}));

vi.mock("../PaperHeader", () => ({
  default: (props: Record<string, unknown>) => {
    cap.headerProps.push(props);
    return <div data-testid="header" />;
  },
}));
vi.mock("../PdfView", () => ({
  default: (props: {
    onPdfPageStateChange?: (s: never, nav: never) => void;
  }) => {
    cap.onPdfPageState =
      (props.onPdfPageStateChange as typeof cap.onPdfPageState) ?? null;
    return <div data-testid="pdf" />;
  },
}));
vi.mock("../PaperRender", async () => {
  const { useEffect } = await import("react");
  return {
    default: (props: {
      onReaderRefs?: (refs: { editor: null; scrollEl: HTMLElement | null }) => void;
    }) => {
      useEffect(() => {
        props.onReaderRefs?.({ editor: null, scrollEl: cap.readerScrollEl });
        // Mount-only lift, like the real PaperRender's ref report.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="reader" />;
    },
  };
});
vi.mock("../BibEditModal", () => ({ default: () => null }));

import RightDetail from "../RightDetail";

const handle = {} as FileSystemDirectoryHandle;

const bib: BibEntry = {
  key: "genette1997",
  type: "book",
  fields: { author: "Gérard Genette", title: "Paratexts", year: "1997" },
  raw: "@book{genette1997}",
};

const pdfEntry: CatalogEntry = {
  citekey: "genette1997",
  title: "Paratexts",
  addedAt: "",
  updatedAt: "",
  pdf: { present: true, format: "pdf" }, // → opens in PDF mode
  indexed: { state: "indexed" },
  bib: { state: "unverified" },
} as CatalogEntry;

const docxEntry: CatalogEntry = {
  ...pdfEntry,
  pdf: { present: false }, // → Text branch (no PDF on disk)
} as CatalogEntry;

const DRAG: LayoutGestureInfo = { kind: "pane", id: "gutter-under-test", axis: "x" };

// Controllable ResizeObserver — the textPodRect effect's RO is the only one
// live in these renders (usePgmarkPages gets a null editor and bails).
let roCallbacks: ResizeObserverCallback[] = [];

beforeEach(() => {
  memStore.clear();
  __resetViewSessionForTests();
  cap.headerProps.length = 0;
  cap.onPdfPageState = null;
  cap.readerScrollEl = null;
  roCallbacks = [];
  // Sync RAF so the effect's poll/measure/park-settle paths land inside act().
  vi.stubGlobal("requestAnimationFrame", ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", (() => {}) as typeof cancelAnimationFrame);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: ResizeObserverCallback) {
        roCallbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver,
  );
});

afterEach(() => {
  cleanup();
  __resetLayoutGestureBusForTest();
  vi.unstubAllGlobals();
});

const lastHeader = () => cap.headerProps[cap.headerProps.length - 1];

describe("RightDetail pane-drag parks (per-frame feedback stashed for the gesture)", () => {
  it("pdf page-state arriving mid-drag parks (latest wins) and applies once on the end edge", () => {
    act(() => {
      render(
        <RightDetail handle={handle} entry={pdfEntry} bib={bib} scope="" panel="right" />,
      );
    });
    expect(cap.onPdfPageState).toBeTruthy();
    // Not ready yet: the synthesized picker is empty.
    expect((lastHeader().pgmarkPages as PgmarkPages).pages).toHaveLength(0);

    const navigate = vi.fn();
    const send = (state: PdfPageState) =>
      cap.onPdfPageState!(state, navigate);

    // Idle: passthrough, synchronously.
    act(() => send({ pagesCount: 5, currentPage: 2 }));
    expect((lastHeader().pgmarkPages as PgmarkPages).pages).toHaveLength(5);
    expect((lastHeader().pgmarkPages as PgmarkPages).currentLabel).toBe("2");

    // Mid-drag: a storm of viewer events parks — the header must not see any
    // of them ride a pointer frame.
    act(() => {
      beginLayoutGesture(DRAG);
      send({ pagesCount: 5, currentPage: 3 });
      send({ pagesCount: 5, currentPage: 4 });
    });
    expect((lastHeader().pgmarkPages as PgmarkPages).currentLabel).toBe("2");

    // End edge: exactly one settle, latest args winning.
    act(() => endLayoutGesture(DRAG));
    expect((lastHeader().pgmarkPages as PgmarkPages).currentLabel).toBe("4");
  });

  it("a text-mode pod ResizeObserver fire mid-drag parks; the end edge reconciles textPodRect once", () => {
    // Real-ish reader geometry: a scroll container holding the [data-pod-frame]
    // the effect measures.
    const scrollEl = document.createElement("div");
    const frame = document.createElement("div");
    frame.setAttribute("data-pod-frame", "");
    let frameRect = { left: 40, width: 600 };
    frame.getBoundingClientRect = () =>
      ({
        left: frameRect.left,
        width: frameRect.width,
        top: 0,
        right: 0,
        bottom: 0,
        height: 0,
      }) as DOMRect;
    scrollEl.appendChild(frame);
    cap.readerScrollEl = scrollEl;

    act(() => {
      render(
        <RightDetail handle={handle} entry={docxEntry} bib={bib} scope="" panel="right" />,
      );
    });
    // Mount poll found the frame and measured it.
    expect(lastHeader().textPodRect).toEqual({ left: 40, width: 600 });
    expect(roCallbacks.length).toBeGreaterThan(0);

    const fireRO = () =>
      roCallbacks.forEach((cb) => cb([], undefined as unknown as ResizeObserver));

    // Mid-drag the pod geometry changes and the RO fires — parked, so the
    // header keeps the pre-drag rect (no setTextPodRect → podAlign cascade
    // riding pointer frames).
    act(() => {
      beginLayoutGesture(DRAG);
    });
    frameRect = { left: 40, width: 480 };
    act(() => {
      fireRO();
      fireRO();
    });
    expect(lastHeader().textPodRect).toEqual({ left: 40, width: 600 });

    // End edge: one settle re-measure picks up the final geometry.
    act(() => endLayoutGesture(DRAG));
    expect(lastHeader().textPodRect).toEqual({ left: 40, width: 480 });
  });

  it("the WINDOW resize path parks too — the second trigger is the one that gets forgotten", () => {
    // This effect was task 317's own signature: the RO parked while the window
    // `resize` listener 38 lines below fed the SAME scheduler raw. PaneFreeze
    // does not (and cannot) freeze an OS window resize, so that raw path was
    // the live one for the entire gesture — a per-frame measure →
    // setTextPodRect → PaperHeader podAlign cascade. Both triggers park now.
    const scrollEl = document.createElement("div");
    const frame = document.createElement("div");
    frame.setAttribute("data-pod-frame", "");
    let frameRect = { left: 40, width: 600 };
    frame.getBoundingClientRect = () =>
      ({
        left: frameRect.left,
        width: frameRect.width,
        top: 0,
        right: 0,
        bottom: 0,
        height: 0,
      }) as DOMRect;
    scrollEl.appendChild(frame);
    cap.readerScrollEl = scrollEl;

    act(() => {
      render(
        <RightDetail handle={handle} entry={docxEntry} bib={bib} scope="" panel="right" />,
      );
    });
    expect(lastHeader().textPodRect).toEqual({ left: 40, width: 600 });

    const fireWindowResize = () =>
      window.dispatchEvent(new Event("resize"));

    // A window gesture is live (published here directly — jsdom fires no real
    // OS resize burst, and the publisher's own detector is unit-tested).
    const WINDOW_GESTURE: LayoutGestureInfo = {
      kind: "window",
      id: "window",
      axis: "both",
    };
    act(() => beginLayoutGesture(WINDOW_GESTURE));
    frameRect = { left: 40, width: 420 };
    act(() => {
      fireWindowResize();
      fireWindowResize();
      fireWindowResize();
    });
    expect(lastHeader().textPodRect).toEqual({ left: 40, width: 600 });

    act(() => endLayoutGesture(WINDOW_GESTURE));
    expect(lastHeader().textPodRect).toEqual({ left: 40, width: 420 });
  });
});
