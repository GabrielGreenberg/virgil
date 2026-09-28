// @vitest-environment jsdom
//
// TASK 763: the Edit-entry modal queues a DIFF against the entry it opened on,
// never a whole entry — so a field added on disk meanwhile cannot be deleted by
// omission, and a field the user removes is NAMED as removed. Before: ✕ on an
// "Other fields" row was inert (a carry-over loop re-added the key), and a
// selection drag released on the backdrop closed the modal and lost the edit.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// `SystemDialogProvider` pulls `@/lib/storage`, whose backend `require` is not
// resolvable under vitest (the repo-wide gotcha).
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { SystemDialogProvider } from "@/components/system-dialog-host";
import { __resetDialogStack } from "@/components/dialog-stack";

import type { BibEntry } from "@library/lib/types";
import BibEditModal from "@library/components/BibEditModal";
import { buildBibEditDiff, isEmptyBibEditDiff } from "@library/lib/bib-edit";
import { parseBibFile } from "@library/lib/bib-parser";

afterEach(() => {
  cleanup();
  __resetDialogStack();
});

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
  render(<SystemDialogProvider><BibEditModal entry={makeEntry()} onSave={onSave} onClose={onClose} /></SystemDialogProvider>);
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

  it("a press wholly on the backdrop closes an UNEDITED entry", async () => {
    const { onClose } = renderModal();
    const backdrop = screen.getByRole("dialog");
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    // The dismissal guard answers through a promise (task 820), even when the
    // answer is "free" — let it settle.
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

// TASK 795: the modal opens on the DISK entry (`raw`), not the CSL projection
// the full-entry fetch hands it for display.
describe("BibEditModal — opens on the disk entry, not the CSL projection", () => {
  const INBOOK = `@inbook{doe2001,
  author = {Doe, Jane},
  title = {The {GB} Theory of \\emph{X}},
  booktitle = {The Big Book},
  year = {2001}
}
`;

  function renderProjected() {
    const [projected] = parseBibFile(INBOOK);
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SystemDialogProvider><BibEditModal entry={projected} onSave={onSave} onClose={vi.fn()} /></SystemDialogProvider>);
    return { onSave };
  }

  it("seeds the disk type, the verbatim title and booktitle (no journal row)", () => {
    renderProjected();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("inbook");
    expect(screen.getByDisplayValue("The {GB} Theory of \\emph{X}")).toBeTruthy();
    expect(screen.getByDisplayValue("The Big Book")).toBeTruthy();
    expect(screen.queryByText("journal")).toBeNull();
  });

  it("a type change names the disk type as its base", async () => {
    const { onSave } = renderProjected();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "book" } });
    await save();
    const payload = onSave.mock.calls[0][0];
    expect(payload.type).toBe("book");
    expect(payload.baseType).toBe("inbook");
    expect(payload.set).toEqual({});
  });

  it("Save with no change on a projected entry queues nothing", async () => {
    const { onSave } = renderProjected();
    await save();
    expect(onSave).not.toHaveBeenCalled();
  });
});
