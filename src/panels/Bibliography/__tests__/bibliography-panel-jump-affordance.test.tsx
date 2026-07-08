// @vitest-environment jsdom
//
// Task 095 — the Bibliography jump-to-citation affordance is gated on a *live
// in-text* occurrence, not on the persisted `isCited` predicate.
//
// Bug class: `isCited` (from the persisted `citations` sidecar) conflates
// "referenced anywhere" — which includes an unanchored/archived citation with
// no `\cite` node in the document — with "jumpable" (a live in-text
// occurrence, from `allEditorCitations`). The panel used to wire the
// live-source jump handler off the persisted-source predicate, so an entry
// cited only by an unanchored/archived citation rendered a full-opacity Jump
// chevron that silently no-op'd (the handler found `ids[…] === undefined`).
//
// The fix gates `onJump` on `ids.length > 0` (live occurrences). These tests
// pin both halves: (A) no actionable jump for a persisted-but-not-in-text
// entry, and (B) a live in-text cite still jumps.

import { describe, it, expect, vi, afterEach } from "vitest";

// panel-primitives (and the bib card chrome) transitively pull `@/lib/storage`
// (the known barrel/storage gotcha) — stub it; nothing here touches a sidecar.
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

// The panel reads the library catalog (via `@/hooks/useLibrary` →
// `@library/lib/catalog-store`); its init effect resolves a folder handle
// through idb-keyval, which throws `indexedDB is not defined` under jsdom.
// Stub the hook to an empty, no-folder catalog — the jump wiring under test
// is independent of any library membership.
vi.mock("@library/lib/catalog-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@library/lib/catalog-store")>();
  return {
    ...actual,
    useCatalogItems: () => ({ entries: [], revision: 0, hasFolder: false }),
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent } from "@testing-library/react";
import BibliographyPanel from "@/panels/Bibliography/BibliographyPanel";
import type { BibEntry, CitationRef } from "@/lib/types";

afterEach(cleanup);

const SMITH: BibEntry = {
  uid: "u-smith",
  key: "smith",
  type: "article",
  fields: { author: "Smith, A.", year: "2001", title: "On Things" },
  raw: "",
} as BibEntry;

// A persisted citation for `smith` that has NO live `\cite` node in the doc —
// the unanchored/panel-only case (`createCitation` defaults `unanchored:true`;
// archiving splices the atom and flags `unanchored`). It still populates
// `citedKeys`, so the entry shows under the default "Cited only" filter.
const UNANCHORED_SMITH: CitationRef = {
  id: "cit-smith",
  command: "\\cite{smith}",
  keys: ["smith"],
  createdAt: "2026-07-08T00:00:00.000Z",
  unanchored: true,
};

function renderPanel(
  extra: Partial<React.ComponentProps<typeof BibliographyPanel>> = {},
) {
  return render(
    <BibliographyPanel
      citations={[UNANCHORED_SMITH]}
      bibEntries={[SMITH]}
      selectedBibKey={null}
      onSelectBibKey={() => {}}
      onUpdateBibEntry={() => {}}
      onUpdateBibKeyAndType={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      docId="doc1"
      entryRequests={[]}
      onAddEntryRequest={() => {}}
      onRemoveEntryRequest={() => {}}
      {...extra}
    />,
  );
}

describe("BibliographyPanel — jump affordance gated on live in-text occurrence (task 095)", () => {
  it("renders the entry (it IS referenced) but offers NO jump when the only citation is unanchored/archived", () => {
    const onScrollToCitation = vi.fn();
    const { container } = renderPanel({
      allEditorCitations: [], // no live \cite node
      onScrollToCitation,
    });
    // The entry is present under the default "Cited only" filter — being
    // referenced by an unanchored citation still counts for the filter/label.
    expect(container.textContent).toContain("On Things");
    // …but there is no actionable jump chevron (dead affordance is gone).
    expect(
      container.querySelector('button[aria-label="Jump to citation"]'),
    ).toBeNull();
  });

  it("still offers the jump and fires onScrollToCitation when a live in-text cite exists", () => {
    const onScrollToCitation = vi.fn();
    const { container } = renderPanel({
      allEditorCitations: [
        { citationId: "c1", command: "\\cite{smith}", keys: ["smith"] },
      ],
      onScrollToCitation,
    });
    const btn = container.querySelector(
      'button[aria-label="Jump to citation"]',
    ) as HTMLElement | null;
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    expect(onScrollToCitation).toHaveBeenCalledTimes(1);
    expect(onScrollToCitation.mock.calls[0][0]).toBe("c1");
  });
});
