// @vitest-environment jsdom
//
// Task 327 — the in-text card lane's measurement gate cannot be captured by
// its own output.
//
// THE DEFECT (wave-2b C5, shipped v0.1.87). Each pass classified an
// already-measured card by its RETAINED pod-relative top: outside the scroll
// band ⇒ deferred to `approxTopForPos` instead of an exact `coordsAtPos` +
// height read. That gate reads the value it exists to refine, so its error
// mode is ABSORBING — a card whose retained top is wrong by more than
// NEAR_ZONE_PX classifies out-of-band, re-approximates from the same knots,
// and classifies out again, forever. The exact read that would fix the
// retained top is exactly what the wrong retained top prevents.
//
// Reachable in production, not a curiosity: a cold prod open commits the
// first measure even when it raced layout (the degeneracy guard deliberately
// prefers a wrong deck to a blank column), and an FSA load restores a mid-doc
// scroll — so the viewport lands far from the well-seeded region, on a long
// paper whose px-per-pos density is uneven enough that endpoint interpolation
// misses by thousands of px. Gabriel's symptoms: the lane beside the text he
// was reading read EMPTY (cards displaced to wrong Ys), and cards that did
// appear came in OVERLAPPING at the 60px-placeholder + 4px-gap quantum
// (never-measured heights).
//
// The scenario below is that story as arithmetic: a compressed cold measure,
// then real geometry, then repeated measure passes. On the pre-fix
// classification the on-screen cluster is NEVER exact-read on any pass and
// packs at the 64px quantum; after the fix the first pass over real geometry
// reads it exactly and the cards spread by their real heights.

import { describe, it, expect, vi, afterEach } from "vitest";

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

/** The row scroll container: its rect is the VISIBLE band; the hook pads it by
 *  ±NEAR_ZONE_PX for the height gate and (in position space) for the pos band.
 *  The window is sized to match so the probes' viewport clamp is a no-op here
 *  and the arithmetic below stays readable. */
const VIEW_TOP = 0;
const VIEW_BOTTOM = 800;
function mountRowScroll(): HTMLElement {
  Object.defineProperty(window, "innerHeight", {
    value: VIEW_BOTTOM,
    configurable: true,
  });
  const el = document.createElement("div");
  el.setAttribute("data-virgil-row-scroll", "");
  el.getBoundingClientRect = () => makeRect(VIEW_TOP, VIEW_BOTTOM);
  Object.defineProperty(el, "offsetParent", { value: document.body });
  document.body.appendChild(el);
  return el;
}

/**
 * Synthetic long-paper geometry, POD-RELATIVE. Deliberately PIECEWISE: the
 * first half is 3px per pos, the second 1px per pos. Linear interpolation
 * between the two exact endpoint knots therefore misses mid-doc by ~0.5·D px
 * — which is what makes the approximation error exceed NEAR_ZONE_PX and the
 * fixed point reachable. A uniform document would heal itself by accident and
 * prove nothing.
 */
function trueTop(pos: number, docSize: number): number {
  const knee = docSize / 2;
  return pos <= knee ? pos * 3 : knee * 3 + (pos - knee);
}
function trueTopInverse(top: number, docSize: number): number {
  const knee = docSize / 2;
  return top <= knee * 3 ? top / 3 : knee + (top - knee * 3);
}

/** The cold, un-laid-out measure: everything crammed near the top. */
const COLD_SCALE = 0.1;

type HookOut = ReturnType<typeof useInTextPositions>;

const REAL_HEIGHTS: Record<string, number> = {
  onA: 81,
  onB: 95,
  onC: 127,
};
const MIN_GAP = 4; // mirrors the module constant

function Harness({
  editor,
  items,
  sinkRef,
  installPod,
}: {
  editor: Editor;
  items: PositionItem[];
  sinkRef: { current: HookOut | null };
  installPod: (el: HTMLDivElement) => void;
}) {
  const out = useInTextPositions(editor, items, true, "data-omni-entry-wrapper");
  // Published from an effect, not during render: the hook's own layout effects
  // are declared inside it and therefore run first, and every assertion reads
  // this after `render`/`act` has flushed.
  React.useLayoutEffect(() => {
    sinkRef.current = out;
  });
  return React.createElement(
    "div",
    { ref: out.panelScrollRef },
    // The pod's geometry must be installed BEFORE the hook's layout effect
    // runs its first measure. React attaches CHILD refs during the same commit
    // and ahead of every layout effect, so a marker child reaching up to its
    // parent gets there in time — and, unlike writing `panelScrollRef.current`
    // by hand, does not modify a value returned from a hook.
    React.createElement("span", {
      key: "__pod-geometry__",
      ref: (el: HTMLSpanElement | null) => {
        if (el?.parentElement) installPod(el.parentElement as HTMLDivElement);
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
            const h = REAL_HEIGHTS[it.id] ?? 60;
            el.getBoundingClientRect = () => makeRect(0, h);
          },
        },
        `card ${it.id}`,
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/**
 * Builds the whole scenario and returns handles. `settle()` flips the mocked
 * geometry from the compressed cold read to the real one (the FOUT / NodeView
 * settle that happens after first paint).
 */
function setupScenario() {
  vi.useFakeTimers();
  mountRowScroll();
  const editor = mountDoc(400);
  const docSize = editor.state.doc.content.size;
  const knee = docSize / 2;

  // COLD: the document is compressed (fonts not swapped, NodeViews unmounted)
  // and short enough that the restored scroll clamps to the top, so the pod
  // sits at the viewport origin.
  // SETTLED: real geometry, and the restored mid-doc scroll position puts the
  // doc's KNEE at viewport y = 400 — the passage the user is actually reading.
  let settled = false;
  const contentHeight = () =>
    settled ? trueTop(docSize, docSize) : docSize * COLD_SCALE;
  const podTop = () => (settled ? 400 - trueTop(knee, docSize) : 0);

  const editorDom = editor.view.dom as HTMLElement;
  editorDom.getBoundingClientRect = () =>
    makeRect(podTop(), podTop() + contentHeight());
  Object.defineProperty(editorDom, "scrollHeight", {
    get: contentHeight,
    configurable: true,
  });

  const coordsSpy = vi
    .spyOn(editor.view, "coordsAtPos")
    .mockImplementation((pos: number) => {
      const top =
        podTop() + (settled ? trueTop(pos, docSize) : pos * COLD_SCALE);
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
  const posAtCoordsSpy = vi
    .spyOn(editor.view, "posAtCoords")
    .mockImplementation(({ top }: { left: number; top: number }) => {
      const rel = top - podTop();
      const pos = settled ? trueTopInverse(rel, docSize) : rel / COLD_SCALE;
      return { pos: Math.round(Math.max(0, Math.min(docSize, pos))), inside: -1 };
    });

  const items: PositionItem[] = [
    { id: "top", pos: 8 },
    { id: "onA", pos: Math.round(knee) - 20 },
    { id: "onB", pos: Math.round(knee) },
    { id: "onC", pos: Math.round(knee) + 20 },
    { id: "bottom", pos: docSize - 8 },
  ];

  const sinkRef: { current: HookOut | null } = { current: null };
  const installPod = (el: HTMLDivElement) => {
    el.getBoundingClientRect = () => makeRect(podTop(), podTop() + 200);
    // The lane's cards have not mounted by the time the FIRST measure runs —
    // it races them exactly as it races layout. This is what leaves the deck
    // on `DEFAULT_ENTRY_HEIGHT`, and why a permanently-deferred card stays
    // there: the card-rect read lives inside the exact-read branch, so a card
    // the gate never re-admits is a card whose height is never learned.
    const realQuery = el.querySelector.bind(el);
    el.querySelector = ((sel: string) =>
      settled ? realQuery(sel) : null) as typeof el.querySelector;
  };
  const view = render(
    <KeepAliveVisibilityProvider isVisible={true}>
      <Harness
        editor={editor}
        items={items}
        sinkRef={sinkRef}
        installPod={installPod}
      />
    </KeepAliveVisibilityProvider>,
  );

  return {
    editor,
    items,
    sinkRef,
    docSize,
    knee,
    podTop,
    coordsSpy,
    posAtCoordsSpy,
    settle: () => {
      settled = true;
    },
    /**
     * One measure trigger: window resize → the layout-gesture park → schedule
     * → RAF → measure. Passes are spaced beyond the window publisher's 100ms
     * burst window on purpose — two resizes inside it are a WINDOW DRAG, and
     * the park would (correctly) swallow the second into a single end-edge
     * settle instead of running it.
     */
    async pass() {
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        vi.advanceTimersByTime(250);
      });
    },
    unmount: () => {
      view.unmount();
      editor.destroy();
    },
  };
}

describe("useInTextPositions — band membership is decided by POS (task 327)", () => {
  it("probes the band ON SCREEN, never at the off-viewport padded edges", async () => {
    // The band's padded edges are scrollRect.top-600 and scrollRect.bottom+600
    // — off-screen by construction on a mid-doc scroll. Probing there defeats
    // the browser's hit-test and drops ProseMirror into a wrap-around
    // getClientRects() scan of every top-level block, which would reinstate
    // the O(blocks) forced-layout cost C5 exists to remove. This task's first
    // cut did exactly that; the padding now lives in position space.
    const s = setupScenario();
    s.settle();
    await s.pass();

    const probedYs = s.posAtCoordsSpy.mock.calls.map(
      (c) => (c[0] as { top: number }).top,
    );
    expect(probedYs.length).toBeGreaterThan(0);
    for (const y of probedYs) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(window.innerHeight);
    }
    // …and it is a fixed handful per pass, not one per item.
    expect(probedYs.length).toBeLessThanOrEqual(2 * 4);

    s.unmount();
  });

  it("an on-screen card whose retained top is badly wrong is still exact-read", async () => {
    const s = setupScenario();
    // Cold pass has run on mount: every item was exact-read (none had a prior
    // entry) against the COMPRESSED geometry, so each retained top is off by
    // thousands of px. This is the seed.
    // ~450px down a 909px-tall compressed document (plus whatever the cascade
    // pushed it), where the settled truth for the same anchor is ~13,600px.
    const coldTop = s.sinkRef.current!.positions.get("onB")!;
    expect(coldTop).toBeLessThan(1000);
    expect(trueTop(s.items[2].pos, s.docSize)).toBeGreaterThan(13_000);

    // Layout settles: real geometry, real content height.
    s.settle();
    s.coordsSpy.mockClear();
    await s.pass();

    // The on-screen cluster is inside the band BY POSITION, so it gets exact
    // reads — even though its retained tops say it is ~9000px above the
    // viewport. PRE-FIX: zero of these are read, on this pass or any later one.
    const readPositions = s.coordsSpy.mock.calls.map((c) => c[0] as number);
    for (const id of ["onA", "onB", "onC"] as const) {
      const item = s.items.find((i) => i.id === id)!;
      expect(readPositions).toContain(item.pos);
    }
    // …and they land at their TRUE tops, not an interpolation.
    expect(s.sinkRef.current!.positions.get("onA")).toBeCloseTo(
      trueTop(s.items[1].pos, s.docSize),
      0,
    );

    s.unmount();
  });

  it("the C5 perf contract survives: far-off-screen anchors are still never read", async () => {
    const s = setupScenario();
    s.settle();
    await s.pass();
    s.coordsSpy.mockClear();
    await s.pass();

    const readPositions = s.coordsSpy.mock.calls.map((c) => c[0] as number);
    expect(readPositions.length).toBeGreaterThan(0); // the band WAS measured
    const farTop = s.items.find((i) => i.id === "top")!.pos;
    const farBottom = s.items.find((i) => i.id === "bottom")!.pos;
    expect(readPositions).not.toContain(farTop);
    expect(readPositions).not.toContain(farBottom);
    // They still have committed (interpolated) positions.
    expect(s.sinkRef.current!.positions.get("top")).toBeGreaterThanOrEqual(0);
    expect(s.sinkRef.current!.positions.get("bottom")).toBeGreaterThan(0);

    s.unmount();
  });

  it("does not re-enter the wrong-geometry fixed point over repeated passes", async () => {
    const s = setupScenario();
    s.settle();
    // Several passes: the classification must not drift back out of band once
    // the tops are correct (which is what a px gate fed by its own output did
    // in the opposite direction).
    for (let i = 0; i < 4; i++) await s.pass();

    for (const id of ["onA", "onB", "onC"] as const) {
      const item = s.items.find((i) => i.id === id)!;
      // Positions are cascade-resolved, so assert the deck is anchored where
      // the real geometry says, within the cascade's push-down slack.
      const got = s.sinkRef.current!.positions.get(id)!;
      const truth = trueTop(item.pos, s.docSize);
      expect(Math.abs(got - truth)).toBeLessThan(300);
    }

    s.unmount();
  });

  it("on-screen cards spread by their REAL heights — no placeholder-quantum overlap", async () => {
    const s = setupScenario();
    s.settle();
    await s.pass();
    // One more pass so the height read taken this pass is reflected in the
    // committed cascade (the card rect is read in the same pass it is used).
    await s.pass();

    const p = s.sinkRef.current!.positions;
    const order = ["onA", "onB", "onC"] as const;
    for (let i = 1; i < order.length; i++) {
      const prevId = order[i - 1];
      const gap = p.get(order[i])! - p.get(prevId)!;
      // The defect renders these at DEFAULT_ENTRY_HEIGHT (60) + MIN_GAP = 64
      // apart while the cards are 81/95/127 tall — the exact quantum Gabriel
      // screenshotted.
      expect(gap).toBeGreaterThanOrEqual(REAL_HEIGHTS[prevId] + MIN_GAP);
    }

    s.unmount();
  });
});
