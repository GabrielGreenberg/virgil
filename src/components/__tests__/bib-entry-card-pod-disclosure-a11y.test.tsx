// @vitest-environment jsdom
//
// Task 1187 — the bib card's sub-pod disclosures are the ONE `PodDisclosure`
// primitive: a `type="button"` that announces its expanded state (flipping on
// click) and wears the focus indicator; "Edit entry" is a typed, focus-ringed
// button; and the inline editor's inputs have accessible names (they were
// labelled only by sibling <span>s, so a screen reader heard "edit text" ×N).

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

function renderCard() {
  const onClick = vi.fn();
  render(
    <BibEntryCard
      entry={{
        uid: "u1",
        key: "foo2020",
        type: "article",
        fields: { author: "A. Author", title: "Orig" },
        raw: "",
      } as BibEntry}
      isSelected
      onClick={onClick}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={async () => ({ ok: true as const })}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onSaveBibEntry={async () => ({ kind: "declined" as const })}
    />,
  );
  return { onClick };
}

describe("BibEntryCard pod disclosures (task 1187)", () => {
  for (const name of ["BibTeX Fields", "Annotations"]) {
    it(`"${name}" is a typed, focus-ringed button whose aria-expanded flips`, () => {
      const { onClick } = renderCard();
      const btn = screen.getByRole("button", { name });
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.className).toMatch(/\bfocus-ring\b/);
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(btn);
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(btn);
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      // The toggle does not reach the card body's own click.
      expect(onClick).not.toHaveBeenCalled();
    });
  }

  it("Edit entry is a typed, focus-ringed button", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "BibTeX Fields" }));
    const edit = screen.getByRole("button", { name: "Edit entry" });
    expect(edit.getAttribute("type")).toBe("button");
    expect(edit.className).toMatch(/\bfocus-ring\b/);
  });

  it("the inline editor's inputs have accessible names", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "BibTeX Fields" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
    expect((screen.getByRole("textbox", { name: "Entry type" }) as HTMLInputElement).value).toBe("article");
    expect((screen.getByRole("textbox", { name: "Cite key" }) as HTMLInputElement).value).toBe("foo2020");
    expect((screen.getByRole("textbox", { name: "Field author" }) as HTMLInputElement).value).toBe("A. Author");
    expect((screen.getByRole("textbox", { name: "Field title" }) as HTMLInputElement).value).toBe("Orig");
  });
});
