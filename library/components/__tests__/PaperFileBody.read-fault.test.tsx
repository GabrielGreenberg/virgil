// @vitest-environment jsdom
//
// Task 1210 — the detail pane's full-entry fetch SETTLES on a read fault.
// The Library read door rejects on a real failure (task 1115); before this
// fix PaperFileBody's `.then` had no rejection handler, so a faulted
// master.bib read left the BibTeX panel on "Loading…" with Edit disabled
// forever (plus an unhandled rejection) — the stuck-loading bug 1115 fixed in
// PdfView. A failure now lands in the settled "no full entry" branch.

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { getFullLibraryBibEntry } = vi.hoisted(() => ({ getFullLibraryBibEntry: vi.fn() }));
vi.mock("@library/lib/bib-entry-full", () => ({ getFullLibraryBibEntry }));
vi.mock("../RightDetail", () => ({
  default: ({ editPending }: { editPending: boolean }) => (
    <div data-testid="detail">{editPending ? "pending" : "settled"}</div>
  ),
}));

import PaperFileBody from "../PaperFileBody";

const handle = {} as unknown as FileSystemDirectoryHandle;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  cleanup();
  getFullLibraryBibEntry.mockReset();
});

describe("PaperFileBody — a faulted master.bib read settles (task 1210)", () => {
  it("leaves the pending state instead of loading forever", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getFullLibraryBibEntry.mockRejectedValue(Object.assign(new Error("io"), { name: "NotReadableError" }));
    render(
      <PaperFileBody handle={handle} citekey="alpha2020" entries={[]} bibByKey={new Map()} scope="" panel="left" />,
    );
    expect(screen.getByTestId("detail").textContent).toBe("pending");
    await act(flush);
    expect(screen.getByTestId("detail").textContent).toBe("settled");
    warn.mockRestore();
  });
});
