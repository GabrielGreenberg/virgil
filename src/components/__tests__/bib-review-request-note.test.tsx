// @vitest-environment jsdom
//
// Task 981 — the bib card's review-request note box was a SINK.
//
// The chip minted the request on the click that OPENED the note strip, so the
// draft it read was necessarily empty; afterwards nothing read the draft, the
// hook's `requestReview` no-ops on an already-pending row, and clicking the
// chip again (to "send") CANCELLED the request. Every persisted row carried
// `requestNotes: undefined` — the field `/editor/answer-bib-review` reads.
//
// The contract now: compose-then-send. Opening writes nothing; Return (or the
// chip, now "Send") mints ONCE with the typed note; Escape cancels and writes
// nothing; a pending request shows the note READ BACK from the row.

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

import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import { useBibReview } from "@/hooks/useBibReview";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

const ENTRY: BibEntry = {
  uid: "u-1",
  key: "foo2020",
  type: "article",
  fields: { author: "A. Author", title: "A title", year: "2020" },
  raw: "",
} as BibEntry;

function renderCard(
  overrides: Partial<React.ComponentProps<typeof BibEntryCard>> = {},
) {
  const onRequestReview = vi.fn();
  const onCancelReview = vi.fn();
  const utils = render(
    <BibEntryCard
      entry={ENTRY}
      isSelected
      onClick={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={onRequestReview}
      onCancelReview={onCancelReview}
      getReviewStatus={() => "none"}
      onSaveBibEntry={() => {}}
      {...overrides}
    />,
  );
  return { onRequestReview, onCancelReview, ...utils };
}

const chip = (c: HTMLElement, type: "fields" | "notes") =>
  c.querySelector(`[data-review-request-chip="${type}"]`) as HTMLButtonElement;
const noteInput = (c: HTMLElement, type: "fields" | "notes") =>
  c.querySelector(`[data-review-request-note="${type}"]`) as HTMLInputElement | null;

describe.each(["fields", "notes"] as const)("task 981 — %s review request", (type) => {
  it("opening the composer writes nothing; Return sends the typed note once", () => {
    const { container, onRequestReview } = renderCard();
    fireEvent.click(chip(container, type));
    expect(onRequestReview).not.toHaveBeenCalled();
    const input = noteInput(container, type)!;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "add the DOI; check the page range" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRequestReview).toHaveBeenCalledTimes(1);
    expect(onRequestReview).toHaveBeenCalledWith(
      "foo2020",
      type,
      "add the DOI; check the page range",
    );
    expect(noteInput(container, type)).toBeNull();
  });

  it("the chip reads Send while composing and sends on click (empty note is fine)", () => {
    const { container, onRequestReview } = renderCard();
    fireEvent.click(chip(container, type));
    expect(chip(container, type).textContent).toBe("Send");
    fireEvent.click(chip(container, type));
    expect(onRequestReview).toHaveBeenCalledWith("foo2020", type, undefined);
  });

  it("Escape in the draft cancels — nothing is ever sent", () => {
    const { container, onRequestReview, onCancelReview } = renderCard();
    fireEvent.click(chip(container, type));
    const input = noteInput(container, type)!;
    fireEvent.change(input, { target: { value: "never mind" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(noteInput(container, type)).toBeNull();
    expect(onRequestReview).not.toHaveBeenCalled();
    expect(onCancelReview).not.toHaveBeenCalled();
  });

  it("a pending request shows the note read back from the row; the chip cancels", () => {
    const { container, onCancelReview } = renderCard({
      getReviewStatus: (_k, t) => (t === type ? "pending" : "none"),
      getReviewNotes: (_k, t) => (t === type ? "the sent note" : undefined),
    });
    // The pod must be open to show the strip.
    fireEvent.click(screen.getByText(type === "fields" ? "BibTeX Fields" : "Annotations"));
    const sent = container.querySelector(`[data-review-request-sent="${type}"]`);
    expect(sent?.textContent).toBe("the sent note");
    expect(noteInput(container, type)).toBeNull();
    fireEvent.click(chip(container, type));
    expect(onCancelReview).toHaveBeenCalledWith("foo2020", type);
  });
});

it("the fields placeholder addresses the reviewer, not the annotator", () => {
  const { container } = renderCard();
  fireEvent.click(chip(container, "fields"));
  expect(noteInput(container, "fields")!.placeholder).not.toMatch(/annotation/i);
});

describe("task 981 — useBibReview carries the note into the row", () => {
  it("requestReview persists requestNotes; getRequestNotes reads it back", () => {
    const { result } = renderHook(() => useBibReview(null));
    act(() => result.current.requestReview("foo2020", "fields", "add the DOI"));
    const row = result.current.requests.find((r) => r.bibKey === "foo2020");
    expect(row?.requestNotes).toBe("add the DOI");
    expect(result.current.getRequestNotes("foo2020", "fields")).toBe("add the DOI");
    expect(result.current.getRequestNotes("foo2020", "notes")).toBeUndefined();
  });
});
