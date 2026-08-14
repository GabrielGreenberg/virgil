// @vitest-environment jsdom
//
// Wave-2b C5 — out-of-zone anchors are APPROXIMATED, not measured.
//
// Pre-C5, `measure()` ran `coordsAtPos` (a forced-layout read) for EVERY item
// on every pass — only the card-rect read was near-zone-culled. The contract
// now: items whose retained pod-relative top puts them outside the scroll
// band are interpolated over the pass's exact knots (`approxTopForPos`, pure
// arithmetic), and the scroll-idle refinement re-runs the pass — exact-reading
// what has scrolled into the band — only while approximated items exist.
//
// Also pins the pure interpolation: exact endpoints, clamping, monotone
// ordering (a cascade fed inverted tops would z-fight the deck).
//
// Task 327: band membership is now decided on the item's document POSITION
// against the band's pos range, so the harness must mock `posAtCoords` as the
// INVERSE of its `coordsAtPos` map. Feeding one and not the other leaves the
// band probe unanswerable, and `resolveVisiblePosBand` deliberately fails OPEN
// (everything exact) — correct, but it would make this suite's culling legs
// vacuous. The behavioural contract below is unchanged.

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
  approxTopForPos,
  type PositionItem,
  type TopKnot,
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
        content: [{ type: "text", text: `Paragraph ${i}.` }],
      })),
    },
  });
}

type HookOut = ReturnType<typeof useInTextPositions>;

function Harness({
  editor,
  items,
  sink,
}: {
  editor: Editor;
  items: PositionItem[];
  sink: { current: HookOut | null };
}) {
  const out = useInTextPositions(editor, items, true, "data-omni-entry-wrapper");
  sink.current = out;
  return React.createElement(
    "div",
    { ref: out.panelScrollRef },
    items.map((it) =>
      React.createElement(
        "div",
        { key: it.id, "data-omni-entry-wrapper": it.id },
        `card ${it.id}`,
      ),
    ),
  );
}

/** A row-scroll container whose rect defines the band [top, bottom]. */
function mountRowScroll(top: number, bottom: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-virgil-row-scroll", "");
  el.getBoundingClientRect = () =>
    ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(el, "offsetParent", { value: document.body });
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("approxTopForPos", () => {
  const knots: TopKnot[] = [
    { pos: 0, top: 0 },
    { pos: 100, top: 1000 },
    { pos: 200, top: 1500 },
  ];
  it("interpolates linearly between surrounding knots", () => {
    expect(approxTopForPos(50, knots)).toBe(500);
    expect(approxTopForPos(150, knots)).toBe(1250);
  });
  it("clamps outside the knot range and hits knots exactly", () => {
    expect(approxTopForPos(-5, knots)).toBe(0);
    expect(approxTopForPos(300, knots)).toBe(1500);
    expect(approxTopForPos(100, knots)).toBe(1000);
  });
  it("is monotone in pos over monotone knots", () => {
    let prev = -Infinity;
    for (let p = 0; p <= 200; p += 7) {
      const t = approxTopForPos(p, knots);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
  it("degenerates safely on empty/single knots", () => {
    expect(approxTopForPos(10, [])).toBe(0);
    expect(approxTopForPos(10, [{ pos: 5, top: 42 }])).toBe(42);
  });
});

describe("useInTextPositions — out-of-zone approximation (wave-2b C5)", () => {
  it("second pass reads coordsAtPos ONLY for in-band items; out-of-band get interpolated tops; scroll-idle refines", async () => {
    vi.useFakeTimers();
    // Band [0, 100] + NEAR_ZONE 600 → viewport gate admits tops in [-600, 700].
    mountRowScroll(0, 100);
    const editor = mountDoc(3);
    const items: PositionItem[] = [
      { id: "near", pos: 1 },
      { id: "far", pos: editor.state.doc.content.size - 2 },
    ];
    // First pass: everything unmeasured → both read exact. "near" lands
    // in-band (top 10), "far" far below the band (top 5000).
    const coordsSpy = vi
      .spyOn(editor.view, "coordsAtPos")
      .mockImplementation((pos: number) => ({
        top: pos < 10 ? 10 : 5000,
        bottom: pos < 10 ? 22 : 5012,
        left: 0,
        right: 0,
      }));
    // The inverse of that map: y below 2500 is the "near" region, above it the
    // tail. The band probe at viewBottom (700) therefore lands at pos 5, so the
    // band is [0, 5] — "near" (pos 1) inside, "far" (pos ≈ docSize) outside.
    vi.spyOn(editor.view, "posAtCoords").mockImplementation(
      ({ top }: { left: number; top: number }) => ({
        pos: top < 2500 ? 5 : editor.state.doc.content.size - 2,
        inside: -1,
      }),
    );
    const editorDom = editor.view.dom as HTMLElement;
    Object.defineProperty(editorDom, "scrollHeight", {
      value: 6000,
      configurable: true,
    });
    editorDom.getBoundingClientRect = () =>
      ({ top: 0, bottom: 6000, left: 0, right: 700, width: 700, height: 6000, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    const sink: { current: HookOut | null } = { current: null };
    const r = render(
      <KeepAliveVisibilityProvider isVisible={true}>
        <Harness editor={editor} items={items} sink={sink} />
      </KeepAliveVisibilityProvider>,
    );
    // Cold pass measured both exactly.
    expect(coordsSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const firstFar = sink.current!.positions.get("far");
    expect(firstFar).toBe(5000);

    // Drain the settle loop (RAF is unshimmed under fake timers in jsdom —
    // the loop stops on stable scrollHeight; flush any queued frames).
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // Second pass (structural trigger): "far" now has a retained top well
    // outside the band → classified out → NO coordsAtPos for it.
    coordsSpy.mockClear();
    act(() => {
      editor
        .chain()
        .insertContentAt(0, {
          type: "paragraph",
          attrs: { uuid: "PN" },
          content: [{ type: "text", text: "New first paragraph." }],
        })
        .run();
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    const readPositions = coordsSpy.mock.calls.map((c) => c[0] as number);
    expect(readPositions.length).toBeGreaterThan(0); // in-band item re-read
    // The far item's pos (near doc end) was never exact-read this pass.
    for (const p of readPositions) expect(p).toBeLessThan(10);
    // …but it still has a committed (interpolated) position, between the
    // in-band knot and the doc-end endpoint.
    const farTop = sink.current!.positions.get("far");
    expect(farTop).toBeGreaterThan(10);
    expect(farTop).toBeLessThanOrEqual(6000);

    // Scroll-idle refinement: with approximated items present, a scroll on
    // the row container schedules ONE full pass at idle (which re-classifies
    // per the CURRENT band; here the far item is still out, so it stays
    // approximated — the contract is that the pass RAN).
    coordsSpy.mockClear();
    const rowScroll = document.querySelector("[data-virgil-row-scroll]")!;
    act(() => {
      rowScroll.dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      vi.advanceTimersByTime(200); // debounce (150ms) + RAF
    });
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0);

    r.unmount();
    editor.destroy();
    vi.useRealTimers();
  });
});
