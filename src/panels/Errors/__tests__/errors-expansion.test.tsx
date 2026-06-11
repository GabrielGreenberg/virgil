// @vitest-environment jsdom
//
// R5 pin tests — error-card expansion is a LIFTED, controlled axis.
//
// The expand set is owned by EditorPane (one scope shared by the docked
// ErrorsPanel and the omni mirror; EditorLayout's code-view sidebar keeps its
// own set for its different error list). These tests pin:
//   1. `pruneExpanded` — drops dead ids, identity-stable, and NO-OP on an
//      empty live list (the transient mid-compile empty list must not wipe
//      the user's expansion state).
//   2. ErrorsPanel's controlled contract — the header chevron fires
//      `onToggleExpanded`, a body click fires `onExpand`, and the component
//      holds NO internal expansion state (display tracks `expandedIds` only).

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
// wiring and controlled display, not layout.
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
import { pruneExpanded } from "@/panels/Errors/expansion";
import type { LatexError } from "@/lib/latex-errors";

const ERR: LatexError = {
  id: "lint:3:1:abc",
  source: "lint",
  severity: "warning",
  line: 3,
  message: "Undefined reference fig:one",
  ruleId: "ref-undefined",
};

function renderPanel(overrides: Partial<Parameters<typeof ErrorsPanel>[0]> = {}) {
  const props = {
    errors: [ERR],
    selectedId: null,
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

describe("pruneExpanded (R5 / A4 deferred #4)", () => {
  it("drops ids that are no longer live", () => {
    const out = pruneExpanded(new Set(["a", "b", "c"]), ["b"]);
    expect([...out].sort()).toEqual(["b"]);
  });

  it("is identity-stable when nothing prunes", () => {
    const expanded = new Set(["a", "b"]);
    expect(pruneExpanded(expanded, ["a", "b", "c"])).toBe(expanded);
  });

  it("no-ops on an empty live list (mid-compile transient must not wipe)", () => {
    const expanded = new Set(["a", "b"]);
    expect(pruneExpanded(expanded, [])).toBe(expanded);
  });
});

describe("ErrorsPanel controlled expansion contract (R5)", () => {
  it("the header chevron fires onToggleExpanded with the error id", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByLabelText("Expand card"));
    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);
    expect(props.onToggleExpanded).toHaveBeenCalledWith(ERR.id);
    expect(props.onExpand).not.toHaveBeenCalled();
  });

  it("a body click fires onExpand with the error id", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByText(/Undefined reference/));
    expect(props.onExpand).toHaveBeenCalledTimes(1);
    expect(props.onExpand).toHaveBeenCalledWith(ERR.id);
  });

  it("holds NO internal expansion state — display tracks expandedIds only", () => {
    const { props, rerender } = renderPanel();
    // Compressed: the expanded-body severity row is absent.
    expect(screen.queryByText("warning")).toBeNull();
    // Clicking the chevron does NOT expand locally (controlled component —
    // the callback fired, but with unchanged props the card stays closed).
    fireEvent.click(screen.getByLabelText("Expand card"));
    expect(screen.queryByText("warning")).toBeNull();
    // Only a prop change opens it.
    rerender(
      <ErrorsPanel {...props} expandedIds={new Set([ERR.id])} />,
    );
    expect(screen.getByText("warning")).toBeTruthy();
    expect(screen.getByLabelText("Collapse card")).toBeTruthy();
  });
});
