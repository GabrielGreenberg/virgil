// @vitest-environment jsdom
//
// useMenuDismiss: the ONE deferred capture-phase click-outside + Escape
// dismissal (design §3.2). Tests: the opening click can't self-close (deferred
// listener); clicks inside the container / an exclude don't dismiss; an outside
// click does; Escape closes with stopPropagation by default; the two-stage
// onEscape interceptor consumes Escape without closing; a non-top controller
// (ownsEscape:false) ignores Escape; and — task 687 — Escape routes to the
// CANCEL door (`onCancel`) while click-outside keeps routing to the DISMISS
// door, with `onCancel` defaulting to `onClose` so every plain menu is
// unchanged.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useRef } from "react";
import { useMenuDismiss } from "../useMenuDismiss";

afterEach(cleanup);

function flushDeferred() {
  // The mousedown listener mounts on a setTimeout(…, 0).
  act(() => {
    vi.runAllTimers();
  });
}

function mousedownOn(el: Element | Document) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

function escape(opts?: { onStop?: () => void }) {
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  if (opts?.onStop) {
    const orig = e.stopPropagation.bind(e);
    e.stopPropagation = () => {
      opts.onStop!();
      orig();
    };
  }
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

interface HarnessProps {
  onClose: () => void;
  onCancel?: () => void;
  exclude?: HTMLElement | null;
  ownsEscape?: boolean;
  onEscape?: () => boolean;
  stopPropagation?: boolean;
}

function Harness({
  onClose,
  onCancel,
  exclude,
  ownsEscape,
  onEscape,
  stopPropagation,
}: HarnessProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useMenuDismiss({
    containerRef,
    getExcludes: exclude !== undefined ? () => [exclude] : undefined,
    onClose,
    onCancel,
    escape: { stopPropagation, onEscape },
    ownsEscape,
  });
  return (
    <div ref={containerRef} data-testid="container">
      <button data-testid="inside">inside</button>
    </div>
  );
}

describe("useMenuDismiss — click-outside", () => {
  it("does not close on a click that fires before the deferred listener mounts", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    // The opening click lands before the setTimeout fires.
    mousedownOn(document.body);
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("closes on an outside click once the listener is live", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    flushDeferred();
    mousedownOn(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does NOT close on a click inside the container", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { getByTestId } = render(<Harness onClose={onClose} />);
    flushDeferred();
    mousedownOn(getByTestId("inside"));
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does NOT close on a click inside a registered exclude element", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const exclude = document.createElement("div");
    document.body.appendChild(exclude);
    const inner = document.createElement("span");
    exclude.appendChild(inner);
    render(<Harness onClose={onClose} exclude={exclude} />);
    flushDeferred();
    mousedownOn(inner);
    expect(onClose).not.toHaveBeenCalled();
    exclude.remove();
    vi.useRealTimers();
  });
});

describe("useMenuDismiss — Escape", () => {
  it("closes on Escape and stops propagation by default", () => {
    const onClose = vi.fn();
    const onStop = vi.fn();
    render(<Harness onClose={onClose} />);
    escape({ onStop });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalled();
  });

  it("does not stopPropagation when stopPropagation:false", () => {
    const onClose = vi.fn();
    const onStop = vi.fn();
    render(<Harness onClose={onClose} stopPropagation={false} />);
    escape({ onStop });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("two-stage onEscape consumes Escape WITHOUT closing when it returns true", () => {
    const onClose = vi.fn();
    const onEscape = vi.fn(() => true);
    render(<Harness onClose={onClose} onEscape={onEscape} />);
    escape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("two-stage onEscape closes when it returns false", () => {
    const onClose = vi.fn();
    const onEscape = vi.fn(() => false);
    render(<Harness onClose={onClose} onEscape={onEscape} />);
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a non-top controller (ownsEscape:false) ignores Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} ownsEscape={false} />);
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── DISMISS is not CANCEL (task 687) ────────────────────────────────────────
// The hook ends a menu through two doors that mean different things. Before
// this split they shared one prop, so a surface that commits on dismissal —
// the citation create popover — committed on Escape too, and the key the user
// presses to abandon was the key that saved.
describe("useMenuDismiss — Escape is the CANCEL door", () => {
  it("Escape calls onCancel and NOT onClose when both are supplied", () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onClose={onClose} onCancel={onCancel} />);
    escape();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("click-outside still calls onClose — the dismiss door is untouched", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onClose={onClose} onCancel={onCancel} />);
    flushDeferred();
    mousedownOn(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("with no onCancel, Escape falls back to onClose (every plain menu)", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the two-stage interceptor still outranks the cancel door", () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const onEscape = vi.fn(() => true);
    render(
      <Harness onClose={onClose} onCancel={onCancel} onEscape={onEscape} />,
    );
    escape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a non-top controller ignores Escape without reaching the cancel door", () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(
      <Harness onClose={onClose} onCancel={onCancel} ownsEscape={false} />,
    );
    escape();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Task 746 — the outside press is read on POINTERDOWN. A surface that
// preventDefaults its pointerdown (every pane divider) suppresses the compat
// mousedown, so a mousedown-only listener never saw the press; and onClose is
// read through a ref, so a fresh inline onClose per render opens no gap.
describe("useMenuDismiss — the press is the pointerdown (task 746)", () => {
  function pointerdownOn(el: Element, opts?: { preventDefault?: boolean }) {
    act(() => {
      const e = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
      if (opts?.preventDefault) {
        // The pane-resize engine's own handler: cancel the compat mouse events.
        el.addEventListener("pointerdown", (ev) => ev.preventDefault(), { once: true });
      }
      el.dispatchEvent(e);
    });
  }

  it("closes on an outside pointerdown the target preventDefaults (no compat mousedown follows)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    flushDeferred();
    const divider = document.createElement("div");
    document.body.appendChild(divider);
    pointerdownOn(divider, { preventDefault: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    divider.remove();
    vi.useRealTimers();
  });

  it("an ordinary press (pointerdown + its compat mousedown) dismisses exactly once", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    flushDeferred();
    pointerdownOn(document.body);
    mousedownOn(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The next gesture is a fresh press.
    flushDeferred();
    pointerdownOn(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does NOT close on a pointerdown inside the container", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { getByTestId } = render(<Harness onClose={onClose} />);
    flushDeferred();
    pointerdownOn(getByTestId("inside"));
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("a new onClose identity per render opens no listener gap and calls the LATEST onClose", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onClose={first} />);
    flushDeferred();
    rerender(<Harness onClose={second} />);
    // No timers flushed: the listener must still be live after the re-render.
    pointerdownOn(document.body);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
