// @vitest-environment jsdom
//
// T6-C16 / BIB-F5-04 — the inline bib editor's "remove field" affordance must
// persist a field map that OMITS the removed field ("I cleared the field but
// it came back" is the bug). Since task 691 that map rides the ONE save door
// (`onSaveBibEntry`), whose `fields` is set-all by contract — so the delete is
// honored by construction rather than by picking the right one of two writers.
// This suite also pins the count: ONE call per Save, never the two (fields,
// then head) that raced in the `.bib` write queue.

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

function makeEntry(): BibEntry {
  return {
    uid: "u1",
    key: "foo2020",
    type: "article",
    fields: { author: "A. Author", title: "Orig", year: "2020", note: "stray" },
    raw: "",
  } as BibEntry;
}

function renderCard(overrides: Partial<React.ComponentProps<typeof BibEntryCard>> = {}) {
  const onSaveBibEntry = vi.fn();
  render(
    <BibEntryCard
      entry={makeEntry()}
      isSelected
      onClick={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onSaveBibEntry={onSaveBibEntry}
      {...overrides}
    />,
  );
  return { onSaveBibEntry };
}

function openEditor() {
  fireEvent.click(screen.getByText("BibTeX Fields"));
  fireEvent.click(screen.getByText("Edit entry"));
}

describe("BibEntryCard inline editor — field delete (BIB-F5-04)", () => {
  it("removing a field then Save sends the OMITTED field through the one save door", () => {
    const { onSaveBibEntry } = renderCard();
    openEditor();

    // Remove the `note` field via its remove button.
    fireEvent.click(screen.getByLabelText("Remove field note"));
    fireEvent.click(screen.getByText("Save"));

    // ONE write for the gesture (task 691), not a field write plus a head
    // write racing each other in the `.bib`'s serial queue.
    expect(onSaveBibEntry).toHaveBeenCalledTimes(1);
    // The mutator takes the ENTRY, not its citekey (task 690) — a citekey
    // names as many `.bib` blocks as carry it.
    const [target, patch] = onSaveBibEntry.mock.calls[0];
    expect(target.key).toBe("foo2020");
    // The removed field is GONE from the set-all map (deleted, not retained).
    expect("note" in patch.fields).toBe(false);
    // The other fields survive.
    expect(patch.fields.author).toBe("A. Author");
    expect(patch.fields.title).toBe("Orig");
    expect(patch.fields.year).toBe("2020");
  });

  it("a remove button exists for every field", () => {
    renderCard();
    openEditor();
    for (const f of ["author", "title", "year", "note"]) {
      expect(screen.getByLabelText(`Remove field ${f}`)).toBeTruthy();
    }
  });

  it("Save carries the whole head — type AND citekey — in the SAME write", () => {
    const { onSaveBibEntry } = renderCard();
    openEditor();
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveBibEntry).toHaveBeenCalledTimes(1);
    const [, patch] = onSaveBibEntry.mock.calls[0];
    expect(patch.type).toBe("article");
    expect(patch.key).toBe("foo2020");
  });
});
