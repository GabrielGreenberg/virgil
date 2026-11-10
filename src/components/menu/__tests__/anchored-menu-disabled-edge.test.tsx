// @vitest-environment jsdom
//
// Task 1563 — `<AnchoredMenu triggerDisabled>` CLOSES an open menu on its grey
// edge, through the ONE `useCloseOnDisabledEdge` rule of task 1369. Before: the
// prop only greyed the button, so the trigger said "unavailable" (and still
// `aria-expanded="true"`) over a menu whose rows and keyboard stayed live.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

import { AnchoredMenu } from "../AnchoredMenu";
import { MenuActionRow } from "../MenuActionRow";

afterEach(() => cleanup());

function Fixture({ disabled }: { disabled: boolean }) {
  return (
    <AnchoredMenu ariaLabel="Things" trigger={() => "Open"} triggerDisabled={disabled}>
      {({ close }) => <MenuActionRow id="a" label="Row" onSelect={close} />}
    </AnchoredMenu>
  );
}

const trigger = () => screen.getByRole("button", { name: "Things" });
const menu = () => document.body.querySelector('[role="menu"]');

describe("AnchoredMenu grey edge (task 1563)", () => {
  it("closes an open menu when its trigger greys", () => {
    const { rerender } = render(<Fixture disabled={false} />);
    fireEvent.click(trigger());
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    rerender(<Fixture disabled />);

    expect(menu()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("does not reopen when the grey lifts", () => {
    const { rerender } = render(<Fixture disabled={false} />);
    fireEvent.click(trigger());
    rerender(<Fixture disabled />);

    rerender(<Fixture disabled={false} />);

    expect(menu()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens normally again after the grey lifts", () => {
    const { rerender } = render(<Fixture disabled={false} />);
    fireEvent.click(trigger());
    rerender(<Fixture disabled />);
    rerender(<Fixture disabled={false} />);

    fireEvent.click(trigger());

    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("a trigger greyed from the start cannot open the menu", () => {
    render(<Fixture disabled />);
    fireEvent.click(trigger());
    expect(menu()).toBeNull();
  });

  it("a re-render that leaves the trigger enabled keeps the menu open", () => {
    const { rerender } = render(<Fixture disabled={false} />);
    fireEvent.click(trigger());
    rerender(<Fixture disabled={false} />);
    expect(menu()).not.toBeNull();
  });
});
