// @vitest-environment jsdom
//
// TASK 1012: the Library's text fields wear the shared field primitive's
// chrome — above all its keyboard focus indicator (`focus-visible:border-
// edge-strong`). Pre-1012 every one of them set `outline: "none"` inline with
// nothing in its place, so tabbing through the bib editor or the catalog search
// showed no focus at all. This renders the real surfaces and asserts each field
// carries the primitive's focus class and no inline chrome that would beat it.
// (The structural, tree-wide half is `field-chrome-guardrail.test.ts` Leg 5.)

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
import LibrarySearchInput from "@library/components/LibrarySearchInput";

afterEach(() => {
  cleanup();
  __resetDialogStack();
});

const FOCUS_CLASS = "focus-visible:border-edge-strong";

function expectPrimitiveChrome(el: HTMLElement) {
  expect(el.className).toContain(FOCUS_CLASS);
  // An inline border/outline/background beats the class — the pre-1012 shape.
  expect(el.style.outline).toBe("");
  expect(el.style.border).toBe("");
  expect(el.style.background).toBe("");
}

describe("Library fields carry the primitive's focus indicator (task 1012)", () => {
  it("every BibEditModal field, in both modes", () => {
    const entry: BibEntry = {
      key: "smith2020",
      type: "article",
      fields: { author: "Smith, J.", title: "A Title", year: "2020", customa: "Alpha" },
      raw: "",
    };
    render(
      <SystemDialogProvider>
        <BibEditModal entry={entry} onSave={vi.fn()} onClose={() => {}} />
      </SystemDialogProvider>,
    );
    const formFields = [
      ...screen.getAllByRole("textbox"),
      ...screen.getAllByRole("combobox"),
    ];
    expect(formFields.length).toBeGreaterThan(5);
    formFields.forEach(expectPrimitiveChrome);

    fireEvent.click(screen.getByRole("tab", { name: "Raw BibTeX" }));
    expectPrimitiveChrome(screen.getByRole("textbox"));
  });

  it("the library search box: primitive chrome, named, the 6px control rung", () => {
    render(<LibrarySearchInput aria-label="Search the library" value="" onChange={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Search the library" });
    expectPrimitiveChrome(box);
    expect(box.className).toContain("rounded-md");
  });
});
