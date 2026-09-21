// @vitest-environment jsdom
//
// TASK 686 — A COMPONENT OWNS ITS TIMERS' LIFETIME.
//
// The React half of `docs/agents/laws/a-nodeview-owns-its-timers-lifetime.md`.
// `useViewLifetime` mounts the SAME scope the vanilla NodeViews arm through
// (`createViewLifetime`), so what is under test here is only the mount: that
// unmount disposes, that a timer armed before it cannot fire after it, that a
// scheduling call made afterwards is inert rather than a revived leak, and that
// the identity handed to consumers is stable across renders.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { useViewLifetime } from "@/hooks/useViewLifetime";
import type { ViewLifetime } from "@/lib/tiptap/view-lifetime";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Hands the live lifetime out so a test can drive it from outside. */
function Probe({ onReady }: { onReady: (lt: ViewLifetime) => void }) {
  const lifetime = useViewLifetime();
  useEffect(() => {
    onReady(lifetime);
  }, [lifetime, onReady]);
  return null;
}

describe("useViewLifetime", () => {
  it("disposes on unmount, so an armed timer never fires", () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    let lt!: ViewLifetime;
    const { unmount } = render(<Probe onReady={(l) => (lt = l)} />);

    lt.setTimeout(fired, 100);
    expect(lt.pending).toBe(1);

    unmount();
    act(() => void vi.advanceTimersByTime(1000));

    expect(fired).not.toHaveBeenCalled();
    expect(lt.disposed).toBe(true);
    expect(lt.pending).toBe(0);
  });

  it("a scheduling call made AFTER unmount arms nothing", () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    let lt!: ViewLifetime;
    const { unmount } = render(<Probe onReady={(l) => (lt = l)} />);
    unmount();

    // A stale closure — a resolved promise, a queued callback — still holding
    // the facade must not be able to revive the leak.
    lt.setTimeout(fired, 10);
    act(() => void vi.advanceTimersByTime(1000));

    expect(fired).not.toHaveBeenCalled();
    expect(lt.pending).toBe(0);
  });

  it("runs onDispose hooks exactly once, on unmount", () => {
    const end = vi.fn();
    let lt!: ViewLifetime;
    const { unmount } = render(<Probe onReady={(l) => (lt = l)} />);
    lt.onDispose(end);

    expect(end).not.toHaveBeenCalled();
    unmount();
    expect(end).toHaveBeenCalledTimes(1);

    // Disposal is idempotent — a second teardown pass cannot end it twice.
    lt.dispose();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("hands out ONE stable identity across re-renders", () => {
    const seen: ViewLifetime[] = [];
    function Rerenderer({ n }: { n: number }) {
      seen.push(useViewLifetime());
      return <span>{n}</span>;
    }
    const view = render(<Rerenderer n={0} />);
    view.rerender(<Rerenderer n={1} />);
    expect(seen.length).toBeGreaterThan(1);
    // A changing identity would silently break every dependency array the
    // lifetime appears in — the card's commit/cancel doors among them.
    expect(new Set(seen).size).toBe(1);
  });

  it("survives StrictMode's mount → cleanup → mount with a LIVE scope", () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    let lt!: ViewLifetime;
    render(
      <StrictMode>
        <Probe onReady={(l) => (lt = l)} />
      </StrictMode>,
    );

    // The first pass's scope was disposed by StrictMode's synthetic unmount,
    // with no render in between. A facade still pointing at it would arm
    // nothing and the component's timers would be dead on arrival.
    expect(lt.disposed).toBe(false);
    lt.setTimeout(fired, 50);
    act(() => void vi.advanceTimersByTime(100));
    expect(fired).toHaveBeenCalledTimes(1);
  });
});
