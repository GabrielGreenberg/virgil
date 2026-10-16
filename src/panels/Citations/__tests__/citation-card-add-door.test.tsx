// @vitest-environment jsdom
//
// Task 1143: every surface that mounts a CitationCard hands it the door that
// adds a library-only entry to the paper's references.bib. The Omni build used
// to leave `onAddBibEntry` out, so picking an "addable" library row wrote the
// key into `\cite{}` and the bib never gained the entry. The door is now
// REQUIRED (null = this surface cannot add) and the Omni + floating surfaces
// build their door list through ONE mapper, `citationCardDoors`.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
import { CitekeyPicker } from "@/panels/Citations/CitekeyPicker";
import type { CitationCardProps } from "@/panels/Citations/CitationCard";
import { buildCitationOmniItems } from "@/panels/Citations/omni";
import { citationCardDoors } from "@/panels/Citations/citation-card-doors";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

const LIBRARY_ONLY: BibEntry = {
  uid: "uid-quine1960",
  key: "quine1960",
  type: "book",
  fields: { author: "Quine, W. V. O.", title: "Word and Object", year: "1960" },
  raw: "",
};

vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [LIBRARY_ONLY], loading: false }),
  useLibraryMemberships: () => ({ membershipMap: new Map(), loading: false }),
  useLibraryEntryLookup: () => () => undefined,
}));

beforeAll(() => {
  (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView =
    () => undefined;
});
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

const ANCHOR = {
  top: 100, bottom: 120, left: 40, right: 140, width: 100, height: 20,
  x: 40, y: 100, toJSON: () => ({}),
} as DOMRect;

const PAPER: BibEntry[] = [
  {
    uid: "uid-lewis1986",
    key: "lewis1986",
    type: "book",
    fields: { author: "Lewis, David", title: "On the Plurality of Worlds", year: "1986" },
    raw: "",
  },
];

function doorSource(addBibEntry: ((e: BibEntry) => void) | null) {
  return {
    bibEntries: PAPER,
    bibPackage: "natbib",
    getCitationDisplayText: () => "",
    updateCitation: () => {},
    addBibEntry,
    getFormattedBib: () => "",
    getAnnotation: () => "",
    setAnnotation: () => {},
    requestBibReview: () => {},
    cancelBibReview: () => {},
    getBibReviewStatus: () => "none" as const,
    saveBibEntry: () => {},
  };
}

describe("citation card add-to-bib door (task 1143)", () => {
  it("the Omni-built citation card carries the host's addBibEntry", () => {
    const addBibEntry = vi.fn();
    const cit: CitationRef = {
      id: "c1",
      command: "\\citep{lewis1986}",
      keys: ["lewis1986"],
      createdAt: "2026-10-16T00:00:00.000Z",
    };
    const [item] = buildCitationOmniItems({
      ...doorSource(addBibEntry),
      citations: [cit],
      citationPositionMap: new Map([["c1", 3]]),
      selectedCitationId: null,
      setSelectedCitationId: () => {},
      scrollToCitation: () => {},
      deleteCitation: () => {},
    });
    const props = (item.content as ReactElement<CitationCardProps>).props;
    expect(props.onAddBibEntry).toBe(addBibEntry);
  });

  it("citationCardDoors maps every hook-side door onto the card's prop", () => {
    const src = doorSource(vi.fn());
    const doors = citationCardDoors(src);
    expect(doors.onAddBibEntry).toBe(src.addBibEntry);
    expect(doors.onSaveBibEntry).toBe(src.saveBibEntry);
    expect(doors.getDisplayText).toBe(src.getCitationDisplayText);
    expect(doors.onUpdateCitation).toBe(src.updateCitation);
    expect(doors.getReviewStatus).toBe(src.getBibReviewStatus);
  });

  function pick(onAddBibEntry: ((e: BibEntry) => void) | null) {
    const onSelectKeys = vi.fn();
    render(
      <CitekeyPicker
        open
        anchorRect={ANCHOR}
        onClose={vi.fn()}
        paperBibEntries={PAPER}
        onSelectKeys={onSelectKeys}
        onAddBibEntry={onAddBibEntry}
      />,
    );
    const input = screen.getByPlaceholderText("Search references or library…");
    fireEvent.change(input, { target: { value: "quine" } });
    return { onSelectKeys, input };
  }

  it("picking a library-only entry adds it to the bib, then cites it", () => {
    const add = vi.fn();
    const { onSelectKeys, input } = pick(add);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(add).toHaveBeenCalledWith(LIBRARY_ONLY);
    expect(onSelectKeys).toHaveBeenCalledWith(["quine1960"]);
  });

  it("a surface that cannot add (null) is not offered library-only rows", () => {
    pick(null);
    expect(screen.queryByText(/Word and Object/)).toBeNull();
  });
});
