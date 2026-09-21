// @vitest-environment jsdom
//
// Task 692 — the panel leg. Drives the REAL gesture the audit described:
// Bibliography panel → search → scope **Library** → type a query, and assert
// the result card offers no way to write to this paper.
//
// This is the leg that fails PRE-FIX: before task 692 the library result
// rendered through the same `BibEntryCard` with the live write callbacks
// bound and the "Edit entry" button unconditional, so three clicks (select,
// Edit entry, Save) reached `onSaveBibEntry` — with the LIBRARY's fields, set
// all, against THIS paper's entry that happens to share the citekey. The
// fixture is exactly that collision: `shared2020` exists locally with a
// `note` field the library copy does not have.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// The panel's library reads: `master.bib` (the preview source), the catalog
// rows (membership chips + `hasFolder`, which is what enables the Library
// scope button) and the custom-library memberships. Stubbed wholesale —
// nothing here touches IndexedDB or an FSA handle.
vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], hasFolder: true }),
  useLibraryMasterBib: () => ({
    entries: [
      {
        uid: "u-lib",
        key: "shared2020",
        type: "article",
        fields: { author: "Zeno of Elea", title: "Library copy", year: "2020" },
        raw: "",
      },
    ],
  }),
  useLibraryMemberships: () => ({ membershipMap: new Map() }),
}));

vi.mock("@library/lib/catalog-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@library/lib/catalog-store")>();
  return {
    ...actual,
    useCatalogItems: () => ({ entries: [], revision: 0, hasFolder: false }),
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent, within } from "@testing-library/react";
import BibliographyPanel from "@/panels/Bibliography/BibliographyPanel";
import type { BibEntry, CitationRef } from "@/lib/types";

afterEach(cleanup);

/** THIS paper's own entry under the same citekey — the cross-target case. */
const LOCAL_SHARED: BibEntry = {
  uid: "u-local",
  key: "shared2020",
  type: "article",
  fields: {
    author: "Zeno of Elea",
    title: "The paper's own copy",
    year: "2020",
    note: "a local field the library copy lacks",
  },
  raw: "",
} as BibEntry;

/** The panel opens on the "Cited only" filter, so the local entry needs a
 *  citation to appear in the default list at all. */
const CITES_SHARED: CitationRef = {
  id: "cit-shared",
  command: "\\cite{shared2020}",
  keys: ["shared2020"],
  createdAt: "2026-09-21T00:00:00.000Z",
};

function renderPanel(
  extra: Partial<React.ComponentProps<typeof BibliographyPanel>> = {},
) {
  const onSaveBibEntry = vi.fn();
  const setAnnotation = vi.fn();
  const onRequestReview = vi.fn();
  const utils = render(
    <BibliographyPanel
      citations={[CITES_SHARED]}
      bibEntries={[LOCAL_SHARED]}
      selectedBibKey="shared2020"
      onSelectBibKey={() => {}}
      onSaveBibEntry={onSaveBibEntry}
      getAnnotation={() => ""}
      setAnnotation={setAnnotation}
      onRequestReview={onRequestReview}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      docId="doc1"
      entryRequests={[]}
      onAddEntryRequest={() => {}}
      onRemoveEntryRequest={() => {}}
      {...extra}
    />,
  );
  return { ...utils, onSaveBibEntry, setAnnotation, onRequestReview };
}

/** Search icon → Library scope → query. The audit's own three steps. */
function searchLibraryFor(container: HTMLElement, query: string) {
  fireEvent.click(
    container.querySelector('button[aria-label="Search"]') as HTMLElement,
  );
  fireEvent.click(within(container).getByText("Library"));
  const input = container.querySelector(
    'input[placeholder="Search library…"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
}

describe("Bibliography panel — a LIBRARY search result is not writable (task 692)", () => {
  it("shows the library record but offers no editor, annotation or review request", () => {
    const { container, onSaveBibEntry, setAnnotation, onRequestReview } =
      renderPanel();
    searchLibraryFor(container, "Zeno");

    // The result really is the LIBRARY's record, selected (so its body — and
    // pre-fix its whole write surface — is rendered).
    expect(container.textContent).toContain("Library copy");

    // Open the BibTeX Fields pod, where the editor door lived.
    fireEvent.click(within(container).getByText("BibTeX Fields"));

    expect(within(container).queryByText("Edit entry")).toBeNull();
    expect(within(container).queryByText("Save")).toBeNull();
    expect(within(container).queryByText("Annotations")).toBeNull();
    expect(within(container).queryByText("Request review")).toBeNull();
    // Nothing reached a write door on the way in, either.
    expect(onSaveBibEntry).not.toHaveBeenCalled();
    expect(setAnnotation).not.toHaveBeenCalled();
    expect(onRequestReview).not.toHaveBeenCalled();
  });

  it("keeps the Add affordance — bringing the record INTO the paper is the one gesture a preview is for", () => {
    const { container } = renderPanel();
    searchLibraryFor(container, "Zeno");
    // The local copy differs from the library copy (the `note` field), so the
    // chip stays actionable rather than flipping to "Added".
    expect(within(container).getByText("Add")).toBeTruthy();
  });

  it("still offers the full write surface for a LOCAL entry", () => {
    const { container } = renderPanel();
    // No search at all: the default list is this paper's own bibliography.
    fireEvent.click(within(container).getByText("BibTeX Fields"));
    expect(within(container).getByText("Edit entry")).toBeTruthy();
    expect(within(container).getByText("Annotations")).toBeTruthy();
  });
});
