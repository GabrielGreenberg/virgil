// @vitest-environment jsdom
//
// TASK 1618 — arrow-key list navigation quiets the stale hover cue as PAINT,
// never by disabling input.
//
// The predecessor (`clearStaleHover`) set `pointer-events:none` on the list
// until the next `pointermove`, so a still-mouse click or a trackpad scroll
// went THROUGH the list. Now an arrow stamps `data-kbd-nav`, the hover rules
// (`pointer-hover:` variant + the outline chrome in globals.css) exclude it,
// and the list's next real pointer input clears it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { render, fireEvent, cleanup } from "@testing-library/react";
import {
  KBD_NAV_ATTR,
  markKeyboardNav,
  useListNavKeys,
} from "@/components/panel-primitives";
import {
  currentInputModality,
  subscribeInputModality,
} from "@/lib/input-modality";

afterEach(cleanup);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function List({ onCardClick }: { onCardClick: () => void }) {
  const keys = useListNavKeys(2, () => {}, () => {});
  return (
    <div data-testid="list" tabIndex={0} onKeyDown={keys}>
      <button data-testid="card" onClick={onCardClick}>card</button>
    </div>
  );
}

describe("keyboard list nav quiets hover without stripping input (task 1618)", () => {
  it("an arrow stamps the paint attribute and leaves hit-testing alone", () => {
    const onCardClick = vi.fn();
    const { getByTestId } = render(<List onCardClick={onCardClick} />);
    const list = getByTestId("list");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list.hasAttribute(KBD_NAV_ATTR)).toBe(true);
    expect(list.style.pointerEvents).not.toBe("none");
    // No pointermove first: the click still reaches the card.
    fireEvent.click(getByTestId("card"));
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });

  it("the list's next real pointer input clears it and reports pointer modality", () => {
    const unsub = subscribeInputModality(() => {});
    try {
      const { getByTestId } = render(<List onCardClick={() => {}} />);
      const list = getByTestId("list");
      fireEvent.keyDown(list, { key: "ArrowUp" });
      expect(currentInputModality()).toBe("keyboard");
      fireEvent.pointerMove(getByTestId("card"));
      expect(list.hasAttribute(KBD_NAV_ATTR)).toBe(false);
      expect(currentInputModality()).toBe("pointer");

      fireEvent.keyDown(list, { key: "ArrowDown" });
      fireEvent.pointerDown(getByTestId("card"));
      expect(list.hasAttribute(KBD_NAV_ATTR)).toBe(false);
    } finally {
      unsub();
    }
  });

  it("a burst of arrows arms ONE listener pair", () => {
    const el = document.createElement("div");
    const add = vi.spyOn(el, "addEventListener");
    for (let i = 0; i < 5; i++) markKeyboardNav(el);
    expect(add).toHaveBeenCalledTimes(2);
    el.dispatchEvent(new Event("pointermove"));
    expect(el.hasAttribute(KBD_NAV_ATTR)).toBe(false);
    markKeyboardNav(el);
    expect(add).toHaveBeenCalledTimes(4);
  });

  it("CENSUS: the hover rules exclude the stamp, and nothing strips pointer-events", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/@custom-variant pointer-hover[\s\S]*?:hover:where\(:not\(\[data-kbd-nav\] \*\)\)/);
    expect(css).toContain(".card-outline-chrome [data-card]:hover:where(:not([data-kbd-nav] *))");
    const prim = read("src/components/panel-primitives.tsx");
    expect(prim).toContain('const CARD_DEFAULT = "bg-surface pointer-hover:border-edge-hover"');
    for (const rel of ["src/components/panel-primitives.tsx", "src/panels/Search/SearchPanel.tsx"]) {
      expect(read(rel)).not.toMatch(/clearStaleHover|style\.pointerEvents\s*=\s*"none"/);
    }
  });
});
