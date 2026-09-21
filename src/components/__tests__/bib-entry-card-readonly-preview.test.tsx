// @vitest-environment jsdom
//
// Task 692 — a PREVIEW card has no write surface, and it has ONE gate.
//
// Bug class: every write `BibEntryCard` offers is addressed by `entry.key`
// into THIS paper's stores — the `.bib` save, the annotation, the two review
// requests. A central-library search result is a record of `master.bib`, so
// that address is either NOTHING (the citekey is not in the local bib: the
// Save matched no entry, was `declined`, and the editor simply closed with no
// feedback) or a DIFFERENT record (the citekey IS local: a set-all Save seeded
// from the LIBRARY's fields overwrote the paper's own entry, deleting every
// field the library copy lacked).
//
// The fix is one flag the CARD reads — `readOnly` — because the card is what
// knows which affordances write. These legs pin the whole surface, not just
// the button the audit found: the editor, the annotation pod, both review
// requests, the drag, and the pop-out IDENTITY (lifting a preview card
// resolved its id against the LOCAL entries — the cross-target write again,
// one gesture further out).

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

const PREVIEW_REASON = "Library preview — add this entry to the paper to edit it.";

function makeEntry(): BibEntry {
  return {
    uid: "u-lib",
    key: "foo2020",
    type: "article",
    fields: { author: "A. Author", title: "Library copy", year: "2020" },
    raw: "",
  } as BibEntry;
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof BibEntryCard>> = {},
) {
  const spies = {
    onSaveBibEntry: vi.fn(),
    setAnnotation: vi.fn(),
    onRequestReview: vi.fn(),
    onCancelReview: vi.fn(),
  };
  const { container } = render(
    <BibEntryCard
      entry={makeEntry()}
      isSelected
      onClick={() => {}}
      getAnnotation={() => "a local annotation"}
      setAnnotation={spies.setAnnotation}
      onRequestReview={spies.onRequestReview}
      onCancelReview={spies.onCancelReview}
      getReviewStatus={() => "none"}
      onSaveBibEntry={spies.onSaveBibEntry}
      {...overrides}
    />,
  );
  return { ...spies, container };
}

function openFieldsPod() {
  fireEvent.click(screen.getByText("BibTeX Fields"));
}

describe("BibEntryCard — a preview card has no write surface (task 692)", () => {
  it("offers no in-place editor, and says why instead", () => {
    const { onSaveBibEntry } = renderCard({ readOnly: { reason: PREVIEW_REASON } });
    openFieldsPod();

    // The affordance is absent — not disabled-looking, ABSENT — so the three
    // clicks (select → Edit entry → Save) cannot be made at all.
    expect(screen.queryByText("Edit entry")).toBeNull();
    expect(screen.queryByText("Save")).toBeNull();
    // …and the reason stands in its place, so the missing button is legible
    // rather than merely gone.
    expect(screen.getByText(PREVIEW_REASON)).toBeTruthy();
    expect(onSaveBibEntry).not.toHaveBeenCalled();
  });

  it("offers no annotation editor and no review requests", () => {
    const { setAnnotation, onRequestReview } = renderCard({
      readOnly: { reason: PREVIEW_REASON },
    });
    openFieldsPod();

    // The annotation pod is the write (it reads and writes THIS paper's note
    // for that citekey), so the whole pod goes with the gate.
    expect(screen.queryByText("Annotations")).toBeNull();
    // Both review buttons mint an AI request against this paper's inbox.
    expect(screen.queryByText("Request review")).toBeNull();
    expect(screen.queryByText("Request annotation")).toBeNull();
    expect(setAnnotation).not.toHaveBeenCalled();
    expect(onRequestReview).not.toHaveBeenCalled();
  });

  it("is neither a drag source nor a liftable float identity", () => {
    const { container } = renderCard({ readOnly: { reason: PREVIEW_REASON } });
    const root = container.querySelector("[data-card]") as HTMLElement;
    expect(root).not.toBeNull();
    // A `\cite{}` for a key this paper's references.bib does not hold.
    expect(root.getAttribute("draggable")).toBe("false");
    // `canLift` clause 1 is `!!cardKey` — withholding it is the registry's own
    // "not poppable", and it is what stops the lift from re-opening a FULLY
    // writable card for whichever local entry shares this citekey.
    expect(root.getAttribute("data-card-key")).toBeNull();
  });

  it("keeps the whole write surface when the card is NOT a preview", () => {
    const { container } = renderCard();
    openFieldsPod();
    expect(screen.getByText("Edit entry")).toBeTruthy();
    expect(screen.getByText("Annotations")).toBeTruthy();
    expect(screen.getByText("Request review")).toBeTruthy();
    const root = container.querySelector("[data-card]") as HTMLElement;
    expect(root.getAttribute("draggable")).toBe("true");
    expect(root.getAttribute("data-card-key")).toBeTruthy();
  });
});
