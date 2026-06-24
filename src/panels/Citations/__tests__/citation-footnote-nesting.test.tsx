// @vitest-environment jsdom
//
// Part B — footnote-child nesting on the DOCKED Citations panel.
//
// A `\cite` that lives inside a footnote body (tagged `nestedInFootnoteId` on
// the structure snapshot, surfaced here as `nestedFootnoteOf`) must:
//   1. be SUPPRESSED from the flat top-level cite list (shown once, grouped);
//   2. render INDENTED (`ml-4`) + tagged `data-citation-nested-in-footnote`
//      with an "in footnote N" context line (the docked analog of sitting
//      under the footnote card in omni);
//   3. be grouped AFTER every top-level cite, under an "In footnotes" divider.
//
// `CitationCard` is mocked to a thin stub so this test drives the PANEL's
// partition / indent / grouping logic in isolation (the card's own internals —
// CitekeyPicker, storage, bib expansion — are covered by their own tests and
// would otherwise pull in indexedDB/storage).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

// storage.ts eagerly `require`s the FSA backend at import time (absent in
// jsdom). Stub the whole barrel — none of its functions are exercised here.
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

// Thin CitationCard stub — surfaces the wrapper class + nested data-attr the
// panel applies, plus the cite id, so the test can assert indent + suppression.
vi.mock("@/panels/Citations/CitationCard", () => ({
  CitationCard: (props: {
    citation: { id: string };
    wrapperClassName?: string;
    extraDataAttrs?: Record<string, string>;
  }) => (
    <div
      data-testid={`cite-${props.citation.id}`}
      data-wrapper-class={props.wrapperClassName ?? ""}
      {...(props.extraDataAttrs ?? {})}
    >
      {props.citation.id}
    </div>
  ),
}));

// PanelThemePicker reaches preferences; not relevant to nesting layout.
vi.mock("@/components/PanelThemePicker", () => ({
  default: () => null,
}));

import CitationsPanel from "@/panels/Citations";
import type { CitationRef } from "@/lib/types";
import type { NestedFootnoteInfo } from "@/components/editor-layout/panels/nest-footnote-children";

afterEach(cleanup);

function cite(id: string): CitationRef {
  return { id, command: `\\cite{${id}}`, keys: [id], createdAt: "2026-01-01" };
}

const baseProps = {
  bibEntries: [],
  citationStyle: "apa",
  bibPackage: "biblatex",
  bibPath: "references.bib",
  selectedId: null,
  onSelect: () => {},
  onScrollToMarker: () => {},
  onUpdateCitation: () => {},
  onDeleteCitation: () => {},
  onSetStyle: () => {},
  onSetBibPackage: () => {},
  getDisplayText: (c: string) => c,
  pendingCreate: null,
  pendingCreateMode: "unanchored" as const,
  onCreateCitation: () => "x",
  onInsertCitation: () => {},
  onClearPendingCreate: () => {},
  onStartCreate: () => {},
  getFormattedBib: () => "",
  getAnnotation: () => "",
  setAnnotation: () => {},
  onRequestReview: () => {},
  onCancelReview: () => {},
  getReviewStatus: () => "none" as const,
  onUpdateBibEntry: () => {},
  onUpdateBibKeyAndType: () => {},
  onAddBibEntry: () => {},
};

function info(footnoteId: string, footnoteNumber: number | null): NestedFootnoteInfo {
  return { footnoteId, footnoteNumber };
}

describe("CitationsPanel — footnote-nested cite nesting (docked)", () => {
  it("renders a top-level cite flat and a footnote-nested cite indented + tagged", () => {
    const citations = [cite("flat"), cite("nested")];
    const order = ["flat", "nested"];
    const nestedFootnoteOf = new Map<string, NestedFootnoteInfo>([
      ["nested", info("fn1", 3)],
    ]);

    render(
      <CitationsPanel
        {...baseProps}
        citations={citations}
        citationOrder={order}
        nestedFootnoteOf={nestedFootnoteOf}
      />,
    );

    // Both cites render exactly once.
    expect(screen.getAllByTestId("cite-flat")).toHaveLength(1);
    expect(screen.getAllByTestId("cite-nested")).toHaveLength(1);

    // The flat cite is NOT indented; the nested cite IS (`ml-4`) and carries
    // the host-footnote data attribute (suppression-from-flat marker).
    expect(screen.getByTestId("cite-flat").getAttribute("data-wrapper-class")).toBe("");
    const nestedEl = screen.getByTestId("cite-nested");
    expect(nestedEl.getAttribute("data-wrapper-class")).toBe("ml-4");
    expect(nestedEl.getAttribute("data-citation-nested-in-footnote")).toBe("fn1");

    // The nested cite is wrapped in a nested group with the "in footnote N"
    // label and the "In footnotes" section divider.
    const group = nestedEl.closest("[data-citation-nested-group]");
    expect(group).not.toBeNull();
    expect(within(group as HTMLElement).getByText(/in footnote 3/i)).toBeTruthy();
    expect(screen.getByText(/^In footnotes$/i)).toBeTruthy();
  });

  it("renders a numberless 'in footnote' label when the host number is unknown", () => {
    const citations = [cite("nested")];
    const nestedFootnoteOf = new Map<string, NestedFootnoteInfo>([
      ["nested", info("fnGone", null)],
    ]);
    render(
      <CitationsPanel
        {...baseProps}
        citations={citations}
        citationOrder={["nested"]}
        nestedFootnoteOf={nestedFootnoteOf}
      />,
    );
    const nestedEl = screen.getByTestId("cite-nested");
    const group = nestedEl.closest("[data-citation-nested-group]") as HTMLElement;
    expect(within(group).getByText("↳ in footnote")).toBeTruthy();
  });

  it("renders everything flat (no nested group, no indent) when no cite is footnote-nested", () => {
    const citations = [cite("a"), cite("b")];
    render(
      <CitationsPanel
        {...baseProps}
        citations={citations}
        citationOrder={["a", "b"]}
        // No nestedFootnoteOf — the no-footnote-nested-cite common case.
      />,
    );
    expect(screen.getByTestId("cite-a").getAttribute("data-wrapper-class")).toBe("");
    expect(screen.getByTestId("cite-b").getAttribute("data-wrapper-class")).toBe("");
    expect(document.querySelector("[data-citation-nested-group]")).toBeNull();
    expect(screen.queryByText(/^In footnotes$/i)).toBeNull();
  });

  it("groups the nested cite AFTER the flat cite in DOM order", () => {
    const citations = [cite("nested"), cite("flat")]; // nested earlier in array
    const nestedFootnoteOf = new Map<string, NestedFootnoteInfo>([
      ["nested", info("fn1", 1)],
    ]);
    render(
      <CitationsPanel
        {...baseProps}
        citations={citations}
        // citationOrder puts nested first; the partition must still place it
        // after the flat cite in render order.
        citationOrder={["nested", "flat"]}
        nestedFootnoteOf={nestedFootnoteOf}
      />,
    );
    const flatEl = screen.getByTestId("cite-flat");
    const nestedEl = screen.getByTestId("cite-nested");
    // compareDocumentPosition: flat precedes nested.
    expect(
      flatEl.compareDocumentPosition(nestedEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
