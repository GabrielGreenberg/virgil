// @vitest-environment jsdom
/**
 * The omni card registry: OmniHost publishes the cards it built per side, and
 * the tool gutter finds one by entity id — the same element, minus the
 * omni-only `data-omni-entry` attribute.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { OmniCardRegistryProvider, createOmniCardRegistry, useOmniCard } from "../omni-card-registry";
import type { OmniItem } from "@/panels/_shared/types";

function Card({ label, extraDataAttrs }: { label: string; extraDataAttrs?: Record<string, string> }) {
  return createElement("div", { "data-testid": "card", ...(extraDataAttrs ?? {}) }, label);
}
const item = (id: string, label: string): OmniItem =>
  ({ id, pos: 1, content: createElement(Card, { label, extraDataAttrs: { "data-omni-entry": id } }) }) as OmniItem;

describe("omni card registry", () => {
  it("finds a card by entity id across sides, with its row suffix stripped", () => {
    const reg = createOmniCardRegistry();
    reg.set("right", [item("float:card:todo:t1@p9", "To-do one"), item("float:card:note:n1", "Note one")]);
    expect(reg.find("t1")?.kind).toBe("todo");
    expect(reg.find("n1")?.kind).toBe("note");
    expect(reg.find("missing")).toBeNull();
  });

  it("renders the same card without the omni entry attribute, and follows updates", () => {
    const reg = createOmniCardRegistry();
    reg.set("right", [item("float:card:note:n1", "Before")]);
    function Slot() {
      return createElement("div", null, useOmniCard("n1")?.content ?? null);
    }
    const { rerender } = render(createElement(OmniCardRegistryProvider, { value: reg }, createElement(Slot)));
    expect(screen.getByTestId("card").textContent).toBe("Before");
    expect(screen.getByTestId("card").hasAttribute("data-omni-entry")).toBe(false);
    reg.set("right", [item("float:card:note:n1", "After")]);
    rerender(createElement(OmniCardRegistryProvider, { value: reg }, createElement(Slot)));
    expect(screen.getByTestId("card").textContent).toBe("After");
  });
});
