// Task 116 — jump-selection scope-completeness guard (the jump-side twin of
// scope-dispatch.test.ts).
//
// The bug class (SR-F3-02, 2nd recurrence): `openItemInPanel`'s hand-written
// selection if-ladder had no `reports` branch, so a Reports-scope search hit
// docked the panel but never selected the matched card. `JumpSelectionSetters`
// replaces the ladder with a TOTAL `Record<SearchJumpPanel | "examples", …>` —
// TypeScript fails the build if a SCOPE_PANEL value has no selection setter.
//
// This file pins:
//   (1) the COMPILE-TIME exhaustiveness (type-level set equality between the
//       record's keys and the SCOPE_PANEL value union + "examples");
//   (2) the runtime: every SCOPE_PANEL value resolves to a dispatchable setter
//       via `jumpSelectionFor` — with `reports` pinned explicitly — and
//       non-selection panel ids resolve to null.

import { describe, it, expect, vi } from "vitest";

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

import {
  JUMP_SELECTION_PANELS,
  jumpSelectionFor,
  type JumpSelectionPanel,
  type JumpSelectionSetters,
} from "@/components/editor-layout/jump-selection";
import { SCOPE_PANEL, type SearchJumpPanel } from "@/lib/search-sources";

// ── Compile-time exhaustiveness proof ──────────────────────────────────────
// Bidirectional assignability == set equality between the setters-record key
// union and SCOPE_PANEL's value union + "examples". A SCOPE_PANEL value
// missing from JumpSelectionPanel breaks one direction; a stray record key
// breaks the other.
type ExpectedKeys = SearchJumpPanel | "examples";
const _keysCoverPanels: ExpectedKeys = null as unknown as JumpSelectionPanel;
const _panelsCoverKeys: JumpSelectionPanel = null as unknown as ExpectedKeys;
void _keysCoverPanels;
void _panelsCoverKeys;

/** A full setters record with one spy per jump-landable panel. */
function spySetters(): JumpSelectionSetters {
  return Object.fromEntries(
    JUMP_SELECTION_PANELS.map((p) => [p, vi.fn()]),
  ) as unknown as JumpSelectionSetters;
}

describe("jump-selection — exhaustiveness over SCOPE_PANEL", () => {
  // SCOPE_PANEL is Partial-typed for by-scope indexing; runtime values are
  // never undefined — the filter just narrows the type.
  const scopePanelValues = Object.values(SCOPE_PANEL).filter(
    (p): p is SearchJumpPanel => p != null,
  );

  it("enumerates every SCOPE_PANEL value (plus examples) exactly once", () => {
    const expected = [...new Set<string>(scopePanelValues), "examples"];
    expect([...JUMP_SELECTION_PANELS].sort()).toEqual(expected.sort());
  });

  it("every SCOPE_PANEL value routes to a selection setter (no dropped panel)", () => {
    const setters = spySetters();
    for (const panel of scopePanelValues) {
      const select = jumpSelectionFor(setters, panel);
      expect(select, `panel "${panel}" has no selection dispatch`).toBeTypeOf(
        "function",
      );
      select!(`item-${panel}`);
      expect(setters[panel]).toHaveBeenCalledWith(`item-${panel}`);
    }
  });

  it("dispatches `reports` — the branch the old if-ladder dropped (task 116)", () => {
    const setters = spySetters();
    jumpSelectionFor(setters, "reports")?.("rep-1");
    expect(setters.reports).toHaveBeenCalledWith("rep-1");
    // And only reports — the jump must not select in sibling panels.
    for (const p of JUMP_SELECTION_PANELS) {
      if (p !== "reports") expect(setters[p]).not.toHaveBeenCalled();
    }
  });

  it("returns null for panel ids without a native selection slot", () => {
    const setters = spySetters();
    for (const panel of ["omni", "search", "outline", "blank"] as const) {
      expect(jumpSelectionFor(setters, panel)).toBeNull();
    }
  });
});
