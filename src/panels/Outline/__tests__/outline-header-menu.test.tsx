// @vitest-environment jsdom
//
// OutlinePanel's view-options kebab — the fold onto the shared `ItemMenu`
// (task 180).
//
// Before the fold this was the last hand-rolled panel-header dropdown: an
// `absolute left-0 top-full … z-30` div laid out INSIDE `Panel`'s
// `overflow-hidden` wrapper. Two consequences, both pinned below:
//   - at the `MIN_BAND_PX` (140) docked band height the menu is ~180px tall, so
//     its last rows rendered OUTSIDE the clip and were unreachable. jsdom can't
//     measure that (no layout), so the durable proxy is the STRUCTURAL fact the
//     clip followed from: the dropdown must not be a descendant of the panel
//     wrapper at all — it is body-portaled. A real-geometry eyeball is owed.
//   - `z-30` sat off the z-ladder, under the float layer (1200) at every band
//     height; the portal rides `OPEN_CHROME_MENU_Z` (2000).
//
// Contracts pinned:
//   1. the trigger is a real menu button (`aria-haspopup` / `aria-expanded`);
//   2. opening portals the dropdown to document.body, NOT into the panel
//      subtree (the clip fix, structurally);
//   3. it carries the chrome-menu z tier, not the old z-30;
//   4. the five rows keep their labels + order, and carry menu-checkbox roles
//      with `aria-checked` mirroring the pref (the old ✓ was a bare span);
//   5. each row still toggles its own `useViewPrefs`-adjacent outline pref —
//      and the menu STAYS OPEN across a run of toggles (the old dropdown did);
//   6. Escape closes it (the hand-rolled copy had no keyboard at all).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

// panel-primitives pulls the storage barrel transitively; stub it so the heavy
// FSA/dev backend graph doesn't load under vitest (the documented
// `@/lib/storage-fsa` resolution failure).
vi.mock("@/lib/storage", () => ({}));

// jsdom has no ResizeObserver; OutlinePanel's own scroll-overflow measure needs
// one to mount. Inert stub — this test asserts menu structure, not geometry.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

import OutlinePanel from "../OutlinePanel";
import { getOutlinePrefsSnapshot, setOutlinePrefs } from "../outline-prefs-store";

// DELIBERATELY ASYMMETRIC, not the product defaults (which have four of these
// five `true`). Each row must be distinguishable from every other by its
// `aria-checked` alone, or a swapped `checked={…}` prop — the exact slip five
// hand-wired near-identical blocks invite — would be invisible here.
const DEFAULT_PREFS = {
  showLabels: true,
  showTitles: false,
  showWordCount: true,
  showPosition: false,
  showNumbers: true,
} as const;

/** The five rows, in render order, with the pref key each one drives. */
const ROWS = [
  { label: "Show section numbers", key: "showNumbers" },
  { label: "Show labels", key: "showLabels" },
  { label: "Show par. titles", key: "showTitles" },
  { label: "Show word count", key: "showWordCount" },
  { label: "Show current position", key: "showPosition" },
] as const;

const CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, uuid: "aaaa" }, content: [{ type: "text", text: "One" }] },
    { type: "paragraph", attrs: { uuid: "bbbb" }, content: [{ type: "text", text: "Body text here." }] },
  ],
};

function renderPanel() {
  return render(<OutlinePanel content={CONTENT} onScrollTo={() => {}} />);
}

const trigger = (c: HTMLElement) =>
  c.querySelector('[aria-haspopup="menu"]') as HTMLElement;
const menu = () => document.body.querySelector('[role="menu"]');
const rows = () =>
  Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
  );
const rowFor = (label: string) =>
  rows().find((r) => r.textContent?.includes(label)) as HTMLElement;

beforeEach(() => {
  setOutlinePrefs({ ...DEFAULT_PREFS });
});
afterEach(() => cleanup());

describe("OutlinePanel view-options kebab — ItemMenu fold (task 180)", () => {
  it("the trigger is a real menu button and starts closed", () => {
    const { container } = renderPanel();
    const btn = trigger(container);
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();
    // The kebab keeps its own tooltip through the fold (ItemMenu's default is
    // the generic "Options"; Outline overrides it via `hint`).
    expect(btn.getAttribute("data-hint")).toBe("View options");
  });

  it("body-portals the dropdown at the chrome-menu tier (escapes Panel's overflow-hidden)", () => {
    const { container } = renderPanel();
    fireEvent.click(trigger(container));

    const open = menu();
    expect(open).toBeTruthy();
    // The clip fix, structurally: NOT a descendant of the rendered panel.
    expect(container.contains(open)).toBe(false);
    expect(open?.parentElement).toBe(document.body);
    // …and on the ladder, not the old off-ladder z-30.
    const z = Number(
      (open as HTMLElement).style.zIndex ||
        (open?.parentElement as HTMLElement | null)?.style.zIndex ||
        0,
    );
    expect(z).toBeGreaterThanOrEqual(2000);
    expect(trigger(container).getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the five rows, their order, and their checked state as menu checkboxes", () => {
    const { container } = renderPanel();
    fireEvent.click(trigger(container));

    expect(rows().map((r) => r.textContent?.replace("✓", "").trim())).toEqual(
      ROWS.map((r) => r.label),
    );
    for (const { label, key } of ROWS) {
      expect(rowFor(label).getAttribute("aria-checked")).toBe(
        String(DEFAULT_PREFS[key]),
      );
    }
  });

  it("each row toggles its own pref, and the menu survives a run of toggles", () => {
    const { container } = renderPanel();
    fireEvent.click(trigger(container));

    for (const { label, key } of ROWS) {
      const before = getOutlinePrefsSnapshot()[key];
      fireEvent.click(rowFor(label));
      expect(getOutlinePrefsSnapshot()[key]).toBe(!before);
      // …and the ROW re-renders to match. Pins display↔state coherence: the
      // pref moving is not enough if the row reads some other pref's value.
      expect(rowFor(label).getAttribute("aria-checked")).toBe(String(!before));
      // No other pref moved with it (guards a rewiring slip).
      for (const other of ROWS) {
        if (other.key === key) continue;
        expect(getOutlinePrefsSnapshot()[other.key]).toBe(
          DEFAULT_PREFS[other.key],
        );
      }
      // Still open — five independent checkboxes, flipped in a run.
      expect(menu()).toBeTruthy();
      // Put it back so the next row starts from the documented defaults.
      fireEvent.click(rowFor(label));
      expect(getOutlinePrefsSnapshot()[key]).toBe(before);
    }
  });

  it("Escape closes it (the hand-rolled dropdown had no keyboard)", () => {
    const { container } = renderPanel();
    fireEvent.click(trigger(container));
    expect(menu()).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(menu()).toBeNull();
    expect(trigger(container).getAttribute("aria-expanded")).toBe("false");
  });

  it("an outside mousedown closes it", async () => {
    const { container } = renderPanel();
    fireEvent.click(trigger(container));
    expect(menu()).toBeTruthy();

    // The dismiss listener attaches on a deferred tick.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
  });
});
