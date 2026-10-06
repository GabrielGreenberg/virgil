// @vitest-environment jsdom
//
// Task 969: every section rule on a card follows the HALO the card hands
// `PanelCard` (`ac.selected || isSelected`), not the host's `isSelected` prop
// alone — so a host that passes `isSelected={false}` while the store has the
// card selected still gets one consistent look. And the "?" help toggle is a
// real disclosure (`aria-expanded` + `aria-controls`).

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import { CardStoreProvider, createCardStore } from "@/links/_shared/anchored-card-store";
import type { ExampleInfo } from "@/components/Editor";

afterEach(cleanup);

const example = {
  exampleId: "ex1",
  number: "1",
  bodyText: "Colorless green ideas sleep furiously.",
  items: [],
  latex: "\\ex Colorless green ideas sleep furiously. \\xe",
} as unknown as ExampleInfo;

function renderCard(storeSelected: boolean) {
  const store = createCardStore();
  // The Help footer lives in the EXPANDED body.
  store.expand({ kind: "example", id: "ex1" });
  if (storeSelected) store.select({ kind: "example", id: "ex1" });
  const utils = render(
    <CardStoreProvider store={store}>
      <ExampleCard example={example} isSelected={false} onSelect={() => {}} onJump={() => {}} />
    </CardStoreProvider>,
  );
  const help = screen.getByText("?", { selector: "button" });
  fireEvent.click(help);
  const rules = Array.from(utils.container.querySelectorAll<HTMLElement>("div.border-t.transition-colors"));
  return { help, rules, container: utils.container };
}

describe("ExampleCard separators follow the halo (task 969)", () => {
  it("store-selected + host isSelected=false → every body rule wears separatorSelected", () => {
    const { rules } = renderCard(true);
    // footer rule + help-explainer rule (the header rule rides PanelCard)
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const r of rules) {
      expect(r.className).not.toContain("border-edge-subtle");
      expect(r.style.borderTopColor).not.toBe("");
    }
  });

  it("control: unselected everywhere → the hover-brightening rest rule", () => {
    const { rules } = renderCard(false);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const r of rules) {
      expect(r.className).toContain("border-edge-subtle group-hover:border-edge-hover");
      expect(r.style.borderTopColor).toBe("");
    }
  });

  it("the ? help toggle is a disclosure: aria-expanded flips, aria-controls names the explainer", () => {
    const store = createCardStore();
    store.expand({ kind: "example", id: "ex1" });
    const { container } = render(
      <CardStoreProvider store={store}>
        <ExampleCard example={example} isSelected={false} onSelect={() => {}} onJump={() => {}} />
      </CardStoreProvider>,
    );
    const help = screen.getByText("?", { selector: "button" });
    expect(help.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(help);
    expect(help.getAttribute("aria-expanded")).toBe("true");
    const id = help.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    const panel = container.ownerDocument.getElementById(id!);
    expect(panel?.textContent).toContain("expex");
  });
});
