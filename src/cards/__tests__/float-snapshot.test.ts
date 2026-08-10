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
import { CARD_KINDS } from "@/cards/predicates";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import type { CardKind } from "@/cards/types";
import { stackCardKindFor, type StackItem } from "@/lib/stack/types";

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

/**
 * The per-kind FIXTURE — a record id in `mockCtx` plus one field probe proving
 * the snapshot carried the real record, keyed by `CardKind`.
 *
 * Task 259 retired the hand-kept `stackable: [...]` array this replaced: it
 * restated Stack membership a sixth time, so a kind whose snapshot silently
 * regressed to `() => null` (or a kind added to the Stack and never wired) was
 * simply absent from the list and the suite stayed green. Membership now comes
 * from `CARD_REGISTRY[kind].stackable` and the expected Stack name from the
 * `stackCardKindFor` bridge; this map only supplies the data the assertion
 * cannot derive. It is typed TOTAL over `CardKind`, so a new kind is a compile
 * error here, and the "every stackable kind is covered" leg below fails if a
 * kind becomes stackable without a fixture id.
 */
const FIXTURES: Record<
  CardKind,
  { id: string; probe: (d: Record<string, unknown>) => unknown; expected: unknown } | null
> = {
  note: { id: "note-1", probe: (d) => d.title, expected: "My note" },
  highlight: { id: "hl-1", probe: (d) => d.text, expected: "hi" },
  footnote: { id: "fn-1", probe: (d) => d.id, expected: "fn-1" },
  archive: { id: "arch-1", probe: (d) => d.title, expected: "Arch" },
  todo: { id: "todo-1", probe: (d) => d.text, expected: "do the thing" },
  bib: { id: "bib-1", probe: (d) => d.key, expected: "bib-1" },
  citation: { id: "cit-1", probe: (d) => d.keys, expected: ["bib-1"] },
  "revision-comment": { id: "rev-c-1", probe: (d) => d.kind, expected: "comment" },
  "revision-suggestion": { id: "rev-s-1", probe: (d) => d.kind, expected: "suggestion" },
  "cutter-comment": { id: "cut-c-1", probe: (d) => d.text, expected: "cut comment" },
  "cutter-suggestion": { id: "cut-s-1", probe: (d) => d.suggested_text, expected: "b" },
  // Not stackable — a resolvable record so the null-snapshot leg builds a REAL
  // Floatable rather than passing on an unresolvable id.
  example: { id: "ex-1", probe: (d) => d, expected: null },
  report: { id: "report-1", probe: (d) => d, expected: null },
  "report-request": null, // no fixture record; not stackable either
  error: null, // not poppable at all (§3.5)
};

describe("card Floatable.snapshotForStack", () => {
  const stackable = CARD_KINDS.filter((k) => CARD_REGISTRY[k].stackable);

  it("every stackable kind has a fixture (the derivation can't skip one silently)", () => {
    for (const k of stackable) {
      expect(FIXTURES[k], `${k}: stackable with no fixture record`).not.toBeNull();
    }
    // Canary: the filter really is selecting, not returning everything/nothing.
    expect(stackable.length).toBeGreaterThan(5);
    expect(stackable.length).toBeLessThan(CARD_KINDS.length);
  });

  for (const kind of stackable) {
    const fx = FIXTURES[kind]!;
    const stackKind = stackCardKindFor(kind);
    it(`${kind} → StackItem(card:${stackKind})`, () => {
      const f = build(kind, fx.id);
      expect(f).not.toBeNull();
      const item = f!.snapshotForStack(SOURCE);
      expect(item).not.toBeNull();
      expect(item!.payload.kind).toBe("card");
      const card = cardPayload(item!);
      expect(card.cardKind).toBe(stackKind);
      expect(fx.probe(card.data)).toEqual(fx.expected);
      // The drop source descriptor round-trips onto the item.
      expect(item!.source).toEqual(SOURCE);
    });
  }

  it("snapshotForStack deep-clones the record (mutating the snapshot can't touch the source)", () => {
    const first = build("note", "note-1")!.snapshotForStack(SOURCE)!;
    (cardPayload(first).data as { title?: string }).title = "MUTATED";
    // A fresh snapshot re-reads the source record — which must be untouched.
    const second = build("note", "note-1")!.snapshotForStack(SOURCE)!;
    expect(cardPayload(second).data.title).toBe("My note");
  });

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

  // The other half of the biconditional, also derived: a kind the registry
  // declares NON-stackable must snapshot null from a real, resolvable record —
  // a `Floatable` that built fine and refused to serialize, not one that
  // returned null because the id didn't resolve. `example` (task 259) and
  // `report` are the two with fixture records.
  for (const kind of CARD_KINDS.filter(
    (k) => !CARD_REGISTRY[k].stackable && FIXTURES[k] !== null,
  )) {
    it(`${kind} is poppable but NOT stackable — a built Floatable snapshots null`, () => {
      const f = build(kind, FIXTURES[kind]!.id);
      expect(f).not.toBeNull(); // record resolves → a real Floatable
      expect(f!.snapshotForStack(SOURCE)).toBeNull(); // …but not stackable
      expect(stackCardKindFor(kind)).toBeNull(); // …and the vocabulary agrees
    });
  }
});
