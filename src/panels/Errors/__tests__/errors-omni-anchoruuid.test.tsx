// @vitest-environment jsdom
//
// Regression guard for task 068 — the OMNI-F1-02 "stale baked pos" class, with
// `error` the lone paragraph-anchored omni kind that never enrolled in the
// live-pos engine.
//
// Every paragraph-anchored omni kind (note/todo/report) stamps `anchorUuid` on
// its OmniItem so `buildParagraphAnchorMap` enrolls it and `useLivePosResolver`
// re-resolves a LIVE position from the DocStructureObserver snapshot each
// transaction. `buildErrorOmniItems` computed the error's paragraph uuid but
// pushed the item WITHOUT `anchorUuid`, so `resolvePos` returned undefined and
// the fold/focus binning fell back to the stale baked `pos` — silently dropping
// an anchored error from a collapsed section (or mis-stamping it outside the
// focus band) after an edit in an earlier paragraph.
//
// Contract this pins:
//   1. An ANCHORED error (source line resolved to a paragraph) carries
//      `anchorUuid === <paragraph uuid>` and is enrolled by
//      `buildParagraphAnchorMap`.
//   2. A FREE error (`paraId == null`) carries no `anchorUuid`, keeps
//      `pos: null`, and is NOT enrolled — unchanged.

import { describe, it, expect, vi } from "vitest";

// ErrorCard → panel-primitives transitively pulls `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest's resolver can't alias (the barrel/
// storage gotcha). Stub it — nothing here touches a sidecar.
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

import { buildErrorOmniItems } from "@/panels/Errors/omni";
import { buildParagraphAnchorMap } from "@/hooks/useLivePosResolver";
import { cardPopKey } from "@/panels/panel-registry";
import type { LatexError } from "@/lib/latex-errors";

const ANCHORED_ERR: LatexError = {
  id: "lint:3:1:anchored",
  source: "lint",
  severity: "warning",
  line: 3,
  message: "Undefined reference fig:one",
  ruleId: "ref-undefined",
};
const FREE_ERR: LatexError = {
  id: "lint:0:0:free",
  source: "lint",
  severity: "error",
  line: 0,
  message: "Preamble parse error",
  ruleId: "parse",
};

const PARA_UUID = "para-uuid-abc";

function build() {
  return buildErrorOmniItems({
    errors: [ANCHORED_ERR, FREE_ERR],
    selectedId: null,
    setSelectedId: () => {},
    // Only the anchored error resolves to a paragraph.
    paragraphByErrorId: new Map([[ANCHORED_ERR.id, PARA_UUID]]),
    snippets: new Map(),
    anchoredIds: new Set([ANCHORED_ERR.id]),
    dismissedIds: new Set(),
    onDismiss: () => {},
    jump: { mode: "anchor" as const, jump: () => {} },
    // Resolve the paragraph uuid to a live pos; the free error has none.
    findParagraphPos: (uuid) => (uuid === PARA_UUID ? 739 : null),
    expandedIds: new Set(),
    onExpand: () => {},
    onToggleExpanded: () => {},
  });
}

describe("buildErrorOmniItems — anchorUuid enrollment (task 068)", () => {
  it("stamps anchorUuid on an anchored error so it enrolls in the live-pos map", () => {
    const items = build();
    const anchoredId = cardPopKey("error", ANCHORED_ERR.id);
    const item = items.find((it) => it.id === anchoredId);
    expect(item).toBeTruthy();
    expect(item!.anchorState).toBe("anchored");
    expect(item!.pos).toBe(739);
    expect(item!.anchorUuid).toBe(PARA_UUID);

    // The whole point: enrollment. `buildParagraphAnchorMap` only maps items
    // carrying an `anchorUuid`, so an unstamped error would be absent here and
    // `useLivePosResolver` could never re-resolve its live pos.
    const map = buildParagraphAnchorMap(items);
    expect(map.get(anchoredId)).toBe(PARA_UUID);
  });

  it("leaves a free error (no resolved paragraph) unenrolled and pos:null", () => {
    const items = build();
    const freeId = cardPopKey("error", FREE_ERR.id);
    const item = items.find((it) => it.id === freeId);
    expect(item).toBeTruthy();
    expect(item!.anchorState).toBe("free");
    expect(item!.pos).toBeNull();
    expect(item!.anchorUuid).toBeUndefined();

    const map = buildParagraphAnchorMap(items);
    expect(map.has(freeId)).toBe(false);
  });
});
