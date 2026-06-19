// @vitest-environment jsdom
//
// CHIP 5 — `getTextAnchorCardKind` returns the sidecar-persisted CardKind of a
// card's Mode-B text-range anchor (`link.target.ref.kind`). This is the
// authoritative kind the parser-default `kind:"note"` mark is reconciled
// against on reload (BUG1) and the SSOT for kind-aware glue.
//
// Storage stub guards the extension-barrel/@/lib/storage gotcha (links.ts pulls
// @/lib/storage transitively through layout-scroll / inline-content).
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

import {
  getTextAnchorCardKind,
  setTextAnchorLink,
  addTextObjectLink,
  type CardWithLinks,
} from "@/links/links";
import type { CardKind } from "@/panels/_shared/types";

function modeBCard(id: string, kind: CardKind): CardWithLinks {
  return setTextAnchorLink({ id, links: [] }, kind, `${id}-anchor`, "the span");
}

describe("getTextAnchorCardKind", () => {
  it("returns the persisted CardKind for each Mode-B anchor kind", () => {
    expect(getTextAnchorCardKind(modeBCard("n", "note"))).toBe("note");
    expect(getTextAnchorCardKind(modeBCard("h", "highlight"))).toBe("highlight");
    expect(getTextAnchorCardKind(modeBCard("r", "revision-comment"))).toBe(
      "revision-comment",
    );
    expect(getTextAnchorCardKind(modeBCard("rp", "report"))).toBe("report");
    expect(getTextAnchorCardKind(modeBCard("t", "todo"))).toBe("todo");
    expect(getTextAnchorCardKind(modeBCard("c", "cutter-comment"))).toBe(
      "cutter-comment",
    );
  });

  it("returns null for a Mode-A (paragraph-anchored) card with no text range", () => {
    const modeA = addTextObjectLink({ id: "a", links: [] }, "note", "para-1");
    expect(getTextAnchorCardKind(modeA)).toBeNull();
  });

  it("returns null for a card with no links at all", () => {
    expect(getTextAnchorCardKind({ id: "x", links: [] })).toBeNull();
    expect(getTextAnchorCardKind({ id: "y" })).toBeNull();
  });
});
