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
import { parseBibFile } from "@/lib/bib-parser";

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

// TASK 1209: after a type change each key has ONE editor. A row whose key the
// new type shows as a form field is folded into that field — before, the row
// stayed, the field was shown twice, and the row's stale value overwrote the
// user's edit (or clearing) of the form field on save.
describe("BibEditModal — a type change gives each key one editor", () => {
  function renderMisc(fields: Record<string, string>) {
    const body = Object.entries(fields)
      .map(([k, v]) => `  ${k} = {${v}}`)
      .join(",\n");
    const raw = `@misc{lee2010,\n${body}\n}\n`;
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SystemDialogProvider>
        <BibEditModal
          entry={{ key: "lee2010", type: "misc", fields, raw }}
          onSave={onSave}
          onClose={vi.fn()}
        />
      </SystemDialogProvider>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "article" } });
    return { onSave };
  }

  const BASE = { author: "Lee, K.", title: "T", year: "2010" };

  it("the folded field renders once, as the form field", () => {
    renderMisc({ ...BASE, journal: "Old Journal" });
    expect(screen.getAllByDisplayValue("Old Journal")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Remove journal" })).toBeNull();
  });

  it("an edit to the folded field is what is saved", async () => {
    const { onSave } = renderMisc({ ...BASE, journal: "Old Journal" });
    fireEvent.change(screen.getByDisplayValue("Old Journal"), {
      target: { value: "New Journal" },
    });
    await save();
    const payload = onSave.mock.calls[0][0];
    expect(payload.type).toBe("article");
    expect(payload.set).toEqual({ journal: "New Journal" });
    expect(payload.remove).toEqual([]);
  });

  it("clearing the folded field removes it", async () => {
    const { onSave } = renderMisc({ ...BASE, journal: "Old Journal" });
    fireEvent.change(screen.getByDisplayValue("Old Journal"), { target: { value: "" } });
    await save();
    const payload = onSave.mock.calls[0][0];
    expect(payload.remove).toEqual(["journal"]);
    expect(payload.set).toEqual({});
  });

  it("switching back keeps the field (763's carry-over), not a resurrected row", async () => {
    const { onSave } = renderMisc({ ...BASE, journal: "Old Journal" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "misc" } });
    expect(screen.queryByDisplayValue("Old Journal")).toBeNull();
    // A type round-trip back to the disk type is no edit at all.
    await save();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a differently-cased disk key is one editor, saved under one spelling", async () => {
    const { onSave } = renderMisc({ ...BASE, Journal: "Old Journal" });
    expect(screen.getAllByDisplayValue("Old Journal")).toHaveLength(1);
    fireEvent.change(screen.getByDisplayValue("Old Journal"), {
      target: { value: "New Journal" },
    });
    await save();
    const payload = onSave.mock.calls[0][0];
    expect(payload.set).toEqual({ journal: "New Journal" });
    expect(payload.remove).toEqual([]);
  });

  it("a key the new type does not show stays a row", () => {
    renderMisc({ ...BASE, customa: "Alpha" });
    expect(screen.getByRole("button", { name: "Remove customa" })).toBeTruthy();
  });
});
