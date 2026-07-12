// @vitest-environment jsdom
//
// PANE-FILL CONTRACT (task 054): RightDetail's root container must GROW to fill
// its pane on either flex axis.
//
// The detail pane is mounted in two different flex contexts:
//   - outer-tab path (PaperOuterView) → a flex COLUMN parent, where
//     `align-items:stretch` already gives the child full width; and
//   - in-library path (ReaderLRU → KeepAliveSlot) → a flex ROW parent
//     (`<div className="flex flex-1 …">`), where a plain flex item shrinks to
//     CONTENT width and pins LEFT.
//
// In PDF mode the widest child is the ~620px centered PaperHeader pod (the PDF
// iframe's intrinsic width is only ~300px), so without a grow the whole detail
// pane collapsed to ~620px, left-pinned, with a manila dead-band to the right —
// the reported bug ("PDF + header all smushed to the left"). Text mode only
// *looked* fine because the EditorPane content is wide enough to push the
// content-width near the pane width.
//
// The fix declares `flex:1` (+ `minWidth:0`) on ALL THREE root branches so the
// pane fills regardless of parent axis. Since Phase 4 (reader drag-freeze) the
// pdf/text branch root is the shared PaneFreeze wrapper, whose constant outer
// style CARRIES this contract (src/lib/pane-resize/PaneFreeze.tsx OUTER_STYLE)
// — these assertions now pin that the freeze mount preserved it. jsdom has no
// layout engine, so this test asserts the declared inline style — the durable,
// worktree-safe proof. A live eyeball over a real PDF fixture is still owed to
// Gabriel (no PDF fixture ships in the checkout).

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

// Stub the heavy children — this test is purely about RightDetail's own root
// container geometry, not what renders inside it.
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

/** True when the element is declared to GROW to fill a flex parent, however
 *  jsdom's CSSOM chose to store the `flex:1` shorthand (`flex-grow` expansion
 *  vs. the un-expanded `flex` longhand). */
function fillsGrow(el: HTMLElement): boolean {
  return (
    el.style.flexGrow === "1" ||
    /(^|\s)1(\s|$)/.test(el.style.flex) ||
    el.style.flex === "1"
  );
}

beforeEach(() => {
  memStore.clear();
  __resetViewSessionForTests();
});
afterEach(() => cleanup());

describe("RightDetail pane-fill (task 054: fill the pane, don't shrink-left)", () => {
  it("PDF-mode root grows to fill the pane (flex:1 + minWidth:0)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <RightDetail handle={handle} entry={pdfEntry} bib={bib} scope="" panel="left" />,
      ));
    });
    const root = container.firstChild as HTMLElement;
    // Landed in the PDF branch (the mocked PdfView is present).
    expect(container.querySelector('[data-testid="pdf"]')).toBeTruthy();
    expect(fillsGrow(root)).toBe(true);
    expect(root.style.minWidth).toBe("0px");
  });

  it("Text-mode root grows to fill the pane (flex:1 + minWidth:0)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <RightDetail handle={handle} entry={docxEntry} bib={bib} scope="" panel="left" />,
      ));
    });
    const root = container.firstChild as HTMLElement;
    // Landed in the Text branch (the mocked reader is present, no PdfView).
    expect(container.querySelector('[data-testid="reader"]')).toBeTruthy();
    expect(fillsGrow(root)).toBe(true);
    expect(root.style.minWidth).toBe("0px");
  });

  it("empty-selection placeholder root also fills the pane", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <RightDetail handle={handle} entry={null} bib={undefined} scope="" panel="left" />,
      ));
    });
    const root = container.firstChild as HTMLElement;
    expect(root.textContent).toContain("Select a paper");
    expect(fillsGrow(root)).toBe(true);
    expect(root.style.minWidth).toBe("0px");
  });
});
