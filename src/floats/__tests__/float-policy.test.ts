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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CARD_FLOAT_BORDER,
  CARD_FLOAT_HEADER_H,
  DOCKED_CARD_BORDER,
  DOCKED_CARD_HEADER_H,
  DOCKED_CARD_SEPARATOR_H,
  FLOAT_Z_BASE,
  FLOATING_PANEL_Z_BASE,
  OPEN_CHROME_MENU_Z,
  POPOUT_MAX_VH,
  RESTING_MARGIN_TRIGGER_Z,
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

// BUG #50 — the resting margin bolt (SelectionActionsMenu) must sit at TEXT/
// content z-level so a popout dropped over its paragraph OCCLUDES it, while the
// transient menu it opens (ActionsMenuPanel via the <Menu> primitive) stays on
// top of everything. These pins guard the editor stacking tier ORDERING so the
// "resting trigger below floats, open menu above floats" split can't silently
// regress to the old magic `2000` on the resting bolt.
describe("editor stacking tiers (BUG #50: margin bolt below floats)", () => {
  it("orders the tiers panels < resting trigger < float layer < open menu", () => {
    expect(FLOATING_PANEL_Z_BASE).toBeLessThan(RESTING_MARGIN_TRIGGER_Z);
    expect(RESTING_MARGIN_TRIGGER_Z).toBeLessThan(FLOAT_Z_BASE);
    expect(FLOAT_Z_BASE).toBeLessThan(OPEN_CHROME_MENU_Z);
  });

  it("demotes the RESTING margin trigger strictly below the float layer", () => {
    // The core BUG #50 invariant: at rest the bolt must be UNDER floats so a
    // popped card / lifted-text overlay (z = FLOAT_Z_BASE) paints over it.
    expect(RESTING_MARGIN_TRIGGER_Z).toBeLessThan(FLOAT_Z_BASE);
    // Derived, not a magic number — sits exactly one below the float base so it
    // wins over content/panels but loses to every float.
    expect(RESTING_MARGIN_TRIGGER_Z).toBe(FLOAT_Z_BASE - 1);
  });

  it("keeps an OPEN chrome menu above the float layer", () => {
    // The other half of the split: the menu the bolt opens (CHROME_Z in the
    // <Menu> primitive) must still compose on top of floats — never demoted.
    expect(OPEN_CHROME_MENU_Z).toBeGreaterThan(FLOAT_Z_BASE);
  });

  it("keeps the resting trigger above the docked-panel band (still clickable)", () => {
    // When nothing overlaps, the bolt must out-stack docked panels so it stays
    // visible + clickable.
    expect(RESTING_MARGIN_TRIGGER_Z).toBeGreaterThan(FLOATING_PANEL_Z_BASE);
  });
});

// Consumer-wiring pins (no resurrected magic `2000` on the resting bolt; the
// open-menu primitive reads the shared tier symbol). Source-text asserts in the
// spirit of the drag-blocklist SSOT test — cheap, and they fail loudly if a
// future edit re-hardcodes the z-index that caused BUG #50.
describe("BUG #50 consumer wiring", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SRC = path.resolve(HERE, "../.."); // src/

  it("SelectionActionsMenu's resting bolt reads RESTING_MARGIN_TRIGGER_Z, not 2000", () => {
    const src = readFileSync(
      path.join(SRC, "components/SelectionActionsMenu.tsx"),
      "utf8",
    );
    expect(src).toContain("RESTING_MARGIN_TRIGGER_Z");
    expect(src).toContain('from "@/floats/float-policy"');
    // The resting bolt must NOT carry the old above-floats literal.
    expect(src).not.toContain("zIndex: 2000");
  });

  it("the <Menu> primitive's CHROME_Z reads the shared OPEN_CHROME_MENU_Z tier", () => {
    const src = readFileSync(
      path.join(SRC, "components/menu/MenuProvider.tsx"),
      "utf8",
    );
    expect(src).toContain("OPEN_CHROME_MENU_Z");
    expect(src).toContain("const CHROME_Z = OPEN_CHROME_MENU_Z");
  });
});
