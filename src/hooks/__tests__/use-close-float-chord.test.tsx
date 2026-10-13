// @vitest-environment jsdom
//
// Cmd-W closes the frontmost floating window — ONE per press (task 1095).
// The hook is EditorLayout's only Cmd-W door; this drives it with a real
// three-float MRU stack whose top advances as floats close, the way
// EditorLayout's reconciler prunes it.

import { describe, it, expect, afterEach } from "vitest";
import { useState, useCallback } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { useCloseFloatChord } from "@/hooks/useCloseFloatChord";

afterEach(cleanup);

let closed: string[] = [];

function Host({ initial }: { initial: string[] }) {
  const [stack, setStack] = useState(initial);
  const close = useCallback((key: string) => {
    closed.push(key);
    setStack((s) => s.filter((k) => k !== key));
  }, []);
  useCloseFloatChord(stack[stack.length - 1], close);
  return null;
}

function press(init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    key: "w",
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    document.body.dispatchEvent(e);
  });
  return e;
}

describe("useCloseFloatChord", () => {
  afterEach(() => {
    closed = [];
  });

  it("an auto-repeat keydown closes nothing; a fresh press closes exactly one", () => {
    render(<Host initial={["a", "b", "c"]} />);
    press({ repeat: true });
    expect(closed).toEqual([]);
    press();
    expect(closed).toEqual(["c"]);
  });

  it("holding the chord closes ONE float, not the whole stack", () => {
    render(<Host initial={["a", "b", "c"]} />);
    press();
    for (let i = 0; i < 5; i++) press({ repeat: true });
    expect(closed).toEqual(["c"]);
    press();
    expect(closed).toEqual(["c", "b"]);
  });

  it("a hold that empties the stack keeps its repeats from the host", () => {
    render(<Host initial={["only"]} />);
    expect(press().defaultPrevented).toBe(true);
    // The stack is now empty — but this is still the press that closed a
    // float, so its repeats must not fall through and close the window.
    expect(press({ repeat: true }).defaultPrevented).toBe(true);
    // A NEW press with nothing open is the host's.
    expect(press().defaultPrevented).toBe(false);
    expect(press({ repeat: true }).defaultPrevented).toBe(false);
    expect(closed).toEqual(["only"]);
  });

  it("a keydown already claimed by an earlier handler is not ours", () => {
    render(<Host initial={["a", "b"]} />);
    const claim = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", claim, { capture: true });
    try {
      press();
    } finally {
      window.removeEventListener("keydown", claim, { capture: true });
    }
    expect(closed).toEqual([]);
  });

  it("only the bare chord: Shift/Ctrl/Alt variants and other keys pass", () => {
    render(<Host initial={["a"]} />);
    press({ shiftKey: true });
    press({ ctrlKey: true });
    press({ altKey: true });
    press({ key: "q" });
    press({ metaKey: false });
    expect(closed).toEqual([]);
  });
});
