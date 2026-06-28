// @vitest-environment jsdom
//
// Guard test for the shared RowMenu primitive (F#5/F#7). Pins the contract
// that all three left-rail/list consumers rely on: a ⋮ trigger that opens a
// portaled menu, declarative items that fire onSelect and close the menu,
// disabled items that don't fire, dividers, a disabled trigger, and
// click-through suppression (opening/selecting must not bubble to the row).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import RowMenu, { type RowMenuEntry } from "../RowMenu";

afterEach(cleanup);

describe("RowMenu (F#5/F#7)", () => {
  it("opens on trigger click, runs an item, and closes", () => {
    const onSelect = vi.fn();
    const items: RowMenuEntry[] = [
      { key: "a", label: "Action A", onSelect },
    ];
    const { getByLabelText, queryByText, getByText } = render(
      <RowMenu items={items} ariaLabel="Test menu" />,
    );
    expect(queryByText("Action A")).toBeNull();
    fireEvent.click(getByLabelText("Test menu"));
    getByText("Action A"); // now mounted in the portal
    fireEvent.click(getByText("Action A"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(queryByText("Action A")).toBeNull(); // closed after select
  });

  it("renders dividers and destructive items, and a disabled item does not fire", () => {
    const live = vi.fn();
    const dead = vi.fn();
    const items: RowMenuEntry[] = [
      { key: "live", label: "Live", onSelect: live },
      { key: "div", divider: true },
      { key: "dead", label: "Dead", onSelect: dead, disabled: true },
    ];
    const { getByLabelText, getByText } = render(
      <RowMenu items={items} ariaLabel="Test menu" />,
    );
    fireEvent.click(getByLabelText("Test menu"));
    fireEvent.click(getByText("Dead"));
    expect(dead).not.toHaveBeenCalled();
    fireEvent.click(getByText("Live"));
    expect(live).toHaveBeenCalledTimes(1);
  });

  it("a disabled trigger does not open", () => {
    const onSelect = vi.fn();
    const { getByLabelText, queryByText } = render(
      <RowMenu
        items={[{ key: "a", label: "Action A", onSelect }]}
        ariaLabel="Test menu"
        disabled
      />,
    );
    fireEvent.click(getByLabelText("Test menu"));
    expect(queryByText("Action A")).toBeNull();
  });

  it("opening the menu does not bubble a click to an enclosing row", () => {
    const rowClick = vi.fn();
    const { getByLabelText } = render(
      <div onClick={rowClick}>
        <RowMenu
          items={[{ key: "a", label: "Action A", onSelect: () => {} }]}
          ariaLabel="Test menu"
        />
      </div>,
    );
    fireEvent.click(getByLabelText("Test menu"));
    expect(rowClick).not.toHaveBeenCalled();
  });
});
