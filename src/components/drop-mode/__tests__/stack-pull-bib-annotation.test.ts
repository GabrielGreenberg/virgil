/**
 * Task 069 — the RESTORE half. A bib/citation stack pull must re-attach the
 * user-authored annotation the snapshot carried (annotations live in a per-doc
 * `annotations.json` sidecar, not on the `BibEntry`, so a cross-doc pull would
 * otherwise drop them silently). These tests drive the real
 * `stackPullDropSpec.applyDrop` against a fake `StackPullApi`, asserting:
 *   - bibliography pull → `setAnnotation(key, html)` after `upsertBibEntry`;
 *   - citation pull → per-key `setAnnotation` for each side-channelled entry;
 *   - a snapshot with NO annotation writes nothing (same-doc / note-less path).
 * The snapshot half is covered by `lib/stack/__tests__/snapshot-bib-annotation`.
 */
import { describe, expect, it, vi } from "vitest";

const { readStackItemMock } = vi.hoisted(() => ({
  readStackItemMock: vi.fn(),
}));
vi.mock("@/hooks/useStack", () => ({ readStackItem: readStackItemMock }));

import { stackPullDropSpec } from "../specs/stack-pull";
import type { DropCtx, Placement, StackPullApi } from "../types";
import type { StackItem } from "@/lib/stack/types";
import type { BibEntry, CitationRef } from "@/lib/types";

const CARD_KEY = "stack-pull:item-1";

function bibEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    uid: "uid-smith",
    key: "smith2020",
    type: "article",
    fields: { title: "On Annotation" },
    raw: "@article{smith2020}",
    ...overrides,
  };
}

/** A fake StackPullApi that records the calls we care about. */
function fakeStack() {
  const upserts: BibEntry[] = [];
  const annotations: Array<[string, string]> = [];
  const api = {
    upsertBibEntry: (e: BibEntry) => upserts.push(e),
    setAnnotation: (k: string, html: string) => annotations.push([k, html]),
    addCitation: (seed: CitationRef) => seed,
    // Unused-by-these-tests members left as no-op stubs.
    addNote: vi.fn(),
    addTodo: vi.fn(),
    addArchive: vi.fn(),
    addRevisionComment: vi.fn(),
    addRevisionSuggestion: vi.fn(),
    addCutterComment: vi.fn(),
    addCutterSuggestion: vi.fn(),
    addFootnote: vi.fn(),
  } as unknown as StackPullApi;
  return { api, upserts, annotations };
}

/** A between-blocks placement + ctx whose mainEditor === placement.editor
 *  (the card path never touches the editor for bib/citation). */
function ctxFor(stack: StackPullApi): { ctx: DropCtx; placement: Placement } {
  const mainEditor = {} as unknown as import("@tiptap/react").Editor;
  const placement = {
    kind: "between-blocks",
    editor: mainEditor,
    insertPos: 0,
  } as unknown as Placement;
  const ctx = { mainEditor, stack } as unknown as DropCtx;
  return { ctx, placement };
}

function bibItem(annotation?: string): StackItem {
  return {
    id: "item-1",
    capturedAt: "2026-07-06T00:00:00.000Z",
    source: { docId: "docA" },
    payload: {
      kind: "card",
      card: { cardKind: "bibliography", data: bibEntry(), ...(annotation ? { annotation } : {}) },
    },
  };
}

describe("stack-pull — bibliography annotation re-attach (task 069)", () => {
  it("re-attaches the carried annotation via setAnnotation after upsert", () => {
    const html = "<p>Key source.</p>";
    readStackItemMock.mockReturnValue(bibItem(html));
    const { api, upserts, annotations } = fakeStack();
    const { ctx, placement } = ctxFor(api);

    stackPullDropSpec.applyDrop(placement, CARD_KEY, ctx);

    expect(upserts.map((e) => e.key)).toEqual(["smith2020"]);
    expect(annotations).toEqual([["smith2020", html]]);
  });

  it("writes NO annotation when the snapshot carried none", () => {
    readStackItemMock.mockReturnValue(bibItem(undefined));
    const { api, upserts, annotations } = fakeStack();
    const { ctx, placement } = ctxFor(api);

    stackPullDropSpec.applyDrop(placement, CARD_KEY, ctx);

    expect(upserts.map((e) => e.key)).toEqual(["smith2020"]);
    expect(annotations).toEqual([]);
  });
});

describe("stack-pull — citation bib annotations re-attach (task 069 cluster)", () => {
  function citationItem(): StackItem {
    const cit: CitationRef = {
      id: "cit-1",
      command: "\\citep{smith2020,jones1990}",
      keys: ["smith2020", "jones1990"],
      createdAt: "2026-07-06T00:00:00.000Z",
    };
    return {
      id: "item-1",
      capturedAt: "2026-07-06T00:00:00.000Z",
      source: { docId: "docA" },
      payload: {
        kind: "card",
        card: {
          cardKind: "citation",
          data: cit,
          bibEntries: [bibEntry(), bibEntry({ uid: "uid-jones", key: "jones1990" })],
          bibAnnotations: { smith2020: "<p>Smith note.</p>" },
        },
      },
    };
  }

  it("upserts every referenced entry and re-attaches only the annotated ones", () => {
    readStackItemMock.mockReturnValue(citationItem());
    const { api, upserts, annotations } = fakeStack();
    const { ctx, placement } = ctxFor(api);

    stackPullDropSpec.applyDrop(placement, CARD_KEY, ctx);

    expect(upserts.map((e) => e.key)).toEqual(["smith2020", "jones1990"]);
    expect(annotations).toEqual([["smith2020", "<p>Smith note.</p>"]]);
  });
});
