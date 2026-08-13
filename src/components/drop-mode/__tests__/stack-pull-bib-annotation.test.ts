/**
 * Task 069 — the RESTORE half, re-expressed on task 235's unified carrier.
 *
 * A bib entry's user-authored annotation lives in a per-doc `annotations.json`
 * sidecar, not on the `BibEntry`, so a cross-doc pull would drop it silently
 * unless the snapshot carries it. 069 built that carry into the CARD payload's
 * own fields (`bibEntries` / `bibAnnotations` / `annotation`); 235 moved it onto
 * `StackItem.bib`, the ONE carrier every payload family rides, and the discharge
 * from the card branch's commit to `withBibUpsert`, which wraps EVERY resolved
 * plan. The contract is unchanged and is what these tests still pin:
 *   - bibliography pull → `setAnnotation(key, html)` after `upsertBibEntry`;
 *   - citation pull → per-key `setAnnotation` for each referenced entry;
 *   - a snapshot with NO annotation writes nothing (same-doc / note-less path);
 *   - a blob PERSISTED BEFORE 235 still restores, through `normalizeStackItemBib`.
 *
 * The seam's unit contract is `lib/stack/__tests__/bib-carry.test.ts`; the
 * content-payload half (the defect 235 fixed) is `stack-content-bib-carry.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

const { readStackItemMock } = vi.hoisted(() => ({
  readStackItemMock: vi.fn(),
}));
vi.mock("@/hooks/useStack", () => ({ readStackItem: readStackItemMock }));

import { stackPullDropSpec } from "../specs/stack-pull";
import type { DropCtx, Placement, StackPullApi } from "../types";
import type { StackItem } from "@/lib/stack/types";
import { normalizeStackItemBib } from "@/lib/stack/bib-carry";
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

/** A fake StackPullApi that records the calls we care about. `existing` seeds
 *  the DESTINATION's own bib notes, which a carry must never overwrite. */
function fakeStack(existing: Record<string, string> = {}) {
  const upserts: BibEntry[] = [];
  const annotations: Array<[string, string]> = [];
  const api = {
    upsertBibEntry: (e: BibEntry) => upserts.push(e),
    getAnnotation: (k: string) => existing[k] ?? "",
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
function ctxFor(stack: StackPullApi | undefined): { ctx: DropCtx; placement: Placement } {
  const mainEditor = {} as unknown as import("@tiptap/react").Editor;
  const placement = {
    kind: "between-blocks",
    editor: mainEditor,
    insertPos: 0,
  } as unknown as Placement;
  const ctx = { mainEditor, stack } as unknown as DropCtx;
  return { ctx, placement };
}

function item(payload: StackItem["payload"], bib?: StackItem["bib"]): StackItem {
  return {
    id: "item-1",
    capturedAt: "2026-07-06T00:00:00.000Z",
    source: { docId: "docA" },
    payload,
    ...(bib ? { bib } : {}),
  };
}

function bibItem(annotation?: string): StackItem {
  return item(
    { kind: "card", card: { cardKind: "bibliography", data: bibEntry() } },
    {
      entries: [bibEntry()],
      annotations: annotation ? { smith2020: annotation } : {},
    },
  );
}

describe("stack-pull — bibliography annotation re-attach (task 069)", () => {
  it("re-attaches the carried annotation via setAnnotation after upsert", () => {
    const html = "<p>Key source.</p>";
    readStackItemMock.mockReturnValue(bibItem(html));
    const { api, upserts, annotations } = fakeStack();
    const { ctx, placement } = ctxFor(api);

    stackPullDropSpec.applyDrop(placement, CARD_KEY, ctx);

    // Twice, by design and harmlessly: a bibliography card DECLARES its own key
    // (which is how its annotation gets carried at all), so the entry arrives
    // once through the carry and once as the card's own payload action.
    // `upsertBibEntry` is a no-op on an existing key, so the second is free —
    // and special-casing the payload's own entry out of the carry would buy a
    // per-kind branch in the seam whose whole point is not having one.
    expect(upserts.map((e) => e.key)).toEqual(["smith2020", "smith2020"]);
    expect(annotations).toEqual([["smith2020", html]]);
  });

  it("writes NO annotation when the snapshot carried none", () => {
    readStackItemMock.mockReturnValue(bibItem(undefined));
    const { api, upserts, annotations } = fakeStack();
    const { ctx, placement } = ctxFor(api);

    stackPullDropSpec.applyDrop(placement, CARD_KEY, ctx);

    expect(upserts.map((e) => e.key)).toEqual(["smith2020", "smith2020"]);
    expect(annotations).toEqual([]);
  });
});

describe("stack-pull — citation bib annotations re-attach (task 069 cluster)", () => {
  const cit: CitationRef = {
    id: "cit-1",
    command: "\\citep{smith2020,jones1990}",
    keys: ["smith2020", "jones1990"],
    createdAt: "2026-07-06T00:00:00.000Z",
  };

  function citationItem(): StackItem {
    return item(
      { kind: "card", card: { cardKind: "citation", data: cit } },
      {
        entries: [bibEntry(), bibEntry({ uid: "uid-jones", key: "jones1990" })],
        annotations: { smith2020: "<p>Smith note.</p>" },
      },
    );
  }

  it("upserts every referenced entry and re-attaches only the annotated ones", () => {
    readStackItemMock.mockReturnValue(citationItem());
    const { api, upserts, annotations } = fakeStack();
    const { ctx, placement } = ctxFor(api);

    stackPullDropSpec.applyDrop(placement, CARD_KEY, ctx);

    expect(upserts.map((e) => e.key)).toEqual(["smith2020", "jones1990"]);
    expect(annotations).toEqual([["smith2020", "<p>Smith note.</p>"]]);
  });

  it("a pre-235 PERSISTED blob still restores, via the read door's normalization", () => {
    // The shape an older build wrote: the bib rode the citation card's own
    // fields. `readEnvelope` lifts it onto `item.bib` for every consumer, so the
    // pull side needs no legacy branch — this is that guarantee, end to end.
    const legacy = {
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
    } as unknown as StackItem;
    readStackItemMock.mockReturnValue(normalizeStackItemBib(legacy));

    const { api, upserts, annotations } = fakeStack();
    const { ctx, placement } = ctxFor(api);

    stackPullDropSpec.applyDrop(placement, CARD_KEY, ctx);

    expect(upserts.map((e) => e.key)).toEqual(["smith2020", "jones1990"]);
    expect(annotations).toEqual([["smith2020", "<p>Smith note.</p>"]]);
  });

  it("KEEPS the destination's own note — a carry fills empty slots, it does not restate", () => {
    // The two halves resolve a conflict the same way: `upsertBibEntry` is
    // insert-if-absent, so doc B keeps its own `smith2020` entry — and a note
    // written over it would describe the entry that was DISCARDED. Sidecar
    // write, no undo, no warning; so the carried note stands down.
    readStackItemMock.mockReturnValue(citationItem());
    const { api, upserts, annotations } = fakeStack({
      smith2020: "<p>Doc B's own note.</p>",
    });
    const { ctx, placement } = ctxFor(api);

    stackPullDropSpec.applyDrop(placement, CARD_KEY, ctx);

    expect(upserts.map((e) => e.key)).toEqual(["smith2020", "jones1990"]);
    expect(annotations).toEqual([]);
  });
});

// The refusal `withBibUpsert` itself owns (a carry with no `ctx.stack`) is
// pinned in `stack-content-bib-carry.test.ts`, against a CONTENT payload: for a
// CARD payload `planCardDrop`'s own pre-321 `if (!stack) return null` refuses
// first, so a card-shaped leg here would pass without reaching the new code.
