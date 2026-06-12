// Pins for the float sizing policy — most importantly `liftSpawnRect`,
// the ONE formula behind pop-out continuity (Session-17 #20): a card
// popped via grab-lift keeps its shape and position; the only allowed
// change is a collapsed card expanding (capped by `capPopoutHeight`).
//
// The chrome-delta numbers under test (see float-policy.ts for the
// style sources):
//   docked chrome above body = 1 (card border) + 24 (header) + 1 (separator) = 26
//   float  chrome above body = 1 (window border) + 24 (FloatChrome)          = 25
//   bottom borders cancel (1px each side) → y = top + 1, height = height − 1,
//   x/width unchanged (the 1px side borders cancel exactly).

import { describe, it, expect } from "vitest";
import {
  CARD_FLOAT_BORDER,
  CARD_FLOAT_HEADER_H,
  DOCKED_CARD_BORDER,
  DOCKED_CARD_HEADER_H,
  DOCKED_CARD_SEPARATOR_H,
  POPOUT_MAX_VH,
  capPopoutHeight,
  liftSpawnRect,
} from "../float-policy";

const DOCKED_TOP =
  DOCKED_CARD_BORDER + DOCKED_CARD_HEADER_H + DOCKED_CARD_SEPARATOR_H;
const FLOAT_TOP = CARD_FLOAT_BORDER + CARD_FLOAT_HEADER_H;

describe("liftSpawnRect — pop-out continuity formula", () => {
  const source = { left: 120, top: 340, width: 296, height: 188 };

  it("preserves the horizontal position and width exactly", () => {
    const r = liftSpawnRect(source);
    expect(r.x).toBe(120);
    expect(r.width).toBe(296);
  });

  it("compensates the vertical chrome delta (y +1, height −1)", () => {
    const r = liftSpawnRect(source);
    // The derivation, not the magic number: docked 26 vs float 25.
    expect(DOCKED_TOP - FLOAT_TOP).toBe(1);
    expect(r.y).toBe(340 + (DOCKED_TOP - FLOAT_TOP));
    expect(r.height).toBe(188 - (DOCKED_TOP - FLOAT_TOP));
  });

  it("keeps the body box identical between docked card and float", () => {
    const r = liftSpawnRect(source);
    // Docked body top/bottom edges…
    const dockedBodyTop = source.top + DOCKED_TOP;
    const dockedBodyBottom = source.top + source.height - DOCKED_CARD_BORDER;
    // …must equal the float's body edges.
    expect(r.y + FLOAT_TOP).toBe(dockedBodyTop);
    expect(r.y + r.height - CARD_FLOAT_BORDER).toBe(dockedBodyBottom);
    // And horizontally: both boxes inset the body by their 1px border.
    expect(r.x + CARD_FLOAT_BORDER).toBe(source.left + DOCKED_CARD_BORDER);
    expect(r.x + r.width - CARD_FLOAT_BORDER).toBe(
      source.left + source.width - DOCKED_CARD_BORDER,
    );
  });

  it("rounds fractional getBoundingClientRect values to whole pixels", () => {
    const r = liftSpawnRect({ left: 10.4, top: 20.6, width: 300.5, height: 150.2 });
    expect(r).toEqual({ x: 10, y: 22, width: 301, height: 149 });
  });

  it("expanded lift is uncapped — exact source size wins (ratified)", () => {
    // A docked card taller than the 55vh cap still pops at its own height.
    const tall = liftSpawnRect({ left: 0, top: 0, width: 300, height: 900 });
    expect(tall.height).toBe(899);
  });
});

describe("collapsed-lift grow target (capPopoutHeight branch)", () => {
  it("caps tall content at POPOUT_MAX_VH of the viewport", () => {
    expect(POPOUT_MAX_VH).toBe(0.55);
    expect(capPopoutHeight(2000, 1000)).toBe(550);
  });

  it("leaves short content at its natural height (a max, not a floor)", () => {
    expect(capPopoutHeight(180, 1000)).toBe(180);
  });

  it("floors the cap (no fractional pixel heights)", () => {
    expect(capPopoutHeight(2000, 901)).toBe(Math.floor(901 * 0.55));
  });
});
