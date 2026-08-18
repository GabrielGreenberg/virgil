// @vitest-environment jsdom
//
// Task 362 — the pin LIFECYCLE contract, driven across BOTH renderers of one
// anchor.
//
// THE DEFECT (Gabriel, 2026-08-18, two screenshots + the real paper): an
// archive card and its margin marker rendered in completely different places,
// with the anchor demonstrably healthy — the uuid live in `main.tex`, the
// `paragraphSnapshot` matching byte-for-byte. Two renderers of one anchor,
// disagreeing about where that anchor is:
//
//   • the MARKER is derived live, every measure, from the block's own
//     geometry (`computeMarkerPositions` over `AnchorNodeMetrics.top`);
//   • the CARD was FROZEN at whatever pod-relative Y the pin gesture wrote —
//     `PinRequest.pinTop`, an absolute coordinate cleared only when another
//     pin replaced it. Task 328 recorded this as its one leftover: "a card
//     pinned by a sanctioned move decouples from its anchor if the document
//     is later edited above it."
//
// So every edit above the anchor moved the anchor, moved the marker with it,
// and left the card behind — permanently, and by a distance that compounds
// with each edit. Nothing throws; the deck is well-formed; the card is simply
// beside the wrong paragraph.
//
// The fix makes the stored value ANCHOR-RELATIVE: a pin is an OFFSET from the
// card's natural (anchor-derived) top, and the absolute Y is re-derived every
// measure. The invariant below follows by construction rather than from a
// threshold, which is why there is no expiry rule to test.
//
// ── What this suite can and cannot drive ──────────────────────────────────
// jsdom lays nothing out, so neither `coordsAtPos` nor a real
// `getBoundingClientRect` can supply geometry: every number here is the INPUT
// under test, exactly as `gutter-stability-doors` does it. What IS real is
// the whole chain that consumes those numbers — the placement door, the pin
// store, `resolveCascade`, and `computeMarkerPositions`.
//
// The two renderers speak different origins (marker Ys are host-container
// relative; card Ys are pod-relative), so the contract is NOT "the same
// number". It is that their DIFFERENCE is invariant under a document edit —
// i.e. neither can move relative to the other without the anchor itself
// moving. Their shared premise is that both are affine in the anchor's screen
// top with slope 1, which is what an edit above the anchor does to each: it
// translates the block, and both readers re-measure it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { omniPinStore } from "../omni-pin-store";
import {
  holdOmniCard,
  requestOmniCardPlacement,
} from "../omni-card-placement";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import type { AnchorNodeMetrics, MarginaliaMarker } from "@/lib/marginalia";
import { REPOSITION_EPSILON_PX } from "@/lib/reposition-policy";
import { resolveCascade, type NaturalEntry } from "@/hooks/useInTextPositions";

const POD_TOP = -200; // the pod is scrolled: its origin sits above the band
const BAND_BOTTOM = 800;

/** The Stojnić archive card from Gabriel's paper, in miniature. */
const UUID = "a713";
const KEY = "float:card:archive:d5c79769";

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

/** A pod hosting one absolutely-positioned card wrapper, publishing the
 *  card's anchor-derived natural top the way `OmniViewPanel` does. */
function scene(podRelTop: number, naturalTop = podRelTop): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("data-virgil-row-scroll", "");
  Object.defineProperty(row, "offsetParent", { value: document.body });
  row.getBoundingClientRect = () => rect(0, BAND_BOTTOM);

  const side = document.createElement("div");
  side.dataset.panelColumnSide = "right";

  const pod = document.createElement("div");
  pod.getBoundingClientRect = () => rect(POD_TOP, 4000);

  const wrapper = document.createElement("div");
  wrapper.dataset.omniEntryWrapper = KEY;
  wrapper.setAttribute("data-omni-natural-top", String(naturalTop));
  wrapper.getBoundingClientRect = () => rect(POD_TOP + podRelTop, 120);

  pod.appendChild(wrapper);
  side.appendChild(pod);
  row.appendChild(side);
  document.body.appendChild(row);
  return wrapper;
}

/** The MARKER renderer, for real. `anchorTop` is the block's live geometric
 *  top; everything else is a plain one-line prose block. */
function markerY(anchorTop: number): number {
  const metrics: AnchorNodeMetrics = {
    id: UUID,
    top: anchorTop,
    domTop: anchorTop,
    height: 24,
    lineHeight: 24,
    lineCount: 1,
    isAtom: false,
  };
  const marker = {
    id: `${UUID}:archive`,
    entityId: "d5c79769",
    type: "archive",
    textObjectId: UUID,
    side: "right",
  } as unknown as MarginaliaMarker;
  const { positioned } = computeMarkerPositions(
    (uuid) => (uuid === UUID ? metrics : null),
    [marker],
    {},
    { left: 1, right: 2 },
  );
  expect(positioned).toHaveLength(1);
  return positioned[0].cell.y;
}

/** The CARD renderer, for real. `naturalTop` is the card's live anchor-derived
 *  top; the deck holds one neighbour above so the cascade has real work. */
function cardY(naturalTop: number, pinned: { id: string; offset: number } | null): number {
  const natural = new Map<string, NaturalEntry>([
    ["neighbour", { naturalTop: 40, height: 80 }],
    [KEY, { naturalTop, height: 120 }],
  ]);
  const items = [
    { id: "neighbour", pos: 1 },
    { id: KEY, pos: 2 },
  ];
  const out = resolveCascade(natural, items, pinned);
  const y = out.get(KEY);
  expect(y).toBeDefined();
  return y!;
}

beforeEach(() => omniPinStore.clearAll());
afterEach(() => {
  document.body.innerHTML = "";
  omniPinStore.clearAll();
});

describe("a pinned card and its marker never disagree about the anchor", () => {
  // The anchor starts at screen 900 (card off screen ⇒ the placement is
  // sanctioned), and the user clicks its marker at 140. Then the paper is
  // edited ABOVE the anchor and everything anchored to it translates by Δ.
  const ANCHOR_0 = 900;
  const DELTA = 420; // a hand-merged draft section inserted above

  function pinAtMarkerClick(): number {
    scene(ANCHOR_0);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    const pin = omniPinStore.get("right");
    expect(pin, "an off-screen card is a sanctioned move").not.toBeNull();
    return pin!.offset;
  }

  it("holds its offset from the marker across an edit ABOVE the anchor", () => {
    const offset = pinAtMarkerClick();
    const pinned = { id: KEY, offset };

    const gapBefore = cardY(ANCHOR_0, pinned) - markerY(ANCHOR_0);
    const gapAfter =
      cardY(ANCHOR_0 + DELTA, pinned) - markerY(ANCHOR_0 + DELTA);

    // The two renderers moved by the same Δ, so their relationship is
    // unchanged — which is the whole of the invariant.
    expect(Math.abs(gapAfter - gapBefore)).toBeLessThanOrEqual(
      REPOSITION_EPSILON_PX,
    );
  });

  it("the pre-fix semantics, modelled — a pod-absolute pin drifts by the full edit distance", () => {
    // The pre-362 store held the absolute Y the gesture computed. This leg
    // MODELS that (there is no longer an API that can express it) by
    // re-deriving the offset per natural top so the product is constant —
    // which is arithmetically identical to `rows[i].top = pinned.pinTop`.
    //
    // The real neuter was measured, not assumed: reverting the two
    // production lines (the door storing `desiredPodTop`, the cascade
    // reading the stored value as absolute) fails EIGHT legs — four here
    // and four in `gutter-stability-doors`.
    const absolutePinTop = 140 - POD_TOP;
    const frozen = (naturalTop: number) => {
      // A frozen pin is `naturalTop + offset` with the offset re-derived so
      // the product is constant — i.e. exactly what "store the absolute Y"
      // computes, expressed in today's type.
      return cardY(naturalTop, { id: KEY, offset: absolutePinTop - naturalTop });
    };
    const gapBefore = frozen(ANCHOR_0) - markerY(ANCHOR_0);
    const gapAfter = frozen(ANCHOR_0 + DELTA) - markerY(ANCHOR_0 + DELTA);
    expect(Math.abs(gapAfter - gapBefore)).toBeCloseTo(DELTA, 6);
    // …and the card genuinely did not move, which is what Gabriel saw.
    expect(frozen(ANCHOR_0 + DELTA)).toBe(frozen(ANCHOR_0));
  });

  it("the card really does travel — the post-fix leg is not passing vacuously", () => {
    const pinned = { id: KEY, offset: pinAtMarkerClick() };
    expect(cardY(ANCHOR_0 + DELTA, pinned) - cardY(ANCHOR_0, pinned)).toBe(
      DELTA,
    );
    expect(markerY(ANCHOR_0 + DELTA) - markerY(ANCHOR_0)).toBe(DELTA);
  });

  it("an edit BELOW the anchor moves neither", () => {
    const pinned = { id: KEY, offset: pinAtMarkerClick() };
    // A card anchored AFTER this one moves; the anchor above it does not, so
    // the pinned card must not either. (Driven through the real cascade with
    // a third row, because a two-row deck cannot express "something below
    // changed".)
    const deck = (tailTop: number) => {
      const natural = new Map<string, NaturalEntry>([
        ["neighbour", { naturalTop: 40, height: 80 }],
        [KEY, { naturalTop: ANCHOR_0, height: 120 }],
        ["tail", { naturalTop: tailTop, height: 90 }],
      ]);
      const items = [
        { id: "neighbour", pos: 1 },
        { id: KEY, pos: 2 },
        { id: "tail", pos: 3 },
      ];
      return resolveCascade(natural, items, pinned);
    };
    expect(deck(2000).get(KEY)).toBe(deck(2400).get(KEY));
    // Guard against a vacuous pass: the tail really did move.
    expect(deck(2400).get("tail")).not.toBe(deck(2000).get("tail"));
    expect(markerY(ANCHOR_0)).toBe(markerY(ANCHOR_0));
  });
});

describe("the offset is the gesture's durable half", () => {
  it("a marker click puts the card where the click was, at pin time", () => {
    scene(900);
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    const offset = omniPinStore.get("right")!.offset;
    // Pod-relative desired Y was `140 - POD_TOP`; the card's natural top was
    // 900; so the card lands back at the requested Y on the next resolve.
    expect(cardY(900, { id: KEY, offset })).toBe(140 - POD_TOP);
  });

  it("a freeze holds the card's CASCADED displacement, not zero", () => {
    // `holdOmniCard` is the one publisher for which the pin IS the point: it
    // fires on mousedown so the card's top survives its own collapse/expand
    // height change. Its offset is the distance the cascade had already
    // pushed the card from its anchor — and that rides later edits too.
    const wrapper = scene(760, 600);
    holdOmniCard(wrapper);
    expect(omniPinStore.get("right")!.offset).toBe(160);
    expect(cardY(600, { id: KEY, offset: 160 })).toBe(760);
    // …and one edit later, still 160 below wherever the anchor now is.
    expect(cardY(1000, { id: KEY, offset: 160 })).toBe(1160);
  });
});

describe("the lift clears the pin it actually holds", () => {
  it("clears a multi-anchor row's pin, which the bare card key never could", () => {
    // A pin stores the WRAPPER's id, and a multi-anchor card's row is
    // `<key>@N`. `clearPin`'s identity guard declines a mismatch, so the
    // lift gesture's bare-key clear silently did nothing for exactly those
    // rows — the card left the deck and its pin stayed.
    const rowId = `${KEY}@1`;
    omniPinStore.requestPin("right", rowId, 40);
    omniPinStore.clearPin("right", KEY); // what the lift used to pass
    expect(omniPinStore.get("right")).not.toBeNull();
    omniPinStore.clearPin("right", rowId); // what it passes now
    expect(omniPinStore.get("right")).toBeNull();
  });
});

describe("a pin that names no measured card is inert", () => {
  it("does not disturb the deck when the anchor is gone", () => {
    // A deleted anchor drops the card out of the natural map entirely. The
    // pin still sits in the store (nothing clears it but a replacement), and
    // the deck must simply re-pack as if it were not there — never bake an
    // absolute Y for a card that has no anchor to be relative to.
    const natural = new Map<string, NaturalEntry>([
      ["neighbour", { naturalTop: 40, height: 80 }],
      ["other", { naturalTop: 300, height: 90 }],
    ]);
    const items = [
      { id: "neighbour", pos: 1 },
      { id: "other", pos: 2 },
    ];
    const unpinned = resolveCascade(natural, items, null);
    const withDeadPin = resolveCascade(natural, items, {
      id: KEY,
      offset: 999,
    });
    expect([...withDeadPin.entries()]).toEqual([...unpinned.entries()]);
  });
});
