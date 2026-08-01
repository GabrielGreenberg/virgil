// @vitest-environment jsdom
//
// Task 270 — the citation card's bottom citekey meta row must BOUND its
// content the way its sibling Code/Preview rows do: a long unbreakable
// citekey (mono, no spaces) must truncate with an ellipsis instead of
// expanding to intrinsic width, collapsing the flex-1 spacer, and shoving
// the shrink-0 remove button off the card edge (where the clip makes it
// unreachable). jsdom can't measure real overflow, so the durable guard is
// the class contract: the row carries `min-w-0` and the citekey button
// carries `truncate min-w-0` — the same idiom the Code/Preview rows use.

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

// CitekeyPicker reaches the Library catalog store (indexedDB on mount, absent
// in jsdom). Stub the hook layer; the picker's data is irrelevant here.
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

import { render, screen, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { CitationRef } from "@/lib/types";

afterEach(cleanup);

// A deliberately long, unbreakable mono citekey — the overflow case.
const LONG_KEY = "vanDerBergAndAssociates2019Proceedings";
const CIT: CitationRef = {
  id: "cit1",
  command: `\\citep{${LONG_KEY}}`,
  keys: [LONG_KEY],
  createdAt: "2026-06-11T00:00:00.000Z",
};
const REF = { kind: "citation" as const, id: CIT.id };

beforeEach(() => {
  cardStore.clearSelection();
  cardStore.expand(REF); // the citekey meta row only renders in an open body
});
afterEach(() => cardStore.collapse(REF));

type CitationCardProps = ComponentProps<typeof CitationCard>;

function renderCard(overrides: Partial<CitationCardProps> = {}) {
  const props: CitationCardProps = {
    citation: CIT,
    isSelected: false,
    bibEntries: [],
    bibPackage: "natbib",
    getDisplayText: () => "van der Berg 2019",
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onUpdateCitation: vi.fn(),
    ...overrides,
  };
  return render(<CitationCard {...props} />);
}

describe("citation card — citekey meta row overflow contract (task 270)", () => {
  it("citekey button truncates and can shrink (truncate + min-w-0)", () => {
    renderCard();
    const keyBtn = screen.getByRole("button", { name: "Click to change" });
    const cls = keyBtn.className;
    expect(cls).toContain("truncate");
    expect(cls).toContain("min-w-0");
  });

  it("the citekey meta row can shrink below its content (min-w-0 on the row)", () => {
    renderCard();
    const keyBtn = screen.getByRole("button", { name: "Click to change" });
    const row = keyBtn.parentElement as HTMLElement;
    // The immediate parent is the meta row div; it must carry min-w-0 so the
    // whole row can shrink within the card and let its children truncate.
    expect(row.className).toContain("min-w-0");
    // Sanity: the trailing remove control is shrink-0 (won't compress) — the
    // reason the row must bound its leading content instead.
    const removeBtn = screen.getByRole("button", { name: "Remove this key" });
    expect(removeBtn.className).toContain("shrink-0");
  });
});
