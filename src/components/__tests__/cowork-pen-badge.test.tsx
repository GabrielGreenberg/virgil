// @vitest-environment jsdom
//
// Task 489 — the WORDS that reach the user, which is a render fact no store or
// hook test can see. Gabriel asked for a "loud indicator to show what is
// happening"; the read-only flip is invisible without it, and a document that
// silently stops accepting keystrokes is a worse experience than one that never
// went read-only at all.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { BAR_STATUS_POLICY } from "@/lib/bar-status-policy";
import CoworkPenBadge from "@/components/CoworkPenBadge";
import { clearCoworkPen, noteCoworkPen } from "@/lib/cowork-pen";

function hold(docId: string) {
  noteCoworkPen(docId, {
    holder: "claude",
    since: Date.now(),
    expiresAt: Date.now() + 30_000,
    source: "pen-context",
  });
}

afterEach(() => {
  cleanup();
  clearCoworkPen();
});

describe("CoworkPenBadge", () => {
  it("renders NOTHING with no hold — self-gating, like its four neighbours", () => {
    const { container } = render(<CoworkPenBadge docId="doc-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("a hold that releases inside the settle window NEVER paints (task 1174)", () => {
    vi.useFakeTimers();
    try {
      hold("doc-1");
      const { container } = render(<CoworkPenBadge docId="doc-1" />);
      expect(container.firstChild).toBeNull();
      act(() => {
        vi.advanceTimersByTime(BAR_STATUS_POLICY["cowork-pen"].settleMs - 1_000);
      });
      expect(container.firstChild).toBeNull();
      act(() => clearCoworkPen());
      act(() => {
        vi.advanceTimersByTime(BAR_STATUS_POLICY["cowork-pen"].settleMs * 2);
      });
      expect(container.firstChild).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("names what is happening while a cowork skill holds the pen (once the hold LASTS)", () => {
    vi.useFakeTimers();
    try {
      hold("doc-1");
      render(<CoworkPenBadge docId="doc-1" />);
      act(() => {
        vi.advanceTimersByTime(BAR_STATUS_POLICY["cowork-pen"].settleMs + 10);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText(/Virgil is editing this paper/i)).toBeTruthy();
    // …and it says WHY the editor stopped accepting typing.
    const label = screen
      .getByRole("status")
      .getAttribute("aria-label")!
      .toLowerCase();
    expect(label).toContain("read-only");
    expect(label).toContain("saving is paused");
  });

  it("is per-DOCUMENT: a hold on another paper says nothing here", () => {
    hold("other-doc");
    const { container } = render(<CoworkPenBadge docId="doc-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("has no doc at all → nothing", () => {
    hold("doc-1");
    const { container } = render(<CoworkPenBadge docId={null} />);
    expect(container.firstChild).toBeNull();
  });
});
