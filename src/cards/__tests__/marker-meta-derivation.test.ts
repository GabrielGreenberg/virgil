// @vitest-environment jsdom
/**
 * A6/R17 pin tests — registry-derived marker metadata.
 *
 * `MARKER_META`'s panel + accent now derive from `CARD_REGISTRY` via
 * `src/cards/marker-meta.ts`. These tables FREEZE the derived values so a
 * registry edit that silently re-routes or re-tints a gutter marker trips a
 * test instead of shipping. The unified themeKey keyspace (A10/B: registry
 * `ThemeKey` ≡ `PanelThemeKey`, the old comment→revision crosswalk deleted)
 * and the one intentional accent identity (error ≡ footnote rust) are pinned
 * explicitly.
 */
import { describe, it, expect, vi } from "vitest";

// `@/components/panel-primitives` transitively pulls `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest's resolver can't alias (the known
// barrel/storage gotcha). Stub every export as a no-op — we only read the
// CARD_THEMES table, never touch a sidecar.
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

import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_THEMES } from "@/components/panel-primitives";
import {
  ALL_MARKER_TYPES,
  cardKindsForMarkerType,
  panelForMarkerType,
  panelThemeKeyForMarkerType,
} from "@/cards/marker-meta";
import type { CardKind, MarkerType, ThemeKey } from "@/cards/types";
import type { MarginItemKind } from "@/cards/delete-margin-item";
import { MARKER_META } from "@/lib/marginalia";
import {
  DEFAULT_PANEL_COLORS,
  deriveMarkerPalette,
  type PanelThemeKey,
} from "@/lib/panel-theme";

/** Bidirectional type-equality assert (compile-time pin). */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("marker-meta derivation (A6/R17)", () => {
  it("registry distinct markerTypes ≡ MARKER_META keys ≡ ALL_MARKER_TYPES", () => {
    const declared = new Set<MarkerType>();
    for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
      const t = CARD_REGISTRY[kind].markerType;
      if (t != null) declared.add(t);
    }
    expect([...declared].sort()).toEqual([...ALL_MARKER_TYPES].sort());
    expect(Object.keys(MARKER_META).sort()).toEqual([...ALL_MARKER_TYPES].sort());
  });

  it("per-type card kinds match the frozen table", () => {
    const frozen: Record<MarkerType, CardKind[]> = {
      note: ["note"],
      archive: ["archive"],
      revision: ["revision-comment", "revision-suggestion"],
      cut: ["cutter-comment", "cutter-suggestion"],
      todo: ["todo"],
      report: ["report", "report-request"],
      error: ["error"],
    };
    for (const t of ALL_MARKER_TYPES) {
      expect(cardKindsForMarkerType(t).sort()).toEqual(frozen[t].sort());
    }
  });

  it("per-type panel matches the frozen table (and MARKER_META.panelId agrees)", () => {
    const frozen: Record<MarkerType, string> = {
      note: "notes",
      archive: "archive",
      revision: "revisions",
      cut: "cutter",
      todo: "todo",
      report: "reports",
      error: "errors",
    };
    for (const t of ALL_MARKER_TYPES) {
      expect(panelForMarkerType(t)).toBe(frozen[t]);
      expect(MARKER_META[t].panelId).toBe(frozen[t]);
    }
  });

  it("per-type theme key matches the frozen table (one keyspace, no crosswalk)", () => {
    const frozen: Record<MarkerType, PanelThemeKey> = {
      note: "note",
      archive: "archive",
      revision: "revision",
      cut: "cut",
      todo: "todo",
      report: "report",
      error: "error",
    };
    for (const t of ALL_MARKER_TYPES) {
      expect(panelThemeKeyForMarkerType(t)).toBe(frozen[t]);
    }
    // A10/B keyspace unification, pinned directly: the revision pair
    // declares the PanelThemeKey token verbatim (the legacy "comment"
    // alias + THEME_KEY_CROSSWALK are gone).
    expect(CARD_REGISTRY["revision-comment"].themeKey).toBe("revision");
    expect(CARD_REGISTRY["revision-suggestion"].themeKey).toBe("revision");
  });

  it("ThemeKey keyspace ≡ PanelThemeKey keyspace (A10/B unification)", () => {
    // Compile-time pin: the registry ThemeKey IS PanelThemeKey.
    const pinned: AssertEqual<ThemeKey, PanelThemeKey> = true;
    expect(pinned).toBe(true);
    // Runtime pin: CARD_THEMES is a total fold over DEFAULT_PANEL_COLORS —
    // same key set, and the revision theme derives from the revision accent.
    expect(Object.keys(CARD_THEMES).sort()).toEqual(
      Object.keys(DEFAULT_PANEL_COLORS).sort(),
    );
    expect(CARD_THEMES.revision.accent).toBe(DEFAULT_PANEL_COLORS.revision);
  });

  it("derived error palette is byte-identical to the old footnote-accent literal", () => {
    // The old MARKER_META.error row hand-pointed at the footnote accent.
    // Deriving from the registry themeKey ("error") must not shift a single
    // byte: the two defaults are the same rust hex.
    expect(DEFAULT_PANEL_COLORS.error).toBe("#b45757");
    expect(DEFAULT_PANEL_COLORS.footnote).toBe("#b45757");
    const legacy = deriveMarkerPalette(DEFAULT_PANEL_COLORS.footnote);
    expect({
      color: MARKER_META.error.color,
      bg: MARKER_META.error.bg,
      border: MARKER_META.error.border,
    }).toEqual(legacy);
  });

  it("MarginItemKind ≡ Exclude<MarkerType, 'error'> (compile-time pin)", () => {
    const pinned: AssertEqual<MarginItemKind, Exclude<MarkerType, "error">> = true;
    expect(pinned).toBe(true);
  });
});
