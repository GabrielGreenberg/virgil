// @vitest-environment jsdom
//
// Task 403 #1, at the CALL SITE. `resolveCiteNoteRows` was never the part that
// could misbehave — a panel that mirrors `entries[0]`'s note onto every row is,
// and no test of the model can see it.
//
// The defect's whole cost is in the BYTES: `rowsFromCommand` mirrored a
// biblatex `\cites[p. 1]{a}{b}`'s note onto row `b`, and the next `persist()`
// re-serialized the rows and WROTE `\cites[p. 1]{a}[p. 1]{b}` into the user's
// `.tex` — a page range invented on a citation that never had one, permanent
// from then on. So the legs below drive the REAL card, edit a DIFFERENT row,
// and assert what `onUpdateCitation` receives.

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

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { BibEntry, CitationRef } from "@/lib/types";

afterEach(cleanup);

const ENTRIES: BibEntry[] = [
  { uid: "u-a", key: "alpha2001", type: "book", fields: { author: "Alpha, A.", year: "2001", title: "A Book" }, raw: "" },
  { uid: "u-b", key: "beta2002", type: "book", fields: { author: "Beta, B.", year: "2002", title: "B Book" }, raw: "" },
];

type CitationCardProps = ComponentProps<typeof CitationCard>;

function renderCard(command: string, bibPackage: string) {
  const citation: CitationRef = {
    id: "cit1",
    command,
    keys: [],
    createdAt: "2026-08-21T00:00:00.000Z",
  };
  cardStore.collapse({ kind: "citation", id: citation.id });
  cardStore.clearSelection();
  const onUpdateCitation = vi.fn();
  const props: CitationCardProps = {
    citation,
    isSelected: false,
    bibEntries: ENTRIES,
    bibPackage,
    getDisplayText: () => "cite",
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onUpdateCitation,
  };
  render(<CitationCard {...props} />);
  fireEvent.click(screen.getByLabelText("Expand card"));
  return { onUpdateCitation };
}

beforeEach(() => {
  cardStore.clearSelection();
});

describe("the panel's rows never invent a note (task 403 #1)", () => {
  it("editing key A's range leaves key B note-less in the WRITTEN command", () => {
    // Pre-fix: row `b` was born carrying `a`'s "p. 1", so this edit emitted
    // `\cites[p. 5]{a}[p. 1]{b}` — the invention surviving an edit that never
    // touched `b`.
    const { onUpdateCitation } = renderCard("\\cites[p. 1]{alpha2001}{beta2002}", "biblatex");

    const ranges = screen.getAllByPlaceholderText("range");
    // ONE range input: only key A has a note. Two is the mirroring, on screen.
    expect(ranges).toHaveLength(1);

    fireEvent.change(ranges[0], { target: { value: "p. 5" } });
    fireEvent.keyDown(ranges[0], { key: "Enter" });

    expect(onUpdateCitation).toHaveBeenCalled();
    const [, command] = onUpdateCitation.mock.calls.at(-1)!;
    expect(command).toBe("\\cites[p. 5]{alpha2001}{beta2002}");
  });

  it("the CONTROL — divergent per-key notes — keeps both through the same edit", () => {
    const { onUpdateCitation } = renderCard(
      "\\cites[p. 1]{alpha2001}[p. 2]{beta2002}",
      "biblatex",
    );

    const ranges = screen.getAllByPlaceholderText("range");
    expect(ranges).toHaveLength(2);

    fireEvent.change(ranges[0], { target: { value: "p. 5" } });
    fireEvent.keyDown(ranges[0], { key: "Enter" });

    const [, command] = onUpdateCitation.mock.calls.at(-1)!;
    expect(command).toBe("\\cites[p. 5]{alpha2001}[p. 2]{beta2002}");
  });

  it("a natbib whole-citation note lands on the key natbib renders it against", () => {
    // natbib's single bracket is the POSTnote, which renders after the LAST
    // cite — so the row that owns it is `b`, and a save must not move it.
    const { onUpdateCitation } = renderCard(
      "\\citep[p. 22]{alpha2001,beta2002}",
      "natbib",
    );

    const ranges = screen.getAllByPlaceholderText("range");
    expect(ranges).toHaveLength(1);

    fireEvent.change(ranges[0], { target: { value: "p. 30" } });
    fireEvent.keyDown(ranges[0], { key: "Enter" });

    const [, command] = onUpdateCitation.mock.calls.at(-1)!;
    expect(command).toBe("\\citep[p. 30]{alpha2001,beta2002}");
  });
});
