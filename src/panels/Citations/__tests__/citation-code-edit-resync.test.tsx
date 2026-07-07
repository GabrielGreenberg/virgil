// @vitest-environment jsdom
//
// Task 078 pin — the raw "Code" LaTeX input bypasses the row mutators, so on
// commit it MUST resync the card's local `rows`/`type`/`starred`/`capitalized`
// from the committed command. Without that resync the local state stays stale,
// and the next control that fires `persist()` (a checkbox, the Type select, a
// row edit) re-serializes from the stale rows — silently dropping the key the
// user just added via the Code field.

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

// CitekeyPicker (always mounted by CitationCard, open=false) reaches the
// Library catalog store, which opens indexedDB on mount — absent in jsdom.
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

import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { parseCiteCommand } from "@/lib/bib-parser";
import type { CitationRef } from "@/lib/types";

afterEach(cleanup);

const REF = { kind: "citation" as const, id: "cit1" };

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

/** A controlled parent that echoes `cit.command` back exactly as the real
 *  `useCitations.updateCitation` does (command stored verbatim, keys re-parsed).
 *  `emitted` records every command the card serialized, newest last. */
function Harness({ emitted }: { emitted: string[] }) {
  const [cit, setCit] = useState<CitationRef>({
    id: "cit1",
    command: "\\cite{smith}",
    keys: ["smith"],
    createdAt: "2026-06-11T00:00:00.000Z",
  });
  return (
    <CitationCard
      citation={cit}
      isSelected={false}
      isAnchored
      bibEntries={[]}
      bibPackage="natbib"
      getDisplayText={() => ""}
      onSelect={() => {}}
      onJump={() => {}}
      onUpdateCitation={(_id, command) => {
        emitted.push(command);
        const parsed = parseCiteCommand(command);
        setCit((c) => ({ ...c, command, keys: parsed?.keys ?? c.keys }));
      }}
    />
  );
}

describe("CitationCard — raw Code edit resyncs local state (task 078)", () => {
  it("a key added via the Code field survives a subsequent checkbox toggle", () => {
    const emitted: string[] = [];
    render(<Harness emitted={emitted} />);

    // Expand the (non-draft) card so the Code row + Type/overflow strip render.
    fireEvent.click(screen.getByLabelText("Expand card"));

    // Open the raw Code editor and add a second key.
    fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
    const codeInput = screen.getByDisplayValue("\\cite{smith}");
    fireEvent.change(codeInput, { target: { value: "\\cite{smith,jones}" } });
    fireEvent.keyDown(codeInput, { key: "Enter" }); // commit

    expect(emitted.at(-1)).toBe("\\cite{smith,jones}");

    // Toggle the `*` (Full author list) checkbox → fires persist() from the
    // card's local rows. Pre-fix this re-serialized from the STALE single-key
    // rows and dropped `jones`.
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Full author list/i }),
    );

    const last = emitted.at(-1)!;
    expect(last).toContain("smith");
    expect(last).toContain("jones"); // the key the bug silently dropped
    expect(last).toMatch(/\\cite\*/); // starred marker applied
  });

  it("the Type select after a Code edit also preserves the added key", () => {
    const emitted: string[] = [];
    render(<Harness emitted={emitted} />);
    fireEvent.click(screen.getByLabelText("Expand card"));

    fireEvent.click(screen.getByLabelText("Edit raw LaTeX"));
    const codeInput = screen.getByDisplayValue("\\cite{smith}");
    fireEvent.change(codeInput, { target: { value: "\\cite{smith,jones}" } });
    fireEvent.keyDown(codeInput, { key: "Enter" });

    // Change the command base via the Type <select> → persist() from rows.
    const typeSelect = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "citep" } });

    const last = emitted.at(-1)!;
    expect(last).toContain("smith");
    expect(last).toContain("jones");
    expect(last).toMatch(/\\citep/);
  });
});
