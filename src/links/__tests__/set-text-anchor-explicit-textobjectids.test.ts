// @vitest-environment jsdom
//
// Task 075 — `setTextAnchorLink`'s explicit-`textObjectIds` param is the SSOT
// chokepoint that lets the clone path thread the containing paragraph id into a
// Mode-B `linkedRange` link. Without it, a freshly-cloned card (whose `links`
// is `[]`, cleared by cloneNote/cloneHighlight/…) would get a Mode-B link with
// `textObjectIds: []`, so `getLinkedTextObjectIds` returns `[]` and the omni
// builder bins the card `free` ("no anchor in document") even though it has a
// live in-doc `linkedAnchor` mark. The five panel `bindAnchor`s pass the
// paragraph id the duplicate walker already hands them.
//
// Storage stub guards the extension-barrel/@/lib/storage gotcha (links.ts pulls
// @/lib/storage transitively).
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
  setTextAnchorLink,
  addTextObjectLink,
  getLinkedTextObjectIds,
  getTextAnchor,
  type CardWithLinks,
} from "@/links/links";
import type { CardKind } from "@/panels/_shared/types";

// The Mode-B card kinds whose panel `bindAnchor` re-attaches an anchor on a
// freshly-cloned card. All five hooks route through `setTextAnchorLink`.
const MODE_B_KINDS: CardKind[] = [
  "note",
  "highlight",
  "todo",
  "revision-comment",
  "revision-suggestion",
  "cutter-comment",
  "cutter-suggestion",
  "report",
];

describe("setTextAnchorLink explicit textObjectIds (task 075)", () => {
  it("threads the paragraph id into the Mode-B link for every clone-capable kind", () => {
    for (const kind of MODE_B_KINDS) {
      // Freshly-cloned card: links cleared, exactly what bindAnchor sees.
      const clone: CardWithLinks = { id: `c-${kind}`, links: [] };
      const bound = setTextAnchorLink(
        clone,
        kind,
        `${kind}-anchor`,
        "the span",
        ["para-1"],
      );
      // Not `free`: the omni builder branches on `getLinkedTextObjectIds`.
      expect(getLinkedTextObjectIds(bound)).toEqual(["para-1"]);
      // The text range still resolves — the card is genuinely Mode-B.
      expect(getTextAnchor(bound)?.anchorId).toBe(`${kind}-anchor`);
    }
  });

  it("regression: without the explicit id, a links:[] clone mis-bins as free", () => {
    const clone: CardWithLinks = { id: "n", links: [] };
    const bound = setTextAnchorLink(clone, "note", "n-anchor", "span");
    // This is the pre-075 behavior: the fallback reads the empty card links.
    expect(getLinkedTextObjectIds(bound)).toEqual([]);
    // getTextAnchor still returns non-null — the internal inconsistency the
    // fix removes (looks anchored to hasTextAnchor, free to the omni bin).
    expect(getTextAnchor(bound)?.anchorId).toBe("n-anchor");
  });

  it("create-path parity: with no explicit id, the card's own paragraph link is preserved", () => {
    // The create path calls addTextObjectLink BEFORE setTextAnchorLink, so the
    // paragraph id is already in `links`; the undefined-param fallback reads it.
    const withPara = addTextObjectLink({ id: "h", links: [] }, "highlight", "para-9");
    const bound = setTextAnchorLink(withPara, "highlight", "h-anchor", "span");
    expect(getLinkedTextObjectIds(bound)).toEqual(["para-9"]);
    expect(getTextAnchor(bound)?.anchorId).toBe("h-anchor");
  });

  it("explicit id overrides for a card that has no prior paragraph link", () => {
    const clone: CardWithLinks = { id: "t", links: [] };
    const bound = setTextAnchorLink(clone, "todo", "t-anchor", "span", ["para-42"]);
    expect(getLinkedTextObjectIds(bound)).toEqual(["para-42"]);
  });
});
