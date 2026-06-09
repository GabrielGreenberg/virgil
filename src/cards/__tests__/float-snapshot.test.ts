// @vitest-environment jsdom
//
// Regression test for AF-follow: each stackable card kind's `Floatable`
// (built via `CARD_REGISTRY[kind].toFloatable(id, ctx)`) must serialize itself
// onto the Stack through `snapshotForStack(source)`. Guards the wiring that
// replaced the legacy prefix-lookup resolver under `lib/stack/`.
//
// We never render `renderBody()` — only build the `Floatable` and call
// `snapshotForStack`. So the card-UI components the factory imports need only
// be importable, not mounted.

import { describe, it, expect, vi } from "vitest";

// `@/cards/floats` transitively pulls `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest's resolver can't alias (the known
// barrel/storage gotcha). Stub every export as a no-op — the factory chain
// only needs the module to import, never to read/write a sidecar.
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

// Importing this module registers every poppable card kind's `toFloatable`
// builder onto CARD_REGISTRY (side effect).
import "@/cards/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import type { CardKind } from "@/cards/types";
import type { StackItem } from "@/lib/stack/types";

const SOURCE = { docId: "doc-1" };

/** Narrow a (card) StackItem to its `{ cardKind, data, bibEntries }`. Throws if
 *  the payload isn't a card — the caller has already asserted it is. */
function cardPayload(item: StackItem): {
  cardKind: string;
  data: Record<string, unknown>;
  bibEntries?: Array<Record<string, unknown>>;
} {
  if (item.payload.kind !== "card") throw new Error("expected a card payload");
  const card = item.payload.card;
  return {
    cardKind: card.cardKind,
    data: card.data as unknown as Record<string, unknown>,
    bibEntries:
      "bibEntries" in card
        ? (card.bibEntries as unknown as Array<Record<string, unknown>>)
        : undefined,
  };
}

const richDoc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

// One record per collection the builders resolve from. Each id matches the id
// passed to `toFloatable` in the per-kind cases below. Cast to `CardFloatCtx`:
// the builders only read the collections + (for citation) `bibEntries`; the
// many handler closures are never invoked (renderBody is not called).
const mockCtx = {
  notes: [{ kind: "note", id: "note-1", title: "My note", content: richDoc("note body"), createdAt: "t", aiRequest: false, links: [] }],
  highlights: [{ kind: "highlight", id: "hl-1", text: "hi", color: "yellow", createdAt: "t", links: [] }],
  footnotes: [{ footnoteId: "fn-1", content: richDoc("fn body"), number: 1, pos: 5 }],
  archiveSnippets: [{ id: "arch-1", title: "Arch", content: richDoc("arch body"), createdAt: "t", links: [] }],
  cutterCards: [
    { kind: "comment", id: "cut-c-1", text: "cut comment", createdAt: "t", links: [] },
    { kind: "suggestion", id: "cut-s-1", original_text: "a", suggested_text: "b", explanation: "why", status: "pending", createdAt: "t", links: [] },
  ],
  todoItems: [{ id: "todo-1", text: "do the thing", done: false, createdAt: "t", links: [] }],
  bibEntries: [{ key: "bib-1", type: "article", fields: { title: "A Paper", author: "Author" } }],
  citations: [{ id: "cit-1", command: "citep", keys: ["bib-1"], createdAt: "t", links: [] }],
  citationPositionMap: new Map(),
  comments: [
    { kind: "comment", id: "rev-c-1", content: richDoc("rev comment"), createdAt: "t", links: [] },
    { kind: "suggestion", id: "rev-s-1", original_text: "a", suggested_text: "b", explanation: "why", status: "pending", createdAt: "t", links: [] },
  ],
  examples: [{ exampleId: "ex-1", title: "Ex", label: "", tag: "" }],
  reportCards: [{ kind: "report", id: "report-1", content: richDoc("report body"), createdAt: "t", links: [] }],
  aiRequests: [{ id: "ai-1", text: "ai req", createdAt: "t" }],
  anchoredIds: new Set<string>(),
  allEditorCitations: [],
  editorRef: { current: null },
} as unknown as CardFloatCtx;

function build(kind: CardKind, id: string) {
  return CARD_REGISTRY[kind].toFloatable(id, mockCtx);
}

describe("card Floatable.snapshotForStack", () => {
  // [floatKind, recordId, expected StackCardKind, a field-probe on the data]
  const stackable: Array<{
    kind: CardKind;
    id: string;
    stackKind: string;
    probe: (data: Record<string, unknown>) => unknown;
    expected: unknown;
  }> = [
    { kind: "note", id: "note-1", stackKind: "note", probe: (d) => d.title, expected: "My note" },
    { kind: "highlight", id: "hl-1", stackKind: "highlight", probe: (d) => d.id, expected: "hl-1" },
    { kind: "footnote", id: "fn-1", stackKind: "footnote", probe: (d) => d.id, expected: "fn-1" },
    { kind: "archive", id: "arch-1", stackKind: "archive", probe: (d) => d.title, expected: "Arch" },
    { kind: "todo", id: "todo-1", stackKind: "todo", probe: (d) => d.text, expected: "do the thing" },
    { kind: "bib", id: "bib-1", stackKind: "bibliography", probe: (d) => d.key, expected: "bib-1" },
    { kind: "citation", id: "cit-1", stackKind: "citation", probe: (d) => d.keys, expected: ["bib-1"] },
    { kind: "revision-comment", id: "rev-c-1", stackKind: "revision-comment", probe: (d) => d.kind, expected: "comment" },
    { kind: "revision-suggestion", id: "rev-s-1", stackKind: "revision-suggestion", probe: (d) => d.kind, expected: "suggestion" },
    { kind: "cutter-comment", id: "cut-c-1", stackKind: "cutter-comment", probe: (d) => d.text, expected: "cut comment" },
    { kind: "cutter-suggestion", id: "cut-s-1", stackKind: "cutter-suggestion", probe: (d) => d.suggested_text, expected: "b" },
  ];

  for (const { kind, id, stackKind, probe, expected } of stackable) {
    it(`${kind} → StackItem(card:${stackKind})`, () => {
      const f = build(kind, id);
      expect(f).not.toBeNull();
      const item = f!.snapshotForStack(SOURCE);
      expect(item).not.toBeNull();
      expect(item!.payload.kind).toBe("card");
      const card = cardPayload(item!);
      expect(card.cardKind).toBe(stackKind);
      expect(probe(card.data)).toEqual(expected);
      // The snapshot is a deep copy — mutating it must not touch the source.
      expect(item!.source).toEqual(SOURCE);
    });
  }

  it("footnote shim carries the FootnoteInfo content (R1 Option B)", () => {
    const f = build("footnote", "fn-1");
    const item = f!.snapshotForStack(SOURCE);
    expect(cardPayload(item!).data.content).toEqual(richDoc("fn body"));
  });

  it("citation attaches the resolved bib sidecar (R3)", () => {
    const f = build("citation", "cit-1");
    const item = f!.snapshotForStack(SOURCE);
    const { bibEntries } = cardPayload(item!);
    expect(bibEntries).toHaveLength(1);
    expect(bibEntries![0].key).toBe("bib-1");
  });

  it("example returns null (R2 — no reachable ExampleRef sidecar)", () => {
    const f = build("example", "ex-1");
    expect(f).not.toBeNull();
    expect(f!.snapshotForStack(SOURCE)).toBeNull();
  });

  it("report is poppable but not stackable — a built Floatable snapshots null", () => {
    const f = build("report", "report-1");
    expect(f).not.toBeNull(); // record resolves → a real Floatable
    expect(f!.snapshotForStack(SOURCE)).toBeNull(); // …but not stackable
  });

  it("ai is poppable but not stackable — a built Floatable snapshots null", () => {
    const f = build("ai", "ai-1");
    expect(f).not.toBeNull();
    expect(f!.snapshotForStack(SOURCE)).toBeNull();
  });
});
