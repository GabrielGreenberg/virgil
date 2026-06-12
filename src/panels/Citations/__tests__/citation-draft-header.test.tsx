// @vitest-environment jsdom
//
// Backlog #13 pin — CitationCard forces `isExpanded = isDraft || ac.expanded`,
// so while drafting the header toggle would be silently broken (the body is
// pinned open). Ratified behavior: a DRAFT card's header click SELECTS only;
// a normal card's header click keeps the full toggle+select composition.

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

// CitekeyPicker (mounted by a draft card) reaches the Library catalog store,
// which opens indexedDB on mount — absent in jsdom (unhandled rejection).
// Stub the hook layer; the picker's data is irrelevant to header wiring.
vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [], loading: false }),
  useLibraryMemberships: () => ({ memberships: new Map(), loading: false }),
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

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import type { CitationRef } from "@/lib/types";

afterEach(cleanup);

const CIT: CitationRef = {
  id: "cit1",
  command: "\\citep{xenakis2020}",
  keys: ["xenakis2020"],
  createdAt: "2026-06-11T00:00:00.000Z",
};

const REF = { kind: "citation" as const, id: CIT.id };

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

type CitationCardProps = ComponentProps<typeof CitationCard>;

function renderCard(overrides: Partial<CitationCardProps> = {}) {
  const props: CitationCardProps = {
    citation: CIT,
    isSelected: false,
    bibEntries: [],
    bibPackage: "natbib",
    getDisplayText: () => "Xenakis 2020",
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onUpdateCitation: vi.fn(),
    ...overrides,
  };
  const utils = render(<CitationCard {...props} />);
  return { props, ...utils };
}

describe("CitationCard draft header-click suppression (backlog #13)", () => {
  it("draft: header click selects but does NOT toggle the pinned-open body", () => {
    renderCard({ isDraft: true });
    // Draft is forced expanded → the header reads as collapsible.
    const header = screen.getByLabelText("Collapse card");
    fireEvent.click(header);
    expect(cardStore.isSelected(REF)).toBe(true);
    // The expansion set is untouched — no silently-broken toggle.
    expect(cardStore.isExpanded(REF)).toBe(false);
    // Still expanded in the DOM (pinned by isDraft).
    expect(screen.getByLabelText("Collapse card")).toBeTruthy();
  });

  it("non-draft: header click keeps the full toggle+select composition", () => {
    renderCard();
    fireEvent.click(screen.getByLabelText("Expand card"));
    expect(cardStore.isSelected(REF)).toBe(true);
    expect(cardStore.isExpanded(REF)).toBe(true);
    expect(screen.getByLabelText("Collapse card")).toBeTruthy();
  });
});
