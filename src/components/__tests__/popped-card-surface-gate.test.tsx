// @vitest-environment jsdom
//
// Task 1246 — the popped-card window rules are gated on the float's SURFACE.
//
// globals.css's "Popped-card seam" (bug #34) moves a card's hover/selection
// ring onto its WINDOW and suppresses the inner card outline. It was written
// for a single card in its own float (`surface="card"`), but it only checked
// `[data-panel-shell-mode="floating"]` — and a whole panel floated from the
// strip is the same FloatingPanel root in floating mode, with the same
// view-pref projection and the same reconciler-stamped
// `data-contains-active-card`. So hovering one note in a floated Notes panel
// rang the whole window and dropped its `--shadow-float` to the card rung.
//
// The fix: FloatingPanel STATES its surface (`data-float-surface`), and every
// popped-context selector requires `="card"`. This suite pins both halves —
// derived from the stylesheet (every selector in the seam, not a hand list),
// and exercised with `Element.matches` against a real rendered root.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import FloatingPanel from "@/components/FloatingPanel";

afterEach(() => cleanup());

const css = fs
  .readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Every selector (comma-split) that names the float root together with an
 *  active-card fact — the window ring and the inner-outline suppression. */
const poppedSelectors = [...css.matchAll(/([^{}]+)\{/g)]
  .flatMap((m) => m[1].split(","))
  .map((s) => s.trim())
  .filter(
    (s) =>
      s.includes("[data-floating-panel]") &&
      (s.includes("data-contains-active-card") || s.includes("[data-card-key]")),
  );

function Float({ surface }: { surface: "panel" | "card" }) {
  return (
    <FloatingPanel
      cardKey={surface === "card" ? "note:n1" : "panel:notes"}
      mode="floating"
      surface={surface}
      initialX={100}
      initialY={100}
      initialWidth={300}
      initialHeight={200}
      zIndex={1000}
      onChange={vi.fn()}
    >
      <div data-card-key="note:n1" data-card-hovered="true" data-card-selected="true">
        card
      </div>
    </FloatingPanel>
  );
}

function mount(surface: "panel" | "card") {
  render(<Float surface={surface} />);
  const root = document.querySelector<HTMLElement>('[data-floating-panel="true"]')!;
  // What the pref projection + reconciler put on the root in the live app.
  root.classList.add("card-outline-chrome");
  root.setAttribute("data-contains-active-card", "true");
  const card = root.querySelector<HTMLElement>("[data-card-key]")!;
  return { root, card };
}

describe("popped-card window rules — surface gate (task 1246)", () => {
  it("the seam is found (the derivation is not vacuous)", () => {
    // One window ring + three inner-outline suppressions.
    expect(poppedSelectors.length).toBeGreaterThanOrEqual(4);
  });

  it('every popped-context selector requires [data-float-surface="card"]', () => {
    for (const sel of poppedSelectors) {
      expect(sel, sel).toContain('[data-float-surface="card"]');
    }
  });

  it("FloatingPanel states its surface on the root", () => {
    const { root } = mount("panel");
    expect(root.getAttribute("data-float-surface")).toBe("panel");
    cleanup();
    expect(mount("card").root.getAttribute("data-float-surface")).toBe("card");
  });

  it("a WHOLE-PANEL float matches none of them (keeps its shadow + per-card outline)", () => {
    const { root, card } = mount("panel");
    for (const sel of poppedSelectors) {
      // :hover never matches in jsdom; the stamped hover/selected legs do.
      expect(root.matches(sel) || card.matches(sel), sel).toBe(false);
    }
  });

  it("a POPPED CARD float still gets the window ring and the suppression", () => {
    const { root, card } = mount("card");
    const ring = poppedSelectors.filter((s) => s.includes("data-contains-active-card"));
    const inner = poppedSelectors.filter(
      (s) => s.includes("[data-card-key]") && !s.includes(":hover"),
    );
    expect(ring.length).toBeGreaterThan(0);
    expect(inner.length).toBeGreaterThan(0);
    for (const sel of ring) expect(root.matches(sel), sel).toBe(true);
    for (const sel of inner) expect(card.matches(sel), sel).toBe(true);
  });
});
