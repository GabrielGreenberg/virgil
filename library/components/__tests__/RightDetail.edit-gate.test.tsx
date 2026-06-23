// @vitest-environment jsdom
//
// DATA-LOSS GATE: the bib-card "edit" must be enabled ONLY on a REAL full
// master.bib entry — NEVER on the slim browse record (or its synthesized-raw
// display fallback). The slim record is always `type:"misc"` with ~12 browse
// fields only (see bib-index.ts `recordToBibEntry`); BibEditModal seeds its form
// from `entry.type`+`entry.fields` (NOT `raw`) and onSave REPLACES the whole
// master.bib block — so editing a slim/synthesized entry would overwrite the
// real entry with a lossy `@misc` block, silently dropping the real type + all
// non-browse fields. So `canEdit` gates on a real (un-synthesized) raw.
//
// Display, by contrast, must always work: PaperFileBody hands RightDetail a
// `withSynthesizedRaw(...)` bib so the formatted card renders even on a slim
// record. This test asserts BOTH halves:
//   - slim/synthesized entry  → display works, edit NOT enabled
//   - real full entry         → display works, edit enabled + modal mounts
//
// It mounts RightDetail directly, stubbing the heavy children
// (PaperRender / PdfView / PaperHeader / BibEditModal) so the assertion is
// purely about the edit-enablement gate.

import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { BibEntry } from "@library/lib/types";
import type { CatalogEntry } from "@library/lib/catalog";
import { withSynthesizedRaw, isSynthesizedRaw } from "@library/lib/reconstruct-bibtex";
import { __resetViewSessionForTests } from "@library/lib/view-session-store";

// jsdom here doesn't ship a full localStorage; install the in-memory shim the
// view-session tests use (RightDetail reads view-mode through the store).
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

// Stub the heavy children. PaperHeader exposes its `onEdit` prop as a button so
// we can confirm RightDetail wired it (canEdit). When `onEdit` is absent it
// renders a `no-edit` marker — and surfaces `editPending` so we can tell a
// "loading" disabled affordance from a genuinely-hidden control. The real
// renderers (PaperRender / PdfView) would mount the full EditorPane — irrelevant
// here. The stubbed bib card echoes the formatted title so we can prove DISPLAY
// works regardless of the edit gate.
vi.mock("../PaperHeader", () => ({
  default: ({
    onEdit,
    editPending,
    bib,
  }: {
    onEdit?: () => void;
    editPending?: boolean;
    bib?: { fields?: Record<string, string> } | null;
  }) => (
    <div>
      <span data-testid="bib-display">{bib?.fields?.title ?? "(none)"}</span>
      {onEdit ? (
        <button data-testid="edit-btn" onClick={onEdit}>
          edit
        </button>
      ) : (
        <span data-testid="no-edit" data-pending={editPending ? "1" : "0"} />
      )}
    </div>
  ),
}));
vi.mock("../PaperRender", () => ({ default: () => <div data-testid="reader" /> }));
vi.mock("../PdfView", () => ({ default: () => <div data-testid="pdf" /> }));
vi.mock("../BibEditModal", () => ({
  default: ({ entry }: { entry: BibEntry }) => (
    <div data-testid="bib-edit-modal">{entry.key}</div>
  ),
}));

import RightDetail from "../RightDetail";

const handle = {} as FileSystemDirectoryHandle;

const entry: CatalogEntry = {
  citekey: "genette1997",
  title: "Paratexts",
  addedAt: "",
  updatedAt: "",
  pdf: { present: false }, // DOCX-only → Text branch, no PdfView needed
  indexed: { state: "indexed" },
  bib: { state: "unverified" },
} as CatalogEntry;

// The REAL slim browse shape: `type:"misc"` + browse fields only, raw="".
// This is exactly what `recordToBibEntry` (bib-index.ts) produces — it is
// NOT the entry's true type (a book here), and it carries none of the non-browse
// fields. Editing+saving it would clobber the real master.bib entry.
const slimBib: BibEntry = {
  key: "genette1997",
  type: "misc",
  fields: { author: "Gérard Genette", title: "Paratexts", year: "1997" },
  raw: "",
};

// A REAL full entry as `getFullLibraryBibEntry` would return it: true type +
// its own non-empty raw block. Editing this is safe.
const fullBib: BibEntry = {
  key: "genette1997",
  type: "book",
  fields: {
    author: "Gérard Genette",
    title: "Paratexts: Thresholds of Interpretation",
    year: "1997",
    publisher: "Cambridge University Press",
    translator: "Jane E. Lewin",
  },
  raw: "@book{genette1997,\n  author = {Gérard Genette},\n  title = {Paratexts: Thresholds of Interpretation},\n  year = {1997},\n  publisher = {Cambridge University Press}\n}\n",
};

beforeEach(() => {
  memStore.clear();
  __resetViewSessionForTests();
});
afterEach(() => cleanup());

describe("RightDetail edit gate (data-loss: slim must not enable edit)", () => {
  it("BLOCKS edit on the raw slim entry (empty raw, type:misc) but still displays it", () => {
    act(() => {
      render(
        <RightDetail
          handle={handle}
          entry={entry}
          bib={slimBib}
          scope=""
          panel="left"
        />,
      );
    });
    // No edit affordance — RightDetail.canEdit is false (no real full entry).
    expect(screen.queryByTestId("edit-btn")).toBeNull();
    expect(screen.getByTestId("no-edit")).toBeTruthy();
    // Display still works.
    expect(screen.getByTestId("bib-display").textContent).toBe("Paratexts");
  });

  it("BLOCKS edit on the SYNTHESIZED-raw slim entry (display fallback) but still displays it", () => {
    // What PaperFileBody hands RightDetail while the full fetch is pending/failed:
    // a slim record with a SYNTHESIZED raw. raw is now non-empty, but it's tagged
    // synthesized — edit must STAY disabled (the synthesized raw is an `@misc`
    // block built from browse fields only).
    const synthesized = withSynthesizedRaw(slimBib);
    expect(synthesized.raw.trim().length).toBeGreaterThan(0); // raw IS populated
    expect(isSynthesizedRaw(synthesized)).toBe(true); // …but tagged synthesized

    act(() => {
      render(
        <RightDetail
          handle={handle}
          entry={entry}
          bib={synthesized}
          editPending={false}
          scope=""
          panel="left"
        />,
      );
    });
    // Despite a non-empty raw, edit is NOT enabled (this is the data-loss guard).
    expect(screen.queryByTestId("edit-btn")).toBeNull();
    expect(screen.getByTestId("no-edit")).toBeTruthy();
    // Display still works on the synthesized entry.
    expect(screen.getByTestId("bib-display").textContent).toBe("Paratexts");
  });

  it("shows a pending (disabled) edit affordance while the full fetch is in flight", () => {
    // Synthesized display entry + editPending → no real edit button, but the
    // pending marker is set so PaperHeader renders the disabled "Loading…" form.
    const synthesized = withSynthesizedRaw(slimBib);
    act(() => {
      render(
        <RightDetail
          handle={handle}
          entry={entry}
          bib={synthesized}
          editPending={true}
          scope=""
          panel="left"
        />,
      );
    });
    expect(screen.queryByTestId("edit-btn")).toBeNull();
    expect(screen.getByTestId("no-edit").getAttribute("data-pending")).toBe("1");
  });

  it("ENABLES edit + opens the modal once a REAL full entry (real raw) is present", () => {
    expect(isSynthesizedRaw(fullBib)).toBe(false); // not synthesized — real raw

    act(() => {
      render(
        <RightDetail
          handle={handle}
          entry={entry}
          bib={fullBib}
          scope=""
          panel="left"
        />,
      );
    });

    const editBtn = screen.getByTestId("edit-btn");
    expect(editBtn).toBeTruthy();
    // Display works.
    expect(screen.getByTestId("bib-display").textContent).toBe(
      "Paratexts: Thresholds of Interpretation",
    );
    // Modal not mounted until the user clicks edit.
    expect(screen.queryByTestId("bib-edit-modal")).toBeNull();

    act(() => {
      editBtn.click();
    });
    const modal = screen.getByTestId("bib-edit-modal");
    expect(modal).toBeTruthy();
    expect(modal.textContent).toBe("genette1997");
  });
});
