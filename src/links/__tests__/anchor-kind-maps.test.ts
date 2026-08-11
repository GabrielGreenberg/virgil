// @vitest-environment jsdom
//
// CHIP 1 foundation — the CardKind↔LinkedAnchorKind crosswalk + the tint SSOT.
//
// These pin the two map-completeness fixes the unified anchor fix depends on:
//   1. `legacyMarkKindForCardKind` is EXHAUSTIVE — `revision-suggestion`,
//      `report`, and `report-request` stamp their CORRECT mark kind instead
//      of the old silent `"note"` default (the BUG1 kind-corruption class at
//      create time); non-anchor kinds return `null`. (Task 202 deleted the
//      `cardKindToLegacyAnchorKind` pass-through these legs used to call — its
//      only reachable caller was the dead `createAnchorLink` — so they now
//      assert on the crosswalk SSOT itself, which is what they were always
//      really pinning.)
//   2. `defaultTintForLinkedAnchorKind` is the single source for the highlight
//      tint (the theme-accent sentinel for highlight, `null` otherwise) — so create and reload
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

import {
  legacyAnchorKindToCardKind,
  legacyKindToCardKindString,
} from "@/links/links";
import type { CardKind } from "@/panels/_shared/types";
import {
  defaultTintForLinkedAnchorKind,
  legacyMarkKindForCardKind,
  legacyMarkKindToCardKind,
} from "@/cards/legacy-token-crosswalk";

describe("legacyMarkKindForCardKind — exhaustive, no silent note default", () => {
  it("folds both revision kinds to the shared `revision` marker", () => {
    expect(legacyMarkKindForCardKind("revision-comment")).toBe("revision");
    expect(legacyMarkKindForCardKind("revision-suggestion")).toBe("revision");
  });

  it("maps report / report-request to their own kinds (was mislabeled `note`)", () => {
    expect(legacyMarkKindForCardKind("report")).toBe("report");
    expect(legacyMarkKindForCardKind("report-request")).toBe("report-request");
  });

  it("passes the simple anchor kinds through", () => {
    expect(legacyMarkKindForCardKind("note")).toBe("note");
    expect(legacyMarkKindForCardKind("highlight")).toBe("highlight");
    expect(legacyMarkKindForCardKind("todo")).toBe("todo");
    expect(legacyMarkKindForCardKind("cutter-comment")).toBe("cutter-comment");
    expect(legacyMarkKindForCardKind("cutter-suggestion")).toBe("cutter-suggestion");
  });

  it("returns null for non-anchor kinds (no silent note fallback)", () => {
    expect(legacyMarkKindForCardKind("footnote")).toBeNull();
    expect(legacyMarkKindForCardKind("citation")).toBeNull();
    expect(legacyMarkKindForCardKind("archive")).toBeNull();
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

describe("legacyAnchorKindToCardKind — complete, routes through the crosswalk SSOT", () => {
  // Regression pin for task 203: the hand-rolled copy silently omitted these
  // three anchor-bearing kinds, so a `linkedAnchor` mark of one of them with no
  // explicit `linkCard` token dropped out of `collectLinksFromEditor`'s result.
  it("resolves the previously-dropped todo / report / report-request kinds", () => {
    expect(legacyAnchorKindToCardKind("todo")).toBe("todo");
    expect(legacyAnchorKindToCardKind("report")).toBe("report");
    expect(legacyAnchorKindToCardKind("report-request")).toBe("report-request");
  });

  it("still folds the dead `cut` alias to cutter-comment", () => {
    expect(legacyAnchorKindToCardKind("cut")).toBe("cutter-comment");
  });

  it("passes the other live mark kinds through", () => {
    expect(legacyAnchorKindToCardKind("note")).toBe("note");
    expect(legacyAnchorKindToCardKind("highlight")).toBe("highlight");
    expect(legacyAnchorKindToCardKind("revision")).toBe("revision-comment");
    expect(legacyAnchorKindToCardKind("cutter-comment")).toBe("cutter-comment");
    expect(legacyAnchorKindToCardKind("cutter-suggestion")).toBe("cutter-suggestion");
  });

  it("returns null for undefined and unknown tokens", () => {
    expect(legacyAnchorKindToCardKind(undefined)).toBeNull();
    expect(legacyAnchorKindToCardKind("bogus")).toBeNull();
    expect(legacyAnchorKindToCardKind("footnote")).toBeNull();
  });
});

describe("links.ts CardKind↔legacy-kind projections agree with the crosswalk SSOT", () => {
  // Guard against the twins drifting back apart: both `links.ts` accessors now
  // route through the crosswalk, so they must equal it for every kind. Mirrors
  // the crosswalk's own round-trip dev pin.
  const ANCHOR_CARD_KINDS: CardKind[] = [
    "note", "highlight", "todo",
    "revision-comment", "revision-suggestion",
    "cutter-comment", "cutter-suggestion",
    "report", "report-request",
  ];
  const NON_ANCHOR_CARD_KINDS: CardKind[] = [
    "footnote", "citation", "example", "archive", "bib", "error",
  ];

  it("legacyMarkKindForCardKind answers every CardKind — mark kind or null", () => {
    // The old leg here asserted the deleted `cardKindToLegacyAnchorKind`
    // pass-through equalled its SSOT; with the alias gone that reads as
    // `x === x`. What it was standing in for is TOTALITY: no CardKind falls
    // through to `undefined`, which is how the pre-203 hand-rolled copy
    // silently dropped todo / report / report-request.
    for (const kind of ANCHOR_CARD_KINDS) {
      expect(legacyMarkKindForCardKind(kind), kind).toBeTruthy();
    }
    for (const kind of NON_ANCHOR_CARD_KINDS) {
      expect(legacyMarkKindForCardKind(kind), kind).toBeNull();
    }
  });

  it("legacyAnchorKindToCardKind inverts legacyMarkKindForCardKind for every anchor kind", () => {
    for (const kind of ANCHOR_CARD_KINDS) {
      const markKind = legacyMarkKindForCardKind(kind)!;
      // Round-trips back through the SSOT forward map. Both revision kinds share
      // the `"revision"` marker, which folds to the comment spine kind — so the
      // round-trip lands on `revision-comment`, not necessarily the start kind.
      expect(legacyAnchorKindToCardKind(markKind)).toBe(legacyMarkKindToCardKind(markKind));
    }
  });
});

describe("defaultTintForLinkedAnchorKind — single tint source", () => {
  it("paints the theme-derived accent band only for highlight", () => {
    // Task 174: the band is an ACCENT SENTINEL, never a resolved hex — a hex
    // here would freeze the panel theme into the document (the `#fbbf24`
    // literal this replaced was byte-identical to DEFAULT_PANEL_COLORS
    // .highlight, i.e. copied out of the theme and then frozen).
    expect(defaultTintForLinkedAnchorKind("highlight")).toBe("accent:highlight");
    expect(defaultTintForLinkedAnchorKind("highlight")).not.toMatch(/^#/);
  });

  it("paints no tint for every non-highlight kind", () => {
    expect(defaultTintForLinkedAnchorKind("note")).toBeNull();
    expect(defaultTintForLinkedAnchorKind("revision")).toBeNull();
    expect(defaultTintForLinkedAnchorKind("todo")).toBeNull();
  });
});
