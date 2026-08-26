// @vitest-environment jsdom
//
// Task 489 — the WORDS that reach the user, which is a render fact no store or
// hook test can see. Gabriel asked for a "loud indicator to show what is
// happening"; the read-only flip is invisible without it, and a document that
// silently stops accepting keystrokes is a worse experience than one that never
// went read-only at all.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

  it("names what is happening while a cowork skill holds the pen", () => {
    hold("doc-1");
    render(<CoworkPenBadge docId="doc-1" />);
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
