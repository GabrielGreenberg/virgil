// @vitest-environment jsdom
//
// T6-C16 / BIB-F5-04 — the inline bib editor's "remove field" affordance must
// route a field DELETION through the set-all `replaceBibEntry` (D3), not the
// merge `updateBibEntry`. Clearing/removing a field then Saving must persist a
// field map that OMITS the removed field ("I cleared the field but it came
// back" is the bug). The Replace-with-library path is exercised in
// BibliographyPanel; here we pin the per-field delete wiring.

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

function makeEntry(): BibEntry {
  return {
    uid: "u1",
    key: "foo2020",
    type: "article",
    fields: { author: "A. Author", title: "Orig", year: "2020", note: "stray" },
    raw: "",
  } as BibEntry;
}

function renderCard(overrides: Partial<React.ComponentProps<typeof BibEntryCard>> = {}) {
  const onReplaceBibEntry = vi.fn();
  const onUpdateBibEntry = vi.fn();
  render(
    <BibEntryCard
      entry={makeEntry()}
      isSelected
      onClick={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onUpdateBibEntry={onUpdateBibEntry}
      onReplaceBibEntry={onReplaceBibEntry}
      onUpdateBibKeyAndType={() => {}}
      {...overrides}
    />,
  );
  return { onReplaceBibEntry, onUpdateBibEntry };
}

function openEditor() {
  fireEvent.click(screen.getByText("BibTeX Fields"));
  fireEvent.click(screen.getByText("Edit entry"));
}

describe("BibEntryCard inline editor — field delete (BIB-F5-04)", () => {
  it("removing a field then Save routes the OMITTED field through replaceBibEntry", () => {
    const { onReplaceBibEntry, onUpdateBibEntry } = renderCard();
    openEditor();

    // Remove the `note` field via its remove button.
    fireEvent.click(screen.getByLabelText("Remove field note"));
    fireEvent.click(screen.getByText("Save"));

    expect(onReplaceBibEntry).toHaveBeenCalledTimes(1);
    const [key, fields] = onReplaceBibEntry.mock.calls[0];
    expect(key).toBe("foo2020");
    // The removed field is GONE from the set-all map (deleted, not retained).
    expect("note" in fields).toBe(false);
    // The other fields survive.
    expect(fields.author).toBe("A. Author");
    expect(fields.title).toBe("Orig");
    expect(fields.year).toBe("2020");
    // Delete is honored only by the set-all path, never the merge fallback.
    expect(onUpdateBibEntry).not.toHaveBeenCalled();
  });

  it("a remove button exists for every field", () => {
    renderCard();
    openEditor();
    for (const f of ["author", "title", "year", "note"]) {
      expect(screen.getByLabelText(`Remove field ${f}`)).toBeTruthy();
    }
  });

  it("Save carries the entry type through replaceBibEntry (set-all owns type too)", () => {
    const { onReplaceBibEntry } = renderCard();
    openEditor();
    fireEvent.click(screen.getByText("Save"));
    const [, , type] = onReplaceBibEntry.mock.calls[0];
    expect(type).toBe("article");
  });
});
