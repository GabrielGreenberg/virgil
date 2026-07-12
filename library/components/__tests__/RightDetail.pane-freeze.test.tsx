// @vitest-environment jsdom
//
// PHASE-4 WIRING (plan §P3, reader drag-freeze): both HEAVY reader branches —
// the pdf.js iframe view AND the text PaperRender view — must render inside
// the shared PaneFreeze wrapper anchored to the pane's STATIONARY edge, so a
// pane gutter drag resizes the reader content exactly ONCE, on the end edge.
// The anchor is derived per PanelKey (library-grid-template.ts): the RIGHT
// panel is the minmax(…,1fr) READER track (left edge moves, right edge
// container-fixed → "right"); the LEFT panel is the fixed-width LIST track
// (the list|reader gutter moves its RIGHT edge → "left") — papers routinely
// mount there via openPaper's opposite-panel routing and cross-panel tab
// drags. The empty-selection placeholder must NOT be wrapped — freezing an
// empty pane is pointless. Same stub-the-heavy-children setup as
// RightDetail.pane-fill.

import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { BibEntry } from "@library/lib/types";
import type { CatalogEntry } from "@library/lib/catalog";
import { __resetViewSessionForTests } from "@library/lib/view-session-store";

const memStore = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
      setItem: (k: string, v: string) => void memStore.set(k, v),
      removeItem: (k: string) => void memStore.delete(k),
      clear: () => memStore.clear(),
    },
  });
});

// Stub the heavy children — this test is purely about which branch roots carry
// the freeze wrapper, not what renders inside it.
vi.mock("../PaperHeader", () => ({ default: () => <div data-testid="header" /> }));
vi.mock("../PaperRender", () => ({ default: () => <div data-testid="reader" /> }));
vi.mock("../PdfView", () => ({ default: () => <div data-testid="pdf" /> }));
vi.mock("../BibEditModal", () => ({ default: () => <div data-testid="modal" /> }));

import RightDetail from "../RightDetail";

const handle = {} as FileSystemDirectoryHandle;

const bib: BibEntry = {
  key: "genette1997",
  type: "book",
  fields: { author: "Gérard Genette", title: "Paratexts", year: "1997" },
  raw: "@book{genette1997}",
};

const pdfEntry: CatalogEntry = {
  citekey: "genette1997",
  title: "Paratexts",
  addedAt: "",
  updatedAt: "",
  pdf: { present: true, format: "pdf" }, // → opens in PDF mode
  indexed: { state: "indexed" },
  bib: { state: "unverified" },
} as CatalogEntry;

const docxEntry: CatalogEntry = {
  ...pdfEntry,
  pdf: { present: false }, // → Text branch (no PDF on disk)
} as CatalogEntry;

beforeEach(() => {
  memStore.clear();
  __resetViewSessionForTests();
});
afterEach(() => cleanup());

describe("RightDetail pane-freeze wiring (reader content frozen during pane drags)", () => {
  it("PDF mode: the branch root is a PaneFreeze anchored to the pane's stationary edge — 'right' in the right panel, 'left' in the left", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <RightDetail handle={handle} entry={pdfEntry} bib={bib} scope="" panel="right" />,
      ));
    });
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("data-pane-freeze")).toBe("right");
    // The heavy content (header + pdf.js mount) sits INSIDE the freeze's
    // inner lock node, so the begin-edge width lock covers it.
    const inner = root.querySelector("[data-pane-freeze-inner]");
    expect(inner?.querySelector('[data-testid="pdf"]')).toBeTruthy();
    expect(inner?.querySelector('[data-testid="header"]')).toBeTruthy();

    // A LEFT-panel reader's stationary edge is its LEFT edge (the list|reader
    // gutter moves its right edge) — anchoring "right" there would translate
    // the frozen content with every pointer frame.
    cleanup();
    act(() => {
      ({ container } = render(
        <RightDetail handle={handle} entry={pdfEntry} bib={bib} scope="" panel="left" />,
      ));
    });
    expect(
      (container.firstChild as HTMLElement).getAttribute("data-pane-freeze"),
    ).toBe("left");
  });

  it("Text mode: the branch root is a PaneFreeze anchored to the pane's stationary edge — 'right' in the right panel, 'left' in the left", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <RightDetail handle={handle} entry={docxEntry} bib={bib} scope="" panel="right" />,
      ));
    });
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("data-pane-freeze")).toBe("right");
    const inner = root.querySelector("[data-pane-freeze-inner]");
    expect(inner?.querySelector('[data-testid="reader"]')).toBeTruthy();
    expect(inner?.querySelector('[data-testid="header"]')).toBeTruthy();

    cleanup();
    act(() => {
      ({ container } = render(
        <RightDetail handle={handle} entry={docxEntry} bib={bib} scope="" panel="left" />,
      ));
    });
    expect(
      (container.firstChild as HTMLElement).getAttribute("data-pane-freeze"),
    ).toBe("left");
  });

  it("empty-selection placeholder is NOT wrapped (nothing heavy to freeze)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <RightDetail handle={handle} entry={null} bib={undefined} scope="" panel="left" />,
      ));
    });
    expect(container.textContent).toContain("Select a paper");
    expect(container.querySelector("[data-pane-freeze]")).toBeNull();
  });
});
