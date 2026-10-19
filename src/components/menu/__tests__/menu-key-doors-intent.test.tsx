// @vitest-environment jsdom
//
// Task 1188 — the menu key doors OUTSIDE `useMenuKeyboard` ask key-intent too.
//
//   - `useMenuDismiss`: a composing Escape (it cancels the IME composition) ends
//     nothing and is left un-prevented; a REPEATING Escape is consumed and ends
//     nothing, so a held Escape closes one nested menu, not the whole chain,
//     and after the last menu closes its repeats never reach the app below.
//   - `useMenuCombobox`: while composing, no key reaches the horizontal
//     override, `onNavigate`, the controller or the caller; a repeated Enter
//     reaches the caller once (the commit runs once). The handler takes a
//     NATIVE KeyboardEvent (the external-input path) with its fields intact.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { MenuProvider } from "../MenuProvider";
import { useMenuItem } from "../useMenuItem";
import { useMenuCombobox, type ComboboxInputProps } from "../useMenuCombobox";
import { useMenuDismiss } from "../useMenuDismiss";
import { __resetRepeatSwallowForTests } from "@/lib/key-intent";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
const PLACEMENTS = [{ side: "below" as const, align: "start" as const }];

afterEach(() => {
  cleanup();
  __resetRepeatSwallowForTests();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function press(target: EventTarget, k: string, opts: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

/** A parent menu with a nested child (the colour popover over the ⚡ menu):
 *  the child owns Escape while it is open, then the parent does. */
function mountNested() {
  return renderHook(() => {
    const parentRef = useRef<HTMLElement | null>(null);
    const childRef = useRef<HTMLElement | null>(null);
    const [parentOpen, setParentOpen] = useState(true);
    const [childOpen, setChildOpen] = useState(true);
    useMenuDismiss({
      containerRef: parentRef,
      open: parentOpen,
      ownsEscape: !childOpen,
      onClose: () => setParentOpen(false),
    });
    useMenuDismiss({
      containerRef: childRef,
      open: childOpen,
      onClose: () => setChildOpen(false),
    });
    return { parentOpen, childOpen };
  });
}

describe("useMenuDismiss — Escape is a deliberate press (task 1188)", () => {
  it("a composing Escape cancels the composition, not the menu", () => {
    const { result } = mountNested();
    const e = press(document.body, "Escape", { isComposing: true });
    expect(result.current).toEqual({ parentOpen: true, childOpen: true });
    expect(e.defaultPrevented).toBe(false);
    // The legacy 229 marker is the IME's too.
    press(document.body, "Escape", { keyCode: 229 });
    expect(result.current.childOpen).toBe(true);
  });

  it("a held Escape closes the top menu only — its repeats end nothing", () => {
    const { result } = mountNested();
    press(document.body, "Escape");
    expect(result.current).toEqual({ parentOpen: true, childOpen: false });
    const r1 = press(document.body, "Escape", { repeat: true });
    const r2 = press(document.body, "Escape", { repeat: true });
    expect(result.current).toEqual({ parentOpen: true, childOpen: false });
    expect(r1.defaultPrevented && r2.defaultPrevented).toBe(true);
    // A fresh press (after keyup) still closes the parent.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
    });
    press(document.body, "Escape");
    expect(result.current.parentOpen).toBe(false);
  });

  it("after the last menu closes, the held Escape's repeats never reach the app", () => {
    const appEscapes = vi.fn();
    document.body.addEventListener("keydown", (e) => appEscapes(e.key, e.repeat));
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(null);
      const [open, setOpen] = useState(true);
      useMenuDismiss({ containerRef: ref, open, onClose: () => setOpen(false) });
      return open;
    });
    press(document.body, "Escape");
    expect(result.current).toBe(false);
    press(document.body, "Escape", { repeat: true });
    press(document.body, "Escape", { repeat: true });
    expect(appEscapes).not.toHaveBeenCalled();
  });
});

function Option({ id }: { id: string }) {
  const { getItemProps } = useMenuItem({ id, run: () => {} });
  return <div {...getItemProps()}>{id}</div>;
}

let liveProps: ComboboxInputProps | null = null;

function Combobox(props: {
  onKeyDown: (e: unknown) => void;
  onNavigate: () => void;
  onArrowHorizontal: (dir: "left" | "right") => void;
}) {
  const { getInputProps, activeId } = useMenuCombobox();
  liveProps = getInputProps({ open: true, ...props });
  return (
    <>
      <input placeholder="q" data-active={activeId ?? ""} {...liveProps} />
      <Option id="a" />
      <Option id="b" />
    </>
  );
}

function renderCombobox() {
  const spies = { onKeyDown: vi.fn(), onNavigate: vi.fn(), onArrowHorizontal: vi.fn() };
  render(
    <MenuProvider
      id="cb"
      layout="combobox"
      role="listbox"
      anchorRect={RECT}
      placements={PLACEMENTS}
      keyboardSource="input"
      onClose={() => {}}
      ariaLabel="cb"
    >
      <Combobox {...spies} />
    </MenuProvider>,
  );
  return { input: screen.getByPlaceholderText("q"), ...spies };
}

describe("useMenuCombobox — key-intent gates the whole handler (task 1188)", () => {
  it("composing keys reach nothing: no detail toggle, no reopen, no cursor move, no commit", () => {
    const { input, onKeyDown, onNavigate, onArrowHorizontal } = renderCombobox();
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowDown", "Enter", "Escape"]) {
      const notPrevented = fireEvent.keyDown(input, { key, isComposing: true });
      expect(notPrevented, key).toBe(true);
    }
    fireEvent.keyDown(input, { key: "ArrowDown", keyCode: 229 });
    expect(onArrowHorizontal).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(input.getAttribute("data-active")).toBe("");
  });

  it("the same keys, not composing, still route (control)", () => {
    const { input, onKeyDown, onNavigate, onArrowHorizontal } = renderCombobox();
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onArrowHorizontal).toHaveBeenCalledWith("left");
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("a held Enter reaches the caller's commit ONCE; arrows keep repeating", () => {
    const { input, onKeyDown, onNavigate } = renderCombobox();
    fireEvent.keyDown(input, { key: "Enter" });
    const repeatNotPrevented = fireEvent.keyDown(input, { key: "Enter", repeat: true });
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(repeatNotPrevented).toBe(false);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown", repeat: true });
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("takes a NATIVE event (the external-input path) with isComposing intact", () => {
    const { onKeyDown } = renderCombobox();
    const composing = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, cancelable: true });
    act(() => liveProps!.onKeyDown(composing));
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(composing.defaultPrevented).toBe(false);
    const fresh = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    act(() => liveProps!.onKeyDown(fresh));
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0]).toBe(fresh);
  });
});
