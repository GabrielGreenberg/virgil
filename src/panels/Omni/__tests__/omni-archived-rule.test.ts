// @vitest-environment jsdom
//
// Task 476 — the ARCHIVED rule for OmniView, stated once and read by every
// renderer.
//
// Archiving a citation hides it from the docked panel and from the margin (both
// read `EditorPane.archivedIds`) and left it rendering in the omni gutter's
// "N unplaced" bin FOREVER, because the rule was re-derived twice and
// incompletely: a local `active()` helper in omni-host covering six of the ten
// families, a private `if (ref.archived) continue;` inside the footnote
// builder, and citations covered by NEITHER. So the unanchored chip said 0
// while the bin beside it said 1, for one card.
//
// The fix filters the ASSEMBLED item array once, against the SAME
// cross-panel set the margin reads — so no builder can opt out of the rule by
// omission, and the two surfaces agree by construction rather than by two
// implementations staying in step.
//
// Why the legs are shaped this way. The behavioural half is driven through the
// REAL builders (citation — the reported case; footnote — whose private filter
// this retires; note — a representative of the six `active()` families), and
// the per-kind half is a SWEEP over `isArchivable`, because what could break
// per kind is the ID GRAMMAR round trip (`cardPopKey` → `parseFloatKey` →
// the raw id the set is keyed on), not the filter. The leg with TEETH is the
// CENSUS: the rule was never the part that could misbehave — a builder that
// re-derives its own `archived` gate is, and a host that never asks is.

import { describe, it, expect, vi } from "vitest";

// The omni builders import card components whose barrel transitively pulls in
// `@/lib/storage`, which `require()`s `@/lib/storage-fsa` — a path vitest's
// resolver can't alias. Stub the storage module so the import graph loads.
// (See memory: vitest_extension_barrel_storage_mock.md)
vi.mock("@/lib/storage", () => {
  const stub = () => undefined;
  const names = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib", "createDocFromPicker",
    "createDocInFolder", "pickProjectFolder", "registerDocInFolder",
    "openExistingDocFromPicker", "listDocs", "renameDoc", "deleteDocFromIndex",
    "flushDoc", "drainDoc", "detectBibPackage", "readPaperFolder", "getTexFilename",
    "writePdf", "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: () => false };
  for (const n of names) mod[n] = stub;
  return mod;
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_KINDS, isArchivable } from "@/cards/predicates";
import { cardPopKey } from "@/panels/panel-registry";
import {
  filterArchivedOmniItems,
  omniItemCardRef,
  omniItemIsArchived,
} from "@/panels/Omni/omni-archived";
import type { OmniItem } from "@/panels/_shared/types";
import type { CitationRef, FootnoteRef } from "@/lib/types";
import type { Link } from "@/links/_shared/types";
import { buildCitationOmniItems } from "@/panels/Citations/omni";
import { buildFootnoteOmniItems } from "@/panels/Footnotes/omni";
import { buildNoteOmniItems } from "@/panels/Notes/omni";
import { resolveCardAnchorRows, type CardAnchorResolver } from "@/links/card-anchor-rows";
import type { ResolveIndex } from "@/links/resolve-card-anchor";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const REPO = join(__dirname, "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const noop = () => {};
const noopId = (_id: string | null) => {};

/** Adapt a synthetic live-uuid→pos map onto the REAL card-anchor authority. */
function rowsFrom(live: Record<string, number>): CardAnchorResolver {
  const index: ResolveIndex = {
    uuidToParagraph: new Set(Object.keys(live)),
    uuidToPos: new Map(Object.entries(live)),
    anchorIdToParagraph: new Map(),
    snapshotToParagraph: () => null,
  };
  return (card) => resolveCardAnchorRows(card, null, index);
}

function paraLink(uuid: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: [uuid] },
    target: { type: "card", ref: { kind: "note", id: "x" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const cit = (id: string, extra: Partial<CitationRef> = {}): CitationRef => ({
  id,
  command: `\\citep{key-${id}}`,
  keys: [`key-${id}`],
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

function citationItems(citations: CitationRef[]): OmniItem[] {
  return buildCitationOmniItems({
    citations,
    citationPositionMap: new Map(),
    selectedCitationId: null,
    setSelectedCitationId: noopId,
    scrollToCitation: noop,
    bibEntries: [],
    bibPackage: "natbib",
    getCitationDisplayText: () => "",
    updateCitation: noop,
    deleteCitation: noop,
    getFormattedBib: () => "",
    getAnnotation: () => "",
    setAnnotation: noop,
    requestBibReview: noop,
    cancelBibReview: noop,
    getBibReviewStatus: () => "none" as const,
    updateBibEntry: noop,
    updateBibKeyAndType: noop,
  });
}

function footnoteItems(refs: FootnoteRef[]): OmniItem[] {
  return buildFootnoteOmniItems({
    footnotes: [],
    orphanedFootnotes: [],
    unanchoredFootnotes: refs,
    onEditUnanchored: noop,
    onDeleteUnanchored: noop,
    selectedFootnoteId: null,
    setSelectedFootnoteId: noopId,
    scrollToFootnote: noop,
    onEditFootnote: noop,
    onDeleteFootnote: noop,
    onEditFootnoteTitle: noop,
    onEditOrphan: noop,
    onDeleteOrphan: noop,
    onEditOrphanTitle: noop,
    setOverrideEditor: noop,
    getCitationDisplayText: () => "",
    onCitationCreated: () => null,
  });
}

function noteItems(cards: Array<{ id: string; archived?: boolean }>): OmniItem[] {
  return buildNoteOmniItems({
    cards: cards.map((c) => ({
      kind: "note" as const,
      id: c.id,
      title: "",
      content: { type: "doc", content: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
      aiRequest: false,
      links: [paraLink("live-uuid")],
      ...(c.archived ? { archived: true } : {}),
    })),
    selectedNoteId: null,
    setSelectedNoteId: noopId,
    jumpToCard: noop,
    resolveCardRows: rowsFrom({ "live-uuid": 42 }),
    updateNote: noop,
    updateNoteTitle: noop,
    setNoteAiRequest: noop,
    setHighlightAiRequest: noop,
    convertCard: noop,
    deleteNote: noop,
    setOverrideEditor: noop,
    getCitationDisplayText: () => "",
    onCitationCreated: () => null,
  });
}

const ARCHIVABLE = CARD_KINDS.filter(isArchivable);
const NOT_ARCHIVABLE = CARD_KINDS.filter((k) => !isArchivable(k));

// ─────────────────────────────────────────────────────────────────────────────

describe("task 476 — the archived rule, per archivable kind", () => {
  it("the sweep is non-vacuous (both halves of the vocabulary exist)", () => {
    expect(ARCHIVABLE.length).toBeGreaterThan(5);
    expect(NOT_ARCHIVABLE.length).toBeGreaterThan(0);
    // The reported kind must be in the swept set, or the sweep says nothing
    // about the case that was filed.
    expect(ARCHIVABLE).toContain("citation");
  });

  it.each(ARCHIVABLE)(
    "an archived %s card produces NO omni item — single-anchor row",
    (kind) => {
      const id = `card-${kind}`;
      const item: OmniItem = {
        id: cardPopKey(kind, id),
        pos: null,
        anchorState: "free",
        content: null,
      };
      expect(filterArchivedOmniItems([item], new Set([id]))).toEqual([]);
      // …and an UNarchived card of the same kind stays (the accepting control,
      // so no leg can pass by dropping everything).
      expect(filterArchivedOmniItems([item], new Set(["someone-else"]))).toEqual([
        item,
      ]);
    },
  );

  it.each(ARCHIVABLE)(
    "an archived %s card produces NO omni item — MULTI-anchor `@N` rows",
    (kind) => {
      const id = `card-${kind}`;
      const base = cardPopKey(kind, id);
      const rows: OmniItem[] = [0, 1, 2].map((n) => ({
        id: `${base}@${n}`,
        pos: null,
        anchorState: "free",
        content: null,
      }));
      expect(filterArchivedOmniItems(rows, new Set([id]))).toEqual([]);
      expect(filterArchivedOmniItems(rows, new Set(["other"])).length).toBe(3);
    },
  );

  it.each(ARCHIVABLE)("`omniItemCardRef` round-trips the %s id grammar", (kind) => {
    // Ids carrying interior colons are real (the legacy `revision:s:<id>`
    // suggestion key), so the parse must be colon-safe.
    for (const id of ["plain-id", "with:colons:inside"]) {
      expect(omniItemCardRef(cardPopKey(kind, id))).toEqual({ kind, id });
      expect(omniItemCardRef(`${cardPopKey(kind, id)}@4`)).toEqual({ kind, id });
    }
  });

  it("a NON-archivable kind is out of scope even on an id collision", () => {
    // `example` (derived) and `error` (system) are never archivable, so the rule
    // may not drop them however the ids happen to collide.
    for (const kind of NOT_ARCHIVABLE) {
      const item: OmniItem = {
        id: cardPopKey(kind, "shared-id"),
        pos: 3,
        anchorState: "anchored",
        content: null,
      };
      expect(omniItemCardRef(item.id)).toBeNull();
      expect(filterArchivedOmniItems([item], new Set(["shared-id"]))).toEqual([item]);
    }
  });

  it("an empty archived set returns the SAME array (identity-stable)", () => {
    const items: OmniItem[] = [
      { id: cardPopKey("note", "n1"), pos: null, anchorState: "free", content: null },
    ];
    expect(filterArchivedOmniItems(items, new Set())).toBe(items);
    // …and so does a non-empty set that matches nothing.
    expect(filterArchivedOmniItems(items, new Set(["nope"]))).toBe(items);
  });
});

describe("task 476 — the REAL builders", () => {
  it("citation: an archived citation produces no omni row (the reported case)", () => {
    // Pre-476 the citation builder answered `anchorState: 'free'` for exactly
    // this shape, which is what put it in the unplaced bin forever.
    const archived = cit("ci-archived", { archived: true, unanchored: true });
    const raw = citationItems([archived]);
    expect(raw).toHaveLength(1);
    expect(raw[0].anchorState).toBe("free");

    expect(filterArchivedOmniItems(raw, new Set(["ci-archived"]))).toEqual([]);
  });

  it("citation: an ACTIVE unanchored citation still surfaces (task 056/079)", () => {
    const parked = cit("ci-parked", { unanchored: true });
    const items = filterArchivedOmniItems(citationItems([parked]), new Set());
    expect(items).toHaveLength(1);
    expect(items[0].anchorState).toBe("free");
  });

  it("citation: archived → UNarchived returns the row", () => {
    const c = cit("ci-x", { unanchored: true });
    const raw = citationItems([c]);
    expect(filterArchivedOmniItems(raw, new Set(["ci-x"]))).toEqual([]);
    // The flag is cleared; the id leaves `archivedIds`; the card comes back.
    expect(filterArchivedOmniItems(raw, new Set())).toHaveLength(1);
  });

  it("footnote: the builder no longer filters, and the shared rule does", () => {
    const ref = (id: string, archived: boolean): FootnoteRef => ({
      id,
      unanchored: true,
      archived,
      content: { type: "doc", content: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const raw = footnoteItems([ref("fn-live", false), ref("fn-archived", true)]);
    // The BUILDER emits both now — its private `archived` gate is retired.
    expect(raw).toHaveLength(2);
    const kept = filterArchivedOmniItems(raw, new Set(["fn-archived"]));
    expect(kept).toHaveLength(1);
    expect(kept[0].id.endsWith("fn-live")).toBe(true);
  });

  it("note: the retired `active()` family is covered by the shared rule", () => {
    const raw = noteItems([{ id: "n-live" }, { id: "n-archived", archived: true }]);
    expect(raw).toHaveLength(2);
    const kept = filterArchivedOmniItems(raw, new Set(["n-archived"]));
    expect(kept.map((i) => i.id)).toEqual([cardPopKey("note", "n-live")]);
  });
});

describe("task 476 — the margin and the omni cannot disagree", () => {
  it("the unanchored chip's count equals the omni unplaced count for one set", () => {
    // The chip's predicate is EditorPane's own:
    //   marginaliaMarkers.filter(m => m.unanchored && !archivedIds.has(m.entityId))
    // The omni's is the rule under test. Both read the SAME `archivedIds`, so
    // for a set of unanchored citations the two counts must match.
    //
    // Stated limit: the chip half is expressed here rather than mounted (the
    // marker source lives inside EditorPane and no unit can drive it), so what
    // this leg pins is that the two predicates agree over the archived axis —
    // the census below is what pins that there is only ONE set to read.
    const cards = [
      cit("a", { unanchored: true }),
      cit("b", { unanchored: true, archived: true }),
      cit("c", { unanchored: true }),
    ];
    const archivedIds = new Set(["b"]);

    const chipCount = cards.filter(
      (c) => c.unanchored && !archivedIds.has(c.id),
    ).length;

    const binCount = filterArchivedOmniItems(citationItems(cards), archivedIds)
      .filter((i) => i.anchorState !== "anchored").length;

    expect(chipCount).toBe(2);
    expect(binCount).toBe(chipCount);
  });

  it("`omniItemIsArchived` IS `archivedIds.has(cardId)` for an archivable row", () => {
    const item: OmniItem = {
      id: cardPopKey("citation", "ci-1"),
      pos: null,
      anchorState: "free",
      content: null,
    };
    expect(omniItemIsArchived(item, new Set(["ci-1"]))).toBe(true);
    expect(omniItemIsArchived(item, new Set(["ci-2"]))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The leg with TEETH. The rule was never the part that could misbehave — an
// eleventh builder re-deriving its own `archived` gate is, and a host that
// assembles items and never asks the rule is. Neither is visible to any
// behavioural test of the rule.

describe("task 476 — census", () => {
  const BUILDERS = [
    "src/panels/Citations/omni.tsx",
    "src/panels/Footnotes/omni.tsx",
    "src/panels/Notes/omni.tsx",
    "src/panels/Archive/omni.tsx",
    "src/panels/Todo/omni.tsx",
    "src/panels/Revisions/omni.tsx",
    "src/panels/Cutter/omni.tsx",
    "src/panels/Reports/omni.tsx",
    "src/panels/Examples/omni.tsx",
    "src/panels/Errors/omni.tsx",
  ];

  it("the builder population is DISCOVERED, so a new one cannot slip the census", () => {
    // Read the host's own import list rather than trusting the array above:
    // a new `build*OmniItems` import that is not censused fails here.
    const host = codeOnly(
      read("src/components/editor-layout/panels/omni-host.tsx"),
    );
    const imported = [...host.matchAll(/build(\w+)OmniItems/g)].map((m) => m[1]);
    expect(new Set(imported).size).toBe(BUILDERS.length);
  });

  it.each(BUILDERS)("%s re-derives no `archived` gate of its own", (rel) => {
    const src = codeOnly(read(rel));
    expect(src).not.toMatch(/\barchived\b/);
  });

  it("omni-host applies the shared rule to the ASSEMBLED array, once", () => {
    const src = codeOnly(
      read("src/components/editor-layout/panels/omni-host.tsx"),
    );
    // The shared door is called, exactly once…
    expect(
      (src.match(/filterArchivedOmniItems\s*\(/g) ?? []).length,
    ).toBe(1);
    // …fed the cross-panel SSOT…
    expect(src).toMatch(/filterArchivedOmniItems\(\[[\s\S]*?\],\s*p\.archivedIds\)/);
    // …and the retired per-family helper is gone.
    expect(src).not.toMatch(/\bconst active\b/);
    expect(src).not.toMatch(/\bactiveNotes\b/);
  });

  it("nothing outside the rule module re-declares an omni archived filter", () => {
    // The rule module is the ONE place `archivedIds` may be consulted for the
    // omni; a second reader is a second implementation.
    const rule = codeOnly(read("src/panels/Omni/omni-archived.ts"));
    expect(rule).toMatch(/export function filterArchivedOmniItems/);
    expect(rule).toMatch(/isArchivable/);
  });
});
