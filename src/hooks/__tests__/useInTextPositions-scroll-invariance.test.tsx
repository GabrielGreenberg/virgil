// @vitest-environment jsdom
//
// Task 1425 — "when I scroll down … the cards habitually lump up together,
// losing their anchor points, then when I scroll back up they all have to jump
// back." A card's committed top must be a function of DOCUMENT GEOMETRY ONLY.
//
// The defect: every already-measured card whose anchor left the scroll band was
// re-INTERPOLATED each pass between the band's last exact read and the
// document's end, on the assumption that height ∝ position. Focus view's hidden
// tail and folded sections are `display:none` — lots of position, zero height —
// so the estimates collapsed toward the last exact read and the cascade packed
// them into one column; the scroll-idle refinement re-ran the pass on every
// scroll pause, so the lump formed as a passage left the viewport and undid
// itself as it came back.
//
// Contract pinned here: (1) with no geometry change, moving the band past
// exact cards and running passes changes NO committed top, with a hidden tail
// and with a folded section; (2) a height change ABOVE off-band cards (in the
// band) still moves them, by exactly the change; (3) a change OFF-band, between
// held cards, is found and read exactly — never estimated.

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

const VIEW_BOTTOM = 800;
const PX_PER_POS = 3;

type HookOut = ReturnType<typeof useInTextPositions>;

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
  React.useLayoutEffect(() => {
    sinkRef.current = out;
  });
  return React.createElement(
    "div",
    { ref: out.panelScrollRef },
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
            if (el) el.getBoundingClientRect = () => makeRect(0, 40);
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
 * A document whose pod-relative geometry is `geom(pos)`, mutable by the test.
 * `hidden` is a pos range rendered `display:none` (every anchor in it reads
 * the top of the range; it occupies zero height). `scrollY` moves the pod and
 * editor together under a fixed viewport — exactly what a real scroll does.
 */
function setup(opts: { hidden: [number, number] | null }) {
  vi.useFakeTimers();
  Object.defineProperty(window, "innerHeight", {
    value: VIEW_BOTTOM,
    configurable: true,
  });
  const row = document.createElement("div");
  row.setAttribute("data-virgil-row-scroll", "");
  row.getBoundingClientRect = () => makeRect(0, VIEW_BOTTOM);
  Object.defineProperty(row, "offsetParent", { value: document.body });
  document.body.appendChild(row);

  const editor = mountDoc(400);
  const docSize = editor.state.doc.content.size;
  const state = {
    scrollY: 0,
    hidden: opts.hidden,
    /** Extra height inserted at (and below) a pos — models an edit/unfold. */
    grow: null as { at: number; px: number } | null,
  };
  const geom = (pos: number): number => {
    const h = state.hidden;
    // Inside the hidden range every anchor reads the range's top; below it the
    // document resumes as if the range had zero height.
    let line = pos;
    if (h && pos >= h[0]) line = pos <= h[1] ? h[0] : h[0] + (pos - h[1]);
    let top = line * PX_PER_POS;
    if (state.grow && pos >= state.grow.at) top += state.grow.px;
    return top;
  };
  const inverse = (rel: number): number => {
    // Coarse inverse is enough for the band probes: scan.
    let best = 0;
    for (let p = 0; p <= docSize; p += 1) if (geom(p) <= rel) best = p;
    return best;
  };
  const podTop = () => -state.scrollY;

  const editorDom = editor.view.dom as HTMLElement;
  editorDom.getBoundingClientRect = () =>
    makeRect(podTop(), podTop() + geom(docSize) + 40);
  Object.defineProperty(editorDom, "scrollHeight", {
    get: () => geom(docSize) + 40,
    configurable: true,
  });
  Object.defineProperty(editorDom, "clientWidth", {
    get: () => 700,
    configurable: true,
  });
  const coordsSpy = vi
    .spyOn(editor.view, "coordsAtPos")
    .mockImplementation((pos: number) => {
      const top = podTop() + geom(pos);
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
  vi.spyOn(editor.view, "posAtCoords").mockImplementation(
    ({ top }: { left: number; top: number }) => ({
      pos: Math.max(0, Math.min(docSize, inverse(top - podTop()))),
      inside: -1,
    }),
  );

  // A note on every 40th pos through the first ~third of the doc: dense
  // enough that a compressed estimate would pack them at MIN_GAP.
  const items: PositionItem[] = [];
  for (let p = 20; p < docSize * 0.35; p += 40)
    items.push({ id: `n${p}`, pos: p });

  const sinkRef: { current: HookOut | null } = { current: null };
  const installPod = (el: HTMLDivElement) => {
    el.getBoundingClientRect = () => makeRect(podTop(), podTop() + 200);
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
    state,
    items,
    docSize,
    coordsSpy,
    naturals: () =>
      new Map(
        [...sinkRef.current!.naturals].map(([id, e]) => [id, e.naturalTop]),
      ),
    positions: () => new Map(sinkRef.current!.positions),
    /** One geometry trigger (window resize → park → settle). */
    async pass() {
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        vi.advanceTimersByTime(250);
      });
    },
    /** A real scroll: move the content and fire the scroll event. */
    async scrollTo(y: number) {
      state.scrollY = y;
      await act(async () => {
        row.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(250);
      });
    },
    unmount() {
      view.unmount();
      editor.destroy();
    },
  };
}

describe("task 1425 — committed tops are a function of document geometry only", () => {
  for (const [label, hiddenFrac] of [
    ["focus view: hidden TAIL", [0.4, 1]],
    ["a FOLDED section below the notes", [0.4, 0.7]],
  ] as const) {
    it(`${label} — scrolling the band past exact cards moves nothing`, async () => {
      const s = setup({ hidden: null });
      const hidden: [number, number] = [
        Math.round(s.docSize * hiddenFrac[0]),
        Math.round(s.docSize * hiddenFrac[1]) - 1,
      ];
      s.state.hidden = hidden;
      await s.pass(); // all cards measured exactly (cold pass + this one)
      const before = s.positions();
      const beforeNat = s.naturals();

      // Scroll down so the noted passage leaves the top of the viewport, run
      // passes (a card resize, a scroll pause — anything), scroll back.
      for (const y of [600, 1500, 3000, 1500, 0]) {
        await s.scrollTo(y);
        await s.pass();
        expect(s.naturals()).toEqual(beforeNat);
        expect(s.positions()).toEqual(before);
      }
      s.unmount();
    });
  }

  it("a scroll alone runs no measure pass", async () => {
    const s = setup({ hidden: null });
    await s.pass();
    s.coordsSpy.mockClear();
    await s.scrollTo(2000);
    expect(s.coordsSpy).not.toHaveBeenCalled();
    s.unmount();
  });

  it("a height change IN the band shifts off-band cards below it by exactly that much — without reading them", async () => {
    const s = setup({ hidden: null });
    await s.pass();
    const before = s.naturals();
    // Band at the top of the doc; grow a paragraph near the top.
    s.state.grow = { at: 30, px: 57 };
    s.coordsSpy.mockClear();
    await s.pass();
    const after = s.naturals();
    for (const it of s.items) {
      const expected = before.get(it.id)! + (it.pos >= 30 ? 57 : 0);
      expect(after.get(it.id)).toBeCloseTo(expected, 5);
    }
    // Far cards were carried, not read.
    const read = new Set(s.coordsSpy.mock.calls.map((c) => c[0] as number));
    const far = s.items.filter((it) => it.pos * PX_PER_POS > VIEW_BOTTOM + 1500);
    expect(far.length).toBeGreaterThan(3);
    expect(far.some((it) => !read.has(it.pos))).toBe(true);
    s.unmount();
  });

  it("a change OFF the band between held cards is found and read exactly — never estimated", async () => {
    const s = setup({ hidden: null });
    await s.pass();
    const before = s.naturals();
    const mid = s.items[Math.floor(s.items.length * 0.7)].pos - 5;
    expect(mid * PX_PER_POS).toBeGreaterThan(VIEW_BOTTOM + 1500); // off-band
    s.state.grow = { at: mid, px: 120 };
    await s.pass();
    const after = s.naturals();
    for (const it of s.items) {
      const expected = before.get(it.id)! + (it.pos >= mid ? 120 : 0);
      expect(after.get(it.id)).toBeCloseTo(expected, 5);
    }
    s.unmount();
  });

  // Task 1464 — the carry assumed no anchor changed ORDER while out of band.
  // The anchors here are the items' own pos (no `resolvePos`), so moving an
  // anchor is mutating `item.pos` — exactly what the live snapshot reports
  // after an Outline reorder or a sidecar re-target.
  it("two off-band sections SWAP places (total height unchanged) — every moved card lands at its new anchor's exact top", async () => {
    const s = setup({ hidden: null });
    await s.pass();
    const far = s.items.filter((it) => it.pos * PX_PER_POS > VIEW_BOTTOM + 2000);
    // Two equal-length runs of cards, far below the band.
    const A = far.slice(0, 4);
    const B = far.slice(8, 12);
    const offset = B[0].pos - A[0].pos;
    for (const it of A) it.pos += offset;
    for (const it of B) it.pos -= offset;
    await s.pass();
    const after = s.naturals();
    for (const it of [...A, ...B])
      expect(after.get(it.id)).toBeCloseTo(it.pos * PX_PER_POS, 5);
    s.unmount();
  });

  it("an off-band card RE-ANCHORED to a far off-band block lands at that block's exact top", async () => {
    const s = setup({ hidden: null });
    await s.pass();
    const far = s.items.filter((it) => it.pos * PX_PER_POS > VIEW_BOTTOM + 2000);
    // (i) across other cards; (ii) within its own gap, so ORDER is unchanged
    // and only the position check can see it.
    const across = far[1];
    across.pos = far[far.length - 2].pos + 7;
    const within = far[4];
    within.pos += 30;
    await s.pass();
    const after = s.naturals();
    expect(after.get(across.id)).toBeCloseTo(across.pos * PX_PER_POS, 5);
    expect(after.get(within.id)).toBeCloseTo(within.pos * PX_PER_POS, 5);
    s.unmount();
  });

  it("the order check costs no reads in the rigid case — an unchanged document carries every off-band card", async () => {
    const s = setup({ hidden: null });
    await s.pass();
    s.coordsSpy.mockClear();
    await s.pass();
    const read = new Set(s.coordsSpy.mock.calls.map((c) => c[0] as number));
    const far = s.items.filter((it) => it.pos * PX_PER_POS > VIEW_BOTTOM + 2000);
    expect(far.length).toBeGreaterThan(3);
    for (const it of far) expect(read.has(it.pos)).toBe(false);
    s.unmount();
  });
});
