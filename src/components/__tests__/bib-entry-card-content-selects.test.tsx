// @vitest-environment jsdom
//
// Task 1410 — interacting with a POPPED-OUT bibliography card's fields selects
// that card (task 1357's one rule: PanelCard's capture-phase `onSelectOnly`).
// A popped bib card is never compressed, so its annotation field is live while
// the card is unselected; it renders `<PanelCard>` directly (no anchored-card
// shell), so it reaches the rule through its own `onSelect` prop — a pure
// select, never the toggle + list-focus `onClick` makes.
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

import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

const entry = {
  uid: "u-1410",
  key: "popped2024",
  type: "article",
  fields: { author: "A. Author", year: "2024", title: "T" },
  raw: "",
} as BibEntry;

function renderPopped(isSelected: boolean) {
  const onClick = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <BibEntryCard
      entry={entry}
      isSelected={isSelected}
      isPoppedOut
      onClick={onClick}
      onSelect={onSelect}
      getAnnotation={() => "<p>note</p>"}
      setAnnotation={() => {}}
      onRequestReview={async () => ({ ok: true as const })}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onSaveBibEntry={async () => ({ kind: "declined" as const })}
    />,
  );
  fireEvent.click(screen.getByText("Annotations"));
  const field = utils.container.querySelector<HTMLElement>(".rtf-content [contenteditable], .rtf-content[contenteditable]")
    ?? utils.container.querySelector<HTMLElement>("[contenteditable]");
  return { ...utils, onClick, onSelect, field };
}

describe("a popped bib card's fields select it (task 1410)", () => {
  it("unselected: a pointer-down in the annotation field selects once — never the toggle", () => {
    const { field, onSelect, onClick } = renderPopped(false);
    expect(field).not.toBeNull();
    fireEvent.pointerDown(field!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("already selected: nothing to do", () => {
    const { field, onSelect } = renderPopped(true);
    fireEvent.pointerDown(field!);
    fireEvent.focus(field!);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
