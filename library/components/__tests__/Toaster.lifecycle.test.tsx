// @vitest-environment jsdom
//
// F#6 guard test. The old Toaster kept ALL dismiss timers in one effect whose
// cleanup `clearTimeout`-ed every timer on each `items` change and only
// re-armed the NEW toasts — so a toast that was still visible when a sibling
// arrived had its timer cancelled and never re-armed → it stuck forever.
//
// These tests pin the new contract: each toast owns its own lifecycle timer,
// pause-on-hover banks remaining time, and the ✕ closes immediately. They fail
// if anyone reverts to a shared-timer effect.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { NotificationItem } from "@library/lib/queue";
import { NOTIFICATION_TTL_MS } from "@library/lib/queue";
import Toaster from "../Toaster";

const INFO_TTL = NOTIFICATION_TTL_MS.info;
const ATTN_TTL = NOTIFICATION_TTL_MS.attention;

function info(at: string, citekey?: string): NotificationItem {
  return { kind: "indexed", at, citekey, summary: `done ${at}` };
}
function attention(at: string): NotificationItem {
  return { kind: "setup-needed", at, summary: `setup ${at}` };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toaster lifecycle (F#6)", () => {
  it("auto-dismisses an info toast after its TTL", () => {
    const { queryByText } = render(<Toaster items={[info("t1")]} />);
    expect(queryByText("done t1")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(INFO_TTL + 10);
    });
    expect(queryByText("done t1")).toBeNull();
  });

  it("a sibling toast arriving does NOT cancel the first toast's timer (the bug)", () => {
    const { rerender, queryByText } = render(<Toaster items={[info("t1")]} />);
    // Halfway through the first toast's life, a second toast arrives.
    act(() => {
      vi.advanceTimersByTime(INFO_TTL / 2);
    });
    rerender(<Toaster items={[info("t1"), info("t2")]} />);
    // Finish the first toast's original TTL. Under the old shared-timer bug
    // its timer was cancelled by the sibling's arrival and never re-armed, so
    // it would still be on screen here. With per-toast timers it dismisses.
    act(() => {
      vi.advanceTimersByTime(INFO_TTL / 2 + 10);
    });
    expect(queryByText("done t1")).toBeNull();
    expect(queryByText("done t2")).not.toBeNull();
    // And the second toast dismisses on its own full TTL.
    act(() => {
      vi.advanceTimersByTime(INFO_TTL / 2 + 10);
    });
    expect(queryByText("done t2")).toBeNull();
  });

  it("attention toasts live longer than info toasts", () => {
    const { queryByText } = render(<Toaster items={[attention("a1")]} />);
    act(() => {
      vi.advanceTimersByTime(INFO_TTL + 10);
    });
    // Still visible past the info TTL.
    expect(queryByText("setup a1")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(ATTN_TTL - INFO_TTL + 10);
    });
    expect(queryByText("setup a1")).toBeNull();
  });

  it("hovering pauses the countdown; leaving resumes from the banked remainder", () => {
    const { getByText, queryByText } = render(<Toaster items={[info("t1")]} />);
    const card = getByText("done t1").parentElement as HTMLElement;
    // Burn most of the TTL, then hover before it expires.
    act(() => {
      vi.advanceTimersByTime(INFO_TTL - 500);
    });
    fireEvent.mouseEnter(card);
    // Time passes while hovered — must NOT dismiss.
    act(() => {
      vi.advanceTimersByTime(INFO_TTL * 3);
    });
    expect(queryByText("done t1")).not.toBeNull();
    // Leaving resumes; only the banked 500ms remains.
    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(queryByText("done t1")).toBeNull();
  });

  it("the ✕ button dismisses immediately", () => {
    const { getByLabelText, queryByText } = render(<Toaster items={[info("t1")]} />);
    fireEvent.click(getByLabelText("Dismiss notification"));
    expect(queryByText("done t1")).toBeNull();
  });
});
