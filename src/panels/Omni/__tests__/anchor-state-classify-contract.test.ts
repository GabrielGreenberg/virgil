// @vitest-environment jsdom
//
// A5 Commit B contract: the 10 omni builders populate `OmniItem.anchorState`
// correctly, and the OmniViewPanel mount-race guard (drop `pos == null` while
// `editor` is null) is preserved. This pins the free / orphaned / anchored
// derivation so a future builder edit can't silently mis-bucket a card into
// (or out of) the unanchored bin.

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

import type { Link } from "@/links/_shared/types";
import type { OmniItem } from "@/panels/_shared/types";
import type {
  ArchivedSnippet,
  TodoItem,
  CutterCard,
  RevisionCard,
  ReportItem,
  CitationRef,
} from "@/lib/types";
import type { ExampleInfo } from "@/components/Editor";
import { buildNoteOmniItems } from "@/panels/Notes/omni";
import { buildFootnoteOmniItems } from "@/panels/Footnotes/omni";
import { buildErrorOmniItems } from "@/panels/Errors/omni";
import { buildArchiveOmniItems } from "@/panels/Archive/omni";
import { buildTodoOmniItems } from "@/panels/Todo/omni";
import { buildCutterOmniItems } from "@/panels/Cutter/omni";
import { buildRevisionOmniItems } from "@/panels/Revisions/omni";
import { buildReportsOmniItems } from "@/panels/Reports/omni";
import { buildCitationOmniItems } from "@/panels/Citations/omni";
import { buildExampleOmniItems } from "@/panels/Examples/omni";

/** A Mode-A paragraph anchor link to one uuid. */
function paraLink(uuid: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
      margin: { side: "right" },
    },
    target: { type: "card", ref: { kind: "note", id: "x" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const noop = () => {};
const noopId = (_id: string | null) => {};

function noteArgs(
  cards: Array<{ id: string; links: Link[] }>,
  resolve: (uuid: string | null) => number | null,
) {
  return {
    cards: cards.map((c) => ({
      kind: "note" as const,
      id: c.id,
      title: "",
      content: { type: "doc", content: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
      aiRequest: false,
      links: c.links,
    })),
    selectedNoteId: null,
    setSelectedNoteId: noopId,
    jumpToCard: noop,
    findParagraphPos: resolve,
    updateNote: noop,
    updateNoteTitle: noop,
    setNoteAiRequest: noop,
    setHighlightAiRequest: noop,
    convertCard: noop,
    deleteNote: noop,
    setOverrideEditor: noop,
    getCitationDisplayText: () => "",
    onCitationCreated: () => null,
  };
}

const byId = (items: OmniItem[]) => new Map(items.map((i) => [i.id, i]));

describe("omni builder anchorState classification", () => {
  it("Notes: no links → free; linked+resolved → anchored; linked+unresolved → orphaned", () => {
    // "free-note" has no links; "anchored-note" links a live uuid;
    // "orphaned-note" links a uuid that no longer resolves.
    const resolve = (uuid: string | null) => (uuid === "live-uuid" ? 42 : null);
    const items = buildNoteOmniItems(
      noteArgs(
        [
          { id: "free-note", links: [] },
          { id: "anchored-note", links: [paraLink("live-uuid")] },
          { id: "orphaned-note", links: [paraLink("dead-uuid")] },
        ],
        resolve,
      ),
    );
    const m = byId(items);
    const free = [...m.values()].find((i) => i.id.endsWith("free-note"))!;
    const anchored = [...m.values()].find((i) => i.id.endsWith("anchored-note"))!;
    const orphaned = [...m.values()].find((i) => i.id.endsWith("orphaned-note"))!;

    expect(free.anchorState).toBe("free");
    expect(free.pos).toBeNull();

    expect(anchored.anchorState).toBe("anchored");
    expect(anchored.pos).toBe(42);

    expect(orphaned.anchorState).toBe("orphaned");
    expect(orphaned.pos).toBeNull();
  });

  it("Footnotes: live footnote → anchored; orphaned footnote → orphaned", () => {
    const items = buildFootnoteOmniItems({
      footnotes: [
        {
          footnoteId: "fn-live",
          content: { type: "doc", content: [] },
          number: 1,
          pos: 17,
        },
      ],
      orphanedFootnotes: [
        {
          footnoteId: "fn-orphan",
          content: { type: "doc", content: [] },
          orphanedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
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
    const live = items.find((i) => i.id.endsWith("fn-live"))!;
    const orphan = items.find((i) => i.id.endsWith("fn-orphan"))!;
    expect(live.anchorState).toBe("anchored");
    expect(live.pos).toBe(17);
    expect(orphan.anchorState).toBe("orphaned");
    expect(orphan.pos).toBeNull();
  });

  it("Errors: no source paragraph → free; resolved → anchored; unresolved paragraph → orphaned", () => {
    const items = buildErrorOmniItems({
      errors: [
        { id: "e-free", source: "lint", severity: "error", line: 1, message: "no para" },
        { id: "e-anchored", source: "lint", severity: "error", line: 2, message: "live" },
        { id: "e-orphan", source: "lint", severity: "error", line: 3, message: "dead" },
      ],
      selectedId: null,
      setSelectedId: noopId,
      paragraphByErrorId: new Map([
        ["e-anchored", "live-uuid"],
        ["e-orphan", "dead-uuid"],
      ]),
      snippets: new Map(),
      anchoredIds: new Set(["e-anchored"]),
      dismissedIds: new Set(),
      onDismiss: noop,
      onJump: noop,
      findParagraphPos: (uuid) => (uuid === "live-uuid" ? 99 : null),
      expandedIds: new Set(),
      onExpand: noop,
      onToggleExpanded: noop,
    });
    const m = byId(items);
    const free = [...m.values()].find((i) => i.id.endsWith("e-free"))!;
    const anchored = [...m.values()].find((i) => i.id.endsWith("e-anchored"))!;
    const orphan = [...m.values()].find((i) => i.id.endsWith("e-orphan"))!;
    expect(free.anchorState).toBe("free");
    expect(free.pos).toBeNull();
    expect(anchored.anchorState).toBe("anchored");
    expect(anchored.pos).toBe(99);
    expect(orphan.anchorState).toBe("orphaned");
    expect(orphan.pos).toBeNull();
  });

  // ── The remaining 7 builders (test-hardening: full 10-builder coverage) ──

  // Shared resolver: only "live-uuid" resolves.
  const resolve = (uuid: string | null) => (uuid === "live-uuid" ? 42 : null);

  it("Archive: anchoredIds-orphan → orphaned; no links → free; live link → anchored; dead link → orphaned", () => {
    const snippet = (id: string, links: Link[]): ArchivedSnippet => ({
      id,
      title: "",
      content: { type: "doc", content: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
      links,
    });
    const items = buildArchiveOmniItems({
      archiveSnippets: [
        // anchoredIds says this one's anchor vanished — orphaned EVEN with a
        // live-looking link (the anchoredIds check wins).
        snippet("s-anchorless", [paraLink("live-uuid")]),
        snippet("s-free", []),
        snippet("s-anchored", [paraLink("live-uuid")]),
        snippet("s-orphan", [paraLink("dead-uuid")]),
      ],
      anchoredIds: new Set(["s-free", "s-anchored", "s-orphan"]),
      selectedArchiveId: null,
      setSelectedArchiveId: noopId,
      jumpToCard: noop,
      findParagraphPos: resolve,
      updateArchiveSnippet: noop,
      updateArchiveSnippetTitle: noop,
      handleDeleteArchive: noop,
      setOverrideEditor: noop,
      getCitationDisplayText: () => "",
      onCitationCreated: () => null,
    });
    const states = new Map(items.map((i) => [i.id, [i.anchorState, i.pos]]));
    expect(states.get("float:card:archive:s-anchorless")).toEqual(["orphaned", null]);
    expect(states.get("float:card:archive:s-free")).toEqual(["free", null]);
    expect(states.get("float:card:archive:s-anchored")).toEqual(["anchored", 42]);
    expect(states.get("float:card:archive:s-orphan")).toEqual(["orphaned", null]);
  });

  it("Todo: no links → free; live link → anchored; dead link → orphaned", () => {
    const todo = (id: string, links: Link[]): TodoItem => ({
      id,
      text: "t",
      notes: "",
      done: false,
      aiRequest: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      links,
    });
    const items = buildTodoOmniItems({
      todoItems: [
        todo("t-free", []),
        todo("t-anchored", [paraLink("live-uuid")]),
        todo("t-orphan", [paraLink("dead-uuid")]),
      ],
      selectedTodoId: null,
      setSelectedTodoId: noopId,
      jumpToCard: noop,
      findParagraphPos: resolve,
      toggleTodo: noop,
      updateTodo: noop,
      updateTodoNotes: noop,
      setTodoAiRequest: noop,
      deleteTodo: noop,
    });
    const byState = items.map((i) => [i.id.split(":").pop(), i.anchorState, i.pos]);
    expect(byState).toEqual([
      ["t-free", "free", null],
      ["t-anchored", "anchored", 42],
      ["t-orphan", "orphaned", null],
    ]);
  });

  it("Cutter: both kinds classify free / anchored / orphaned", () => {
    const comment = (id: string, links: Link[]): CutterCard => ({
      kind: "comment",
      id,
      createdAt: "2026-01-01T00:00:00.000Z",
      text: "c",
      content: { type: "doc", content: [] },
      aiRequest: false,
      links,
    });
    const suggestion = (id: string, links: Link[]): CutterCard => ({
      kind: "suggestion",
      id,
      createdAt: "2026-01-01T00:00:00.000Z",
      author: "human",
      original_text: "",
      suggested_text: "",
      explanation: "",
      user_text: "",
      instructions: "",
      status: "pending",
      links,
    });
    const items = buildCutterOmniItems({
      cards: [
        comment("c-free", []),
        comment("c-anchored", [paraLink("live-uuid")]),
        suggestion("s-orphan", [paraLink("dead-uuid")]),
      ],
      selectedId: null,
      setSelectedId: noopId,
      jumpToCard: noop,
      findParagraphPos: resolve,
      editor: null,
      updateCommentContent: noop,
      setCommentAiRequest: noop,
      updateSuggestionField: noop,
      acceptSuggestion: noop,
      rejectSuggestion: noop,
      convertCard: noop,
      deleteCard: noop,
    });
    const states = new Map(items.map((i) => [i.id, [i.anchorState, i.pos]]));
    // Canonical AF float-key grammar: kind-in-key, suggestions key separately.
    expect(states.get("float:card:cutter-comment:c-free")).toEqual(["free", null]);
    expect(states.get("float:card:cutter-comment:c-anchored")).toEqual(["anchored", 42]);
    expect(states.get("float:card:cutter-suggestion:s-orphan")).toEqual(["orphaned", null]);
  });

  it("Revisions: both kinds classify free / anchored / orphaned", () => {
    const comment = (id: string, links: Link[]): RevisionCard => ({
      kind: "comment",
      id,
      createdAt: "2026-01-01T00:00:00.000Z",
      text: "c",
      content: { type: "doc", content: [] },
      aiRequest: false,
      links,
    });
    const suggestion = (id: string, links: Link[]): RevisionCard => ({
      kind: "suggestion",
      id,
      createdAt: "2026-01-01T00:00:00.000Z",
      author: "ai",
      original_text: "",
      suggested_text: "",
      explanation: "",
      user_text: "",
      instructions: "",
      status: "pending",
      links,
    });
    const items = buildRevisionOmniItems({
      cards: [
        comment("r-free", []),
        suggestion("r-anchored", [paraLink("live-uuid")]),
        comment("r-orphan", [paraLink("dead-uuid")]),
      ],
      selectedId: null,
      setSelectedId: noopId,
      jumpToCard: noop,
      findParagraphPos: resolve,
      editor: null,
      updateCommentContent: noop,
      setCommentAiRequest: noop,
      updateSuggestionField: noop,
      acceptSuggestion: noop,
      rejectSuggestion: noop,
      convertCard: noop,
      deleteCard: noop,
    });
    const states = new Map(items.map((i) => [i.id, [i.anchorState, i.pos]]));
    expect(states.get("float:card:revision-comment:r-free")).toEqual(["free", null]);
    expect(states.get("float:card:revision-suggestion:r-anchored")).toEqual(["anchored", 42]);
    expect(states.get("float:card:revision-comment:r-orphan")).toEqual(["orphaned", null]);
  });

  it("Reports: both kinds classify free / anchored / orphaned", () => {
    const report = (id: string, links: Link[]): ReportItem => ({
      kind: "report",
      id,
      createdAt: "2026-01-01T00:00:00.000Z",
      author: "ai",
      title: "",
      text: "r",
      content: { type: "doc", content: [] },
      links,
    });
    const request = (id: string, links: Link[]): ReportItem => ({
      kind: "report-request",
      id,
      createdAt: "2026-01-01T00:00:00.000Z",
      text: "q",
      content: { type: "doc", content: [] },
      aiRequest: false,
      links,
    });
    const items = buildReportsOmniItems({
      cards: [
        report("rp-free", []),
        report("rp-anchored", [paraLink("live-uuid")]),
        request("rq-orphan", [paraLink("dead-uuid")]),
      ],
      selectedId: null,
      setSelectedId: noopId,
      jumpToCard: noop,
      findParagraphPos: resolve,
      updateReportContent: noop,
      updateReportTitle: noop,
      updateRequestContent: noop,
      setRequestAiRequest: noop,
      convertCard: noop,
      deleteCard: noop,
      setOverrideEditor: noop,
      getCitationDisplayText: () => "",
      onCitationCreated: () => null,
    });
    const states = new Map(items.map((i) => [i.id, [i.anchorState, i.pos]]));
    expect(states.get("float:card:report:rp-free")).toEqual(["free", null]);
    expect(states.get("float:card:report:rp-anchored")).toEqual(["anchored", 42]);
    expect(states.get("float:card:report-request:rq-orphan")).toEqual(["orphaned", null]);
  });

  it("Citations: never free — in the position map → anchored; missing marker → orphaned", () => {
    const cit = (id: string): CitationRef => ({
      id,
      command: `\\citep{key-${id}}`,
      keys: [`key-${id}`],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const items = buildCitationOmniItems({
      citations: [cit("ci-anchored"), cit("ci-orphan")],
      citationPositionMap: new Map([["ci-anchored", 7]]),
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
      getBibReviewStatus: () => "none",
      updateBibEntry: noop,
      updateBibKeyAndType: noop,
    });
    const states = new Map(items.map((i) => [i.id, [i.anchorState, i.pos]]));
    expect(states.get("float:card:citation:ci-anchored")).toEqual(["anchored", 7]);
    // A citation with no in-text marker is ORPHANED, never "free" — an
    // intrinsically in-text kind (this includes panel-created unanchored
    // citations: current behavior classifies them orphaned too).
    expect(states.get("float:card:citation:ci-orphan")).toEqual(["orphaned", null]);
  });

  it("Examples: never free — block pos → anchored; gone block (null pos) → orphaned", () => {
    const ex = (exampleId: string, pos: number | null): ExampleInfo =>
      ({
        exampleId,
        // The builder's defensive `pos == null` branch — ExampleInfo types pos
        // as number, so cast to exercise the gone-block path.
        pos: pos as unknown as number,
        number: 1,
        kind: "single",
        tag: "",
        label: "",
        preview: "",
        subRange: "",
      }) as unknown as ExampleInfo;
    const items = buildExampleOmniItems({
      examples: [ex("ex-anchored", 31), ex("ex-orphan", null)],
      selectedExampleId: null,
      setSelectedExampleId: noopId,
      onJump: noop,
    });
    const states = new Map(items.map((i) => [i.id, [i.anchorState, i.pos]]));
    expect(states.get("float:card:example:ex-anchored")).toEqual(["anchored", 31]);
    expect(states.get("float:card:example:ex-orphan")).toEqual(["orphaned", null]);
  });
});

// The OmniViewPanel mount-race guard (pos == null dropped while `editor` is
// null) used to be pinned here via a hand-copied mirror of the component's
// split useMemo — a mirror can't fail when the component drifts. It is now
// pinned against the REAL default-exported component in
// `omni-view-panel-split-contract.test.tsx` (test-hardening rewire).
