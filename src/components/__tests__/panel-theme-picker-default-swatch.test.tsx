// @vitest-environment jsdom
//
// Task 494 — every shipped default is a swatch the picker can mark ACTIVE.
//
// `PanelThemePicker` marks a swatch active by exact-hex equality against the
// panel's CURRENT colour (`PresetSwatch active={…}`), and `pick()` short-circuits
// a click on the panel's own default back to `clearPanelColor`. Both are
// silently inert for a default the grid does not contain. Measured at HEAD,
// `PRESET_COLORS` was missing THREE shipped defaults — `highlight` (#fbbf24),
// `todo` (#44403c), `example` (#0d9488) — so opening those three pickers at
// their own colour showed fourteen swatches with none marked active, and (the
// reset row being gated on `isOverridden`, which is false at the default) the
// popover said nothing anywhere about what the current colour was.
//
// The sweep drives the REAL component, per Verify: the active ring is a
// className decision, so a leg reading only the exported grid would pass on a
// picker that renders the grid wrong.
//
// The DEFECT leg reimplements the RETIRED rule locally (the curated list alone)
// rather than re-parameterising the live one, so it fails for the reason it
// names instead of by arithmetic identity — and it is what proves the sweep is
// not vacuous.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act, screen } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({}));

import PanelThemePicker from "@/components/PanelThemePicker";
import {
  clearPanelColor,
  DEFAULT_PANEL_COLORS,
  getPanelColor,
  isPanelColorOverridden,
  PICKER_SWATCHES,
  PRESET_COLORS,
  setPanelColor,
  SYSTEM_THEME_KEYS,
  type PanelThemeKey,
} from "@/lib/panel-theme";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});
beforeEach(() => {
  localStorage.clear();
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const OVERRIDABLE = (Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]).filter(
  (k) => !SYSTEM_THEME_KEYS.has(k),
);

/** Swatch name → hex, off the live grid — never a restated list. */
const HEX_BY_NAME = new Map(
  PICKER_SWATCHES.map((c) => [c.name, c.hex.toLowerCase()] as const),
);

/** The swatch buttons of the OPEN picker, in grid order. The reset row shares
 *  `role="menuitem"`, so membership is decided by the grid's own labels. */
function swatches(): HTMLElement[] {
  const surface = document.body.querySelector('[role="menu"]') as HTMLElement | null;
  if (!surface) return [];
  return (
    Array.from(surface.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
  ).filter((el) => HEX_BY_NAME.has(el.getAttribute("aria-label") ?? ""));
}

const hexOf = (el: HTMLElement) =>
  HEX_BY_NAME.get(el.getAttribute("aria-label") ?? "") ?? null;

/** A swatch is ACTIVE when it wears the selected ring (`ring-2 ring-stone-500`),
 *  which is the only signal the popover gives at a non-overridden default. */
const isActive = (el: HTMLElement) =>
  el.className.includes("ring-2") && el.className.includes("ring-stone-500");

async function openPickerFor(key: PanelThemeKey) {
  render(<PanelThemePicker panelKey={key} label={`${key} color`} />);
  fireEvent.click(screen.getByLabelText(`${key} color`));
  await settle();
}

describe("task 494 — the picker marks an active swatch at every shipped default", () => {
  it("sweeps every user-overridable default and finds exactly one active swatch", async () => {
    expect(OVERRIDABLE.length).toBeGreaterThanOrEqual(11);
    for (const key of OVERRIDABLE) {
      await openPickerFor(key);
      const grid = swatches();
      expect(grid.length, `no swatches rendered for "${key}"`).toBeGreaterThan(0);
      const active = grid.filter(isActive);
      expect(
        active.length,
        `panel "${key}" at its shipped default ${DEFAULT_PANEL_COLORS[key]} → ` +
          `${active.length} active swatches (want exactly 1)`,
      ).toBe(1);
      // …and it is the swatch carrying that panel's own hex.
      expect(hexOf(active[0])).toBe(DEFAULT_PANEL_COLORS[key].toLowerCase());
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("DEFECT: the retired curated-list-only grid misses three of them", () => {
    // The pre-494 rule, restated locally. If this ever finds zero misses the
    // sweep above has stopped being able to fail, and this leg says so.
    const curated = new Set(PRESET_COLORS.map((c) => c.hex.toLowerCase()));
    const missed = OVERRIDABLE.filter(
      (k) => !curated.has(DEFAULT_PANEL_COLORS[k].toLowerCase()),
    );
    expect(missed.sort()).toEqual(["example", "highlight", "todo"]);
  });

  it("the grid is DERIVED — curated list, then the defaults it does not carry", () => {
    // Prefix identity keeps the keyboard-grid coords pinned by
    // `panel-chrome-menu-ssot.test.tsx` (which addresses PRESET_COLORS[0], [1],
    // [1+7]) meaningful, and keeps the appended-not-interleaved decision honest.
    expect(PICKER_SWATCHES.slice(0, PRESET_COLORS.length)).toEqual(PRESET_COLORS);
    const hexes = PICKER_SWATCHES.map((c) => c.hex.toLowerCase());
    expect(new Set(hexes).size, "duplicate hex in the grid").toBe(hexes.length);
    for (const key of OVERRIDABLE) {
      expect(hexes).toContain(DEFAULT_PANEL_COLORS[key].toLowerCase());
    }
    // Every derived member is a shipped default — the grid may not grow a
    // literal by any other route.
    const shipped = new Set(
      OVERRIDABLE.map((k) => DEFAULT_PANEL_COLORS[k].toLowerCase()),
    );
    for (const c of PICKER_SWATCHES.slice(PRESET_COLORS.length)) {
      expect(shipped.has(c.hex.toLowerCase())).toBe(true);
    }
    // No system accent adds a swatch of its own. Stated as a property of the
    // TAIL rather than as an absence, because absence is not observable today:
    // `aiRequest` (#0ea5e9) is the curated "Sky" and `error` (#b45757) the
    // curated "Rust", so both hexes are legitimately in the grid for reasons
    // that have nothing to do with the system keys.
    const tail = PICKER_SWATCHES.slice(PRESET_COLORS.length).map((c) =>
      c.hex.toLowerCase(),
    );
    expect(tail.length).toBe(new Set(tail).size);
    expect(tail.every((h) => shipped.has(h))).toBe(true);
  });

  it("clicking the default swatch CLEARS the override — the pick() short-circuit", async () => {
    // Unreachable from the grid pre-494 for exactly the three missing defaults:
    // the only way back to the default was the reset row.
    setPanelColor("highlight", "#3b82f6");
    expect(isPanelColorOverridden("highlight")).toBe(true);

    await openPickerFor("highlight");
    const own = PICKER_SWATCHES.find(
      (c) => c.hex.toLowerCase() === DEFAULT_PANEL_COLORS.highlight.toLowerCase(),
    )!;
    fireEvent.click(screen.getByLabelText(own.name));
    await settle();

    expect(isPanelColorOverridden("highlight")).toBe(false);
    expect(getPanelColor("highlight").toLowerCase()).toBe(
      DEFAULT_PANEL_COLORS.highlight.toLowerCase(),
    );
    clearPanelColor("highlight");
  });

  it("CONTROL: a panel whose default was already curated still marks one swatch", async () => {
    // `note` (#15803d = "Green") passed before this task and must still pass —
    // so a green sweep can't be the fix turning everything on.
    await openPickerFor("note");
    expect(swatches().filter(isActive)).toHaveLength(1);
  });

  it("CONTROL: an OVERRIDDEN panel marks the override, not its default", async () => {
    setPanelColor("todo", PRESET_COLORS[0].hex);
    await openPickerFor("todo");
    const active = swatches().filter(isActive);
    expect(active).toHaveLength(1);
    expect(hexOf(active[0])).toBe(PRESET_COLORS[0].hex.toLowerCase());
    clearPanelColor("todo");
  });
});

/**
 * The fourth table in the same class, and the cheapest of the four to close.
 *
 * `COLLAB_COLORS` (`src/lib/collab.ts`) is six hand-written hexes under a
 * comment DECLARING them "a curated subset of PRESET_COLORS". Measured at HEAD
 * the claim is true — and it was held by nothing, which is the same shape as
 * the three members of task 494 and the shape this repo keeps re-learning: a
 * stated invariant with no consumer is not an invariant.
 *
 * Deliberately NOT derived. Which six accents read as distinguishable
 * collaborator identities is a design judgement, not a fact about the palette,
 * so the honest treatment is a pin on the relation the comment already claims —
 * not a rule that would let a palette edit silently re-choose the collaborator
 * colours out from under it.
 */
describe("task 494 — COLLAB_COLORS is pinned to the claim its comment makes", () => {
  it("is a genuine subset of the curated palette, name AND hex", async () => {
    const { COLLAB_COLORS } = await import("@/lib/collab");
    const curated = new Map(
      PRESET_COLORS.map((c) => [c.hex.toLowerCase(), c.name] as const),
    );
    expect(COLLAB_COLORS.length).toBeGreaterThanOrEqual(4);
    for (const c of COLLAB_COLORS) {
      const name = curated.get(c.hex.toLowerCase());
      expect(name, `collab color "${c.name}" ${c.hex} is not in PRESET_COLORS`).toBeDefined();
      expect(name).toBe(c.name);
    }
  });
});
