// @vitest-environment jsdom
//
// Task 082 — Citations panel ArrowUp/Down keyboard navigation, two defects
// retired via shared primitives:
//
//   • M1 (useArchiveVisibleItems): the cycle used to iterate the UNFILTERED
//     `orderedCitations` while CardListPanel renders only the archive-view
//     -filtered set, so arrows stepped onto archived, off-screen cards. The
//     cycle is now fed the SAME visible set — no arrow step lands on a hidden
//     citation.
//   • M2 (useListNavKeys): `handleNavKeys` fired on ANY ArrowUp/Down inside the
//     panel scroll body, hijacking the caret inside a card's own text inputs.
//     The shared handler now ignores events from an editable target (INPUT /
//     TEXTAREA / SELECT / contentEditable).
//
// panel-primitives transitively pulls `@/lib/storage` — stub it. CitationCard
// mounts real editors — stub it to a light div (M1) / a div with an input (M2)
// so the test pins the panel's cycle/guard wiring, not card internals.

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

// Light CitationCard stub: renders the card id + an INPUT so we can dispatch a
// keydown from an editable target (M2). No `data-link-card`, so the panel's
// scroll-into-view query no-ops.
vi.mock("@/panels/Citations/CitationCard", () => ({
  CitationCard: ({ citation }: { citation: { id: string } }) => (
    <div data-testid="cit-card" data-id={citation.id}>
      <input data-testid={`cit-input-${citation.id}`} defaultValue="" />
    </div>
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, fireEvent, cleanup } from "@testing-library/react";
import { type ComponentProps } from "react";
import CitationsPanel from "@/panels/Citations/CitationsPanel";
import type { CitationRef } from "@/lib/types";

afterEach(cleanup);

const cit = (id: string, archived = false): CitationRef => ({
  id,
  command: `\\cite{${id}}`,
  keys: [id],
  createdAt: "2026-01-01",
  ...(archived ? { archived: true } : {}),
});

type PanelProps = ComponentProps<typeof CitationsPanel>;

function baseProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    citations: [],
    bibEntries: [],
    citationStyle: "apa",
    bibPackage: "biblatex",
    bibPath: "references.bib",
    selectedId: null,
    citationOrder: [],
    onSelect: vi.fn(),
    onScrollToMarker: vi.fn(),
    onUpdateCitation: vi.fn(),
    onDeleteCitation: vi.fn(),
    onSetStyle: vi.fn(),
    onSetBibPackage: vi.fn(),
    getDisplayText: (c: string) => c,
    pendingCreate: null,
    pendingCreateMode: "anchored",
    onCreateCitation: vi.fn(() => "new"),
    onInsertCitation: vi.fn(),
    onClearPendingCreate: vi.fn(),
    onStartCreate: vi.fn(),
    getFormattedBib: () => "",
    getAnnotation: () => "",
    setAnnotation: vi.fn(),
    onRequestReview: vi.fn(),
    onCancelReview: vi.fn(),
    getReviewStatus: () => "none",
    onUpdateBibEntry: vi.fn(),
    onUpdateBibKeyAndType: vi.fn(),
    onAddBibEntry: vi.fn(),
    ...overrides,
  };
}

function keyTarget(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!el) throw new Error("scroll container (tabindex=0) not found");
  return el;
}

describe("Task 082 M1 — cycle iterates the archive-VISIBLE set only", () => {
  it("ArrowDown/Up never lands on an archived (off-screen) citation", () => {
    // Archived card sits FIRST in document order; the OLD unfiltered cycle would
    // select it on the first ArrowDown. With the fix, only the two active cards
    // are rendered AND cycled.
    const citations = [cit("arch", true), cit("a"), cit("b")];
    const props = baseProps({ citations, citationOrder: ["arch", "a", "b"] });
    const { container, getAllByTestId } = render(<CitationsPanel {...props} />);

    // Only the two active cards render.
    const rendered = getAllByTestId("cit-card").map((el) => el.dataset.id);
    expect(rendered).toEqual(["a", "b"]);

    const target = keyTarget(container);
    // Walk a full loop and one wrap: every activation must be a visible id.
    fireEvent.keyDown(target, { key: "ArrowDown" }); // → a
    fireEvent.keyDown(target, { key: "ArrowDown" }); // → b
    fireEvent.keyDown(target, { key: "ArrowDown" }); // → wrap to a
    fireEvent.keyDown(target, { key: "ArrowUp" }); // → wrap to b

    const selected = (props.onSelect as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(selected.length).toBeGreaterThan(0);
    expect(selected).not.toContain("arch");
    expect(new Set(selected)).toEqual(new Set(["a", "b"]));
    // The archived marker is never scroll-jumped to either.
    const scrolled = (
      props.onScrollToMarker as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    expect(scrolled).not.toContain("arch");
  });
});

describe("Task 082 M2 — arrows inside a card input do not cycle", () => {
  it("ArrowDown from an INPUT target is ignored (no cycle, no selection)", () => {
    const citations = [cit("a"), cit("b")];
    const props = baseProps({ citations, citationOrder: ["a", "b"] });
    const { getByTestId } = render(<CitationsPanel {...props} />);

    const input = getByTestId("cit-input-a");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onScrollToMarker).not.toHaveBeenCalled();
  });

  it("ArrowDown from the scroll body (non-input) still cycles (control)", () => {
    const citations = [cit("a"), cit("b")];
    const props = baseProps({ citations, citationOrder: ["a", "b"] });
    const { container } = render(<CitationsPanel {...props} />);

    fireEvent.keyDown(keyTarget(container), { key: "ArrowDown" });
    expect(props.onSelect).toHaveBeenCalledWith("a");
  });
});
