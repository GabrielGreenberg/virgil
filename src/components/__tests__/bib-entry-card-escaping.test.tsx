// @vitest-environment jsdom
//
// SECURITY pin (backlog #28): BibEntryCard's publication-details row must
// render `.bib` field values as escaped text, never as live markup. A field
// containing HTML/script (fetched by find-citation from an external source,
// or a shared paper's references.bib) must NOT inject nodes into the panel.
// The row is built from JSX spans (React escapes children), so no
// `dangerouslySetInnerHTML` field sink remains.

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

import { render, cleanup } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

function makeEntry(fields: Record<string, string>): BibEntry {
  return {
    uid: "evil",
    key: "evil2020",
    type: "article",
    fields: { author: "A. Author", year: "2020", title: "T", ...fields },
    raw: "",
  } as BibEntry;
}

function renderCard(entry: BibEntry) {
  return render(
    <BibEntryCard
      entry={entry}
      isSelected
      onClick={() => {}}
      getFormattedBib={() => ""}
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

describe("BibEntryCard publication-details escaping", () => {
  it("does not inject a <script> tag from the journal field", () => {
    const { container } = renderCard(
      makeEntry({ journal: "<script>window.__pwned=1</script>Evil J." }),
    );
    // No live <script> node was parsed into the card.
    expect(container.querySelector("script")).toBeNull();
    // The literal text is present (escaped, so visible as text).
    expect(container.textContent).toContain("<script>");
    expect(
      (globalThis as { __pwned?: number }).__pwned,
    ).toBeUndefined();
  });

  it("does not inject a <b>/<img onerror> from the booktitle field", () => {
    const { container } = renderCard(
      makeEntry({ booktitle: '<img src=x onerror="window.__pwned2=1">Proc.' }),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
    expect(
      (globalThis as { __pwned2?: number }).__pwned2,
    ).toBeUndefined();
  });

  it("does not inject markup from the editor/publisher/doi fields", () => {
    const { container } = renderCard(
      makeEntry({
        editor: "<i>x</i>",
        publisher: "<b>P</b>",
        doi: "10.1/<svg onload=1>",
      }),
    );
    // The only emphasis nodes in the body are the component's own known-safe
    // <i> wrappers around journal/booktitle — none come from field data, so
    // no <b>/<svg> field tag survives.
    expect(container.querySelector("svg[onload]")).toBeNull();
    expect(container.textContent).toContain("<i>x</i>");
    expect(container.textContent).toContain("<b>P</b>");
  });
});
