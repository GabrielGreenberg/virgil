// @vitest-environment jsdom
/**
 * `activatableProps` — the ONE spelling of the `button` role for a container
 * that cannot be a `<button>` (task 536).
 *
 * The contract has four parts and the fourth is the one every hand-rolled
 * copy lacked: the role, a tab stop, Enter/Space activation — and a TARGET
 * GUARD, so a key pressed on a NESTED control is that control's alone. The
 * `InlineTabLabel` leg below is the live case: pre-536 Enter on a tab's close
 * button both closed the tab (its own native activation) and ACTIVATED it
 * (the container's key handler, reached by bubbling).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { activatableProps, isActivationKey } from "@/lib/activatable-props";
import { InlineTabLabel } from "@/components/editor-layout/InlineTabLabel";

afterEach(cleanup);

function renderContainer() {
  const activate = vi.fn();
  const utils = render(
    <div data-testid="host" {...activatableProps(activate)}>
      label
      <button type="button" data-testid="nested">×</button>
    </div>,
  );
  const host = utils.getByTestId("host");
  const nested = utils.getByTestId("nested");
  return { activate, host, nested };
}

describe("the four parts", () => {
  it("announces the role and is a tab stop", () => {
    const { host } = renderContainer();
    expect(host.getAttribute("role")).toBe("button");
    expect(host.tabIndex).toBe(0);
  });

  it("activates on click, Enter and Space — and consumes the two keys", () => {
    const { activate, host } = renderContainer();
    fireEvent.click(host);
    expect(activate).toHaveBeenCalledTimes(1);
    const enter = fireEvent.keyDown(host, { key: "Enter" });
    expect(activate).toHaveBeenCalledTimes(2);
    // `fireEvent` returns false when a handler called preventDefault.
    expect(enter).toBe(false);
    const space = fireEvent.keyDown(host, { key: " " });
    expect(activate).toHaveBeenCalledTimes(3);
    expect(space).toBe(false);
  });

  it("ignores every other key, and does not consume it", () => {
    const { activate, host } = renderContainer();
    const a = fireEvent.keyDown(host, { key: "a" });
    const tab = fireEvent.keyDown(host, { key: "Tab" });
    expect(activate).not.toHaveBeenCalled();
    expect(a).toBe(true);
    expect(tab).toBe(true);
  });

  it("TARGET GUARD: a key on a nested control is that control's, not the container's", () => {
    const { activate, nested } = renderContainer();
    fireEvent.keyDown(nested, { key: "Enter" });
    fireEvent.keyDown(nested, { key: " " });
    expect(activate).not.toHaveBeenCalled();
    // A CLICK on the nested control still bubbles to the container's
    // `onClick` unless the control stops it — that is the click contract
    // every consumer already handles with `stopPropagation`, and it is
    // deliberately NOT guarded here: a click on a non-interactive CHILD (the
    // tab's label span) must still activate the tab.
  });

  it("isActivationKey names exactly the two keys", () => {
    expect(isActivationKey("Enter")).toBe(true);
    expect(isActivationKey(" ")).toBe(true);
    expect(isActivationKey("Spacebar")).toBe(false);
    expect(isActivationKey("a")).toBe(false);
  });
});

describe("InlineTabLabel — the consumer whose nested close was the live case", () => {
  function renderTab() {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const utils = render(
      <InlineTabLabel id="t1" label="Paper" title="Paper" onActivate={onActivate} onClose={onClose} />,
    );
    const tab = utils.container.querySelector<HTMLElement>('[role="button"]')!;
    const close = utils.container.querySelector<HTMLButtonElement>("button")!;
    return { onActivate, onClose, tab, close };
  }

  it("Enter and Space on the tab activate it", () => {
    const { onActivate, tab } = renderTab();
    fireEvent.keyDown(tab, { key: "Enter" });
    fireEvent.keyDown(tab, { key: " " });
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onActivate).toHaveBeenCalledWith("t1");
  });

  it("DEFECT (latent pre-536): Enter on the CLOSE button does not also activate the tab", () => {
    const { onActivate, close } = renderTab();
    fireEvent.keyDown(close, { key: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("the tab supplies the design system's focus indicator", () => {
    const { tab } = renderTab();
    expect(tab.classList.contains("focus-ring")).toBe(true);
  });
});
