// @vitest-environment jsdom
//
// Backlog #12 pin — OrphanedFootnoteCard has a REAL expansion axis (the
// global cardStore, kind "footnote", keyed on the stable footnoteId) instead
// of the old `compressed = !isSelected` weld. All four selected×expanded
// cells are reachable:
//   - header click toggles expansion AND selects (the ratified composition);
//   - a second header click collapses while staying selected;
//   - expand-without-select (direct store expand) shows the body unselected;
//   - body click keeps select+expand.

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

// The rich/borrowed bodies mount real TipTap editors — mock to light divs so
// the test pins the expansion wiring, not editor internals. Which testid is
// in the DOM doubles as the expanded/collapsed probe.
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
import { OrphanedFootnoteCard } from "@/panels/Footnotes/FootnoteCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import type { OrphanedFootnote } from "@/lib/types";

afterEach(cleanup);

const REF = { kind: "footnote" as const, id: "orph1" };

const ORPHAN = {
  footnoteId: "orph1",
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "orphan body" }] }],
  },
} as unknown as OrphanedFootnote;

beforeEach(() => {
  // The store is module-scoped — reset both axes between tests.
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

type OrphanProps = ComponentProps<typeof OrphanedFootnoteCard>;

function renderOrphan(overrides: Partial<OrphanProps> = {}) {
  const props: OrphanProps = {
    orphan: ORPHAN,
    isSelected: false,
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  const utils = render(<OrphanedFootnoteCard {...props} />);
  return { props, ...utils };
}

describe("OrphanedFootnoteCard expansion axis (backlog #12)", () => {
  it("starts collapsed + unselected (cell 1)", () => {
    renderOrphan();
    expect(screen.getByTestId("borrowed")).toBeTruthy();
    expect(screen.queryByTestId("rtf")).toBeNull();
    expect(cardStore.isSelected(REF)).toBe(false);
  });

  it("header click expands AND selects (cell 4); a second click collapses but stays selected (cell 2)", () => {
    renderOrphan();
    fireEvent.click(screen.getByLabelText("Expand card"));
    expect(screen.getByTestId("rtf")).toBeTruthy();
    expect(cardStore.isExpanded(REF)).toBe(true);
    expect(cardStore.isSelected(REF)).toBe(true);

    fireEvent.click(screen.getByLabelText("Collapse card"));
    expect(screen.getByTestId("borrowed")).toBeTruthy();
    expect(cardStore.isExpanded(REF)).toBe(false);
    // Selection is its own axis — the toggle never clears it.
    expect(cardStore.isSelected(REF)).toBe(true);
  });

  it("expand-without-select is reachable (cell 3) — expansion no longer welded to selection", () => {
    renderOrphan();
    fireEvent.click(screen.getByLabelText("Expand card"));
    cardStore.clearSelection();
    // Still expanded with no selection (the old weld collapsed on deselect).
    expect(cardStore.isExpanded(REF)).toBe(true);
    expect(cardStore.isSelected(REF)).toBe(false);
    expect(screen.getByTestId("rtf")).toBeTruthy();
  });

  it("body click keeps the select+expand contract without the toggling host onSelect", () => {
    const { props } = renderOrphan();
    fireEvent.click(screen.getByTestId("borrowed"));
    expect(cardStore.isExpanded(REF)).toBe(true);
    expect(cardStore.isSelected(REF)).toBe(true);
    // Review nit fold: the host's TOGGLING onSelect is no longer composed in
    // (cardStore.select drives the derived selection slot) - a second body
    // click must not drop the halo.
    expect(props.onSelect).toHaveBeenCalledTimes(0);
  });
});
