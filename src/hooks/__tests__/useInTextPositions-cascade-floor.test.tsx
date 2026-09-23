// @vitest-environment jsdom
//
// Task 544 — the cascade FLOOR: the deck clears the sticky chrome that
// shares its column.
//
// THE DEFECT (Gabriel, app 0.1.103, real paper, screenshot): "many notes, high
// up in the document — when one note is opened, the top of the note gets
// stuck behind the unanchored, unplaced bars." The column's band frame is
// STICKY and floats over the scrolled cascade pod; since task 421 the omni
// bin stack lives in that frame (and a docked band always has). The cascade
// resolver placed the first card at its anchor's natural top — the top of the
// pod — where the frame paints OVER it. Same class as the marginalia lane's
// occupancy laws: two owners painting into one column with no cross-owner
// resolution.
//
// THE FIX: `useInTextPositions` takes a `CascadeFloor` source. Its `read`
// runs inside the measure pass (once per pass, beside the pod rect) and
// answers in pod coordinates AT SCROLL ZERO — so the value is scroll-invariant
// like every other number the cascade holds — and `resolveCascade` binds the
// forward pass to it. The source's element rides the pass's own per-card
// ResizeObserver, so a pill expanding or a band docking re-floors the deck
// through the one settle door.
//
// WHY NO EXISTING SUITE COULD SEE THIS. Every `useInTextPositions` suite
// mounts the pod alone: there is no sticky chrome in any of them, so "the
// first card is painted under the bins" is unrepresentable. And every omni
// suite MOCKS the hook, so the floor never reaches a resolver there.
//
// Legs (measured by neutering — dropping the floor from `resolveCascade`'s
// forward pass fails 1, 3, 5 and 7; dropping the observer wiring fails 5;
// reading `podRect.top` without the scroll correction fails 4):
//   1. pure resolver: the first card rests AT the floor, later cards pack
//      below it, a pin above the floor is clamped to it, floor 0 is the
//      pre-544 resolver byte for byte;
//   2. `readStickyOccupancyFloor`: scroll-invariant while stuck, 0 for an
//      empty frame, clamped for a frame that has not reached its pin;
//   3. REAL hook + REAL floor source over a fake frame: the first card
//      clears the bins by exactly the inter-card gap;
//   4. …and the value does not move when the document scrolls;
//   5. the bin stack GROWING (a pill expanded) re-floors the deck through
//      the observer, with no other trigger;
//   6. an observer fire that changes nothing commits nothing (the deck's
//      `positions` map keeps its identity);
//   7. a docked band above an EMPTY slot floors the deck under the band;
//   8. control: no floor source → the first card sits at its natural top.

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
  resolveCascade,
  type CascadeFloor,
  type NaturalEntry,
  type PositionItem,
} from "@/hooks/useInTextPositions";
import {
  cascadeFloorForBinSlot,
  readStickyOccupancyFloor,
  DATA_STACK_FRAME,
} from "@/components/editor-layout/omni-bin-slot";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";

/** The hook's own inter-card gap. It is module-private there; the arithmetic
 *  below is what pins it (the floor source reports the chrome's last pixel
 *  and the pass adds exactly this). */
const MIN_GAP = 4;

/* ── A DELIVERING ResizeObserver (per instance, the height-authority shape) ── */
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
  observes(el: Element): boolean {
    return this.targets.has(el);
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
function deliverResize(entries: FakeEntry[]): void {
  for (const o of [...observers]) o.deliver(entries);
}
function anyObserverWatches(el: Element): boolean {
  return [...observers].some((o) => o.observes(el));
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
});
afterAll(() => {
  observers.clear();
  delete (globalThis as Record<string, unknown>).ResizeObserver;
});

/* ── Geometry ─────────────────────────────────────────────────────────── */

function makeRect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 300,
    width: 300,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** The frame is stuck `POD_GAP` below the scrollport's top at every scroll
 *  position; the pod's top starts at the scrollport's top and moves up as the
 *  document scrolls (`-scrollTop`). */
const POD_GAP = 10;
const SCALE = 3;
const BAND_H = 800;
const CARD_H = 60;

/* ── Editor ───────────────────────────────────────────────────────────── */

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

/* ── Pure legs ────────────────────────────────────────────────────────── */

describe("leg 1 — resolveCascade binds the forward pass to the floor", () => {
  const natural = new Map<string, NaturalEntry>([
    ["a", { naturalTop: 0, height: CARD_H }],
    ["b", { naturalTop: 30, height: CARD_H }],
    ["c", { naturalTop: 500, height: CARD_H }],
  ]);
  const items: PositionItem[] = [
    { id: "a", pos: 0 },
    { id: "b", pos: 10 },
    { id: "c", pos: 200 },
  ];

  it("the first card rests AT the floor and the rest pack below; a far card is untouched", () => {
    const out = resolveCascade(natural, items, null, 100);
    expect(out.get("a")).toBe(100);
    expect(out.get("b")).toBe(100 + CARD_H + MIN_GAP);
    expect(out.get("c")).toBe(500);
  });

  it("a pin ABOVE the floor is clamped to it (a card under the bins is what the pin exists to escape)", () => {
    const out = resolveCascade(natural, items, { id: "c", offset: -480 }, 100);
    expect(out.get("c")).toBe(100);
  });

  it("floor 0 (and the omitted default) is the pre-544 resolver byte for byte", () => {
    const explicit = resolveCascade(natural, items, null, 0);
    const omitted = resolveCascade(natural, items, null);
    expect([...explicit]).toEqual([...omitted]);
    expect(omitted.get("a")).toBe(0);
    expect(omitted.get("b")).toBe(CARD_H + MIN_GAP);
  });
});

describe("leg 2 — readStickyOccupancyFloor is a scroll-zero, scroll-invariant number", () => {
  function frameAndSlot(slotBottom: number, frameTop = POD_GAP) {
    const frame = document.createElement("div");
    const slot = document.createElement("div");
    frame.appendChild(slot);
    frame.getBoundingClientRect = () => makeRect(frameTop, frameTop + 700);
    slot.getBoundingClientRect = () => makeRect(frameTop, slotBottom);
    return { frame, slot };
  }

  it("stuck frame: the same answer at every scroll position", () => {
    const { frame, slot } = frameAndSlot(POD_GAP + 60);
    for (const scrollTop of [0, 120, 999]) {
      const podRect = makeRect(-scrollTop, 20000 - scrollTop);
      expect(readStickyOccupancyFloor(frame, slot, podRect, scrollTop)).toBe(POD_GAP + 60);
    }
  });

  it("an empty frame is no floor", () => {
    const { frame, slot } = frameAndSlot(POD_GAP);
    expect(readStickyOccupancyFloor(frame, slot, makeRect(0, 20000), 0)).toBe(0);
  });

  it("a frame that has not reached its pin clamps at 0 — the conservative direction", () => {
    // Natural position 30px ABOVE the pod's first pixel (a column that starts
    // above the scrollport): the difference goes negative and the floor is
    // the full occupancy rather than a few pixels less.
    const { frame, slot } = frameAndSlot(-30 + 60, -30);
    expect(readStickyOccupancyFloor(frame, slot, makeRect(0, 20000), 0)).toBe(60);
  });
});

/* ── The real hook over a fake frame ──────────────────────────────────── */

type HookOut = ReturnType<typeof useInTextPositions>;

function Harness({
  editor,
  items,
  floor,
  sinkRef,
  podTopRef,
}: {
  editor: Editor;
  items: PositionItem[];
  floor: CascadeFloor | null;
  sinkRef: { current: HookOut | null };
  podTopRef: { current: number };
}) {
  const out = useInTextPositions(
    editor,
    items,
    true,
    "data-omni-entry-wrapper",
    null,
    undefined,
    floor,
  );
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
            makeRect(podTopRef.current, podTopRef.current + 20000);
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
            if (el) el.getBoundingClientRect = () => makeRect(0, CARD_H);
          },
        },
        `card ${it.id}`,
      ),
    ),
  );
}

function setup(items: PositionItem[], opts: { floor: boolean; slotTop?: number; slotBottom?: number }) {
  vi.useFakeTimers();
  const scroll = { top: 0 };
  const podTopRef = { current: 0 };

  // The row scroll: its rect never moves (it IS the viewport); its scrollTop
  // is what moves the pod.
  Object.defineProperty(window, "innerHeight", { value: BAND_H, configurable: true });
  const rowScroll = document.createElement("div");
  rowScroll.setAttribute("data-virgil-row-scroll", "");
  rowScroll.getBoundingClientRect = () => makeRect(0, BAND_H);
  Object.defineProperty(rowScroll, "offsetParent", { value: document.body });
  Object.defineProperty(rowScroll, "scrollTop", { get: () => scroll.top, configurable: true });
  document.body.appendChild(rowScroll);

  // The column's sticky frame and its bin slot — stuck at POD_GAP from the
  // scrollport top whatever the scroll, exactly as `PanelColumn` renders it.
  const frame = document.createElement("div");
  frame.setAttribute(DATA_STACK_FRAME, "right");
  const slot = document.createElement("div");
  frame.appendChild(slot);
  document.body.appendChild(frame);
  const slotRect = {
    top: opts.slotTop ?? POD_GAP,
    bottom: opts.slotBottom ?? POD_GAP + 60,
  };
  frame.getBoundingClientRect = () => makeRect(POD_GAP, POD_GAP + 700);
  slot.getBoundingClientRect = () => makeRect(slotRect.top, slotRect.bottom);
  const floor = opts.floor ? cascadeFloorForBinSlot(slot) : null;

  const editor = mountDoc(160);
  const docSize = editor.state.doc.content.size;
  const CONTENT_H = docSize * SCALE;
  const editorDom = editor.view.dom as HTMLElement;
  editorDom.getBoundingClientRect = () =>
    makeRect(podTopRef.current, podTopRef.current + CONTENT_H);
  Object.defineProperty(editorDom, "scrollHeight", {
    get: () => CONTENT_H,
    configurable: true,
  });
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => ({
    top: pos * SCALE + podTopRef.current,
    bottom: pos * SCALE + podTopRef.current + 20,
    left: 0,
    right: 0,
  }));
  vi.spyOn(editor.view, "posAtCoords").mockImplementation(
    ({ top }: { left: number; top: number }) => ({
      pos: Math.round(
        Math.max(0, Math.min(docSize, (top - podTopRef.current) / SCALE)),
      ),
      inside: -1,
    }),
  );

  const sinkRef: { current: HookOut | null } = { current: null };
  const view = render(
    <KeepAliveVisibilityProvider isVisible={true}>
      <Harness
        editor={editor}
        items={items}
        floor={floor}
        sinkRef={sinkRef}
        podTopRef={podTopRef}
      />
    </KeepAliveVisibilityProvider>,
  );

  return {
    slot,
    floor,
    top: (id: string) => sinkRef.current?.positions.get(id),
    positionsRef: () => sinkRef.current?.positions,
    async idle(ms = 2000) {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
    },
    /** Scroll the document by `px`: the pod (and every anchor) moves up, the
     *  frame stays put, and a resize re-enters the settle door. */
    async scrollTo(px: number) {
      scroll.top = px;
      podTopRef.current = -px;
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        vi.advanceTimersByTime(4000);
      });
    },
    /** Grow the bin stack (a pill expanded) and let the observer report it —
     *  the ONLY trigger an expand has. */
    async resizeSlot(bottom: number) {
      slotRect.bottom = bottom;
      await act(async () => {
        deliverResize([entryFor(slot, bottom - slotRect.top)]);
        vi.advanceTimersByTime(2000);
      });
    },
    async fireSlotUnchanged() {
      await act(async () => {
        deliverResize([entryFor(slot, slotRect.bottom - slotRect.top)]);
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

const FIRST = { id: "first", pos: 0 };
const SECOND = { id: "second", pos: 10 };
const FAR = { id: "far", pos: 2000 };

describe("task 544 — the deck clears the sticky bins", () => {
  it("leg 3: the first card clears the bins by exactly the inter-card gap; the next packs below it; a far card is untouched", async () => {
    const s = setup([FIRST, SECOND, FAR], { floor: true });
    await s.idle();
    // Chrome: frame stuck at POD_GAP, slot bottom at POD_GAP + 60 → the
    // chrome's last pixel is 70px into the pod at scroll zero.
    const floor = POD_GAP + 60 + MIN_GAP;
    expect(s.top(FIRST.id)).toBe(floor);
    expect(s.top(SECOND.id)).toBe(floor + CARD_H + MIN_GAP);
    expect(s.top(FAR.id)).toBe(FAR.pos * SCALE);
    s.unmount();
  });

  it("leg 4: the floor does not move when the document scrolls", async () => {
    const s = setup([FIRST, SECOND], { floor: true });
    await s.idle();
    const before = [s.top(FIRST.id), s.top(SECOND.id)];
    await s.scrollTo(500);
    expect([s.top(FIRST.id), s.top(SECOND.id)]).toEqual(before);
    await s.scrollTo(37);
    expect([s.top(FIRST.id), s.top(SECOND.id)]).toEqual(before);
    s.unmount();
  });

  it("leg 5: the bin stack growing re-floors the deck through the observer — no other trigger", async () => {
    const s = setup([FIRST, SECOND], { floor: true });
    await s.idle();
    expect(anyObserverWatches(s.slot)).toBe(true);
    expect(s.top(FIRST.id)).toBe(POD_GAP + 60 + MIN_GAP);
    await s.resizeSlot(POD_GAP + 240);
    expect(s.top(FIRST.id)).toBe(POD_GAP + 240 + MIN_GAP);
    expect(s.top(SECOND.id)).toBe(POD_GAP + 240 + MIN_GAP + CARD_H + MIN_GAP);
    // …and shrinking back (the pill collapsed) releases it.
    await s.resizeSlot(POD_GAP + 60);
    expect(s.top(FIRST.id)).toBe(POD_GAP + 60 + MIN_GAP);
    s.unmount();
  });

  it("leg 6: an observer fire that changes nothing commits nothing", async () => {
    const s = setup([FIRST, SECOND], { floor: true });
    await s.idle();
    const before = s.positionsRef();
    expect(before).toBeDefined();
    await s.fireSlotUnchanged();
    expect(s.positionsRef()).toBe(before);
    s.unmount();
  });

  it("leg 7: a docked band above an EMPTY slot floors the deck under the band", async () => {
    // The slot is the frame's last flex child: with a 300px band docked it
    // sits at the band's bottom plus the pod-gap separator, zero height.
    const bandBottom = POD_GAP + 300;
    const s = setup([FIRST], {
      floor: true,
      slotTop: bandBottom + POD_GAP,
      slotBottom: bandBottom + POD_GAP,
    });
    await s.idle();
    expect(s.top(FIRST.id)).toBe(bandBottom + POD_GAP + MIN_GAP);
    s.unmount();
  });

  it("leg 8 (control): no floor source → the first card sits at its natural top", async () => {
    const s = setup([FIRST, SECOND], { floor: false });
    await s.idle();
    expect(s.top(FIRST.id)).toBe(0);
    expect(s.top(SECOND.id)).toBe(CARD_H + MIN_GAP);
    s.unmount();
  });
});
