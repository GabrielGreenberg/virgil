// @vitest-environment jsdom
//
// Task 2026-08-21-409 — the two halves of the bib ROW family, driven through
// the REAL `BibEntryCard`:
//
//   HEADER + publication details → PROJECTED (`L{ó}pez`, `&`, an en dash)
//   the "BibTeX Fields" pod       → RAW-SOURCE, deliberately (decision 2)
//
// Both directions in ONE card, because that pairing IS the decision: a
// rendered view above its own source, the same relationship the editor has to
// the code pane. A leg that asserted only the projection would pass on an
// implementation that also projected the source pod — which is the one change
// in this family that could round-trip a rendering back into the `.bib`.
//
// Neutered check: reverting `BibEntryCard`'s three field reads to
// `entry.fields.*` fails the five projection legs and leaves the raw-pod legs
// green, which is exactly the pre-409 tree.

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
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

const RAW_AUTHOR = "L{\\'o}pez, Luis";
const RAW_TITLE = "Ellipsis \\& Anaphora";
const RAW_JOURNAL = "Linguistic Inquiry \\& Beyond";
const RAW_PAGES = "10--25";

const ENTRY: BibEntry = {
  uid: "u1",
  key: "lopez2009",
  type: "article",
  fields: {
    author: RAW_AUTHOR,
    year: "2009",
    title: RAW_TITLE,
    journal: RAW_JOURNAL,
    pages: RAW_PAGES,
  },
  raw: "",
} as BibEntry;

function renderCard() {
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
    />,
  );
}

describe("bib row — the reader sees glyphs, not bytes", () => {
  it("the header line shows the projected author and title", () => {
    const { container } = renderCard();
    const text = container.textContent ?? "";
    expect(text).toContain("L{ó}pez, Luis");
    expect(text).toContain("Ellipsis & Anaphora");
    expect(text).not.toContain("\\'o");
    expect(text).not.toContain("\\&");
  });

  it("the publication-details block projects too", () => {
    const { container } = renderCard();
    const text = container.textContent ?? "";
    // The journal keeps its `<i>` wrapper; what must go is the escape.
    expect(text).toContain("Linguistic Inquiry & Beyond");
    // …and the en-dashed page range reads as a range.
    expect(text).toContain("pp. 10–25");
    expect(text).not.toContain("10--25");
  });

  it("RAW-SOURCE POD — the BibTeX Fields pod still shows the bytes", () => {
    // Decision 2. This is the pod the "Edit entry" button opens over; a
    // projection here would be the write-back hazard rather than a fix.
    const { container, getByText } = renderCard();
    fireEvent.click(getByText("BibTeX Fields"));
    const text = container.textContent ?? "";
    expect(text).toContain(RAW_AUTHOR);
    expect(text).toContain(RAW_TITLE);
    expect(text).toContain(RAW_PAGES);
  });

  it("…and the field EDITOR seeds from the raw bytes, not the rendering", () => {
    // The write-back hazard the memo feared, pinned as REFUTED: no input in
    // either silo is seeded from a rendered string, so a projection at the JSX
    // sites cannot round-trip into the `.bib`.
    const { container, getByText } = renderCard();
    fireEvent.click(getByText("BibTeX Fields"));
    fireEvent.click(getByText("Edit entry"));
    const values = [...container.querySelectorAll("input")].map(
      (el) => (el as HTMLInputElement).value,
    );
    expect(values).toContain(RAW_AUTHOR);
    expect(values).toContain(RAW_TITLE);
    expect(values.some((v) => v.includes("ó"))).toBe(false);
  });
});
