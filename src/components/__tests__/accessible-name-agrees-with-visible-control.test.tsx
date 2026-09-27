// @vitest-environment jsdom
//
// Task 424 — ONE law, the half a SOURCE census structurally cannot see.
//
// > A control's accessible name is what the user sees. Where an element shows
// > text, that text IS the name; where it shows only an icon, the name says
// > what pressing it DOES — never what it suppresses.
//
// `icon-button-a11y-guardrail`'s leg D censuses the static shape (a `<button>`
// with a literal visible word must not carry an `aria-label`). It is blind to
// two shapes that are live in this app, and both are pinned here by RENDER:
//
//   1. **A computed label.** The omni bin pills render `{count} unanchored`
//      through a shared primitive, so the text AND the label were identifiers
//      — nothing a grep can compare. The pills carried
//      `aria-label={expanded ? "Collapse …" : "Show …"}`, and an `aria-label`
//      REPLACES the subtree in the name computation, so the COUNT — the
//      pill's only variable information — was never announced. WCAG 2.5.3
//      *Label in Name*: a voice-control user saying "click 3 unanchored" did
//      not reach it. `aria-expanded` already carried the state the label was
//      trying to say, so the label was doing damage in exchange for nothing.
//
//   2. **A name/polarity question.** The strip's blank-gutter toggle was
//      `iconHint({ label: "Omni view" })` — named for the surface it
//      SUPPRESSES, so a screen-reader user heard "Omni view, toggle button,
//      pressed" at exactly the moment the omni view was empty. The fix set a
//      contract: a toggle's NAME is stable, `aria-pressed` is the state
//      channel, and only the sighted tooltip flips. That toggle was retired
//      with omni-hide (task 807); the contract lives on in the figure-number
//      (and heading-number) `#` toggles, so member 3 now pins it there. A
//      general "aria-pressed polarity matches the label" census is not
//      automatable (it requires reading intent), so this is honestly a
//      PER-SITE pin, and says so.
//
// Measured (task 424) by neutering each half in turn: restoring the pills'
// `aria-label` fails 3 legs.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { OmniUnanchoredBin, OmniOutsideFocusBin } from "@/panels/Omni/OmniViewPanel";
import FigureAnnotation from "@/components/FigureAnnotation";
import type { OmniItem } from "@/panels/_shared/types";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const item = (state: OmniItem["anchorState"], n: number): OmniItem => ({
  id: `float:card:note:${state}-${n}`,
  pos: null,
  anchorState: state,
  content: createElement("div", null, state),
});

/**
 * The accessible name of a `<button>`, computed the way a screen reader does
 * for the shapes in play here: an `aria-label` REPLACES the subtree; otherwise
 * the name is the subtree's text with every `aria-hidden` element removed.
 *
 * Written out rather than taken from a library, so the leg states the RULE it
 * is testing — `textContent` alone would pass on the very defect (it never
 * sees the `aria-label` that overrides it).
 */
function accessibleName(btn: HTMLElement): string {
  const label = btn.getAttribute("aria-label");
  if (label !== null) return label.trim();
  return visibleLabel(btn);
}

/** The text a sighted user reads on the control: its subtree with every
 *  `aria-hidden` element (and their descendants) removed. */
function visibleLabel(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const hidden of Array.from(clone.querySelectorAll('[aria-hidden="true"], [aria-hidden=""]'))) {
    hidden.remove();
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

const pills = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("button.omni-bin-pill"));

describe("member 1 — an omni bin pill announces its own text, count included", () => {
  it("names every pill by its visible text, and the count is IN the name", () => {
    const { container } = render(
      createElement(
        "div",
        null,
        createElement(OmniUnanchoredBin, {
          free: [item("free", 1), item("free", 2)],
          orphaned: [item("orphaned", 1), item("orphaned", 2), item("orphaned", 3)],
        }),
        createElement(OmniOutsideFocusBin, { items: [item("free", 9)] }),
      ),
    );
    const found = pills(container);
    // RENEGOTIATED (task 544): the no-anchor bin is ONE pill counting both
    // states ("N unanchored"); the free/orphaned distinction moved to the
    // rows. Two pills, and each still names itself by its visible text.
    expect(found).toHaveLength(2);
    const names = found.map(accessibleName);
    expect(names).toEqual(["5 unanchored", "1 outside focus"]);
    // …and each name CONTAINS the pill's own visible label, so a voice-control
    // user reading the pill aloud reaches it (WCAG 2.5.3). Tautological only
    // while no `aria-label` is present — which is the whole contract: with the
    // pre-424 label restored, `accessibleName` returns "Show unanchored cards"
    // and contains none of the three.
    for (const btn of found) {
      const label = visibleLabel(btn);
      expect(label).toMatch(/^\d+ \w/);
      expect(accessibleName(btn)).toContain(label);
    }
  });

  it("carries the collapse state on aria-expanded, not in the name", () => {
    const { container } = render(
      createElement(OmniOutsideFocusBin, { items: [item("free", 1), item("free", 2)] }),
    );
    const btn = pills(container)[0]!;
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(accessibleName(btn)).toBe("2 outside focus");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    // The name does NOT change with the state: expanding a disclosure does not
    // rename it, and the count is still the thing announced.
    expect(accessibleName(btn)).toBe("2 outside focus");
  });

  it("explains itself through data-hint, which is not a name", () => {
    const { container } = render(
      createElement(OmniUnanchoredBin, { free: [], orphaned: [item("orphaned", 1)] }),
    );
    const btn = pills(container)[0]!;
    // (task 544: the merged pill's hint names both ways a card ends up here.)
    expect(btn.getAttribute("data-hint")).toMatch(/no place in the text/);
    expect(btn.hasAttribute("aria-label")).toBe(false);
  });
});

describe("member 3 — the figure-number toggle's name is stable; the tooltip flips", () => {
  // A PER-SITE pin, deliberately: whether a toggle's name agrees with its
  // `aria-pressed` polarity requires reading intent, so no census can ask it.
  // (Re-homed from the retired omni blank-gutter toggle, task 807.)
  const toggleOf = (numbered: boolean) => {
    const { container } = render(
      createElement(FigureAnnotation, { label: "fig:a", numbered }),
    );
    return container.querySelector<HTMLButtonElement>(
      "button.figure-annotation-numbered-toggle",
    )!;
  };

  for (const numbered of [false, true]) {
    it(`names the CONTROL, not its state (numbered=${numbered})`, () => {
      const btn = toggleOf(numbered);
      const name = accessibleName(btn);
      expect(name).toBe("Figure number");
      // `aria-pressed` is the state channel; the name is stable across it, so
      // the two cannot double-announce or contradict each other.
      expect(btn.getAttribute("aria-pressed")).toBe(String(numbered));
      // The sighted user's tooltip DOES flip — it has no state channel of its
      // own — and always says what pressing it does.
      const hint = btn.getAttribute("data-hint") ?? "";
      expect(hint.toLowerCase()).toMatch(numbered ? /hide/ : /show/);
    });
  }

  it("keeps one stable name across the toggle", () => {
    const nameOff = accessibleName(toggleOf(false));
    cleanup();
    const nameOn = accessibleName(toggleOf(true));
    expect(nameOn).toBe(nameOff);
  });
});
