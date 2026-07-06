// @vitest-environment jsdom
//
// Task 055 — BibEntryCard renders through the UNIFIED card-standard header
// (PanelCard `kind="bib"`), not a bespoke hand-rolled header block. Pins the
// contract of the re-slot:
//   1. The unified header (`[data-card-header]`) renders with the
//      "BIBLIOGRAPHY ITEM" overline (via `kindLabelOverride`), like every
//      other card kind — no bespoke absolute top-right control cluster.
//   2. author · year · title still render (moved into the card body/title).
//   3. The occurrence counter (n/N) survives, in the header trailing slot.
//   4. The "Add" affordance survives and still fires onAdd.
//   5. Drag-to-cite survives: the card root is a drag source writing the
//      MIME_CITATION payload.

import { describe, it, expect, vi, afterEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/
// storage gotcha) — stub it; nothing here touches a sidecar.
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import { MIME_CITATION } from "@/lib/marginalia";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

const ENTRY: BibEntry = {
  uid: "u1",
  key: "genette1997",
  type: "book",
  fields: {
    author: "Genette, G.",
    year: "1997",
    title: "Paratexts: Thresholds of interpretation",
  },
  raw: "",
} as BibEntry;

function renderCard(extra: Partial<React.ComponentProps<typeof BibEntryCard>> = {}) {
  return render(
    <BibEntryCard
      entry={ENTRY}
      isSelected
      onClick={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onUpdateBibEntry={() => {}}
      onUpdateBibKeyAndType={() => {}}
      {...extra}
    />,
  );
}

describe("BibEntryCard — unified card-standard header (task 055)", () => {
  it("renders through the unified header with a BIBLIOGRAPHY ITEM overline", () => {
    const { container, getByText } = renderCard();
    // The unified PanelCard header (single source of truth) is present…
    expect(container.querySelector('[data-card-header]')).not.toBeNull();
    // …with the card-standard overline label (uppercased by CSS; DOM text is
    // the raw label).
    expect(getByText("Bibliography item")).toBeTruthy();
  });

  it("still renders author · year · title", () => {
    const { getByText } = renderCard();
    expect(getByText("Genette, G.")).toBeTruthy();
    expect(getByText("1997")).toBeTruthy();
    expect(getByText("Paratexts: Thresholds of interpretation")).toBeTruthy();
  });

  it("keeps the occurrence counter when the entry is cited more than once", () => {
    const { getByText } = renderCard({
      occurrenceInfo: { total: 3, current: 0, onCycle: () => {} },
    });
    expect(getByText("1/3")).toBeTruthy();
  });

  it("keeps the Add affordance and fires onAdd", () => {
    const onAdd = vi.fn();
    const { getByText } = renderCard({
      draggable: false,
      addAction: { onAdd, alreadyAdded: false },
    });
    fireEvent.click(getByText("Add"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("remains a drag source writing the MIME_CITATION payload", () => {
    const { container } = renderCard();
    const root = container.querySelector('[data-card]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute("draggable")).toBe("true");

    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (type: string, val: string) => { store[type] = val; },
      getData: (type: string) => store[type] ?? "",
      setDragImage: () => {},
      set effectAllowed(_v: string) {},
      get effectAllowed() { return "copyMove"; },
    };
    fireEvent.dragStart(root, { dataTransfer });
    expect(store[MIME_CITATION]).toBeTruthy();
    expect(store[MIME_CITATION]).toContain("genette1997");
    expect(store["text/plain"]).toContain("\\cite{genette1997}");
  });
});
