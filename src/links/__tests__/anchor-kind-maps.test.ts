// @vitest-environment jsdom
//
// CHIP 1 foundation — the CardKind↔LinkedAnchorKind crosswalk + the tint SSOT.
//
// These pin the two map-completeness fixes the unified anchor fix depends on:
//   1. `cardKindToLegacyAnchorKind` is EXHAUSTIVE — `revision-suggestion`,
//      `report`, and `report-request` now stamp their CORRECT mark kind instead
//      of the old silent `"note"` default (the BUG1 kind-corruption class at
//      create time); non-anchor kinds return `null`.
//   2. `defaultTintForLinkedAnchorKind` is the single source for the highlight
//      tint (`#fbbf24` for highlight, `null` otherwise) — so create and reload
//      derive the same tint.
//
// The storage stub guards the extension-barrel/@/lib/storage gotcha (links.ts
// transitively pulls @/lib/storage through layout-scroll / inline-content).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { cardKindToLegacyAnchorKind, legacyKindToCardKindString } from "@/links/links";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";

describe("cardKindToLegacyAnchorKind — exhaustive, no silent note default", () => {
  it("folds both revision kinds to the shared `revision` marker", () => {
    expect(cardKindToLegacyAnchorKind("revision-comment")).toBe("revision");
    expect(cardKindToLegacyAnchorKind("revision-suggestion")).toBe("revision");
  });

  it("maps report / report-request to their own kinds (was mislabeled `note`)", () => {
    expect(cardKindToLegacyAnchorKind("report")).toBe("report");
    expect(cardKindToLegacyAnchorKind("report-request")).toBe("report-request");
  });

  it("passes the simple anchor kinds through", () => {
    expect(cardKindToLegacyAnchorKind("note")).toBe("note");
    expect(cardKindToLegacyAnchorKind("highlight")).toBe("highlight");
    expect(cardKindToLegacyAnchorKind("todo")).toBe("todo");
    expect(cardKindToLegacyAnchorKind("cutter-comment")).toBe("cutter-comment");
    expect(cardKindToLegacyAnchorKind("cutter-suggestion")).toBe("cutter-suggestion");
  });

  it("returns null for non-anchor kinds (no silent note fallback)", () => {
    expect(cardKindToLegacyAnchorKind("footnote")).toBeNull();
    expect(cardKindToLegacyAnchorKind("citation")).toBeNull();
    expect(cardKindToLegacyAnchorKind("archive")).toBeNull();
  });

  it("round-trips through legacyKindToCardKindString to a real data-link-card token", () => {
    // revision folds to the spine `revision-comment:` data-link-card token (the
    // CSS rule keys on `[data-link-card^="revision-comment:"]`; `comment:` is a
    // legacy alias), NOT a ruleless `revision:`.
    expect(legacyKindToCardKindString("revision")).toBe("revision-comment");
    expect(legacyKindToCardKindString("report")).toBe("report");
    expect(legacyKindToCardKindString("note")).toBe("note");
  });
});

describe("defaultTintForLinkedAnchorKind — single tint source", () => {
  it("paints the Adobe yellow only for highlight", () => {
    expect(defaultTintForLinkedAnchorKind("highlight")).toBe("#fbbf24");
  });

  it("paints no tint for every non-highlight kind", () => {
    expect(defaultTintForLinkedAnchorKind("note")).toBeNull();
    expect(defaultTintForLinkedAnchorKind("revision")).toBeNull();
    expect(defaultTintForLinkedAnchorKind("todo")).toBeNull();
  });
});
