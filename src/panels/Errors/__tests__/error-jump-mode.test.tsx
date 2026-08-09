// @vitest-environment jsdom
//
// Task 125 — jumpability is owned by the MOUNT, not baked into the card.
//
// The Errors card renders on three surfaces with two different jump semantics:
// the visual mounts (docked panel + omni mirror) reach an error through its
// resolved PARAGRAPH, and the code-view sidebar reaches it by LINE. The card
// used to synthesize `hasAnchor || err.line > 0` for both — the union of the
// two rules, correct for neither. Each mount now forwards an `ErrorJump`
// capability (handler + mode, bound together at the handler's definition), and
// `canJumpToError` is the ONE formula every jump-issuing path gates on.
//
// Pinned here:
//   1. the predicate's truth table, both modes;
//   2. a line>0-but-UNANCHORED error is not handed to an `"anchor"` mount's
//      handler (the jump could only early-return);
//   3. a line-LESS error is not handed to a `"line"` mount's handler —
//      `scrollToLine(0)` clamps to line 1, so that jump scrolls the code pane
//      to the top, moves the caret and steals focus;
//   4. the same error IS handed over in the mount that can reach it;
//   5. every refusal still SELECTS — refusing a jump must never refuse
//      selection, which is what paints the editor's error highlight;
//   6. the keyboard nav (Arrow/Enter) obeys the same gate, not just the click.

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
import { canJumpToError } from "@/panels/Errors";
import type { ErrorJumpMode } from "@/panels/Errors";
import type { LatexError } from "@/lib/latex-errors";

afterEach(cleanup);

/** Resolved to a body paragraph, so an `"anchor"` mount can reach it. */
const ANCHORED: LatexError = {
  id: "lint:12:1:anchored",
  source: "lint",
  severity: "warning",
  line: 12,
  message: "Undefined reference fig:one",
  ruleId: "ref-undefined",
};

/** A preamble / `\usepackage` diagnostic: a real line, but its line is NOT in a
 *  uuid-tagged body paragraph, so no anchor resolved. Reachable in the code
 *  view, unreachable in the visual editor. */
const UNANCHORED_WITH_LINE: LatexError = {
  id: "compile:4:1:pkg",
  source: "compile",
  severity: "error",
  line: 4,
  message: "Package unavailable offline: tikz",
  ruleId: "offline-package",
};

/** A compile record the log gave no line for (`line: 0` is the documented
 *  "no line" sentinel in `LatexError`). Unreachable in BOTH mounts. */
const LINELESS: LatexError = {
  id: "compile:0:0:noline",
  source: "compile",
  severity: "error",
  line: 0,
  message: "Emergency stop while reading the font map",
};

function renderPanel(
  mode: ErrorJumpMode,
  errors: LatexError[],
  anchoredIds: Set<string>,
) {
  const jump = { mode, jump: vi.fn() };
  const onSelect = vi.fn();
  const utils = render(
    <ErrorsPanel
      errors={errors}
      selectedId={null}
      onSelect={onSelect}
      jump={jump}
      anchoredIds={anchoredIds}
      dismissedIds={new Set()}
      onDismiss={vi.fn()}
      expandedIds={new Set()}
      onExpand={vi.fn()}
      onToggleExpanded={vi.fn()}
    />,
  );
  return { jump, onSelect, ...utils };
}

/** Click the card BODY (the compressed message line), not the header — the
 *  header composition is deliberately jump-free. */
function clickBody(match: RegExp) {
  // A ruleId-less error's derived title IS its first message line, so the text
  // matches twice inside the same body div. Either node bubbles to the card's
  // click handler — take the first.
  fireEvent.click(screen.getAllByText(match)[0]);
}

describe("canJumpToError — the one jumpability formula (task 125)", () => {
  it("'anchor' mode asks ONLY whether the error resolved to a paragraph", () => {
    expect(canJumpToError(ANCHORED, "anchor", true)).toBe(true);
    // A real line does not make it reachable in the visual editor.
    expect(canJumpToError(UNANCHORED_WITH_LINE, "anchor", false)).toBe(false);
    expect(canJumpToError(LINELESS, "anchor", false)).toBe(false);
    // ...and a resolved anchor makes a line-less error reachable there.
    expect(canJumpToError(LINELESS, "anchor", true)).toBe(true);
  });

  it("'line' mode asks ONLY whether the error carries a line", () => {
    // The preamble error the visual mount can't reach IS reachable in code.
    expect(canJumpToError(UNANCHORED_WITH_LINE, "line", false)).toBe(true);
    expect(canJumpToError(ANCHORED, "line", true)).toBe(true);
    // `scrollToLine(0)` clamps to line 1 — declined rather than misfired.
    expect(canJumpToError(LINELESS, "line", true)).toBe(false);
    expect(canJumpToError(LINELESS, "line", false)).toBe(false);
  });
});

describe("ErrorsPanel — a body click jumps only where the mount can reach", () => {
  it("'anchor' mount: an unanchored line>0 error selects but does NOT jump", () => {
    const { jump, onSelect } = renderPanel(
      "anchor",
      [UNANCHORED_WITH_LINE],
      new Set(),
    );
    clickBody(/Package unavailable offline/);
    expect(jump.jump).not.toHaveBeenCalled();
    // Selection is untouched by the gate — it is what paints the highlight.
    expect(onSelect).toHaveBeenCalledWith(UNANCHORED_WITH_LINE.id);
  });

  it("'anchor' mount: an anchored error DOES jump", () => {
    const { jump } = renderPanel("anchor", [ANCHORED], new Set([ANCHORED.id]));
    clickBody(/Undefined reference/);
    expect(jump.jump).toHaveBeenCalledTimes(1);
    expect(jump.jump).toHaveBeenCalledWith(ANCHORED);
  });

  it("'line' mount: the SAME unanchored error jumps (a preamble error is reachable in code)", () => {
    const { jump } = renderPanel("line", [UNANCHORED_WITH_LINE], new Set());
    clickBody(/Package unavailable offline/);
    expect(jump.jump).toHaveBeenCalledTimes(1);
    expect(jump.jump).toHaveBeenCalledWith(UNANCHORED_WITH_LINE);
  });

  it("'line' mount: a line-LESS error selects but does NOT jump (no scroll-to-top caret hijack)", () => {
    const { jump, onSelect } = renderPanel("line", [LINELESS], new Set());
    clickBody(/Emergency stop/);
    expect(jump.jump).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(LINELESS.id);
  });
});

describe("ErrorsPanel — keyboard nav obeys the same gate", () => {
  it("ArrowDown onto an unreachable error selects it without jumping", () => {
    const { jump, onSelect } = renderPanel(
      "anchor",
      [UNANCHORED_WITH_LINE],
      new Set(),
    );
    // The panel's scroll region is the nav-key target (`scrollTabIndex={0}`).
    const list = document.querySelector('[tabindex="0"]') as HTMLElement;
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(UNANCHORED_WITH_LINE.id);
    expect(jump.jump).not.toHaveBeenCalled();
  });

  it("ArrowDown onto a reachable error selects AND jumps", () => {
    const { jump, onSelect } = renderPanel(
      "anchor",
      [ANCHORED],
      new Set([ANCHORED.id]),
    );
    const list = document.querySelector('[tabindex="0"]') as HTMLElement;
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(ANCHORED.id);
    expect(jump.jump).toHaveBeenCalledWith(ANCHORED);
  });
});
