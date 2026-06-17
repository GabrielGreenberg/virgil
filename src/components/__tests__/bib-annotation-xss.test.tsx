// @vitest-environment jsdom
//
// SECURITY pin (BIB-F5-01): BibEntryCard's annotation editor seeds a
// contentEditable's innerHTML from the persisted annotation string
// (annotations.json — written by answer-bib-review or carried in a shared
// paper). That string is UNTRUSTED, so an <img onerror>/<script>/<svg onload>
// payload must NOT inject live, event-firing DOM when the Annotations pod opens.
// The editor routes the value through sanitizeAnnotationHtml on seed (and on
// write), so the sink is gone.

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

import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

function makeEntry(): BibEntry {
  return {
    key: "evil2020",
    type: "article",
    fields: { author: "A. Author", year: "2020", title: "T" },
    raw: "",
  } as BibEntry;
}

function renderCard(annotation: string) {
  return render(
    <BibEntryCard
      entry={makeEntry()}
      isSelected
      onClick={() => {}}
      getFormattedBib={() => ""}
      getAnnotation={() => annotation}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onUpdateBibEntry={() => {}}
      onUpdateBibKeyAndType={() => {}}
    />,
  );
}

/** Expand the Annotations pod so AnnotationEditor mounts and seeds innerHTML. */
function openAnnotations() {
  fireEvent.click(screen.getByText("Annotations"));
}

describe("BibEntryCard annotation XSS", () => {
  it("does not inject an <img onerror> seeded from a stored annotation", () => {
    const { container } = renderCard(
      '<b>note</b><img src=x onerror="window.__bibPwned=1">',
    );
    openAnnotations();

    const editor = container.querySelector(".annotation-editor")!;
    expect(editor).not.toBeNull();
    expect(editor.querySelector("img")).toBeNull();
    expect(editor.innerHTML).not.toMatch(/<img/i);
    expect(editor.innerHTML).not.toMatch(/onerror/i);
    // The benign formatting survived.
    expect(editor.innerHTML).toContain("<b>note</b>");
    expect((globalThis as { __bibPwned?: number }).__bibPwned).toBeUndefined();
  });

  it("does not inject a <script> seeded from a stored annotation", () => {
    const { container } = renderCard(
      'hello<script>window.__bibPwned2=1</script>',
    );
    openAnnotations();

    const editor = container.querySelector(".annotation-editor")!;
    expect(editor.querySelector("script")).toBeNull();
    expect(editor.innerHTML).not.toMatch(/<script/i);
    expect((globalThis as { __bibPwned2?: number }).__bibPwned2).toBeUndefined();
  });
});
