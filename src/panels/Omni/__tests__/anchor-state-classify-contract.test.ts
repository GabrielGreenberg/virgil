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
import { buildNoteOmniItems } from "@/panels/Notes/omni";
import { buildFootnoteOmniItems } from "@/panels/Footnotes/omni";
import { buildErrorOmniItems } from "@/panels/Errors/omni";

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
});

describe("OmniViewPanel mount-race guard (pos == null dropped while editor null)", () => {
  // Mirror of the {anchored, unanchored} split in OmniViewPanel: while
  // `editor` is null, builders that resolve UUIDs transiently return pos:null
  // for items that WILL anchor once the editor mounts. Those must be dropped,
  // not flashed into the unanchored bin.
  function split(items: OmniItem[], editor: object | null) {
    const anchored: OmniItem[] = [];
    const unanchored: OmniItem[] = [];
    for (const item of items) {
      if (item.pos == null) {
        if (!editor) continue; // mount-race guard
        unanchored.push(item);
      } else {
        anchored.push(item);
      }
    }
    return { anchored, unanchored };
  }

  const items: OmniItem[] = [
    { id: "float:card:note:a", pos: 10, anchorState: "anchored", content: null },
    { id: "float:card:note:b", pos: null, anchorState: "free", content: null },
    { id: "float:card:note:c", pos: null, anchorState: "orphaned", content: null },
  ];

  it("drops every pos:null item while editor is null", () => {
    const { anchored, unanchored } = split(items, null);
    expect(anchored.map((i) => i.id)).toEqual(["float:card:note:a"]);
    expect(unanchored).toHaveLength(0);
  });

  it("routes free + orphaned into unanchored once editor is live", () => {
    const { anchored, unanchored } = split(items, {});
    expect(anchored.map((i) => i.id)).toEqual(["float:card:note:a"]);
    expect(unanchored.map((i) => i.anchorState).sort()).toEqual(["free", "orphaned"]);
  });
});
