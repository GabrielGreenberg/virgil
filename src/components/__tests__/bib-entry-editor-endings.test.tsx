// @vitest-environment jsdom
//
// Task 1522 — the bib entry editor's ENDINGS are separate channels (law:
// Escape means cancel).
//   - Cancel is unreachable while a save is in flight: the write cannot be
//     un-sent, so closing over it hid a refusal and lost the draft.
//   - A save that REJECTS releases the in-flight lock and says why.
//   - Escape in any field cancels (no write); ⌘/Ctrl+Enter saves.

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

import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";
import type { BibSaveResult } from "@/lib/project-bib";

afterEach(cleanup);

const ENTRY: BibEntry = {
  uid: "u-1",
  key: "foo2020",
  type: "article",
  fields: { author: "A. Author", title: "A title", year: "2020" },
  raw: "",
} as BibEntry;

function renderCard(save: () => Promise<BibSaveResult>) {
  const spy = vi.fn(save);
  const utils = render(
    <BibEntryCard
      entry={ENTRY}
      isSelected
      onClick={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={async () => ({ ok: true as const })}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onSaveBibEntry={spy}
    />,
  );
  return { save: spy, ...utils };
}

function openEditorAndType(container: HTMLElement): HTMLInputElement {
  fireEvent.click(screen.getByText("BibTeX Fields"));
  fireEvent.click(screen.getByText("Edit entry"));
  const titleInput = Array.from(container.querySelectorAll("input")).find(
    (i) => i.value === "A title",
  )!;
  fireEvent.change(titleInput, { target: { value: "My retyped title" } });
  return titleInput;
}

const editorOpen = (c: HTMLElement) => c.querySelector("[data-bib-entry-editor]") !== null;

describe("task 1522 — Cancel during an in-flight save", () => {
  it("Cancel is disabled while saving; a refusal then reports to the still-open editor", async () => {
    let resolve!: (r: BibSaveResult) => void;
    const { container } = renderCard(
      () => new Promise<BibSaveResult>((r) => { resolve = r; }),
    );
    openEditorAndType(container);
    fireEvent.click(screen.getByText("Save"));
    const cancel = screen.getByText("Saving…").closest("button")!;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    // Escape is a no-op while saving, too.
    fireEvent.keyDown(container.querySelector("[data-bib-entry-editor] input")!, { key: "Escape" });
    expect(editorOpen(container)).toBe(true);
    await act(async () => resolve({ kind: "read-only" }));
    expect(container.querySelector("[data-bib-save-error]")?.textContent).toMatch(/read-only/i);
    expect(editorOpen(container)).toBe(true);
    expect(screen.getByText("Cancel").closest("button")!.disabled).toBe(false);
  });

  it("a rejecting save clears the lock and says why", async () => {
    const { container } = renderCard(async () => {
      throw new Error("disk on fire");
    });
    openEditorAndType(container);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(container.querySelector("[data-bib-save-error]")?.textContent).toMatch(/disk on fire/),
    );
    expect(screen.getByText("Save").closest("button")!.disabled).toBe(false);
    expect(screen.getByText("Cancel").closest("button")!.disabled).toBe(false);
  });
});

describe("task 1522 — keyboard endings", () => {
  it("Escape in a field closes the editor without writing", () => {
    const { container, save } = renderCard(async () => ({ kind: "written" }) as BibSaveResult);
    const input = openEditorAndType(container);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(editorOpen(container)).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("⌘/Ctrl+Enter in a field saves (once, even when held)", async () => {
    const { container, save } = renderCard(async () => ({ kind: "declined" }) as BibSaveResult);
    const input = openEditorAndType(container);
    fireEvent.keyDown(input, { key: "Enter", metaKey: true, ctrlKey: true });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true, ctrlKey: true, repeat: true });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((save.mock.calls[0] as unknown[])[1]).toMatchObject({
      fields: expect.objectContaining({ title: "My retyped title" }),
    });
  });

  it("plain Enter does not save", () => {
    const { container, save } = renderCard(async () => ({ kind: "written" }) as BibSaveResult);
    const input = openEditorAndType(container);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(save).not.toHaveBeenCalled();
    expect(editorOpen(container)).toBe(true);
  });
});
