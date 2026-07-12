// @vitest-environment jsdom
//
// Task 096 — the Bibliography citekey-conflict strip has a context lifecycle
// tied to the library-search context that raises it.
//
// Bug class: the ephemeral amber `conflictDecision` strip (shown when a
// library-search "Add" hits a local citekey with different fields) ignored the
// search context that is its only in-search origin.
//
//   Member A — leaving that context (close-search / toggle scope to "local" /
//   toggle the search bar off) never cleared `conflictDecision`, so an orphaned
//   strip lingered above the now-local list with all four actions live on a
//   stale snapshot. Fix: every search-context teardown clears the strip.
//
//   Member B — "Save under new citekey" minted `<key>-2`, then selected it
//   against the still-showing *library* results, which never contain the
//   suffixed key → selectedIdx === -1, an invisible add. Fix: exit the search
//   context, widen the filter (a brand-new entry is uncited), then select +
//   scroll the new entry so it renders selected in the local list.

import { describe, it, expect, vi, afterEach } from "vitest";

// panel-primitives (+ bib card chrome) transitively pull `@/lib/storage`
// (the known barrel/storage gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

// The catalog store hits idb-keyval (throws `indexedDB is not defined` under
// jsdom). Stub it to an empty, no-folder catalog — the library data the panel
// actually reads comes from the `@/hooks/useLibrary` mock below.
vi.mock("@library/lib/catalog-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@library/lib/catalog-store")>();
  return {
    ...actual,
    useCatalogItems: () => ({ entries: [], revision: 0, hasFolder: false }),
  };
});

// Drive the library-search path deterministically: a connected library
// (`hasFolder: true` enables the "Library" scope toggle) whose master.bib holds
// a `smith` entry with fields that DIFFER from the local `smith` (so "Add"
// raises the conflict strip).
const SMITH_LIB = {
  uid: "u-smith-lib",
  key: "smith",
  type: "article",
  fields: { author: "Smith, A.", year: "2005", title: "On Other Things" },
  raw: "",
};
vi.mock("@/hooks/useLibrary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useLibrary")>();
  return {
    ...actual,
    useLibraryItems: () => ({ items: [], revision: 0, hasFolder: true }),
    useLibraryMasterBib: () => ({ entries: [SMITH_LIB], error: null }),
    useLibraryMemberships: () => ({ membershipMap: new Map() }),
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

import { useState, useCallback } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import BibliographyPanel from "@/panels/Bibliography/BibliographyPanel";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

const SMITH_LOCAL: BibEntry = {
  uid: "u-smith-local",
  key: "smith",
  type: "article",
  fields: { author: "Smith, A.", year: "2001", title: "On Things" },
  raw: "",
} as BibEntry;

const CONFLICT_TEXT = "is already in your bib with different fields";

// A stateful host so `onAddBibEntry` actually appends (Member B needs the new
// `smith-2` row to render) and `onSelectBibKey` actually tracks selection.
function Host({
  onAdd,
  onSelect,
}: {
  onAdd?: (e: BibEntry) => void;
  onSelect?: (k: string | null) => void;
}) {
  const [entries, setEntries] = useState<BibEntry[]>([SMITH_LOCAL]);
  const [selected, setSelected] = useState<string | null>(null);
  const handleAdd = useCallback(
    (e: BibEntry) => {
      onAdd?.(e);
      setEntries((prev) =>
        prev.some((x) => x.key === e.key) ? prev : [...prev, e],
      );
    },
    [onAdd],
  );
  const handleSelect = useCallback(
    (k: string | null) => {
      onSelect?.(k);
      setSelected(k);
    },
    [onSelect],
  );
  return (
    <BibliographyPanel
      citations={[]}
      bibEntries={entries}
      selectedBibKey={selected}
      onSelectBibKey={handleSelect}
      onAddBibEntry={handleAdd}
      onUpdateBibEntry={() => {}}
      onUpdateBibKeyAndType={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      docId="doc1"
      entryRequests={[]}
      onAddEntryRequest={() => {}}
      onRemoveEntryRequest={() => {}}
    />
  );
}

/** Open search → library scope → type "smith" → click "Add" on the library
 *  result, landing the conflict strip. Returns the rendered container. */
function raiseConflict(container: HTMLElement) {
  // Open the search bar (header magnifier).
  fireEvent.click(container.querySelector('button[data-hint="Search"]')!);
  // Switch to library scope.
  fireEvent.click(
    container.querySelector('button[data-hint="Search library"]')!,
  );
  // Type a query that surfaces the library `smith`.
  const input = container.querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "smith" } });
  // Click the "Add" pill on the library result.
  const addBtn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Add",
  );
  expect(addBtn, "library result should render an Add affordance").toBeTruthy();
  fireEvent.click(addBtn!);
  expect(container.textContent).toContain(CONFLICT_TEXT);
}

describe("BibliographyPanel — conflict-strip context lifecycle (task 096)", () => {
  // ---- Member A: teardown clears the strip ----

  it("clears the conflict strip when the search bar is closed via its X (closeSearch)", () => {
    const { container } = render(<Host />);
    raiseConflict(container);
    // While search is open there are two `Close search` buttons: the header
    // magnifier toggle (first, handleToggleSearch) and the in-bar X (last,
    // closeSearch). Target the in-bar X specifically.
    const closers = container.querySelectorAll(
      'button[data-hint="Close search"]',
    );
    expect(closers.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(closers[closers.length - 1]!);
    expect(container.textContent).not.toContain(CONFLICT_TEXT);
  });

  it("clears the conflict strip when scope flips back to Local", () => {
    const { container } = render(<Host />);
    raiseConflict(container);
    fireEvent.click(container.querySelector('button[data-hint="Search local"]')!);
    expect(container.textContent).not.toContain(CONFLICT_TEXT);
  });

  it("clears the conflict strip when the search bar is toggled off (handleToggleSearch)", () => {
    const { container } = render(<Host />);
    raiseConflict(container);
    // The header magnifier (first `Close search` button) toggles search off.
    const toggles = container.querySelectorAll(
      'button[data-hint="Close search"]',
    );
    fireEvent.click(toggles[0]!);
    expect(container.textContent).not.toContain(CONFLICT_TEXT);
  });

  // ---- Member B: "Save under new citekey" surfaces the new entry ----

  it("adds smith-2 and renders it as a visible, selected row (not an invisible add)", () => {
    const onAdd = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<Host onAdd={onAdd} onSelect={onSelect} />);
    raiseConflict(container);

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Save under new citekey",
    );
    expect(saveBtn).toBeTruthy();
    act(() => {
      fireEvent.click(saveBtn!);
    });

    // The suffixed entry is persisted…
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].key).toBe("smith-2");
    // …the conflict strip is gone (context torn down)…
    expect(container.textContent).not.toContain(CONFLICT_TEXT);
    // …the new row is rendered (search closed, filter widened to "all")…
    expect(
      container.querySelector('[data-bib-entry="smith-2"]'),
      "smith-2 row should be visible after save",
    ).not.toBeNull();
    // …and it is the selected key (navigateToEntry selected it).
    expect(onSelect).toHaveBeenLastCalledWith("smith-2");
  });

  it("selects the ORIGINAL local key on Replace / Keep / Request-merge (unchanged)", () => {
    const onSelect = vi.fn();
    const { container } = render(<Host onSelect={onSelect} />);
    raiseConflict(container);
    // "Keep yours" just dismisses; it must not select a phantom row.
    const keepBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Keep yours",
    );
    fireEvent.click(keepBtn!);
    expect(container.textContent).not.toContain(CONFLICT_TEXT);
  });
});
