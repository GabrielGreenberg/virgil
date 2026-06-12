// @vitest-environment jsdom
//
// Backlog #16 pin — BorrowedMainText resolves citation display text from the
// surrounding CitationDisplayProvider when no `getCitationDisplayText` prop
// is threaded, so COLLAPSED footnote/archive bodies render "Author Year"
// instead of the raw \citep command. The explicit prop stays the override,
// and the component still renders without any provider (raw command shown).

import { describe, it, expect, afterEach, vi } from "vitest";

// BorrowedMainText imports the tiptap extension barrel, which transitively
// pulls `@/lib/storage` (the known barrel/storage gotcha) — stub it.
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

import { render, waitFor, cleanup } from "@testing-library/react";
import { BorrowedMainText } from "@/components/BorrowedMainText";
import { CitationDisplayProvider } from "@/components/editor-layout/contexts/citation-display";

afterEach(cleanup);

const RAW_COMMAND = "\\citep{abusch2014}";

const DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        {
          type: "citation",
          attrs: { command: RAW_COMMAND, displayText: "" },
        },
      ],
    },
  ],
};

const ctxValue = {
  getCitationDisplayText: (command: string) =>
    command.includes("abusch2014") ? "Abusch 2014" : command,
  onCitationCreated: () => ({ id: "x", displayText: "" }),
};

describe("BorrowedMainText citation resolution (backlog #16)", () => {
  it("picks up the resolver from CitationDisplayProvider when no prop is passed", async () => {
    const { container } = render(
      <CitationDisplayProvider value={ctxValue}>
        <BorrowedMainText value={DOC} instanceKey="ctx-test" />
      </CitationDisplayProvider>,
    );
    await waitFor(() => {
      expect(container.textContent).toContain("Abusch 2014");
    });
    expect(container.textContent).not.toContain(RAW_COMMAND);
  });

  it("the explicit prop overrides the context resolver", async () => {
    const { container } = render(
      <CitationDisplayProvider value={ctxValue}>
        <BorrowedMainText
          value={DOC}
          instanceKey="prop-test"
          getCitationDisplayText={() => "Prop Override 1999"}
        />
      </CitationDisplayProvider>,
    );
    await waitFor(() => {
      expect(container.textContent).toContain("Prop Override 1999");
    });
    expect(container.textContent).not.toContain("Abusch 2014");
  });

  it("renders without a provider (raw command fallback, no throw)", async () => {
    const { container } = render(
      <BorrowedMainText value={DOC} instanceKey="bare-test" />,
    );
    await waitFor(() => {
      expect(container.textContent).toContain(RAW_COMMAND);
    });
  });
});
