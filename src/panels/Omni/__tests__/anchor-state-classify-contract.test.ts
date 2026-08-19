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
import { resolveCardAnchorRows, type CardAnchorResolver } from "@/links/card-anchor-rows";
import type { ResolveIndex } from "@/links/resolve-card-anchor";
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
    },
    target: { type: "card", ref: { kind: "note", id: "x" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Adapt a synthetic live-uuid→pos map onto the REAL card-anchor authority
 *  (task 369). The RULE under test stays the shipped one — only the document
 *  is synthetic — so these legs keep pinning the production classification
 *  rather than a re-derived stub of it. */
function rowsFrom(live: Record<string, number>): CardAnchorResolver {
  const index: ResolveIndex = {
    uuidToParagraph: new Set(Object.keys(live)),
    uuidToPos: new Map(Object.entries(live)),
    anchorIdToParagraph: new Map(),
    snapshotToParagraph: () => null,
  };
  return (card) => resolveCardAnchorRows(card, null, index);
}

const noop = () => {};
const noopId = (_id: string | null) => {};

function noteArgs(
  cards: Array<{ id: string; links: Link[] }>,
  resolveCardRows: CardAnchorResolver,
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
    resolveCardRows,
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
    const items = buildNoteOmniItems(
      noteArgs(
        [
          { id: "free-note", links: [] },
          { id: "anchored-note", links: [paraLink("live-uuid")] },
          { id: "orphaned-note", links: [paraLink("dead-uuid")] },
        ],
        rowsFrom({ "live-uuid": 42 }),
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

  it("Footnotes: live → anchored; orphaned → orphaned; active unanchored ref → present FREE/null; archived ref → absent", () => {
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
      // Task 077: the third card kind — atomless archive-born `FootnoteRef`s.
      // An unarchive leaves an ACTIVE unanchored ref (`archived:false,
      // unanchored:true`); an archived ref stays out of Omni (docked
      // Archives-view only).
      unanchoredFootnotes: [
        {
          id: "fn-unanchored",
          unanchored: true,
          archived: false,
          content: { type: "doc", content: [] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "fn-archived",
          unanchored: true,
          archived: true,
          content: { type: "doc", content: [] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
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
    const live = items.find((i) => i.id.endsWith("fn-live"))!;
    const orphan = items.find((i) => i.id.endsWith("fn-orphan"))!;
    expect(live.anchorState).toBe("anchored");
    expect(live.pos).toBe(17);
    expect(orphan.anchorState).toBe("orphaned");
    expect(orphan.pos).toBeNull();
    // Active unanchored ref (task 056, adopted): present, pos null, FREE — an
    // archive-born `FootnoteRef` carries deliberate `unanchored` intent (the
    // `\footnote` atom was removed and not re-inserted, so it's a re-placeable
    // PARKED ref), not a lost marker. Matches the sibling Citations unanchored
    // ref → no red "orphaned" badge on a card the user parked deliberately.
    const unanchored = items.find((i) => i.id.endsWith("fn-unanchored"))!;
    expect(unanchored).toBeDefined();
    expect(unanchored.pos).toBeNull();
    expect(unanchored.anchorState).toBe("free");
    // Archived ref: dropped from Omni (parity with the docked Archives view).
    expect(items.find((i) => i.id.endsWith("fn-archived"))).toBeUndefined();
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
      jump: { mode: "anchor" as const, jump: noop },
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
  const resolveCardRows = rowsFrom({ "live-uuid": 42 });

  it("Archive: born-free (unanchored) → free; link-swept-to-empty → orphaned; live link → anchored; dead-but-present link → orphaned (docked/float agree)", () => {
    // Task 104: anchor-state derives from (live position, born-free intent),
    // NOT link presence. The fixture builds `anchoredIds` FAITHFULLY — a
    // snippet is in the set iff it has a link that resolves LIVE (via
    // `resolve`), exactly as `EditorPane.anchoredArchiveIds` now does — so the
    // previously-unproducible inputs (a live link excluded from the set, a
    // link-less id inside it) that masked Defect A are gone.
    const snippet = (
      id: string,
      links: Link[],
      unanchored?: boolean,
    ): ArchivedSnippet => ({
      id,
      title: "",
      content: { type: "doc", content: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
      ...(unanchored ? { unanchored: true } : {}),
      links,
    });
    const snippets = [
      // deliberately created with no anchor target → free (neutral)
      snippet("s-born-free", [], true),
      // had a link, the orphan sweep stripped it to [] (no intent) → orphaned
      snippet("s-swept", []),
      // live-resolving link → anchored
      snippet("s-anchored", [paraLink("live-uuid")]),
      // link present but its uuid no longer resolves → orphaned (Defect B)
      snippet("s-dead", [paraLink("dead-uuid")]),
    ];
    // The docked panel's anchored set is now DERIVED from the same authority
    // the omni builder reads (task 369) — `EditorPane.anchoredArchiveIds` is
    // exactly this fold — so presence-vs-position divergence is structural,
    // not a fixture the test has to keep faithful by hand.
    const anchoredIds = new Set(
      snippets.filter((s) => resolveCardRows(s).anchored).map((s) => s.id),
    );
    expect(anchoredIds).toEqual(new Set(["s-anchored"]));
    const items = buildArchiveOmniItems({
      archiveSnippets: snippets,
      selectedArchiveId: null,
      setSelectedArchiveId: noopId,
      jumpToCard: noop,
      resolveCardRows,
      updateArchiveSnippet: noop,
      updateArchiveSnippetTitle: noop,
      handleDeleteArchive: noop,
      setOverrideEditor: noop,
      getCitationDisplayText: () => "",
      onCitationCreated: () => null,
    });
    const states = new Map(items.map((i) => [i.id, [i.anchorState, i.pos]]));
    expect(states.get("float:card:archive:s-born-free")).toEqual(["free", null]);
    expect(states.get("float:card:archive:s-swept")).toEqual(["orphaned", null]);
    expect(states.get("float:card:archive:s-anchored")).toEqual(["anchored", 42]);
    expect(states.get("float:card:archive:s-dead")).toEqual(["orphaned", null]);
    // Docked/float parity (Defect B): both derive `orphaned` as
    // `!anchoredIds.has(id)` off the ONE authority, so they agree with the
    // omni classifier for the dead-but-present link by construction.
    expect(anchoredIds.has("s-dead")).toBe(false);
    expect(anchoredIds.has("s-anchored")).toBe(true);
    expect(anchoredIds.has("s-born-free")).toBe(false);
    expect(anchoredIds.has("s-swept")).toBe(false);
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
      resolveCardRows,
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
      resolveCardRows,
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
      resolveCardRows,
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
      resolveCardRows,
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

  it("Citations (task 056): in the position map → anchored; missing marker + no intent → orphaned; missing marker + unanchored intent → free", () => {
    const cit = (id: string, unanchored?: boolean): CitationRef => ({
      id,
      command: `\\citep{key-${id}}`,
      keys: [`key-${id}`],
      createdAt: "2026-01-01T00:00:00.000Z",
      ...(unanchored ? { unanchored: true } : {}),
    });
    const items = buildCitationOmniItems({
      // ci-parked: archived-then-unarchived — carries `unanchored: true`, no
      // live marker → deliberately FREE (not the red orphaned-error badge).
      citations: [cit("ci-anchored"), cit("ci-orphan"), cit("ci-parked", true)],
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
    // A citation with no in-text marker AND no free intent is ORPHANED (its
    // `\cite` marker was genuinely deleted in-text) — the recoverable-error
    // state (red badge).
    expect(states.get("float:card:citation:ci-orphan")).toEqual(["orphaned", null]);
    // A citation with no in-text marker but `unanchored: true` intent is FREE
    // — deliberately parked (archive→unarchive removed the atom and did not
    // re-insert it), a normal re-placeable state, NOT the red orphaned error.
    expect(states.get("float:card:citation:ci-parked")).toEqual(["free", null]);
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
