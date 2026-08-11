// @vitest-environment jsdom
//
// task 2026-07-18-183 — the Errors header badge must count the RENDERED set,
// not the unfiltered one. Historically `ErrorsPanel` passed
// `count={visible.length}` (unfiltered) alongside `items={filtered}`, and
// `CardListPanel` forwarded that raw `count` verbatim whenever the panel
// supplied no `getArchived`. Under a text filter the one header row then
// showed the badge ("ERRORS 12") beside a `PrevNextCounter` reading the
// filtered set ("0 errors"), above an empty list — two numbers for the same
// set, disagreeing.
//
// The fix removed `count` from `CardListPanelProps` entirely: the badge is
// DERIVED from `visibleItems` unconditionally, so a card panel structurally
// cannot hand the header a number unrelated to what it renders.
//
// These tests pin: badge == rendered card count under a subset filter; no
// badge at all when the filter matches nothing (the `count > 0` gate in
// PanelHeader); clearing restores the full count; and — the task-124
// regression guard — a filter that merely HIDES the selected error must NOT
// clear the cross-surface selection.

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
import ErrorsPanel from "@/panels/Errors/ErrorsPanel";
import type { LatexError } from "@/lib/latex-errors";

afterEach(cleanup);

function makeError(n: number, message: string): LatexError {
  return {
    id: `e${n}`,
    source: "lint",
    severity: "error",
    line: n,
    message,
  } as LatexError;
}

// 3 errors mentioning "brace", 2 mentioning "float" — so a "brace" filter
// selects a strict subset and "zzz" selects none.
const ERRORS: LatexError[] = [
  makeError(1, "Unbalanced brace in section"),
  makeError(2, "Unbalanced brace in figure"),
  makeError(3, "Stray brace"),
  makeError(4, "Float too large"),
  makeError(5, "Float lost"),
];

function badge(container: HTMLElement): string | null {
  return container.querySelector(".panel-header-count")?.textContent ?? null;
}

function cardCount(container: HTMLElement): number {
  // `data-card="1"` is the PanelCard root marker — one per rendered ErrorCard.
  return container.querySelectorAll('[data-card="1"]').length;
}

function renderPanel(props: Partial<React.ComponentProps<typeof ErrorsPanel>> = {}) {
  return render(
    <ErrorsPanel
      errors={ERRORS}
      selectedId={null}
      onSelect={vi.fn()}
      jump={{ mode: "line", jump: vi.fn() }}
      dismissedIds={new Set()}
      onDismiss={vi.fn()}
      expandedIds={new Set()}
      onExpand={vi.fn()}
      onToggleExpanded={vi.fn()}
      {...props}
    />,
  );
}

function typeFilter(q: string) {
  const input = screen.getByPlaceholderText("Filter errors…");
  fireEvent.change(input, { target: { value: q } });
}

describe("Errors badge tracks the rendered set (task 183)", () => {
  it("no filter: badge equals the full undismissed count", () => {
    const { container } = renderPanel();
    expect(badge(container)).toBe("5");
    expect(cardCount(container)).toBe(5);
  });

  it("subset filter: badge equals the number of cards actually rendered", () => {
    const { container } = renderPanel();
    typeFilter("brace");
    expect(cardCount(container)).toBe(3);
    expect(badge(container)).toBe("3");
  });

  it("badge agrees with the PrevNextCounter beside it in the same header", () => {
    const { container } = renderPanel();
    typeFilter("brace");
    // The counter renders "N errors" when nothing is selected.
    expect(screen.getByText("3 errors")).toBeTruthy();
    expect(badge(container)).toBe("3");
  });

  it("zero matches: no badge at all, over the filter empty state", () => {
    const { container } = renderPanel();
    typeFilter("zzz");
    expect(cardCount(container)).toBe(0);
    expect(badge(container)).toBeNull();
    expect(screen.getByText("No errors match the filter.")).toBeTruthy();
    expect(screen.getByText("0 errors")).toBeTruthy();
  });

  it("clearing the filter restores the full count", () => {
    const { container } = renderPanel();
    typeFilter("brace");
    expect(badge(container)).toBe("3");
    typeFilter("");
    expect(badge(container)).toBe("5");
    expect(cardCount(container)).toBe(5);
  });

  it("dismissed errors are excluded from the badge", () => {
    const { container } = renderPanel({ dismissedIds: new Set(["e1", "e2"]) });
    expect(badge(container)).toBe("3");
  });
});

describe("task 124 regression guard — a filter must not clear the selection", () => {
  it("filtering out the selected error does NOT call onSelect(null)", () => {
    const onSelect = vi.fn();
    const { container } = renderPanel({ selectedId: "e1", onSelect });
    // "e1" ("Unbalanced brace in section") is hidden by a "float" filter, but
    // selection is cross-surface shared state (omni halo + editor highlight)
    // and a docked-view text filter must not mutate it.
    typeFilter("float");
    expect(cardCount(container)).toBe(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("but an error leaving the shared set (dismissed) still clears it", () => {
    const onSelect = vi.fn();
    renderPanel({ selectedId: "e1", onSelect, dismissedIds: new Set(["e1"]) });
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
