// @vitest-environment jsdom
//
// C24 (REP-F1-01 / OMNI-F1-03) — the collapsed-card empty body sentinel.
//
// EditableCard's compressed view has two branches:
//   • sans-class kinds (note/report/…) render `compressedSummary` (a string);
//   • borrowed-class kinds (footnote/archive/example) render the resolved body
//     via BorrowedMainText.
//
// Both must show the muted italic "empty" sentinel for an EMPTY body. The bugs:
//   • REP-F1-01 / OMNI-F1-03(a): the summary branch used `compressedSummary ??
//     <CardEmptyText/>`, but every caller passes `makeCompressedSummary(...) ||
//     ""`, so an empty body arrived as `''` (falsy, NOT nullish) and `??` never
//     substituted — the card showed a blank line. Fixed to `||`.
//   • OMNI-F1-03(b): the borrowed branch had NO empty guard at all, so an empty
//     footnote/archive/example body rendered a blank BorrowedMainText line.
//     Fixed by projecting the body to plain text and showing the sentinel when
//     empty.
//
// panel-primitives transitively pulls `@/lib/storage` (the barrel/storage
// gotcha) — stub it; nothing here touches a sidecar.

import { describe, it, expect, vi, afterEach } from "vitest";

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

// Light stubs — the empty guard lives BEFORE BorrowedMainText mounts, so the
// stub's presence (a "borrowed" testid) vs the sentinel is the probe.
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
import { EditableCard, CARD_THEMES } from "@/components/panel-primitives";

afterEach(cleanup);

const theme = CARD_THEMES.note;
const EMPTY_DOC = { type: "doc", content: [] };
const NONEMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
};

type Props = ComponentProps<typeof EditableCard>;
function renderCard(overrides: Partial<Props>) {
  const props: Props = {
    id: "c1",
    selected: false,
    theme,
    kind: "note",
    value: EMPTY_DOC,
    onChange: vi.fn(),
    compressed: true,
    ...overrides,
  };
  return render(<EditableCard {...props} />);
}

describe("C24 — collapsed empty-body sentinel (summary branch, `??`→`||`)", () => {
  it('shows "empty" when compressedSummary is the empty string (REP-F1-01)', () => {
    const { container } = renderCard({ kind: "note", compressedSummary: "" });
    // The `||` falls through on '' → CardEmptyText renders the muted sentinel.
    expect(container.textContent).toContain("empty");
  });

  it("renders the summary verbatim when non-empty (no spurious sentinel)", () => {
    const { container } = renderCard({
      kind: "note",
      compressedSummary: "a real summary",
    });
    expect(container.textContent).toContain("a real summary");
    expect(container.textContent).not.toContain("empty");
  });
});

describe("C24 — collapsed empty-body sentinel (borrowed branch, OMNI-F1-03)", () => {
  it('shows "empty" for an EMPTY borrowed body instead of a blank BorrowedMainText', () => {
    const { container } = renderCard({
      kind: "footnote",
      cardKind: "footnote", // borrowed-class → the BorrowedMainText branch
      compressedContent: EMPTY_DOC,
    });
    // The empty guard fires BEFORE BorrowedMainText mounts.
    expect(screen.queryByTestId("borrowed")).toBeNull();
    expect(container.textContent).toContain("empty");
  });

  it("mounts BorrowedMainText for a NON-empty borrowed body (no false sentinel)", () => {
    renderCard({
      kind: "footnote",
      cardKind: "footnote",
      compressedContent: NONEMPTY_DOC,
    });
    expect(screen.getByTestId("borrowed")).toBeTruthy();
  });
});
