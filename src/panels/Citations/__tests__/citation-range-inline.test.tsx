// @vitest-environment jsdom
//
// Task 010 — the `+range` (postnote) affordance must TRAIL the citation
// display line, not sit in the bibkey metadata row. This renders the real
// CitationCard chrome and pins two contracts:
//   (1) placement — `+range` lives in the citation display container and the
//       bibkey metadata row (the citekey button) no longer carries it;
//   (2) behavior — typing a range still serializes the correct postnote into
//       the citation command (onUpdateCitation).

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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

vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [], loading: false }),
  useLibraryMemberships: () => ({ memberships: new Map(), loading: false }),
  useLibraryEntryLookup: () => () => undefined,
}));

vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { BibEntry, CitationRef } from "@/lib/types";

afterEach(cleanup);

const CIT: CitationRef = {
  id: "cit1",
  command: "\\citep{xenakis2020}",
  keys: ["xenakis2020"],
  createdAt: "2026-06-11T00:00:00.000Z",
};

const ENTRY: BibEntry = {
  uid: "uid-xen",
  key: "xenakis2020",
  type: "book",
  fields: {
    author: "Xenakis, Iannis",
    year: "2020",
    title: "Formalized Music",
  },
  raw: "@book{xenakis2020,...}",
};

const REF = { kind: "citation" as const, id: CIT.id };

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

type CitationCardProps = ComponentProps<typeof CitationCard>;

function renderExpandedCard(overrides: Partial<CitationCardProps> = {}) {
  const props: CitationCardProps = {
    citation: CIT,
    isSelected: false,
    bibEntries: [ENTRY],
    bibPackage: "natbib",
    getDisplayText: () => "Xenakis 2020",
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onUpdateCitation: vi.fn(),
    ...overrides,
  };
  const utils = render(<CitationCard {...props} />);
  // Open the card body so the key rows render.
  fireEvent.click(screen.getByLabelText("Expand card"));
  return { props, ...utils };
}

describe("CitationCard +range trails the citation display line (task 010)", () => {
  it("renders +range inside the citation display container, not the bibkey row", () => {
    renderExpandedCard();

    const rangeBtn = screen.getByText("+range");

    // (1) The +range control shares the citation DISPLAY line — the container
    //     that also holds the formatted citation text (title).
    const displayLine = rangeBtn.closest("div.leading-snug");
    expect(displayLine).toBeTruthy();
    expect(displayLine!.textContent).toContain("Formalized Music");
    expect(displayLine!.textContent).toContain("+range");

    // (2) The bibkey metadata row (the citekey change button) no longer
    //     carries the +range affordance.
    const citekeyBtn = screen.getByLabelText("Click to change");
    const metaRow = citekeyBtn.parentElement!;
    expect(metaRow.textContent).toContain("xenakis2020");
    expect(metaRow.textContent).not.toContain("+range");
  });

  it("typing a range still serializes the postnote into the command", () => {
    const onUpdateCitation = vi.fn();
    renderExpandedCard({ onUpdateCitation });

    fireEvent.click(screen.getByText("+range"));
    const input = screen.getByPlaceholderText("range");
    fireEvent.change(input, { target: { value: "pp. 12-15" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onUpdateCitation).toHaveBeenCalled();
    const [, command] = onUpdateCitation.mock.calls.at(-1)!;
    expect(command).toContain("xenakis2020");
    expect(command).toContain("pp. 12-15");
  });
});
