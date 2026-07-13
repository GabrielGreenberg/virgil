// @vitest-environment jsdom
//
// Task 124 pin tests — the docked ErrorsPanel's LOCAL text filter must not
// mutate the SHARED cross-surface selection.
//
// `selectedId`/`onSelect` are owned by useDiagnostics ("one set across all
// surfaces"): the omni mirror renders all errors (unfiltered) and reads the
// same `selectedId` for its halo, and the editor's error-highlight range is
// driven by `selectedId`. So the panel's selection-clear effect must gate on
// `visible` (dismissal-only) — NOT `filtered` (dismissal + text filter):
//   1. A text filter that hides the selected error does NOT clear the shared
//      selection (`onSelect(null)` is never called).
//   2. A `visible`-set removal (dismissal / re-lint drop) STILL clears it.

import { describe, it, expect, vi, afterEach } from "vitest";

// ErrorsPanel → panel-primitives transitively pulls `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest's resolver can't alias (the known
// barrel/storage gotcha). Stub it — nothing here touches a sidecar.
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

// jsdom has no ResizeObserver; panel-primitives' card header measures itself
// with one on mount. A no-op stub is enough — these tests assert callback
// wiring, not layout.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ErrorsPanel from "@/panels/Errors";

// vitest globals are off, so RTL's auto-cleanup never registers — unmount
// explicitly or renders leak across tests (repo convention).
afterEach(cleanup);
import type { LatexError } from "@/lib/latex-errors";

const ERR_A: LatexError = {
  id: "lint:3:1:aaa",
  source: "lint",
  severity: "warning",
  line: 3,
  message: "Undefined reference fig:one",
  ruleId: "ref-undefined",
};
const ERR_B: LatexError = {
  id: "lint:7:1:bbb",
  source: "lint",
  severity: "warning",
  line: 7,
  message: "Overfull hbox in section two",
  ruleId: "overfull",
};

function renderPanel(overrides: Partial<Parameters<typeof ErrorsPanel>[0]> = {}) {
  const props = {
    errors: [ERR_A, ERR_B],
    selectedId: ERR_A.id,
    onSelect: vi.fn(),
    onJump: vi.fn(),
    dismissedIds: new Set<string>(),
    onDismiss: vi.fn(),
    expandedIds: new Set<string>(),
    onExpand: vi.fn(),
    onToggleExpanded: vi.fn(),
    ...overrides,
  };
  const utils = render(<ErrorsPanel {...props} />);
  return { props, ...utils };
}

describe("ErrorsPanel — local text filter vs. shared selection (task 124)", () => {
  it("a text filter that hides the selected error does NOT clear the shared selection", () => {
    const { props } = renderPanel();
    // Initial mount: ERR_A is selected and present in `visible` — no clear.
    expect(props.onSelect).not.toHaveBeenCalled();
    // Type a filter that matches ERR_B only, hiding the selected ERR_A.
    fireEvent.change(screen.getByPlaceholderText("Filter errors…"), {
      target: { value: "overfull" },
    });
    // The selected card is filtered out of the docked list...
    expect(screen.queryByText(/Undefined reference/)).toBeNull();
    expect(screen.getByText(/Overfull hbox/)).toBeTruthy();
    // ...but the shared selection is untouched (omni halo + editor highlight persist).
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("clears the selection when the selected error leaves the VISIBLE set (dismissal)", () => {
    const { props, rerender } = renderPanel();
    expect(props.onSelect).not.toHaveBeenCalled();
    // Dismiss ERR_A — it leaves `visible`, so the shared selection must clear.
    rerender(
      <ErrorsPanel
        {...props}
        dismissedIds={new Set([ERR_A.id])}
      />,
    );
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("clears the selection when the selected error is removed by a re-lint", () => {
    const { props, rerender } = renderPanel();
    expect(props.onSelect).not.toHaveBeenCalled();
    // Re-lint drops ERR_A from the error list entirely — leaves `visible`.
    rerender(<ErrorsPanel {...props} errors={[ERR_B]} />);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });
});
