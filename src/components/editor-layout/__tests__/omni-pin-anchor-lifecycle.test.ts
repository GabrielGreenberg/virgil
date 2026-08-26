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
//
// ── Which leg covers which half, stated because it is not obvious ─────────
// The fix has TWO halves and no single leg sees both:
//   • the CASCADE half (re-derive `naturalTop + offset` each pass) is what
//     the gap-invariance legs below catch;
//   • the DOOR half (STORE the offset rather than the absolute Y) is caught
//     only by "the offset is the gesture's durable half" and by the doors
//     suite — neuter the door alone and the gap legs still pass, because an
//     absolute Y re-added to a natural top still translates 1:1.
// And `markerY` is deliberately honest rather than impressive: it is a real
// call into the real `computeMarkerPositions`, but `cellAt` reduces at row 0
// to `node.top + const`, so its DISCRIMINATING power is limited to "the
// marker side gained a stored Y / stopped tracking `AnchorNodeMetrics.top`".
// That is worth pinning — it is the half of this class the marker renderer
// could regress into — but it is not what makes the gap legs fail.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "@/lib/__tests__/_source-scan";
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

/** The RETIRED rule, reimplemented locally: the pre-362 cascade forced the
 *  pinned row to the STORED number (`rows[i].top = pinned.pinTop`) instead of
 *  re-deriving it from the anchor. Kept here — twenty lines, over the same
 *  deck `cardY` builds — so the defect leg fails on the behaviour it names
 *  rather than on an arithmetic identity of the fixed code. */
function preFixCardY(naturalTop: number, storedAbsoluteTop: number): number {
  const rows = [
    { id: "neighbour", top: 40, height: 80 },
    { id: KEY, top: naturalTop, height: 120 },
  ].sort((a, b) => a.top - b.top);
  const MIN_GAP = 4;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      const prev = rows[i - 1];
      const minTop = prev.top + prev.height + MIN_GAP;
      if (rows[i].top < minTop) rows[i].top = minTop;
    }
    if (rows[i].id === KEY) rows[i].top = storedAbsoluteTop; // ← the defect
  }
  for (let i = rows.length - 1; i > 0; i--) {
    const cur = rows[i];
    const prev = rows[i - 1];
    const maxPrevTop = cur.top - prev.height - MIN_GAP;
    if (prev.top > maxPrevTop) prev.top = maxPrevTop;
  }
  return rows.find((r) => r.id === KEY)!.top;
}

const clearPins = () => {
  omniPinStore.clearPin("left");
  omniPinStore.clearPin("right");
};

beforeEach(clearPins);
afterEach(() => {
  document.body.innerHTML = "";
  clearPins();
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

  // Neuter counts, measured rather than asserted: reverting the CASCADE half
  // alone (read the stored value as absolute) fails this leg's siblings here;
  // reverting the DOOR half alone (store `desiredPodTop`) fails SEVEN legs
  // across this file and `gutter-stability-doors`; reverting BOTH fails EIGHT.
  // The two halves are covered by different legs — see the header.
  it("DEFECT LEG — the retired pod-absolute rule drifts by the full edit distance", () => {
    // `preFixCardY` is a local reimplementation of the RETIRED rule, not a
    // re-parameterisation of the live one: it runs the pre-362 cascade
    // (`rows[i].top = <the stored number>`, verbatim) so the leg can fail
    // for the reason it names rather than by arithmetic identity.
    const absolutePinTop = 140 - POD_TOP;
    const gapBefore = preFixCardY(ANCHOR_0, absolutePinTop) - markerY(ANCHOR_0);
    const gapAfter =
      preFixCardY(ANCHOR_0 + DELTA, absolutePinTop) - markerY(ANCHOR_0 + DELTA);
    expect(Math.abs(gapAfter - gapBefore)).toBeCloseTo(DELTA, 6);
    // …and the card genuinely did not move, which is what Gabriel saw.
    expect(preFixCardY(ANCHOR_0 + DELTA, absolutePinTop)).toBe(
      preFixCardY(ANCHOR_0, absolutePinTop),
    );
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
    //
    // RENEGOTIATED (task 490) — this leg used to run with an EMPTY store,
    // which pinned "a hold ALWAYS writes" as the contract. On a pin-free side
    // nothing can move the pressed card (`resolveCascade`'s forward pass is
    // height-independent; the backward pass is pin-gated), so that write held
    // nothing and instead froze the crowd's CURRENT displacement forever —
    // Gabriel's "archive cards are displacing to the same extent as they would
    // be when open". The freeze is asserted where it is real: with a pin
    // standing, which is the only state in which the card's own top depends on
    // its own height. See `holdIsNeeded` in `omni-card-placement.ts`.
    omniPinStore.requestPin("right", "float:card:note:other", 30);
    const wrapper = scene(760, 600);
    holdOmniCard(wrapper);
    expect(omniPinStore.get("right")!.cardId).toBe(KEY);
    expect(omniPinStore.get("right")!.offset).toBe(160);
    expect(cardY(600, { id: KEY, offset: 160 })).toBe(760);
    // …and one edit later, still 160 below wherever the anchor now is.
    expect(cardY(1000, { id: KEY, offset: 160 })).toBe(1160);
  });
});

describe("the reference may be an ESTIMATE, and the pin rides its correction", () => {
  it("a refined natural moves the pinned card by exactly the correction", () => {
    // Moving an OFF-SCREEN card is the case the necessity rule sanctions, and
    // an off-band card's committed natural is an INTERPOLATION (wave-2b C5),
    // refined to exact on scroll idle. Post-362 the pinned card's absolute Y
    // is re-derived every pass, so it MOVES by the estimation error when the
    // refinement lands — where a pod-absolute pin was immune by construction.
    //
    // Accepted deliberately and pinned here so it is a contract rather than a
    // surprise: the correction moves the card TOWARD its anchor (the offset
    // the user chose, now measured from the truth), and it lands on the next
    // pass because the pin has just brought the card into view.
    const APPROX = 880;
    const EXACT = 900;
    scene(1400, APPROX); // off screen ⇒ sanctioned; natural still estimated
    requestOmniCardPlacement(KEY, { viewportY: 140 });
    const offset = omniPinStore.get("right")!.offset;

    // The pin lands exactly where the gesture asked, against the estimate…
    expect(cardY(APPROX, { id: KEY, offset })).toBe(140 - POD_TOP);
    // …and the refinement moves it by the estimation error, no more.
    expect(cardY(EXACT, { id: KEY, offset })).toBe(140 - POD_TOP + (EXACT - APPROX));
  });
});

describe("the lift clears the pin it actually holds", () => {
  it("the store's identity guard declines a bare key for an `@N` row", () => {
    // Why the fork mattered: a pin stores the WRAPPER's id, and a
    // multi-anchor card's row is `<key>@N`. This pins the MECHANISM only —
    // it was already true before the fix, and the census below is what
    // catches the part that actually misbehaved.
    const rowId = `${KEY}@1`;
    omniPinStore.requestPin("right", rowId, 40);
    omniPinStore.clearPin("right", KEY); // what the lift used to pass
    expect(omniPinStore.get("right")).not.toBeNull();
    omniPinStore.clearPin("right", rowId); // what it passes now
    expect(omniPinStore.get("right")).toBeNull();
  });

  it("CENSUS — the lift gesture clears by the WRAPPER's id, never the bare card key", () => {
    // The store was never the part that could misbehave; the caller was, and
    // `clearPin(side, cardKey)` type-checks perfectly while silently clearing
    // nothing for exactly the rows that need it. No unit test of the store
    // can see that, so the leg with teeth reads the call site's source.
    const src = codeOnly(
      readFileSync(
        path.resolve(__dirname, "../../panel-primitives.tsx"),
        "utf8",
      ),
    );
    const call = /omniPinStore\.clearPin\(([\s\S]{0,160}?)\)/.exec(src);
    expect(call, "the lift's clearPin call must exist").not.toBeNull();
    expect(call![1]).toMatch(/omniEntryWrapper/);
    // …and the pre-fix spelling is gone.
    expect(call![1]).not.toMatch(/^\s*side\s*,\s*cardKey\s*$/);
  });
});

describe("a pin that names no measured card is inert", () => {
  it("does not disturb the deck when the anchor is gone", () => {
    // A deleted anchor drops the card out of the natural map entirely. The
    // pin still sits in the store (nothing clears it but a replacement), and
    // the deck must simply re-pack as if it were not there — never bake an
    // absolute Y for a card that has no anchor to be relative to.
    // The deck OVERLAPS naturally (100 < 40 + 80 + MIN_GAP), so the forward
    // pass has to push and the backward pass has something it could pull.
    // That matters: the only thing the dead pin could still change is
    // whether the backward pass runs at all, and on a deck that already
    // clears, that pass is the identity — so a non-overlapping fixture
    // would hold whether or not the gate exists.
    const natural = new Map<string, NaturalEntry>([
      ["neighbour", { naturalTop: 40, height: 80 }],
      ["other", { naturalTop: 100, height: 90 }],
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
    // Guard against a vacuous pass: the deck really did have packing to do.
    expect(unpinned.get("other")).toBe(40 + 80 + 4);
  });
});
