// @vitest-environment jsdom
//
// StripButton accessible name (task 2026-07-15-142).
//
// Every icon-only side-rail button used to carry its label ONLY in the custom
// `data-hint` attribute (a CSS-tooltip hook, not an accessible name). Its sole
// child is a titleless inline SVG, so a screen reader announced it as a bare
// "button". This pins the contract: the button computes a non-empty accessible
// name (from `aria-label`, sourced from the same label string), the tooltip
// `data-hint` is preserved, and the decorative icon SVG is `aria-hidden`.
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";

// StripButton shares its module with `useStripHandlers`, which imports the heavy
// `panel-column` chain; StripButton itself never touches it — stub it out.
vi.mock("../panel-column", () => ({ measureOmniGap: () => 0 }));

import { render, cleanup } from "@testing-library/react";
import { StripButton } from "../drag-drop";
import { panelLabel } from "../panel-icons";

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(cleanup);

describe("StripButton accessible name", () => {
  it("exposes the panel label as an accessible name (not just data-hint)", () => {
    const { getByRole } = render(
      <StripButton
        panelId="notes"
        active={false}
        onClick={vi.fn()}
        onMove={vi.fn()}
        side="left"
        stripRef={{ current: null }}
      />,
    );
    // Resolves by accessible name — would throw if the button were nameless.
    const btn = getByRole("button", { name: panelLabel("notes") });
    expect(btn).toBeTruthy();
    // The visual tooltip is still wired to the same string.
    expect(btn.getAttribute("data-hint")).toBe(panelLabel("notes"));
  });

  it("marks the decorative icon SVG aria-hidden so it adds no a11y noise", () => {
    const { getByRole } = render(
      <StripButton
        panelId="footnotes"
        active
        onClick={vi.fn()}
        onMove={vi.fn()}
        side="right"
        stripRef={{ current: null }}
      />,
    );
    const btn = getByRole("button", { name: panelLabel("footnotes") });
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    // The name comes from aria-label; the icon subtree must be hidden.
    const hiddenHost = btn.querySelector('[aria-hidden="true"]');
    expect(hiddenHost).not.toBeNull();
    expect(hiddenHost!.contains(svg)).toBe(true);
  });
});
