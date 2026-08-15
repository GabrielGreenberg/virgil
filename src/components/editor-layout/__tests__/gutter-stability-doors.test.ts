// @vitest-environment jsdom
//
// Task 328 — the two doors, driven against real DOM.
//
// THE DEFECT (example 2, Gabriel's words): "the card is already easily
// visible, but clicking its linked text makes it jump to 'the best position'
// anyway." `alignOmniCardWithClick` computed `pinTop = clickY - pod.top` and
// published it unconditionally; `useInTextPositions` then FORCED the card to
// that Y and re-cascaded the whole deck around it in both directions. So one
// click moved a card the user could already see AND every neighbour with it.
//
// The headline leg below is the one that would have caught it: a visible,
// near-enough card is not placed AT ALL — the door writes nothing, so the
// REAL `resolveCascade` returns exactly the map it returned before the click.
//
// "Writes nothing" rather than "pins at the current top" is load-bearing, and
// the second leg is what pins the difference: the store holds ONE pin per
// side, so a no-op-looking pin still REPLACES another card's pin, releasing
// that card back to its natural position and re-packing its neighbours. A
// hold that moved a different card would be this bug wearing the fix's
// clothes.
//
// jsdom lays nothing out, so every rect here is stubbed — which is fine and
// in fact necessary: these doors are pure DOM-read + policy, and the geometry
// is the input under test.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { omniPinStore } from "../omni-pin-store";
import {
  holdOmniCard,
  requestOmniCardPlacement,
} from "../omni-card-placement";
import { alignEntryToYIfNeeded } from "../layout-scroll";
import { resolveCascade, type NaturalEntry } from "@/hooks/useInTextPositions";

const BAND_TOP = 0;
const BAND_BOTTOM = 800;
const POD_TOP = -200; // the pod is scrolled: its origin sits above the band

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 400,
    width: 400,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

interface Scene {
  row: HTMLElement;
  pod: HTMLElement;
  wrapper: HTMLElement;
}

/** A row scroll → side column → pod → one absolutely-positioned card
 *  wrapper, with the geometry the cascade would have produced: the card's
 *  pod-relative top is `podRelTop`, so its screen top is `POD_TOP +
 *  podRelTop`. */
function scene(cardKey: string, podRelTop: number, height = 120): Scene {
  const row = document.createElement("div");
  row.setAttribute("data-virgil-row-scroll", "");
  Object.defineProperty(row, "offsetParent", { value: document.body });
  // `findScrollParent` walks computed `overflow-y`; jsdom reports "visible"
  // for everything, so the row is reached through `findRowScroll` instead —
  // which is the production path for an editor-anchored entry anyway.
  row.getBoundingClientRect = () => rect(BAND_TOP, BAND_BOTTOM - BAND_TOP);

  const side = document.createElement("div");
  side.dataset.panelColumnSide = "right";

  const pod = document.createElement("div");
  pod.getBoundingClientRect = () => rect(POD_TOP, 4000);

  const wrapper = document.createElement("div");
  wrapper.dataset.omniEntryWrapper = cardKey;
  wrapper.getBoundingClientRect = () => rect(POD_TOP + podRelTop, height);

  pod.appendChild(wrapper);
  side.appendChild(pod);
  row.appendChild(side);
  document.body.appendChild(row);
  return { row, pod, wrapper };
}

beforeEach(() => {
  omniPinStore.clearAll();
});
afterEach(() => {
  document.body.innerHTML = "";
  omniPinStore.clearAll();
});

const KEY = "float:card:note:abc";

describe("the card door — clicking the text of a visible card moves nothing", () => {
  it("writes NO pin for a visible, near-enough card, and the deck is byte-stable", () => {
    // The card sits at pod-relative 300 → screen 100, comfortably inside the
    // 0..800 band. The user clicks its marker 40px lower.
    scene(KEY, 300);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    expect(omniPinStore.get("right")).toBeNull();

    // …and the deck is what it was. Real cascade, real naturals, three cards
    // packed tightly enough that the backward pass has something it COULD
    // pull — so a pin at 340 (= 140 - POD_TOP, what the pre-fix publisher
    // wrote) moves the clicked card AND its neighbours.
    const natural = new Map<string, NaturalEntry>([
      ["a", { naturalTop: 100, height: 150 }],
      [KEY, { naturalTop: 300, height: 120 }],
      ["c", { naturalTop: 380, height: 90 }],
    ]);
    const items = [
      { id: "a", pos: 1 },
      { id: KEY, pos: 2 },
      { id: "c", pos: 3 },
    ];
    const unpinned = resolveCascade(natural, items, null);
    const pin = omniPinStore.get("right") as { pinTop: number } | null;
    const after = resolveCascade(
      natural,
      items,
      pin ? { id: KEY, pinTop: pin.pinTop } : null,
    );
    expect([...after.entries()]).toEqual([...unpinned.entries()]);
    // Guard against passing vacuously: the pre-fix placement really would
    // have moved this deck.
    const preFix = resolveCascade(natural, items, {
      id: KEY,
      pinTop: 140 - POD_TOP,
    });
    expect([...preFix.entries()]).not.toEqual([...unpinned.entries()]);
  });

  it("a refused placement leaves ANOTHER card's pin alone", () => {
    // One pin per side: a "hold" that published at the current top would
    // replace this one, releasing card `other` back to its natural position
    // and re-packing its neighbours — a move nobody asked for, caused by the
    // very gesture that was supposed to move nothing.
    scene(KEY, 300);
    omniPinStore.requestPin("right", "float:card:note:other", 999);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    const pin = omniPinStore.get("right")!;
    expect(pin.cardId).toBe("float:card:note:other");
    expect(pin.pinTop).toBe(999);
  });

  it("MOVES a card that is off screen — necessity (a)", () => {
    // Pod-relative 1400 → screen 1200, well below the band.
    scene(KEY, 1400);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    expect(omniPinStore.get("right")!.pinTop).toBe(140 - POD_TOP);
  });

  it("MOVES a visible card that is very far from the click — necessity (b)", () => {
    // Visible at screen 100, click 500px away: the dense-stack case, where a
    // buried card's cascade offset from its own anchor IS the burial.
    scene(KEY, 300);
    requestOmniCardPlacement(KEY, { viewportY: 620 });
    expect(omniPinStore.get("right")!.pinTop).toBe(620 - POD_TOP);
  });

  it("takes a pod-relative desired top verbatim (the jump path's pre-scroll measurement)", () => {
    scene(KEY, 1400); // off screen ⇒ sanctioned
    requestOmniCardPlacement(KEY, { podTop: 42 });
    expect(omniPinStore.get("right")!.pinTop).toBe(42);
  });

  it("holdOmniCard pins the current top — the collapse/expand freeze still works", () => {
    scene(KEY, 300);
    holdOmniCard(KEY);
    expect(omniPinStore.get("right")!.pinTop).toBe(300);
  });

  it("pins the WRAPPER's own id, so a multi-anchor `@N` row still matches", () => {
    scene(`${KEY}@1`, 1400); // off screen, so the move is sanctioned
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    expect(omniPinStore.get("right")!.cardId).toBe(`${KEY}@1`);
  });

  it("publishes nothing when the card isn't in the DOM at all", () => {
    scene("float:card:note:other", 300);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    expect(omniPinStore.get("right")).toBeNull();
  });
});

describe("the document door — a scroll happens only when it must", () => {
  function entryAt(top: number, height: number): HTMLElement {
    const { wrapper } = scene(KEY, 0);
    wrapper.getBoundingClientRect = () => rect(top, height);
    return wrapper;
  }

  it("refuses to scroll toward a target the entry is already near", () => {
    const el = entryAt(300, 40);
    expect(alignEntryToYIfNeeded(el, 340)).toBe(false);
  });

  it("scrolls when the entry is off screen", () => {
    const el = entryAt(1200, 40);
    expect(alignEntryToYIfNeeded(el, 340)).toBe(true);
  });

  it("scrolls when the entry is visible but very far from the target", () => {
    const el = entryAt(100, 40);
    expect(alignEntryToYIfNeeded(el, 700)).toBe(true);
  });
});
