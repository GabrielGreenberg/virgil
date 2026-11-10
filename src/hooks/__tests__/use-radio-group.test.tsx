// @vitest-environment jsdom
//
// Task 1554 — the arrow keys step ONE option from the option that holds focus,
// in both directions, checked or not. With nothing checked the hook used to
// step from the checked index: ArrowRight re-checked the focused Tab stop (the
// key looked dead) while ArrowLeft jumped to the last option.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useRadioGroup } from "../useRadioGroup";

const OPTIONS = ["a", "b", "c", "d"] as const;

function Group({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const { groupProps, radioProps } = useRadioGroup<string>({
    options: OPTIONS,
    value,
    onChange: setValue,
  });
  return (
    <div {...groupProps}>
      {OPTIONS.map((o, i) => (
        <button key={o} {...radioProps(i)}>
          <span>{o}</span>
        </button>
      ))}
    </div>
  );
}

const radios = () => screen.getAllByRole("radio");
const checkedIndex = () =>
  radios().findIndex((r) => r.getAttribute("aria-checked") === "true");

afterEach(cleanup);

describe("useRadioGroup arrow keys step from the focused option", () => {
  it("nothing checked, focus on the Tab stop: ArrowRight → option 1", () => {
    render(<Group initial="zzz" />);
    expect(checkedIndex()).toBe(-1);
    radios()[0].focus();
    fireEvent.keyDown(radios()[0], { key: "ArrowRight" });
    expect(checkedIndex()).toBe(1);
    expect(document.activeElement).toBe(radios()[1]);
  });

  it("nothing checked, focus on the Tab stop: ArrowLeft → the last option", () => {
    render(<Group initial="zzz" />);
    radios()[0].focus();
    fireEvent.keyDown(radios()[0], { key: "ArrowUp" });
    expect(checkedIndex()).toBe(OPTIONS.length - 1);
    expect(document.activeElement).toBe(radios()[OPTIONS.length - 1]);
  });

  it("focus and check diverged: steps from focus, not from the checked option", () => {
    render(<Group initial="a" />);
    radios()[2].focus();
    fireEvent.keyDown(radios()[2], { key: "ArrowDown" });
    expect(checkedIndex()).toBe(3);
    expect(document.activeElement).toBe(radios()[3]);
  });

  it("a keydown from inside an option resolves to that option", () => {
    render(<Group initial="b" />);
    const inner = radios()[1].querySelector("span")!;
    fireEvent.keyDown(inner, { key: "ArrowLeft" });
    expect(checkedIndex()).toBe(0);
  });

  it("wraps at both ends", () => {
    render(<Group initial="d" />);
    fireEvent.keyDown(radios()[3], { key: "ArrowRight" });
    expect(checkedIndex()).toBe(0);
    fireEvent.keyDown(radios()[0], { key: "ArrowLeft" });
    expect(checkedIndex()).toBe(3);
  });
});
