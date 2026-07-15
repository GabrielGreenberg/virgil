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
  DRAGGABLE_DIALOG_Z,
  DROP_INDICATOR_Z,
  FLOAT_Z_BASE,
  FLOAT_Z_MAX,
  FLOATING_PANEL_Z_BASE,
  HINT_Z,
  MODAL_SCRIM_Z,
  OPEN_CHROME_MENU_Z,
  POPOUT_MAX_VH,
  RESTING_MARGIN_TRIGGER_Z,
  capPopoutHeight,
  cardFloatZ,
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

  it("places a draggable tool window just above floats but below open menus (task 033)", () => {
    // A scrimless SystemDialog variant="draggable" (Preferences window) rides the
    // float band, above popped cards yet below a chrome menu opened from inside it
    // — and far below the modal tier. Derived from FLOAT_Z_MAX, not a magic number.
    expect(DRAGGABLE_DIALOG_Z).toBeGreaterThan(FLOAT_Z_BASE);
    expect(DRAGGABLE_DIALOG_Z).toBeLessThan(OPEN_CHROME_MENU_Z);
    expect(DRAGGABLE_DIALOG_Z).toBeLessThan(MODAL_SCRIM_Z);
    // One tier above the BOUNDED float band — the derivation, not the literal.
    expect(DRAGGABLE_DIALOG_Z).toBe(FLOAT_Z_MAX + 1);
    // …and the task-033 value is unchanged (1205) by the task-137 re-derivation.
    expect(DRAGGABLE_DIALOG_Z).toBe(FLOAT_Z_BASE + 5);
  });

  it("keeps the resting trigger above the docked-panel band (still clickable)", () => {
    // When nothing overlaps, the bolt must out-stack docked panels so it stays
    // visible + clickable.
    expect(RESTING_MARGIN_TRIGGER_Z).toBeGreaterThan(FLOATING_PANEL_Z_BASE);
  });
});

// Task 137 — the card-float band is BOUNDED. `cardFloatZ` saturates the MRU
// raise-on-click offset at FLOAT_Z_MAX so a frontmost card can never climb over
// the draggable-dialog tier (Preferences), however many cards are popped. This
// pins the ceiling the old unbounded `FLOAT_Z_BASE + idx` silently drifted past.
describe("card-float band ceiling (task 137: bounded MRU band)", () => {
  it("keeps every attainable card z strictly below the draggable dialog tier", () => {
    // The core invariant: no offset, however large, can reach Preferences.
    for (const offset of [0, 1, 4, 5, 6, 7, 20, 1000]) {
      expect(cardFloatZ(offset)).toBeLessThan(DRAGGABLE_DIALOG_Z);
    }
    // The band ceiling itself sits below the dialog tier, by construction.
    expect(FLOAT_Z_MAX).toBeLessThan(DRAGGABLE_DIALOG_Z);
    expect(DRAGGABLE_DIALOG_Z).toBe(FLOAT_Z_MAX + 1);
  });

  it("preserves MRU ordering below the ceiling", () => {
    expect(cardFloatZ(0)).toBe(FLOAT_Z_BASE);
    expect(cardFloatZ(3)).toBe(FLOAT_Z_BASE + 3);
    expect(cardFloatZ(4)).toBe(FLOAT_Z_MAX);
    // Strictly increasing up to the cap so a raised card out-stacks a buried one.
    expect(cardFloatZ(2)).toBeGreaterThan(cardFloatZ(1));
  });

  it("saturates at FLOAT_Z_MAX past the ceiling (the 6-7-card overrun is gone)", () => {
    // Six popped cards → frontmost offset 6 used to reach 1206 > 1205; now clamps.
    expect(cardFloatZ(5)).toBe(FLOAT_Z_MAX);
    expect(cardFloatZ(6)).toBe(FLOAT_Z_MAX);
    expect(cardFloatZ(1000)).toBe(FLOAT_Z_MAX);
  });

  it("floors a negative/absent offset at the band base (never below)", () => {
    expect(cardFloatZ(-1)).toBe(FLOAT_Z_BASE);
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

// Task 032 — the modal / tooltip z-scale (the top of the ladder). These pin the
// ordering (open menu < drop indicator < modal scrim < hint) and the exact
// values so the three formerly-bare literals can never drift apart or re-cross.
describe("modal / tooltip stacking tiers (task 032)", () => {
  it("orders open-menu < drop-indicator < modal-scrim < hint", () => {
    expect(OPEN_CHROME_MENU_Z).toBeLessThan(DROP_INDICATOR_Z);
    expect(DROP_INDICATOR_Z).toBeLessThan(MODAL_SCRIM_Z);
    expect(MODAL_SCRIM_Z).toBeLessThan(HINT_Z);
  });

  it("pins the exact tier values (the SSOT the CSS mirror + inline styles read)", () => {
    expect(DROP_INDICATOR_Z).toBe(9999);
    expect(MODAL_SCRIM_Z).toBe(10000);
    expect(HINT_Z).toBe(10010);
  });

  it("keeps a modal strictly above an in-flight drop indicator", () => {
    // A drop bar left painting during a gesture must never pierce an open modal.
    expect(MODAL_SCRIM_Z).toBeGreaterThan(DROP_INDICATOR_Z);
  });

  it("keeps a hint bubble above the modal tier so hints on modal controls show", () => {
    expect(HINT_Z).toBeGreaterThan(MODAL_SCRIM_Z);
  });
});

// Consumer-wiring pins for the task-032 tiers — the named constant is read at
// each site, never a resurrected bare literal. Source-text asserts in the
// spirit of the BUG #50 wiring pins above.
describe("task 032 consumer wiring", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SRC = path.resolve(HERE, "../.."); // src/

  it("SystemDialog's scrim reads MODAL_SCRIM_Z, not a bare z-[10000]", () => {
    const src = readFileSync(
      path.join(SRC, "components/system-dialog.tsx"),
      "utf8",
    );
    expect(src).toContain("MODAL_SCRIM_Z");
    expect(src).toContain('from "@/floats/float-policy"');
    expect(src).not.toContain("z-[10000]");
  });

  it("the drop-mode indicator reads DROP_INDICATOR_Z, not a bare 9999", () => {
    const src = readFileSync(
      path.join(SRC, "components/drop-mode/Indicator.tsx"),
      "utf8",
    );
    expect(src).toContain("DROP_INDICATOR_Z");
    expect(src).toContain('from "@/floats/float-policy"');
    expect(src).not.toContain("zIndex: 9999");
  });

  it("the .hint-bubble CSS literal still mirrors HINT_Z (CSS can't import TS)", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    // The SSOT is HINT_Z; the CSS rule mirrors its value. If HINT_Z moves, this
    // fails until the mirror is updated.
    expect(css).toContain(`z-index: ${HINT_Z}`);
  });
});

// Task 137 consumer wiring — BOTH card-float z sites route through the bounded
// `cardFloatZ` helper, so no site can reintroduce the raw unbounded
// `FLOAT_Z_BASE + offset` that overran the dialog tier. Source-text asserts in
// the spirit of the BUG #50 / task-032 wiring pins above.
describe("task 137 consumer wiring (bounded card-float band)", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SRC = path.resolve(HERE, "../.."); // src/

  it("EditorLayout's cardFloatZIndex derives from cardFloatZ, not FLOAT_Z_BASE + idx", () => {
    const src = readFileSync(
      path.join(SRC, "components/EditorLayout.tsx"),
      "utf8",
    );
    expect(src).toContain("cardFloatZ(");
    // The old unbounded form must be gone.
    expect(src).not.toContain("FLOAT_Z_BASE +");
  });

  it("FloatWindow's floatZIndex fallback derives from cardFloatZ, not FLOAT_Z_BASE + indexHint", () => {
    const src = readFileSync(path.join(SRC, "floats/FloatWindow.tsx"), "utf8");
    expect(src).toContain("cardFloatZ(indexHint)");
    expect(src).not.toContain("FLOAT_Z_BASE + indexHint");
  });
});
