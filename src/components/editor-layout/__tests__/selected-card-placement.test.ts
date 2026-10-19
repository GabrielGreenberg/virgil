// @vitest-environment jsdom
//
// Task 1179 — the selection-alignment door. A selected card sits LEVEL with
// the clicked marker in whichever host shows it: the Omni pin (the existing
// door, with the policy's named "selection-alignment" intent) or the native
// list's slide (a scrollTop delta + transient spacer padding). Pins:
//   • the slide puts the card's top at the click Y — even for a visible,
//     nearby card (the named exception to task 328's hold rule);
//   • near the top / bottom the list grows a spacer instead of clamping short;
//   • it releases on deselect, on user list scroll, on re-sort/filter, on hide;
//     typing inside the card releases nothing;
//   • no slide during a layout gesture; a row-scrolled card is never moved
//     (that would drag the document);
//   • an Omni-hosted card goes to the pin door with the intent.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { strip, walkFiles } from "@/lib/__tests__/_source-scan";

const gesture = { active: false };
vi.mock("@/lib/pane-resize/layout-gesture-bus", () => ({
  isLayoutGestureActive: () => gesture.active,
}));
vi.mock("@/components/editor-layout/omni-card-placement", () => ({
  requestOmniCardPlacement: vi.fn(),
}));

import {
  placeSelectedCard,
  frameForOffset,
  offsetForTarget,
  releasedOffset,
} from "@/components/editor-layout/selected-card-placement";
import { requestOmniCardPlacement } from "@/components/editor-layout/omni-card-placement";
import { createCardStore, type CardStore } from "@/links/_shared/anchored-card-store";
import { mayReposition } from "@/lib/reposition-policy";

const omniMock = vi.mocked(requestOmniCardPlacement);

/* ── A list with real-enough geometry ─────────────────────────────── */

const BAND_TOP = 100; // scroller's viewport top
const BAND_H = 400;
const CARD_H = 60;
const GAP = 10;
const N = 10; // content height = 10 * 70 = 700 → natural max scroll 300

let rafQueue: FrameRequestCallback[] = [];
function flushFrames(n = 5) {
  for (let i = 0; i < n; i++) {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(performance.now() + 1000);
  }
}

interface List {
  scroller: HTMLElement;
  cards: HTMLElement[];
  store: CardStore;
  scrollTop: () => number;
}

function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function buildList(): List {
  document.body.innerHTML = "";
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  let top = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      const max = scroller.scrollHeight - BAND_H;
      top = Math.max(0, Math.min(max, v));
    },
  });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => BAND_H });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    get: () => N * (CARD_H + GAP) + px(scroller.style.paddingTop) + px(scroller.style.paddingBottom),
  });
  scroller.getBoundingClientRect = () =>
    ({ top: BAND_TOP, bottom: BAND_TOP + BAND_H, height: BAND_H, left: 0, right: 200, width: 200 }) as DOMRect;
  const cards: HTMLElement[] = [];
  for (let i = 0; i < N; i++) {
    const card = document.createElement("div");
    card.setAttribute("data-card-key", `float:card:note:n${i}`);
    card.getBoundingClientRect = () => {
      const idx = Array.from(scroller.children).indexOf(card);
      const t = BAND_TOP + px(scroller.style.paddingTop) + idx * (CARD_H + GAP) - scroller.scrollTop;
      return { top: t, bottom: t + CARD_H, height: CARD_H, left: 0, right: 200, width: 200 } as DOMRect;
    };
    scroller.appendChild(card);
    cards.push(card);
  }
  document.body.appendChild(scroller);
  return { scroller, cards, store: createCardStore(), scrollTop: () => scroller.scrollTop };
}

function place(list: List, i: number, viewportY: number) {
  list.store.select({ kind: "note", id: `n${i}` });
  placeSelectedCard({
    omniKey: `float:card:note:n${i}`,
    entrySelector: `[data-card-key="float:card:note:n${i}"]`,
    viewportY,
    store: list.store,
  });
  flushFrames();
}

const topOf = (el: HTMLElement) => el.getBoundingClientRect().top;

let reduce = true;
beforeEach(() => {
  rafQueue = [];
  gesture.active = false;
  reduce = true;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("reduce") })) as never;
  // jsdom lays nothing out: count every element as rendered.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return document.body; },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  omniMock.mockClear();
  // @ts-expect-error — restore jsdom's own (absent) getter
  delete HTMLElement.prototype.offsetParent;
});

describe("the slide arithmetic", () => {
  it("positive offset = top spacer; negative = scroll, then bottom spacer past the max", () => {
    expect(frameForOffset(50, 300)).toEqual({ padTop: 50, padBottom: 0, scrollTop: 0 });
    expect(frameForOffset(-120, 300)).toEqual({ padTop: 0, padBottom: 0, scrollTop: 120 });
    expect(frameForOffset(-380, 300)).toEqual({ padTop: 0, padBottom: 80, scrollTop: 380 });
  });
  it("the target offset moves the card by exactly its distance from the click", () => {
    expect(offsetForTarget(-100, 250, 200)).toBe(-150);
  });
  it("a release settles inside the natural range, keeping position where it can", () => {
    expect(releasedOffset(40, 300)).toBe(0);
    expect(releasedOffset(-120, 300)).toBe(-120);
    expect(releasedOffset(-380, 300)).toBe(-300);
  });
  it("the policy's named exception moves a visible, nearby card (and still holds jitter)", () => {
    const rect = { top: 200, bottom: 260 };
    const band = { top: 100, bottom: 500 };
    expect(mayReposition({ current: 200, target: 230, rect, band })).toBe("hold");
    expect(
      mayReposition({ current: 200, target: 230, rect, band, intent: "selection-alignment" }),
    ).toBe("move");
    expect(
      mayReposition({ current: 200, target: 203, rect, band, intent: "selection-alignment" }),
    ).toBe("hold");
  });
});

describe("native-list slide", () => {
  it("a visible, nearby card still slides level with the click", () => {
    const list = buildList();
    // card 2 sits at 100 + 140 = 240; click at 270 (30px away, fully visible)
    place(list, 2, 270);
    expect(topOf(list.cards[2])).toBe(270);
  });

  it("a mid-list card aligns by plain scroll (no spacer)", () => {
    const list = buildList();
    place(list, 6, 150); // natural top 520 → scroll 370? clamp: needs scroll 370 > max 300
    expect(topOf(list.cards[6])).toBe(150);
    place(list, 5, 200); // natural 450 → needs scroll 250 ≤ 300
    expect(topOf(list.cards[5])).toBe(200);
    expect(list.scroller.style.paddingTop).toBe("0px");
  });

  it("near the TOP the list grows a top spacer instead of clamping short", () => {
    const list = buildList();
    place(list, 0, 300); // card 0 at 100, must sit at 300
    expect(topOf(list.cards[0])).toBe(300);
    expect(px(list.scroller.style.paddingTop)).toBe(200);
    expect(list.scrollTop()).toBe(0);
  });

  it("near the BOTTOM the list grows a bottom spacer", () => {
    const list = buildList();
    place(list, 9, 120); // natural 730 → scroll 610 > max 300
    expect(topOf(list.cards[9])).toBe(120);
    expect(px(list.scroller.style.paddingBottom)).toBeGreaterThan(0);
  });

  it("a second selection continues from the first's spacer (no snap in between)", () => {
    const list = buildList();
    place(list, 0, 300);
    place(list, 1, 320);
    expect(topOf(list.cards[1])).toBe(320);
  });

  it("the animated path lands on the same frame as the instant one", () => {
    reduce = false;
    const list = buildList();
    place(list, 0, 300);
    flushFrames(20);
    expect(topOf(list.cards[0])).toBe(300);
  });

  describe("release", () => {
    it("on deselect: the spacer goes, the inline padding is restored", () => {
      const list = buildList();
      place(list, 0, 300);
      list.store.clearSelection();
      flushFrames();
      expect(list.scroller.style.paddingTop).toBe("");
      expect(topOf(list.cards[0])).toBe(BAND_TOP);
    });

    it("hover releases nothing; selecting another card IN the list keeps it still", () => {
      const list = buildList();
      place(list, 0, 300);
      list.store.setHover({ kind: "note", id: "n3" });
      flushFrames();
      expect(px(list.scroller.style.paddingTop)).toBe(200);
      // A card click (no placement follows): the clicked card must not slide
      // out from under the cursor.
      const before = topOf(list.cards[1]);
      list.store.select({ kind: "note", id: "n1" });
      flushFrames();
      expect(topOf(list.cards[1])).toBe(before);
    });

    it("marker A then marker B mid-release: no stray padding, ever", () => {
      reduce = false;
      const list = buildList();
      place(list, 0, 300);
      flushFrames(20);
      // B's click: select (A's state is still on the scroller) …
      list.store.select({ kind: "note", id: "n1" });
      rafQueue = [];
      placeSelectedCard({
        omniKey: "float:card:note:n1",
        entrySelector: '[data-card-key="float:card:note:n1"]',
        viewportY: 260,
        store: list.store,
      });
      flushFrames(20);
      expect(topOf(list.cards[1])).toBe(260);
      list.store.clearSelection();
      flushFrames(20);
      expect(list.scroller.style.paddingTop).toBe("");
      expect(list.scroller.style.paddingBottom).toBe("");
    });

    it("a scroll the BROWSER made (focus) is never written back as stale", () => {
      const list = buildList();
      place(list, 5, 200); // plain scroll, no spacer
      list.scroller.scrollTop = 40; // e.g. focus-scroll, no intent event
      list.store.clearSelection();
      flushFrames();
      expect(list.scrollTop()).toBe(40);
    });

    it("on the user scrolling the list (wheel)", () => {
      const list = buildList();
      place(list, 0, 300);
      list.scroller.dispatchEvent(new Event("wheel"));
      flushFrames();
      expect(list.scroller.style.paddingTop).toBe("");
    });

    it("scroll keys release; typing inside the card's editor does not", () => {
      const list = buildList();
      place(list, 0, 300);
      const field = document.createElement("textarea");
      list.cards[0].appendChild(field);
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      field.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      flushFrames();
      expect(px(list.scroller.style.paddingTop)).toBe(200);
      list.scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
      flushFrames();
      expect(list.scroller.style.paddingTop).toBe("");
    });

    it("a press on a card is a click, not a scroll; a scrollbar press releases", () => {
      const list = buildList();
      place(list, 0, 300);
      list.cards[0].dispatchEvent(new Event("pointerdown", { bubbles: true }));
      flushFrames();
      expect(px(list.scroller.style.paddingTop)).toBe(200);
      list.scroller.dispatchEvent(new Event("pointerdown"));
      flushFrames();
      expect(list.scroller.style.paddingTop).toBe("");
    });

    it("on re-sort / filter (the list's children change)", async () => {
      const list = buildList();
      place(list, 0, 300);
      list.scroller.insertBefore(list.cards[5], list.cards[0]);
      await Promise.resolve();
      flushFrames();
      expect(list.scroller.style.paddingTop).toBe("");
    });

    it("is OWNER-keyed: another doc's selection change releases nothing", () => {
      const a = buildList();
      place(a, 0, 300);
      const other = createCardStore();
      other.select({ kind: "note", id: "n7" });
      other.clearSelection();
      flushFrames();
      expect(px(a.scroller.style.paddingTop)).toBe(200);
    });

    it("on the list going hidden (zero-height box), at once", () => {
      const observers: { cb: ResizeObserverCallback }[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(cb: ResizeObserverCallback) { observers.push({ cb }); }
          observe() {}
          disconnect() {}
        },
      );
      const list = buildList();
      place(list, 0, 300);
      const fire = (h: number) =>
        observers.at(-1)!.cb([{ contentRect: { height: h } } as never], {} as never);
      fire(400); // the initial delivery is ignored
      fire(380); // a resize that is not a hide
      expect(px(list.scroller.style.paddingTop)).toBe(200);
      fire(0);
      expect(list.scroller.style.paddingTop).toBe("");
    });
  });

  it("a click above the list's top edge aligns to that edge, not under the header", () => {
    const list = buildList();
    place(list, 4, 20); // band starts at 100
    expect(topOf(list.cards[4])).toBe(BAND_TOP);
  });

  it("no slide during a layout gesture", () => {
    const list = buildList();
    gesture.active = true;
    place(list, 0, 300);
    expect(list.scroller.style.paddingTop).toBe("");
    expect(topOf(list.cards[0])).toBe(BAND_TOP);
  });

  it("a card that scrolls with the ROW is never moved (that would drag the document)", () => {
    const list = buildList();
    list.scroller.setAttribute("data-virgil-row-scroll", "");
    place(list, 0, 300);
    expect(list.scroller.style.paddingTop).toBe("");
  });

  it("a hidden pane's card is never the target (fail-closed)", () => {
    const list = buildList();
    // @ts-expect-error — un-render everything
    delete HTMLElement.prototype.offsetParent;
    place(list, 0, 300);
    expect(list.scroller.style.paddingTop).toBe("");
  });
});

describe("Omni host", () => {
  it("a mounted omni wrapper goes to the pin door with the selection-alignment intent", () => {
    document.body.innerHTML = "";
    const w = document.createElement("div");
    w.setAttribute("data-omni-entry-wrapper", "float:card:note:n1@p2");
    document.body.appendChild(w);
    placeSelectedCard({
      omniKey: "float:card:note:n1@p2",
      entrySelector: '[data-card-key="float:card:note:n1"]',
      viewportY: 222,
      store: createCardStore(),
    });
    flushFrames();
    expect(omniMock).toHaveBeenCalledWith(
      "float:card:note:n1@p2",
      { viewportY: 222 },
      "selection-alignment",
    );
  });

  it("nothing mounted after the frame budget: nothing is written", () => {
    document.body.innerHTML = "";
    placeSelectedCard({
      omniKey: "float:card:note:zz",
      entrySelector: '[data-card-key="float:card:note:zz"]',
      viewportY: 10,
      store: createCardStore(),
    });
    flushFrames(10);
    expect(omniMock).not.toHaveBeenCalled();
  });
});

describe("the door's laws — source census", () => {
  // Keystroke sanctity: the door is reached ONLY from click bridges and
  // subscribes to no editor event, so typing cannot arm a slide. Scroll-anchor
  // stability case (a): no scroll listener re-solves the card. Geometry: no
  // per-block doc probe — the marker's Y is the click's own clientY.
  const src = strip(
    readFileSync(
      path.resolve(__dirname, "../selected-card-placement.ts"),
      "utf8",
    ),
    true, // comments blanked, strings KEPT — the event names are strings
  );
  it("no editor subscriber, no doc probe, no scroll listener", () => {
    expect(src).not.toMatch(/\.on\(\s*["'`](update|transaction|selectionUpdate)/);
    expect(src).not.toMatch(/coordsAtPos|posAtCoords|\.state\.doc|descendants\(/);
    expect(src).not.toMatch(/addEventListener\(\s*["'`]scroll/);
    expect(src).not.toMatch(/document\.querySelector/);
  });
  it("only the click bridges call the door", () => {
    const callers = walkFiles(path.resolve(__dirname, "../../.."))
      .filter((f) => /\.tsx?$/.test(f) && !/__tests__|\.test\./.test(f))
      .filter((f) => /\bplaceSelectedCard\s*\(/.test(strip(readFileSync(f, "utf8"), true)))
      .map((f) => path.basename(f))
      .sort();
    expect(callers).toEqual(["marker-clicks.ts", "selected-card-placement.ts"]);
  });
  it("only the selection door speaks the policy's named exception", () => {
    const speakers = walkFiles(path.resolve(__dirname, "../../.."))
      .filter((f) => /\.tsx?$/.test(f) && !/__tests__|\.test\./.test(f))
      .filter((f) => /["']selection-alignment["']/.test(strip(readFileSync(f, "utf8"), true)))
      .map((f) => path.basename(f))
      .sort();
    // The policy declares it, the omni door forwards its type, and the
    // selection door is the only publisher that passes the literal.
    expect(speakers).toEqual(["reposition-policy.ts", "selected-card-placement.ts"]);
  });
});
