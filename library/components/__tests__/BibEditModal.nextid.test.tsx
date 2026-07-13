// @vitest-environment jsdom
//
// TASK 128: the extra-row id allocator (`nextId`) and the row seeder
// (`seedExtraRowsFromFields`) must draw from ONE monotonic counter, so a
// raw→form switch can never leave `nextId` behind the re-seeded row ids. If it
// does, the next "+ Add field" mints an id that collides with an existing extra
// row — editing the new row then mutates (or, on save, corrupts/drops) the
// pre-existing field, and React warns about a duplicate key.
//
// Unlike RightDetail.edit-gate.test.tsx (which `vi.mock`s the modal), this test
// renders the REAL <BibEditModal> and drives the mode toggle + add-field flow.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { BibEntry } from "@library/lib/types";
import BibEditModal from "@library/components/BibEditModal";

afterEach(() => cleanup());

// An all-known entry: 0 extra rows at mount, so `nextId` seeds to 1 — the exact
// starting point `seedExtraRowsFromFields` restarts from, which is what made the
// pre-fix collision reachable.
function makeEntry(): BibEntry {
  return {
    key: "smith2020",
    type: "article",
    fields: { author: "Smith, J.", title: "A Title", year: "2020" },
    raw: "",
  };
}

// A raw block carrying the same known fields PLUS two unknown (extra) fields.
const RAW_WITH_TWO_EXTRAS = `@article{smith2020,
  author = {Smith, J.},
  title = {A Title},
  year = {2020},
  customa = {Alpha},
  customb = {Beta}
}`;

describe("BibEditModal — extra-row id allocator survives a raw→form switch", () => {
  it("adds a third custom field without colliding with the two re-seeded rows", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<BibEditModal entry={makeEntry()} onSave={onSave} onClose={() => {}} />);

    // Start in Form mode with zero extra rows.
    expect(screen.queryAllByPlaceholderText("field")).toHaveLength(0);

    // → Raw, seed two unknown fields into the raw text.
    fireEvent.click(screen.getByRole("tab", { name: "Raw BibTeX" }));
    const rawTextarea = screen.getByRole("textbox");
    fireEvent.change(rawTextarea, { target: { value: RAW_WITH_TWO_EXTRAS } });

    // ← Form: the two unknowns are re-seeded as extra rows (ids 1, 2). The
    // allocator must now advance PAST them.
    fireEvent.click(screen.getByRole("tab", { name: "Form" }));
    let keyInputs = screen.getAllByPlaceholderText("field") as HTMLInputElement[];
    let valueInputs = screen.getAllByPlaceholderText("value") as HTMLInputElement[];
    expect(keyInputs.map((i) => i.value)).toEqual(["customa", "customb"]);
    expect(valueInputs.map((i) => i.value)).toEqual(["Alpha", "Beta"]);

    // "+ Add field" → a third row. Pre-fix, `nextId` was still 1, so this row
    // shared an id with `customa` and editing it would mutate customa.
    fireEvent.click(screen.getByRole("button", { name: "+ Add field" }));
    keyInputs = screen.getAllByPlaceholderText("field") as HTMLInputElement[];
    valueInputs = screen.getAllByPlaceholderText("value") as HTMLInputElement[];
    expect(keyInputs).toHaveLength(3);

    // Fill only the NEW (third) row.
    fireEvent.change(keyInputs[2], { target: { value: "customc" } });
    fireEvent.change(valueInputs[2], { target: { value: "Gamma" } });

    // The pre-existing rows must be untouched — the crux of the non-cross-
    // mutation contract.
    keyInputs = screen.getAllByPlaceholderText("field") as HTMLInputElement[];
    valueInputs = screen.getAllByPlaceholderText("value") as HTMLInputElement[];
    expect(keyInputs.map((i) => i.value)).toEqual(["customa", "customb", "customc"]);
    expect(valueInputs.map((i) => i.value)).toEqual(["Alpha", "Beta", "Gamma"]);

    // On save, consolidateFields must emit all three custom fields correctly.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [, savedFields] = onSave.mock.calls[0] as [string, Record<string, string>];
    expect(savedFields.customa).toBe("Alpha");
    expect(savedFields.customb).toBe("Beta");
    expect(savedFields.customc).toBe("Gamma");
  });
});
