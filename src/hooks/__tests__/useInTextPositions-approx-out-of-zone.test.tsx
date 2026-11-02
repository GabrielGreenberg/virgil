// @vitest-environment jsdom
//
// Wave-2b C5 — out-of-zone anchors are not READ every pass.
//
// Pre-C5, `measure()` ran `coordsAtPos` (a forced-layout read) for EVERY item
// on every pass — only the card-rect read was near-zone-culled. The contract
// now: an already-measured item whose anchor is outside the scroll band is
// HELD, and carried by the shift measured at its neighbouring exact reads
// (`resolveHeldTops`, task 1425). Zero reads where the document moved rigidly;
// a bisected exact read where it did not. Nothing is interpolated, so a scroll
// triggers no pass and moves no card (task 1425 retired C5's scroll-idle
// refinement, whose re-interpolation lumped the deck).
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
  resolveHeldTops,
  type PositionItem,
  type HeldItem,
  type ShiftAnchor,
} from "@/hooks/useInTextPositions";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";

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

describe("resolveHeldTops — the scroll-invariant carry (task 1425)", () => {
  const edges = (top: number, bottom: number): ShiftAnchor[] => [
    { pos: -Infinity, delta: top },
    { pos: Infinity, delta: bottom },
  ];
  const held: HeldItem[] = [
    { id: "a", pos: 10, prevTop: 100 },
    { id: "b", pos: 20, prevTop: 200 },
    { id: "c", pos: 30, prevTop: 300 },
    { id: "d", pos: 40, prevTop: 400 },
  ];

  it("no geometry change ⇒ every top unchanged, ZERO reads", () => {
    const read = vi.fn(() => 0);
    const out = resolveHeldTops(held, edges(0, 0), read);
    expect(read).not.toHaveBeenCalled();
    for (const h of held) expect(out.get(h.id)).toBe(h.prevTop);
  });

  it("an edit ABOVE the held run shifts it rigidly when the doc end agrees — zero reads", () => {
    const read = vi.fn(() => 0);
    const anchors = [
      { pos: -Infinity, delta: 0 },
      { pos: 5, delta: 50 }, // an in-band exact read that moved by 50
      { pos: Infinity, delta: 50 },
    ];
    const out = resolveHeldTops(held, anchors, read);
    expect(read).not.toHaveBeenCalled();
    for (const h of held) expect(out.get(h.id)).toBe(h.prevTop + 50);
  });

  it("an unexplained change inside the run is BISECTED to exact reads, not estimated", () => {
    // Truth: everything at pos ≥ 30 moved by +80 (a fold below "b").
    const truth = (h: HeldItem) => h.prevTop + (h.pos >= 30 ? 80 : 0);
    const read = vi.fn(truth);
    const out = resolveHeldTops(held, edges(0, 80), read);
    for (const h of held) expect(out.get(h.id)).toBe(truth(h));
    expect(read.mock.calls.length).toBeLessThan(held.length);
  });

  it("a failed read rides its left neighbour rather than vanishing", () => {
    const out = resolveHeldTops(held, edges(0, 10), () => null);
    for (const h of held) expect(out.has(h.id)).toBe(true);
  });
});

describe("useInTextPositions — out-of-zone approximation (wave-2b C5)", () => {
  it("second pass reads coordsAtPos ONLY for in-band items; out-of-band are carried; a scroll runs no pass", async () => {
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
    // …but it still has a committed (carried) position.
    const farTop = sink.current!.positions.get("far");
    expect(farTop).toBeGreaterThan(10);
    expect(farTop).toBeLessThanOrEqual(6000);

    // …and it is EXACTLY where it was: nothing above or below it moved (the
    // mocked geometry is static), so the carry is rigid with delta 0 — no
    // interpolation toward the in-band knot (task 1425).
    expect(farTop).toBe(firstFar);

    // A scroll schedules NO pass (task 1425 retired the scroll-idle
    // refinement): no anchor is read and no card moves.
    coordsSpy.mockClear();
    const rowScroll = document.querySelector("[data-virgil-row-scroll]")!;
    act(() => {
      rowScroll.dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(coordsSpy).not.toHaveBeenCalled();
    expect(sink.current!.positions.get("far")).toBe(firstFar);

    r.unmount();
    editor.destroy();
    vi.useRealTimers();
  });
});
