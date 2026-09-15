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
/** The deck owner the scene's pod stamps (task 583 — pins are keyed per
 *  deck, never per side). */
const OWNER = "omni-pin-test-a";

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
 *  podRelTop`.
 *
 *  `naturalTop` is the card's ANCHOR-derived top — what the pod publishes on
 *  `data-omni-natural-top` and what every stored pin is expressed against
 *  since task 362. It defaults to `podRelTop` (an unpacked deck, where the
 *  two coincide); pass them apart to model a card the cascade has pushed
 *  away from its anchor. */
function scene(
  cardKey: string,
  podRelTop: number,
  height = 120,
  naturalTop: number = podRelTop,
): Scene {
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
  pod.setAttribute("data-omni-pin-owner", OWNER);
  pod.getBoundingClientRect = () => rect(POD_TOP, 4000);

  const wrapper = addWrapper(pod, cardKey, podRelTop, height, naturalTop);
  side.appendChild(pod);
  row.appendChild(side);
  document.body.appendChild(row);
  return { row, pod, wrapper };
}

/** A second (or third) card wrapper in the same pod. */
function addWrapper(
  pod: HTMLElement,
  cardKey: string,
  podRelTop: number,
  height = 120,
  naturalTop: number = podRelTop,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.dataset.omniEntryWrapper = cardKey;
  wrapper.setAttribute("data-omni-natural-top", String(naturalTop));
  wrapper.getBoundingClientRect = () => rect(POD_TOP + podRelTop, height);
  pod.appendChild(wrapper);
  return wrapper;
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
    expect(omniPinStore.get(OWNER)).toBeNull();

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
    const pin = omniPinStore.get(OWNER) as { offset: number } | null;
    const after = resolveCascade(
      natural,
      items,
      pin ? { id: KEY, offset: pin.offset } : null,
    );
    expect([...after.entries()]).toEqual([...unpinned.entries()]);
    // Guard against passing vacuously: the pre-fix placement really would
    // have moved this deck. (Pins are anchor-relative since 362, so the
    // pre-fix absolute Y of `140 - POD_TOP` is that Y minus this card's
    // natural top.)
    const preFix = resolveCascade(natural, items, {
      id: KEY,
      offset: 140 - POD_TOP - 300,
    });
    expect([...preFix.entries()]).not.toEqual([...unpinned.entries()]);
  });

  it("a refused placement leaves ANOTHER card's pin alone", () => {
    // One pin per side: a "hold" that published at the current top would
    // replace this one, releasing card `other` back to its natural position
    // and re-packing its neighbours — a move nobody asked for, caused by the
    // very gesture that was supposed to move nothing.
    scene(KEY, 300);
    omniPinStore.requestPin(OWNER, "float:card:note:other", 999);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    const pin = omniPinStore.get(OWNER)!;
    expect(pin.cardId).toBe("float:card:note:other");
    expect(pin.offset).toBe(999);
  });

  it("MOVES a card that is off screen — necessity (a)", () => {
    // Pod-relative 1400 → screen 1200, well below the band.
    scene(KEY, 1400);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    // Stored ANCHOR-RELATIVE (task 362): the requested absolute pod Y minus
    // the card's natural top.
    expect(omniPinStore.get(OWNER)!.offset).toBe(140 - POD_TOP - 1400);
  });

  it("MOVES a visible card that is very far from the click — necessity (b)", () => {
    // Visible at screen 100, click 500px away: the dense-stack case, where a
    // buried card's cascade offset from its own anchor IS the burial.
    scene(KEY, 300);
    requestOmniCardPlacement(KEY, { viewportY: 620 });
    expect(omniPinStore.get(OWNER)!.offset).toBe(620 - POD_TOP - 300);
  });

  it("takes a pod-relative desired top verbatim (the jump path's pre-scroll measurement)", () => {
    scene(KEY, 1400); // off screen ⇒ sanctioned
    requestOmniCardPlacement(KEY, { podTop: 42 });
    expect(omniPinStore.get(OWNER)!.offset).toBe(42 - 1400);
  });

  it("holdOmniCard pins the current top WHEN A PIN IS STANDING — the freeze still works", () => {
    // Takes the wrapper the user pressed, never a key: under multi-pane
    // keep-alive a `document.querySelector` by key can answer with a
    // `display:none` warm pane's twin, whose rects all read zero.
    //
    // Deliberately a PACKED card: the cascade has pushed it 80px below its
    // anchor, so "freeze me where I am" is 80, not 0 — a scene where natural
    // and current coincided would pass with the conversion deleted.
    //
    // RENEGOTIATED (task 490) — this leg used to run with an EMPTY store and
    // assert that a hold always writes. That is the shape Gabriel reported: on
    // a pin-free side nothing can move the pressed card (the forward pass is
    // height-independent; the backward pass is pin-gated), so the write held
    // nothing and instead lifted every card ABOVE it off its anchor, forever.
    // The freeze is asserted where it is real — with a pin standing.
    //
    // RENEGOTIATED AGAIN (task 583) — "a pin is standing" is not enough: the
    // pinned card must be IN THIS DECK and BELOW the pressed one, because the
    // backward pass only reaches rows above the pin. The pin is placed on a
    // real wrapper under KEY.
    const { wrapper, pod } = scene(KEY, 300, 120, 220);
    addWrapper(pod, "float:card:note:other", 600, 120, 580);
    omniPinStore.requestPin(OWNER, "float:card:note:other", 30);
    holdOmniCard(wrapper);
    expect(omniPinStore.get(OWNER)!.cardId).toBe(KEY);
    expect(omniPinStore.get(OWNER)!.offset).toBe(80);
  });

  it("holdOmniCard writes NOTHING on a pin-free side — a hold that holds nothing (task 490)", () => {
    // The defect leg. With no pin standing, `resolveCascade` runs forward-only,
    // so the pressed card's top does not depend on its own height and the click
    // cannot move it — the freeze held nothing. What the pre-490 write DID do
    // is make the crowd's CURRENT displacement permanent, because nothing ever
    // clears a pin.
    const { wrapper } = scene(KEY, 300, 120, 220);
    holdOmniCard(wrapper);
    expect(omniPinStore.get(OWNER)).toBeNull();

    // …and the accepting control, which is Gabriel's second report as
    // arithmetic. The pressed card sits 80px below its anchor because the card
    // ABOVE it is expanded. Collapse that card and the deck's own answer walks
    // back to the anchor — but the pin does not, so the card stays displaced by
    // a crowd that is no longer there ("displacing to the same extent as they
    // would be when open").
    const items = [
      { id: "a", pos: 1 },
      { id: KEY, pos: 2 },
    ];
    const afterNeighbourCollapsed = new Map<string, NaturalEntry>([
      ["a", { naturalTop: 100, height: 60 }],
      [KEY, { naturalTop: 220, height: 120 }],
    ]);
    const unpinned = resolveCascade(afterNeighbourCollapsed, items, null);
    const withStaleHold = resolveCascade(afterNeighbourCollapsed, items, {
      id: KEY,
      offset: 80,
    });
    expect(unpinned.get(KEY)).toBe(220); // back on its anchor
    expect(withStaleHold.get(KEY)).toBe(300); // …still 80px below it, forever
  });

  it("holdOmniCard refuses an offset ABOVE the anchor — the ratchet's second turn (task 490)", () => {
    // Once ANY pin stands, the backward pass can lift a card above its own
    // anchor. Pressing THAT card used to freeze the negative displacement as a
    // durable pin: the card then contradicts its own margin marker forever,
    // which is task 362's decoupling arriving through the offset instead of
    // through the coordinate. A hold may only hold what the deck's own rule
    // could have produced, and the forward pass never puts a card above its
    // anchor.
    const { wrapper, pod } = scene(KEY, 220, 120, 300); // lifted 80px ABOVE its anchor
    addWrapper(pod, "float:card:note:other", 400, 120, 600); // the pin, below it
    omniPinStore.requestPin(OWNER, "float:card:note:other", 30);
    holdOmniCard(wrapper);
    expect(omniPinStore.get(OWNER)!.cardId).toBe("float:card:note:other");
  });

  describe("task 583 — the hold asks whether THIS pin can move THIS card", () => {
    const OTHER = "float:card:note:other";

    it("DEFECT LEG — a press on a card BELOW a standing pin writes nothing", () => {
      // Gabriel's 490 bug, re-armed: after ONE marker click pinned OTHER, the
      // pre-583 rule ("any pin standing?") let every press below it replace the
      // pin — OTHER snapped back to its natural top (a card the user did not
      // touch) and the pressed card froze at the crowd's displacement. The
      // forward pass sets a row's top from its predecessors only, and the
      // backward pass is the identity after the pinned row, so no transient
      // can move the pressed card.
      const { wrapper, pod } = scene(KEY, 700, 120, 620); // pushed 80 below
      addWrapper(pod, OTHER, 300, 120, 400);
      omniPinStore.requestPin(OWNER, OTHER, -100);
      const before = omniPinStore.get(OWNER)!;
      holdOmniCard(wrapper);
      expect(omniPinStore.get(OWNER)).toBe(before); // untouched, same object
    });

    it("a pin naming a card NO LONGER IN THIS DECK (archived, deleted) enables nothing", () => {
      // Inert in the cascade, and pre-583 still enough to satisfy the rule.
      const { wrapper } = scene(KEY, 300, 120, 220);
      omniPinStore.requestPin(OWNER, OTHER, 30);
      const before = omniPinStore.get(OWNER)!;
      holdOmniCard(wrapper);
      expect(omniPinStore.get(OWNER)).toBe(before);
    });

    it("pressing the PINNED card itself writes nothing — its top IS the pin", () => {
      const { wrapper } = scene(KEY, 300, 120, 220);
      omniPinStore.requestPin(OWNER, KEY, 80);
      const before = omniPinStore.get(OWNER)!;
      holdOmniCard(wrapper);
      expect(omniPinStore.get(OWNER)).toBe(before);
    });

    it("a natural-top TIE is ordered as the cascade orders it — by DOM (items) order", () => {
      // `resolveCascade` sorts by natural top, stably over the items the pod
      // renders wrappers in; so on a tie, the wrapper EARLIER in the pod is
      // the row above.
      const earlier = scene(KEY, 300, 120, 220);
      addWrapper(earlier.pod, OTHER, 300, 120, 220);
      omniPinStore.requestPin(OWNER, OTHER, 0);
      holdOmniCard(earlier.wrapper); // KEY precedes OTHER ⇒ above ⇒ holds
      expect(omniPinStore.get(OWNER)!.cardId).toBe(KEY);

      document.body.innerHTML = "";
      omniPinStore.clearAll();
      const s2 = scene(OTHER, 300, 120, 220);
      const later = addWrapper(s2.pod, KEY, 300, 120, 220);
      omniPinStore.requestPin(OWNER, OTHER, 0);
      const before = omniPinStore.get(OWNER)!;
      holdOmniCard(later); // KEY follows OTHER ⇒ below ⇒ no transient
      expect(omniPinStore.get(OWNER)).toBe(before);
    });

    it("LIFECYCLE — after a press below the pin, the pressed card still returns to its anchor", () => {
      // Driven through the REAL `resolveCascade`: the deck Gabriel reported.
      // OTHER is pinned; KEY sits below it, pushed 80px off its anchor by an
      // expanded card `a` between them. Press KEY (no pin written), collapse
      // `a` — KEY walks back to its anchor, because nothing froze it.
      const { wrapper, pod } = scene(KEY, 700, 120, 620);
      addWrapper(pod, OTHER, 100, 120, 100);
      omniPinStore.requestPin(OWNER, OTHER, 0);
      holdOmniCard(wrapper);
      const pin = omniPinStore.get(OWNER)!;
      const items = [
        { id: OTHER, pos: 1 },
        { id: "a", pos: 2 },
        { id: KEY, pos: 3 },
      ];
      const collapsed = new Map<string, NaturalEntry>([
        [OTHER, { naturalTop: 100, height: 120 }],
        ["a", { naturalTop: 300, height: 60 }],
        [KEY, { naturalTop: 620, height: 120 }],
      ]);
      const after = resolveCascade(collapsed, items, {
        id: pin.cardId,
        offset: pin.offset,
      });
      expect(after.get(KEY)).toBe(620);
      // Vacuity guard: the pre-583 write (KEY pinned at its crowd offset)
      // really would have kept it displaced.
      const preFix = resolveCascade(collapsed, items, { id: KEY, offset: 80 });
      expect(preFix.get(KEY)).toBe(700);
    });
  });

  describe("task 583 — one deck's pins are invisible to another deck", () => {
    const OTHER = "float:card:note:other";

    function secondPane(): { wrapper: HTMLElement; pod: HTMLElement } {
      const row = document.createElement("div");
      const side = document.createElement("div");
      side.dataset.panelColumnSide = "right"; // same rail, different pane
      const pod = document.createElement("div");
      pod.setAttribute("data-omni-pin-owner", "omni-pin-test-b");
      pod.getBoundingClientRect = () => rect(POD_TOP, 4000);
      const wrapper = addWrapper(pod, KEY, 300, 120, 220);
      addWrapper(pod, OTHER, 600, 120, 580);
      side.appendChild(pod);
      row.appendChild(side);
      document.body.appendChild(row);
      return { wrapper, pod };
    }

    it("a pin in pane A does not enable a hold in pane B", () => {
      scene(OTHER, 600, 120, 580); // pane A's pod holds OTHER, pinned
      omniPinStore.requestPin(OWNER, OTHER, 0);
      const b = secondPane(); // pane B has its own KEY above its own OTHER — unpinned
      holdOmniCard(b.wrapper);
      expect(omniPinStore.get("omni-pin-test-b")).toBeNull();
      expect(omniPinStore.get(OWNER)!.cardId).toBe(OTHER);
    });

    it("a pin written in pane B does not replace pane A's pin", () => {
      scene(OTHER, 600, 120, 580);
      omniPinStore.requestPin(OWNER, OTHER, 5);
      const b = secondPane();
      omniPinStore.requestPin("omni-pin-test-b", OTHER, 0);
      holdOmniCard(b.wrapper); // B's own pin ⇒ B's hold writes in B
      expect(omniPinStore.get("omni-pin-test-b")!.cardId).toBe(KEY);
      expect(omniPinStore.get(OWNER)!.cardId).toBe(OTHER);
      expect(omniPinStore.get(OWNER)!.offset).toBe(5);
    });

    it("a pod with NO owner is refused — fail CLOSED", () => {
      const { wrapper, pod } = scene(KEY, 1400);
      pod.removeAttribute("data-omni-pin-owner");
      requestOmniCardPlacement(KEY, { viewportY: 140 });
      holdOmniCard(wrapper);
      expect(omniPinStore.get(OWNER)).toBeNull();
    });

    it("releaseOwner drops only that deck's slot", () => {
      omniPinStore.requestPin(OWNER, OTHER, 1);
      omniPinStore.requestPin("omni-pin-test-b", OTHER, 2);
      omniPinStore.releaseOwner("omni-pin-test-b");
      expect(omniPinStore.get("omni-pin-test-b")).toBeNull();
      expect(omniPinStore.get(OWNER)!.offset).toBe(1);
    });
  });

  it.each([
    ["absent", null],
    ["empty", ""],
    ["whitespace", "  "],
    ["non-numeric", "auto"],
    ["NaN", "NaN"],
  ])("refuses a wrapper whose natural top is %s — fail CLOSED", (_label, value) => {
    // The alternative (store the absolute Y when the anchor reference is
    // missing) is exactly the decoupling 362 retires, arriving silently on
    // whichever path lost the attribute. A wrapper with no READABLE natural
    // top is treated as "nothing to pin", like a missing wrapper.
    //
    // The empty/whitespace cases are the ones with teeth: `Number("")` and
    // `Number("  ")` are both 0, so a presence-blind parse would read them
    // as an anchor sitting at the very top of the pod and store a plausible
    // WRONG offset rather than refusing — silent, where absence is not.
    const { wrapper } = scene(KEY, 1400); // off screen ⇒ otherwise sanctioned
    if (value === null) wrapper.removeAttribute("data-omni-natural-top");
    else wrapper.setAttribute("data-omni-natural-top", value);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    expect(omniPinStore.get(OWNER)).toBeNull();
    holdOmniCard(wrapper);
    expect(omniPinStore.get(OWNER)).toBeNull();
  });

  it("pins the WRAPPER's own id, so a multi-anchor `@N` row still matches", () => {
    scene(`${KEY}@1`, 1400); // off screen, so the move is sanctioned
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    expect(omniPinStore.get(OWNER)!.cardId).toBe(`${KEY}@1`);
  });

  it("publishes nothing when the card isn't in the DOM at all", () => {
    scene("float:card:note:other", 300);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    expect(omniPinStore.get(OWNER)).toBeNull();
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
