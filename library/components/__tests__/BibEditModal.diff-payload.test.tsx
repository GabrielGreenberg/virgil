// @vitest-environment jsdom
//
// TASK 763: the Edit-entry modal queues a DIFF against the entry it opened on,
// never a whole entry — so a field added on disk meanwhile cannot be deleted by
// omission, and a field the user removes is NAMED as removed. Before: ✕ on an
// "Other fields" row was inert (a carry-over loop re-added the key), and a
// selection drag released on the backdrop closed the modal and lost the edit.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { BibEntry } from "@library/lib/types";
import BibEditModal from "@library/components/BibEditModal";
import { buildBibEditDiff, isEmptyBibEditDiff } from "@library/lib/bib-edit";

afterEach(() => cleanup());

const RAW = `@article{smith2020,
  author = {Smith, J.},
  title = {A Title},
  year = {2020},
  customa = {Alpha}
}
`;

function makeEntry(): BibEntry {
  return {
    key: "smith2020",
    type: "article",
    fields: { author: "Smith, J.", title: "A Title", year: "2020", customa: "Alpha" },
    raw: RAW,
  };
}

function renderModal() {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(<BibEditModal entry={makeEntry()} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => undefined);
}

describe("buildBibEditDiff", () => {
  it("names only what changed, and carries the base", () => {
    const d = buildBibEditDiff(makeEntry(), "article", {
      author: "Smith, J.",
      title: "A Better Title",
      year: "2020",
      doi: "10.1/x",
    });
    expect(d.set).toEqual({ title: "A Better Title", doi: "10.1/x" });
    expect(d.remove).toEqual(["customa"]);
    expect(d.baseType).toBe("article");
    expect(d.baseRaw).toBe(RAW);
  });

  it("an untouched entry is an empty diff", () => {
    const e = makeEntry();
    expect(isEmptyBibEditDiff(buildBibEditDiff(e, e.type, { ...e.fields }))).toBe(true);
  });
});

describe("BibEditModal — saves a diff", () => {
  it("✕ on a custom field puts it in `remove`, not `set`", async () => {
    const { onSave } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Remove customa" }));
    await save();
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.remove).toEqual(["customa"]);
    expect(payload.set).toEqual({});
  });

  it("renaming a custom field removes the old key and sets the new one", async () => {
    const { onSave } = renderModal();
    const key = screen.getByPlaceholderText("field") as HTMLInputElement;
    fireEvent.change(key, { target: { value: "customb" } });
    await save();
    const payload = onSave.mock.calls[0][0];
    expect(payload.remove).toEqual(["customa"]);
    expect(payload.set).toEqual({ customb: "Alpha" });
  });

  it("an edit to one field sends only that field", async () => {
    const { onSave } = renderModal();
    const title = screen.getByDisplayValue("A Title");
    fireEvent.change(title, { target: { value: "A New Title" } });
    await save();
    const payload = onSave.mock.calls[0][0];
    expect(payload.set).toEqual({ title: "A New Title" });
    expect(payload.remove).toEqual([]);
  });

  it("Save with no change queues nothing and closes", async () => {
    const { onSave, onClose } = renderModal();
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("BibEditModal — backdrop", () => {
  it("a press that starts inside the card and ends on the backdrop does not close", () => {
    const { onClose } = renderModal();
    const backdrop = screen.getByRole("dialog");
    const inside = screen.getByDisplayValue("A Title");
    fireEvent.mouseDown(inside);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a press wholly on the backdrop closes", () => {
    const { onClose } = renderModal();
    const backdrop = screen.getByRole("dialog");
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
