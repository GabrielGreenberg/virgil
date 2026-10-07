// @vitest-environment jsdom
//
// Task 994 — the menu keyboard controller acts only on FRESH, DELIBERATE
// presses (the shared `src/lib/key-intent.ts` gate):
//
//   - IME composition: Enter that commits a candidate (`isComposing` or the
//     legacy `keyCode 229`) never activates a row — window source AND combobox
//     source — and is left un-prevented for the IME.
//   - Auto-repeat: a held activation key runs its row ONCE; the repeats are
//     consumed, and after the menu CLOSES on activation (its listener gone) the
//     repeats still never reach the editor underneath, until that key's keyup.
//   - Nav arrows keep repeating (held ArrowDown walks the list).

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useState } from "react";
import { MenuRegistry } from "../registry";
import { useMenuKeyboard } from "../useMenuKeyboard";
import { __resetRepeatSwallowForTests } from "@/lib/key-intent";
import { isPlainEnter } from "@/components/dialog-enter-policy";

afterEach(() => {
  cleanup();
  __resetRepeatSwallowForTests();
});

function makeRegistry(runs: Record<string, () => void>) {
  const r = new MenuRegistry("m", "list");
  r.register({ id: "a", region: "list", disabled: false, letter: "A", run: runs.a ?? (() => {}) });
  r.register({
    id: "del",
    region: "list",
    disabled: false,
    letter: "D",
    letterAliases: ["Backspace", "Delete"],
    run: runs.del ?? (() => {}),
  });
  r.register({ id: "c", region: "list", disabled: false, run: () => {} });
  r.setActive("a");
  return r;
}

/** A stand-in for ProseMirror: a bubble listener on a body child. */
function editorStandIn() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const seen: KeyboardEvent[] = [];
  el.addEventListener("keydown", (e) => seen.push(e));
  return { el, seen };
}

function press(target: EventTarget, k: string, opts: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

function release(target: EventTarget, k: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true, cancelable: true }));
  });
}

/** Window-source menu that CLOSES on activation, like DragHandleMenu. */
function mountClosingMenu(makeReg: (close: () => void) => MenuRegistry) {
  let close = () => {};
  const reg = makeReg(() => close());
  return renderHook(() => {
    const [open, setOpen] = useState(true);
    close = () => setOpen(false);
    useMenuKeyboard({ registry: reg, layout: "list", open, letterShortcuts: true });
    return open;
  });
}

describe("menu keyboard — IME composition is the IME's", () => {
  it("window source: composing Enter does not activate and is not prevented", () => {
    const run = vi.fn();
    const reg = makeRegistry({ a: run });
    renderHook(() => useMenuKeyboard({ registry: reg, layout: "list", open: true }));
    const { el } = editorStandIn();
    const e1 = press(el, "Enter", { isComposing: true });
    const e2 = press(el, "Enter", { keyCode: 229 });
    expect(run).not.toHaveBeenCalled();
    expect(e1.defaultPrevented).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
    // A plain Enter still activates.
    press(el, "Enter");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("combobox source: composing Enter does not activate; composing arrows do not move", () => {
    const run = vi.fn();
    const reg = makeRegistry({ a: run });
    const { result } = renderHook(() =>
      useMenuKeyboard({ registry: reg, layout: "list", open: true, source: "input" }),
    );
    const enter = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, cancelable: true });
    act(() => result.current.handleKeyDown(enter));
    expect(run).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    act(() => result.current.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown", isComposing: true })));
    expect(reg.activeId()).toBe("a");
  });
});

describe("menu keyboard — auto-repeat answers the first press only", () => {
  it("held Backspace runs delete ONCE and its repeats never reach the editor until keyup", () => {
    const del = vi.fn();
    const hook = mountClosingMenu((close) => makeRegistry({ del: () => (del(), close()) }));
    const { el, seen } = editorStandIn();

    press(el, "Backspace");
    expect(del).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toBe(false); // the menu closed — its listener is gone

    const r1 = press(el, "Backspace", { repeat: true });
    const r2 = press(el, "Backspace", { repeat: true });
    expect(r1.defaultPrevented && r2.defaultPrevented).toBe(true);
    expect(seen).toHaveLength(0); // nothing reached the "editor"
    expect(del).toHaveBeenCalledTimes(1);

    release(el, "Backspace");
    press(el, "Backspace"); // a fresh press after release is the editor's again
    expect(seen).toHaveLength(1);
  });

  it("held Enter on an open menu activates once (repeats swallowed, not run)", () => {
    const run = vi.fn();
    const reg = makeRegistry({ a: run });
    renderHook(() => useMenuKeyboard({ registry: reg, layout: "list", open: true }));
    const { el, seen } = editorStandIn();
    press(el, "Enter");
    press(el, "Enter", { repeat: true });
    press(el, "Enter", { repeat: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(0);
  });

  it("a fresh press of another key disarms the swallow", () => {
    mountClosingMenu((close) => makeRegistry({ a: close }));
    const { el, seen } = editorStandIn();
    press(el, "Enter");
    press(el, "x"); // fresh press — the editor's
    press(el, "Enter", { repeat: true }); // swallow already disarmed
    expect(seen.map((e) => e.key)).toEqual(["x", "Enter"]);
  });

  it("held ArrowDown keeps walking the list", () => {
    const reg = makeRegistry({});
    renderHook(() => useMenuKeyboard({ registry: reg, layout: "list", open: true }));
    const { el } = editorStandIn();
    press(el, "ArrowDown");
    press(el, "ArrowDown", { repeat: true });
    expect(reg.activeId()).toBe("c");
  });
});

describe("isPlainEnter reads the same gate", () => {
  it("rejects repeat and composition, accepts a fresh plain Enter", () => {
    expect(isPlainEnter(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(true);
    expect(isPlainEnter(new KeyboardEvent("keydown", { key: "Enter", repeat: true }))).toBe(false);
    expect(isPlainEnter(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }))).toBe(false);
    expect(isPlainEnter(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }))).toBe(false);
  });
});
