// @vitest-environment jsdom
//
// Task 316, the pop-out half — "either it works or it is impossible by
// construction, never *the card disappears*."
//
// Threading the parked card's `cardKey` (so its drop button renders) also arms
// PanelCard's header drag-lift, which is the only pop-out path. The footnote
// float builder resolved LIVE atoms only (`getFootnotes()` / `ctx.footnotes`,
// both editor-derived), so an atomless ref returned null and the lift would
// have landed in a blank window — the regression a naive `cardKey` thread
// ships. The builder now falls back to the sidecar half of the collection,
// which is the shape the citation twin has had all along.
//
// The `renderBody()` closure is never invoked here: this pins RESOLUTION and
// the chrome facets that derive from it, so the card UI need only import.

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

// Side effect: registers every kind's `toFloatable` onto CARD_REGISTRY.
import "@/cards/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import { cardPopKey } from "@/panels/panel-registry";
import type { FootnoteRef } from "@/lib/types";

const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const PARKED = {
  id: "fn-parked",
  unanchored: true,
  content: body("the parked body"),
  createdAt: "2026-08-08T00:00:00.000Z",
} as unknown as FootnoteRef;

/** `editorRef.current` is null, so the builder falls back to `ctx.footnotes` —
 *  the same both-sources-empty state a real doc has for a parked ref. */
function ctxWith(opts: {
  live?: Array<{ footnoteId: string; content: unknown; number: number; pos: number }>;
  parked?: FootnoteRef[];
}): CardFloatCtx {
  return {
    footnotes: opts.live ?? [],
    unanchoredFootnotes: opts.parked ?? [],
    selectedFootnoteId: null,
    setSelectedFootnoteId: vi.fn(),
    setOverrideEditor: vi.fn(),
    getCitationDisplayText: () => "",
    handleCitationCreated: vi.fn(),
    handleEditUnanchoredFootnote: vi.fn(),
    handleDeleteUnanchoredFootnote: vi.fn(),
    footnoteAiRequests: {},
    editorRef: { current: null },
  } as unknown as CardFloatCtx;
}

const build = (id: string, ctx: CardFloatCtx) =>
  CARD_REGISTRY.footnote.toFloatable(id, ctx);

describe("footnote float: the atomless fallback (task 316)", () => {
  it("resolves a parked ref that no live atom carries", () => {
    const f = build(PARKED.id, ctxWith({ parked: [PARKED] }));
    expect(f).not.toBeNull();
    expect(f!.key).toBe(cardPopKey("footnote", PARKED.id));
    expect(f!.kind).toBe("footnote");
  });

  it("offers no jump — there is no in-text marker to jump to", () => {
    // Mirrors the citation twin's `isAnchored` fork. A live jump chevron on a
    // card with no marker is the dead control that fork exists to prevent.
    const f = build(PARKED.id, ctxWith({ parked: [PARKED] }));
    expect(f!.canJump).toBe(false);
  });

  it("keeps the (re)anchor drop button — the whole point of popping it out", () => {
    // `canDrop` is the static registry facet, so this pins that the fallback
    // goes through the SAME `cardFloatable` shell as the anchored branch rather
    // than a hand-built Floatable that could drop chrome.
    const f = build(PARKED.id, ctxWith({ parked: [PARKED] }));
    expect(f!.canDrop).toBe(CARD_REGISTRY.footnote.droppable);
    expect(f!.canDrop).toBe(true);
  });

  it("snapshots the ref's real body onto the Stack", () => {
    const f = build(PARKED.id, ctxWith({ parked: [PARKED] }));
    const item = f!.snapshotForStack({ docId: "doc-1" });
    expect(item).not.toBeNull();
    const payload = item!.payload;
    if (payload.kind !== "card") throw new Error("expected a card payload");
    expect(payload.card.cardKind).toBe("footnote");
    expect(JSON.stringify(payload.card.data)).toContain("the parked body");
  });

  it("a LIVE atom still wins — the anchored branch is untouched", () => {
    // `selectAtomlessFootnoteRefs` already refuses to list a ref whose atom is
    // back, but the flag can outlive the atom on several routes (undo, a
    // re-typed `\footnote`, a paste). The live branch must win here too, or a
    // stale flag would strip the jump from a genuinely anchored footnote.
    const f = build("fn-live", ctxWith({
      live: [{ footnoteId: "fn-live", content: body("live"), number: 1, pos: 5 }],
      parked: [{ ...PARKED, id: "fn-live" } as FootnoteRef],
    }));
    expect(f!.canJump).toBe(true);
  });

  it("returns null when the id is in neither half", () => {
    // A ref deleted mid-gesture: nothing to render is still the right answer.
    expect(build("nope", ctxWith({}))).toBeNull();
  });
});
