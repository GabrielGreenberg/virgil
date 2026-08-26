// @vitest-environment jsdom
//
// Task 490 — a retained measurement is invalidated by the EVENT that changes
// it, never by a proxy for the card's visibility.
//
// THE DEFECT (Gabriel, app 0.1.99, real paper): "archive cards are displacing
// to the same extent as they would be when open." `realHeightRef` retains the
// last REAL card height across the ±NEAR_ZONE_PX viewport gate (task 043), and
// the ONLY thing that refreshed it was the measure pass's own
// `getBoundingClientRect` — which runs only for a card whose ANCHOR is inside
// the band, on BOTH the position-band route (`deferredItems`) and the viewport
// -px route (`inViewport`). The original justification — "a card's rendered
// height is scroll-invariant" — is true of SCROLL and false of everything else:
// a card collapses, expands, swaps presence tier, or finishes laying out a late
// font / KaTeX span / image. So a card that SHRANK while its anchor was out of
// band kept its old, taller height and the cascade went on reserving it. The
// hole is symmetric: a card that GREW out of band keeps a too-SMALL height and
// the next card packs on top of it — the task-043 overlap this very cache
// exists to prevent, arriving from the other side.
//
// THE FIX: the per-card ResizeObserver is the height AUTHORITY. It already
// fires on every height change for every rendered card, wherever it sits, and
// its entry already carries the new size POST-layout — so recording it forces
// no layout and needs no gate. The pass's rect read stays as the SEED.
//
// WHY NO EXISTING SUITE COULD SEE THIS. `useInTextPositions-retained-height`
// is pure and pins only the SHRINK-PROTECTION direction ("never re-collapse to
// the 60px placeholder") — a card that got shorter out of band is
// unrepresentable there. And no suite in the repo ever DELIVERS a per-card
// ResizeObserver entry: `settle-convergence` installs a deliberate NO-OP stub,
// so the one trigger a collapse actually has was untested end to end. This
// file installs a DELIVERING observer and drives the real hook.
//
// Measured by neutering `noteObservedHeights` to a no-op: the two defect legs
// fail (the committed height stays at the expanded value); the in-band control
// passes either way and says so.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { Editor } from "@tiptap/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useInTextPositions,
  type PositionItem,
} from "@/hooks/useInTextPositions";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";

/* ── A DELIVERING ResizeObserver ──────────────────────────────────────────
 *  Records observers PER INSTANCE (the hook tears its observer down and
 *  re-creates it on every `measureVersion` bump, so a single shared "deliver"
 *  binding would be whichever instance was built last) and lets a test hand
 *  entries to whichever instance is observing a given element. */
interface FakeEntry {
  target: Element;
  contentRect: { height: number };
  borderBoxSize: ReadonlyArray<{ blockSize: number; inlineSize: number }>;
}
const observers = new Set<FakeRO>();
class FakeRO {
  private readonly targets = new Set<Element>();
  constructor(private readonly cb: (entries: FakeEntry[]) => void) {
    observers.add(this);
  }
  observe(el: Element): void {
    this.targets.add(el);
  }
  unobserve(el: Element): void {
    this.targets.delete(el);
  }
  disconnect(): void {
    this.targets.clear();
    observers.delete(this);
  }
  deliver(entries: FakeEntry[]): void {
    const mine = entries.filter((e) => this.targets.has(e.target));
    if (mine.length) this.cb(mine);
  }
}
function entryFor(el: Element, height: number): FakeEntry {
  return {
    target: el,
    contentRect: { height },
    borderBoxSize: [{ blockSize: height, inlineSize: 300 }],
  };
}
/** Deliver a resize to every live observer that is watching these elements. */
function deliverResize(entries: FakeEntry[]): void {
  for (const o of [...observers]) o.deliver(entries);
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
});
afterAll(() => {
  observers.clear();
  delete (globalThis as Record<string, unknown>).ResizeObserver;
});

/* ── Editor + geometry ────────────────────────────────────────────────── */

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

function mountDoc(paragraphs: number): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: Array.from({ length: paragraphs }, (_, i) => ({
        type: "paragraph",
        attrs: { uuid: `P${i}` },
        content: [{ type: "text", text: `Paragraph number ${i}.` }],
      })),
    },
  });
}

function makeRect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 800,
    width: 800,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** `top = pos * SCALE`. NEAR_ZONE_PX is 600, so an anchor sits inside the band
 *  only while the scroll container's rect brackets `pos * SCALE` (± 600). */
const SCALE = 3;
const BAND_H = 800;
const NEAR_CARD = { id: "near", pos: 40 };
const FAR_CARD = { id: "far", pos: 2000 };
const EXPANDED_H = 300;
const COLLAPSED_H = 68;

/** The scroll container's live rect. A test MOVES it to model scrolling: the
 *  hook only ever compares the band against `coordsAtPos`, so moving the band
 *  under fixed coordinates is arithmetically identical to moving the document
 *  under a fixed band — and it leaves the pod rect (hence every naturalTop)
 *  untouched, which is what keeps the tops comparable across phases. */
let bandTop = 0;

function mountRowScroll(): void {
  Object.defineProperty(window, "innerHeight", {
    value: BAND_H,
    configurable: true,
  });
  const el = document.createElement("div");
  el.setAttribute("data-virgil-row-scroll", "");
  el.getBoundingClientRect = () => makeRect(bandTop, bandTop + BAND_H);
  Object.defineProperty(el, "offsetParent", { value: document.body });
  document.body.appendChild(el);
}

type HookOut = ReturnType<typeof useInTextPositions>;

function Harness({
  editor,
  items,
  sinkRef,
  heights,
  elsRef,
}: {
  editor: Editor;
  items: PositionItem[];
  sinkRef: { current: HookOut | null };
  heights: Map<string, number>;
  elsRef: { current: Map<string, HTMLElement> };
}) {
  const out = useInTextPositions(editor, items, true, "data-omni-entry-wrapper");
  React.useLayoutEffect(() => {
    sinkRef.current = out;
  });
  return React.createElement(
    "div",
    { ref: out.panelScrollRef },
    React.createElement("span", {
      key: "__pod-geometry__",
      ref: (el: HTMLSpanElement | null) => {
        if (el?.parentElement) {
          (el.parentElement as HTMLElement).getBoundingClientRect = () =>
            makeRect(0, 20000);
        }
      },
    }),
    items.map((it) =>
      React.createElement(
        "div",
        {
          key: it.id,
          "data-omni-entry-wrapper": it.id,
          ref: (el: HTMLElement | null) => {
            if (!el) return;
            elsRef.current.set(it.id, el);
            // Reads the LIVE map, so flipping a height in the map is enough —
            // no re-render needed, exactly like a real collapse whose DOM the
            // observer reports before React has any reason to re-run this hook.
            el.getBoundingClientRect = () =>
              makeRect(0, heights.get(it.id) ?? 60);
          },
        },
        `card ${it.id}`,
      ),
    ),
  );
}

function setup(items: PositionItem[]) {
  vi.useFakeTimers();
  bandTop = 0;
  mountRowScroll();
  const editor = mountDoc(160);
  const docSize = editor.state.doc.content.size;
  const CONTENT_H = docSize * SCALE;
  const editorDom = editor.view.dom as HTMLElement;
  editorDom.getBoundingClientRect = () => makeRect(0, CONTENT_H);
  Object.defineProperty(editorDom, "scrollHeight", {
    get: () => CONTENT_H,
    configurable: true,
  });
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => ({
    top: pos * SCALE,
    bottom: pos * SCALE + 20,
    left: 0,
    right: 0,
  }));
  vi.spyOn(editor.view, "posAtCoords").mockImplementation(
    ({ top }: { left: number; top: number }) => ({
      pos: Math.round(Math.max(0, Math.min(docSize, top / SCALE))),
      inside: -1,
    }),
  );

  const heights = new Map<string, number>(
    items.map((it) => [it.id, EXPANDED_H]),
  );
  const elsRef = { current: new Map<string, HTMLElement>() };
  const sinkRef: { current: HookOut | null } = { current: null };
  const view = render(
    <KeepAliveVisibilityProvider isVisible={true}>
      <Harness
        editor={editor}
        items={items}
        sinkRef={sinkRef}
        heights={heights}
        elsRef={elsRef}
      />
    </KeepAliveVisibilityProvider>,
  );

  return {
    editor,
    heights,
    elsRef,
    committedHeight: (id: string) => sinkRef.current?.naturals.get(id)?.height,
    committedTop: (id: string) => sinkRef.current?.positions.get(id),
    async idle(ms = 2000) {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
    },
    /** Put the band over `pos * SCALE` (or far away) and let the deck settle.
     *  Dispatches a scroll so the hook's own scroll-idle refinement re-measures,
     *  which is exactly how a real scroll re-classifies an item. */
    async scrollBandTo(top: number) {
      bandTop = top;
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        vi.advanceTimersByTime(4000);
      });
    },
    /** Change a card's rendered height and let the observer report it — the
     *  ONLY trigger a real collapse/expand has for an out-of-band card. */
    async resizeCard(id: string, height: number) {
      heights.set(id, height);
      const el = elsRef.current.get(id)!;
      await act(async () => {
        deliverResize([entryFor(el, height)]);
        vi.advanceTimersByTime(2000);
      });
    },
    unmount() {
      view.unmount();
      editor.destroy();
    },
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  observers.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("task 490 — the ResizeObserver is the card-height authority", () => {
  it("a card that COLLAPSES while its anchor is out of band re-commits its height (defect leg)", async () => {
    const s = setup([NEAR_CARD, FAR_CARD]);
    // Seed the cache the only way the pre-490 code could: scroll the anchor
    // INTO the near zone so the measure pass takes its rect. This is the state
    // the defect preserves forever.
    await s.scrollBandTo(FAR_CARD.pos * SCALE - BAND_H / 2);
    expect(s.committedHeight(FAR_CARD.id)).toBe(EXPANDED_H);

    // …and scroll away again. From here the pass never re-reads this card's
    // rect: both the pos-band route and the inViewport gate ask about the
    // ANCHOR, and the anchor is thousands of px off screen.
    await s.scrollBandTo(0);
    expect(s.committedHeight(FAR_CARD.id)).toBe(EXPANDED_H);

    // The collapse. Its ONLY trigger is the per-card observer.
    await s.resizeCard(FAR_CARD.id, COLLAPSED_H);
    expect(s.committedHeight(FAR_CARD.id)).toBe(COLLAPSED_H);
    s.unmount();
  });

  it("…and the deck packs behind it accordingly — the symmetric GROW case too", async () => {
    // Two cards whose anchors are close enough together that the CROWD, not the
    // anchor, decides the second card's top. The first card's height is
    // therefore exactly the second card's displacement.
    const A = { id: "a", pos: 2000 };
    const B = { id: "b", pos: 2010 };
    const s = setup([A, B]);
    await s.scrollBandTo(A.pos * SCALE - BAND_H / 2);
    const packedWhileExpanded = s.committedTop(B.id)!;
    expect(s.committedHeight(A.id)).toBe(EXPANDED_H);
    await s.scrollBandTo(0);

    await s.resizeCard(A.id, COLLAPSED_H);
    const packedAfterCollapse = s.committedTop(B.id)!;
    expect(packedAfterCollapse).toBeLessThan(packedWhileExpanded);
    expect(packedWhileExpanded - packedAfterCollapse).toBe(
      EXPANDED_H - COLLAPSED_H,
    );

    // The hole is symmetric: growing back out of band must be seen too, or the
    // next card packs INSIDE this one (the task-043 overlap this cache exists
    // to prevent, arriving from the other side).
    await s.resizeCard(A.id, EXPANDED_H);
    expect(s.committedTop(B.id)).toBe(packedWhileExpanded);
    s.unmount();
  });

  it("a card whose anchor is IN band re-commits too — the control (passes either way)", async () => {
    // Non-regression pin, and it says so: the in-band route was never broken —
    // the pass's own rect read refreshes it. A leg that only drove this shape
    // is exactly why the defect shipped.
    const s = setup([NEAR_CARD]);
    await s.idle();
    expect(s.committedHeight(NEAR_CARD.id)).toBe(EXPANDED_H);
    await s.resizeCard(NEAR_CARD.id, COLLAPSED_H);
    expect(s.committedHeight(NEAR_CARD.id)).toBe(COLLAPSED_H);
    s.unmount();
  });

  it("a ZERO-height report is not a measurement — a hidden pane cannot corrupt the cache", async () => {
    // A `display:none` keep-alive pane reports 0x0 for every element, and an
    // unpainted wrapper reports 0. Writing either would pack the whole deck
    // contiguously from the top — the shape `measure()`'s own hidden bail
    // exists to prevent. Skipping keeps the last good value, which IS the
    // retain-across-a-hide contract.
    const s = setup([NEAR_CARD, FAR_CARD]);
    await s.scrollBandTo(FAR_CARD.pos * SCALE - BAND_H / 2);
    expect(s.committedHeight(FAR_CARD.id)).toBe(EXPANDED_H);
    await s.scrollBandTo(0);

    const el = s.elsRef.current.get(FAR_CARD.id)!;
    await act(async () => {
      deliverResize([entryFor(el, 0)]);
      vi.advanceTimersByTime(2000);
    });
    expect(s.committedHeight(FAR_CARD.id)).toBe(EXPANDED_H);
    s.unmount();
  });
});
