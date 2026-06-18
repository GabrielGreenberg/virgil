// @vitest-environment jsdom
//
// T5 Pillar D — SCOPE_DISPATCH scope-completeness guard.
//
// The bug class (SR-F3-02 / SR-A1-01 / SR-F7-01): `reports` was a full scope
// (chip + label + color + a `searchReports` helper) but the panel's hand-written
// if-ladder had no branch for it, so it never searched. SCOPE_DISPATCH replaces
// the ladder with a TOTAL `Record<SearchScope, ScopeSearchFn>` — TypeScript
// fails the build if a SearchScope member has no dispatch entry, so a scope can
// never again be enumerated-but-unsearched.
//
// This file pins:
//   (1) the COMPILE-TIME exhaustiveness (a type-level proof that the map is
//       total over SearchScope, and a guard test that fails if a SCOPE_ORDER
//       member loses its dispatch entry);
//   (2) the runtime: `reports` actually runs `searchReports` (regression for
//       the dropped scope), and the shared uuid-pos scope list is honest.

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

import { SCOPE_DISPATCH, UUID_POS_SCOPES, type ScopeSearchCtx } from "@/panels/Search/scope-dispatch";
import { SCOPE_ORDER, type SearchScope, type SearchHit } from "@/lib/search-sources";
import type { ReportItem } from "@/lib/types";

// ── Compile-time exhaustiveness proof ──────────────────────────────────────
// If `SearchScope` gained a member with no SCOPE_DISPATCH entry, the object
// literal in scope-dispatch.ts would not satisfy `Record<SearchScope, ...>`
// and the module would fail to type-check. This local assertion mirrors that:
// it only type-checks if SCOPE_DISPATCH's key set is EXACTLY SearchScope.
type DispatchKeys = keyof typeof SCOPE_DISPATCH;
// Bidirectional assignability == set equality. A missing key breaks one
// direction; an extra key breaks the other.
const _keysCoverScope: SearchScope = null as unknown as DispatchKeys;
const _scopeCoversKeys: DispatchKeys = null as unknown as SearchScope;
void _keysCoverScope;
void _scopeCoversKeys;

describe("SCOPE_DISPATCH — exhaustiveness over SearchScope", () => {
  it("has exactly one dispatch entry per SCOPE_ORDER member (no dropped scope)", () => {
    for (const scope of SCOPE_ORDER) {
      expect(typeof SCOPE_DISPATCH[scope]).toBe("function");
    }
    // And no stray entries beyond the enumerated scopes.
    expect(Object.keys(SCOPE_DISPATCH).sort()).toEqual([...SCOPE_ORDER].sort());
  });

  it("includes the `reports` scope that the old if-ladder silently dropped (SR-F3-02)", () => {
    expect(SCOPE_DISPATCH).toHaveProperty("reports");
    expect(typeof SCOPE_DISPATCH.reports).toBe("function");
  });
});

describe("SCOPE_DISPATCH.reports — runs searchReports against report cards", () => {
  it("returns a hit for a matching report title/body", () => {
    const reportCards: ReportItem[] = [
      {
        id: "rep-1",
        kind: "report",
        title: "Quarterly UNICORN findings",
        text: "The UNICORN metric rose.",
        status: "open",
        author: "user",
        createdAt: 0,
        links: [],
      } as unknown as ReportItem,
    ];

    // Minimal ctx — reports search uses cards + editor + uuidPos + re. The
    // editor anchor resolution falls back to lowestPos (empty map) → unanchored,
    // which is fine for asserting the MATCH fired.
    const fakeEditor = {} as ScopeSearchCtx["editor"];
    const ctx: ScopeSearchCtx = {
      editor: fakeEditor,
      re: /UNICORN/g,
      uuidPos: new Map(),
      footnotes: [],
      orphanedFootnotes: [],
      notes: [],
      citations: [],
      editorCitations: [],
      getCitationDisplayText: (s) => s,
      todos: [],
      archiveSnippets: [],
      cutterCards: [],
      reportCards,
      comments: [],
      bibEntries: [],
      searchMainText: () => [],
    };

    const hits: SearchHit[] = SCOPE_DISPATCH.reports(ctx);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.scope === "reports")).toBe(true);
    expect(hits.some((h) => h.itemId === "rep-1")).toBe(true);
  });
});

describe("UUID_POS_SCOPES — honest about which scopes need the uuid→pos map", () => {
  it("every listed scope is a real SearchScope", () => {
    for (const s of UUID_POS_SCOPES) {
      expect(SCOPE_ORDER).toContain(s);
    }
  });
});
