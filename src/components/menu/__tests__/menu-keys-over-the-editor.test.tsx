// @vitest-environment jsdom
//
// Task 734 — the menu keyboard controller over the editable it parks focus in.
//
// Four editor-anchored menus (grab bar, lightning, heading type, selection
// color) never take DOM focus: they leave the caret in the PM view's
// contentEditable and track the active row with roving
// `aria-activedescendant`. `useMenuKeyboard`'s window-CAPTURE source used to
// bail on ANY editable target, which is exactly that designed state — so the
// whole advertised keyboard contract was dead in the browser, and the declined
// key reached ProseMirror instead (pressing the `F` the menu was showing you
// replaced the selected passage with "f").
//
// Every key here is dispatched on the FOCUSED ELEMENT, the way a browser
// dispatches it — never on `window`, which is how the old suite passed by not
// looking (task 731's class).
//
// The two legs that must both hold:
//   - the menu's OWN activedescendant host (the focused contentEditable) →
//     nav, letters, the Backspace/Delete alias all run, and the event is
//     prevented + stopped so ProseMirror never sees it;
//   - any OTHER editable (task 386's defect leg: a plain `<input>`, a
//     `<textarea>`, an unfocused contentEditable) → nothing runs and the event
//     is NOT prevented, so the field keeps its own key.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { DragHandleMenu } from "../../DragHandleMenu";
import { cardActionRows } from "@/lib/actions/action-registry";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

/** A stand-in for the PM view's contentEditable. jsdom neither derives
 *  `isContentEditable` from the attribute nor focuses a plain div, so both are
 *  forced — the real element is natively focusable and really editable. */
function mountEditable(): HTMLDivElement {
  const el = document.createElement("div");
  el.contentEditable = "true";
  el.tabIndex = 0;
  Object.defineProperty(el, "isContentEditable", { value: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

/** Dispatch a keydown the way the browser does: on the focused element, which
 *  bubbles up through the capture-phase window listener. */
function keyOn(el: HTMLElement, k: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

function menuButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll('[role="menu"] button[role="menuitem"]'),
  ) as HTMLButtonElement[];
}

function activeButton(): HTMLButtonElement | undefined {
  return menuButtons().find((b) => b.getAttribute("data-active") === "");
}

function labelOf(b: HTMLButtonElement | undefined): string {
  if (!b) return "";
  return b.querySelectorAll("span")[1]?.textContent ?? "";
}

describe("task 734 — keys typed into the editable the menu parked focus in", () => {
  it("Down/Up/Home/End move the active row (dispatched on the focused editable)", () => {
    const editable = mountEditable();
    editable.focus();
    expect(document.activeElement).toBe(editable);

    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);
    const rows = cardActionRows("grab");

    keyOn(editable, "ArrowDown");
    expect(labelOf(activeButton())).toBe(rows[0].label);
    keyOn(editable, "ArrowDown");
    expect(labelOf(activeButton())).toBe(rows[1].label);
    keyOn(editable, "ArrowUp");
    expect(labelOf(activeButton())).toBe(rows[0].label);
    keyOn(editable, "End");
    expect(labelOf(activeButton())).toBe(rows[rows.length - 1].label);
    keyOn(editable, "Home");
    expect(labelOf(activeButton())).toBe(rows[0].label);
  });

  it("Enter activates the active row", () => {
    const editable = mountEditable();
    editable.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    keyOn(editable, "ArrowDown");
    keyOn(editable, "Enter");
    expect(onSelect).toHaveBeenCalledWith(cardActionRows("grab")[0].id);
  });

  it("the letter fast-path runs its row — and the letter never reaches the document", () => {
    const editable = mountEditable();
    editable.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    const e = keyOn(editable, "f");
    expect(onSelect).toHaveBeenCalledWith("footnote");
    // preventDefault + stopPropagation: PM's handleKeyDown never sees it, so
    // the selected passage is not replaced with "f".
    expect(e.defaultPrevented).toBe(true);
  });

  it("the destructive Backspace/Delete alias runs the delete row", () => {
    const editable = mountEditable();
    editable.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    keyOn(editable, "Backspace");
    expect(onSelect).toHaveBeenLastCalledWith("delete");
    keyOn(editable, "Delete");
    expect(onSelect).toHaveBeenLastCalledWith("delete");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("a consumed key is stopped before the editable's own listener sees it", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);

    keyOn(editable, "f");
    expect(pmHandler).not.toHaveBeenCalled();
  });

  it("an UNCONSUMED key still reaches the editable untouched", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);

    // `q` maps to no row on the grab menu.
    const e = keyOn(editable, "q");
    expect(pmHandler).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe("task 386's protection (the defect leg, re-run against the new predicate)", () => {
  it("a bare Backspace typed into an unrelated <input> does NOT run the delete row", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    const back = keyOn(input, "Backspace");
    const letter = keyOn(input, "f");
    expect(onSelect).not.toHaveBeenCalled();
    // The field keeps its own keys.
    expect(back.defaultPrevented).toBe(false);
    expect(letter.defaultPrevented).toBe(false);
  });

  it("a bare key typed into an unrelated <textarea> does NOT run a row", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    keyOn(ta, "Delete");
    keyOn(ta, "ArrowDown");
    expect(onSelect).not.toHaveBeenCalled();
    expect(activeButton()).toBeUndefined();
  });

  it("an editable that is NOT the menu's host (focus elsewhere) does NOT run a row", () => {
    // A second contentEditable — e.g. a card body — that does not hold focus.
    // Ownership is the FOCUSED host, not "any contentEditable".
    const other = mountEditable();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    const e = keyOn(other, "f");
    expect(onSelect).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});
