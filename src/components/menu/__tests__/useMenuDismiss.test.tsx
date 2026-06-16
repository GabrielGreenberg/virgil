// @vitest-environment jsdom
//
// useMenuDismiss: the ONE deferred capture-phase click-outside + Escape
// dismissal (design §3.2). Tests: the opening click can't self-close (deferred
// listener); clicks inside the container / an exclude don't dismiss; an outside
// click does; Escape closes with stopPropagation by default; the two-stage
// onEscape interceptor consumes Escape without closing; a non-top controller
// (ownsEscape:false) ignores Escape.

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
  exclude?: HTMLElement | null;
  ownsEscape?: boolean;
  onEscape?: () => boolean;
  stopPropagation?: boolean;
}

function Harness({ onClose, exclude, ownsEscape, onEscape, stopPropagation }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useMenuDismiss({
    containerRef,
    getExcludes: exclude !== undefined ? () => [exclude] : undefined,
    onClose,
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
