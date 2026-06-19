// @vitest-environment jsdom
//
// T5 Pillar A — `filterOmniItemsByFoldAndFocus` binning on the LIVE pos
// (OMNI-F1-02). The bug: an entity-anchored omni item carries a `pos` baked
// when `items` was last (structurally) rebuilt; a plain-typing edit shifts the
// item across a fold/focus boundary but leaves the baked pos stale, so a
// classification keyed on `item.pos` lands in the WRONG bin. With the live
// resolver the bin is correct. These pins drive a REAL doc so `doc.resolve(pos)
// .index(0)` behaves faithfully, and contrast the stale-pos vs live-pos result.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const n of FNS) mod[n] = vi.fn();
  return mod;
});

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import type { FocusState } from "@/hooks/useFocusMode";
import { filterOmniItemsByFoldAndFocus } from "../omni-fold-focus-filter";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

// Doc layout (top-level block indices in []):
//   [0] heading "Sec A"
//   [1] paragraph with a footnote atom (fn-1)
//   [2] heading "Sec B"
//   [3] paragraph "tail"
function makeContent(): Content {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2, uuid: "h-a" }, content: [{ type: "text", text: "Sec A" }] },
      {
        type: "paragraph",
        attrs: { uuid: "p-fn" },
        content: [
          { type: "text", text: "Has " },
          { type: "footnote", attrs: { footnoteId: "fn-1", number: 1 } },
        ],
      },
      { type: "heading", attrs: { level: 2, uuid: "h-b" }, content: [{ type: "text", text: "Sec B" }] },
      { type: "paragraph", attrs: { uuid: "p-tail" }, content: [{ type: "text", text: "tail" }] },
    ],
  };
}

function mount(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  // Warm the bus so the footnote position is live (see useLivePosResolver test).
  editor
    .chain()
    .insertContentAt(editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "Z" }] })
    .run();
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

const FN_KEY = cardPopKey("footnote", "fn-1");
const NO_FOCUS = null as FocusState | null;
const liveResolver = (editor: Editor) => (id: string): number | undefined =>
  id === FN_KEY ? getBus(editor)!.structure.footnotes.find((f) => f.id === "fn-1")?.pos : undefined;

describe("filterOmniItemsByFoldAndFocus — live-pos fold binning (OMNI-F1-02)", () => {
  it("keeps a footnote whose LIVE anchor is in a NON-collapsed section even when the BAKED pos points into a collapsed one", () => {
    const { editor, cleanup } = mount();
    try {
      const doc = editor.state.doc;
      const livePos = getBus(editor)!.structure.footnotes.find((f) => f.id === "fn-1")!.pos;
      const liveBi = doc.resolve(livePos).index(0); // === 1 (the fn paragraph)

      // The footnote's anchor paragraph lives at block index 1 (NOT collapsed).
      // But its BAKED `item.pos` is stale and points into block index 0 (which
      // IS collapsed) — the pre-fix mis-bin.
      const stalePos = doc.resolve(1).pos; // somewhere inside block 0 (heading)
      const staleBi = doc.resolve(stalePos).index(0); // === 0
      expect(staleBi).toBe(0);
      expect(liveBi).toBe(1);

      const item: OmniItem = {
        id: FN_KEY,
        pos: stalePos, // STALE baked pos → block 0
        anchorState: "anchored",
        content: null,
      };
      const hidden = new Set<number>([0]); // section A collapsed

      // Pre-fix behavior (baked pos): block 0 is hidden → DROPPED (the bug).
      const bakedOnly = filterOmniItemsByFoldAndFocus([item], doc, hidden, NO_FOCUS, () => undefined);
      expect(bakedOnly).toHaveLength(0);

      // Live-pos behavior: block 1 is visible → KEPT (the fix).
      const live = filterOmniItemsByFoldAndFocus([item], doc, hidden, NO_FOCUS, liveResolver(editor));
      expect(live).toHaveLength(1);
      expect(live[0].id).toBe(FN_KEY);
    } finally {
      cleanup();
    }
  });

  it("drops a footnote whose LIVE anchor IS in a collapsed section (binning still works the other way)", () => {
    const { editor, cleanup } = mount();
    try {
      const doc = editor.state.doc;
      const item: OmniItem = {
        id: FN_KEY,
        // Stale baked pos pointing at the (visible) tail block 3…
        pos: doc.resolve(doc.content.size - 2).pos,
        anchorState: "anchored",
        content: null,
      };
      // …but the LIVE anchor (block 1) is the one that's collapsed.
      const hidden = new Set<number>([1]);

      const live = filterOmniItemsByFoldAndFocus([item], doc, hidden, NO_FOCUS, liveResolver(editor));
      expect(live).toHaveLength(0); // correctly dropped on the LIVE bin
    } finally {
      cleanup();
    }
  });
});

describe("filterOmniItemsByFoldAndFocus — live-pos focus binning (OMNI-F1-02)", () => {
  it("stamps `outsideFocus` based on the LIVE anchor block, not the stale baked pos", () => {
    const { editor, cleanup } = mount();
    try {
      const doc = editor.state.doc;
      // The footnote's LIVE anchor is block index 1. Focus band = [2, 3] (it is
      // OUTSIDE the band). A stale baked pos in block 2 would wrongly read as
      // INSIDE.
      const stalePosInBand = doc.resolve(0).pos; // block 0 — but we want a stale "inside" miss
      const item: OmniItem = {
        id: FN_KEY,
        pos: stalePosInBand,
        anchorState: "anchored",
        content: null,
      };
      // LOCKED band: only a locked band confines, so only then is an
      // out-of-band card stamped (CHIP A).
      const focus: FocusState = { active: true, locked: true, startBlockIndex: 2, endBlockIndex: 3 } as FocusState;

      const live = filterOmniItemsByFoldAndFocus([item], doc, new Set(), focus, liveResolver(editor));
      expect(live).toHaveLength(1);
      // Block 1 is outside [2,3] → stamped.
      expect(live[0].outsideFocus).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("CHIP A: an UNLOCKED (active-only) band stamps NOTHING, even out-of-band", () => {
    const { editor, cleanup } = mount();
    try {
      const doc = editor.state.doc;
      const item: OmniItem = {
        id: FN_KEY,
        pos: doc.resolve(0).pos,
        anchorState: "anchored",
        content: null,
      };
      // Live anchor (block 1) is OUTSIDE [2,3], but the band is NOT locked → a
      // mere focus selection confines nothing, so no card is binned.
      const focus: FocusState = { active: true, locked: false, startBlockIndex: 2, endBlockIndex: 3 } as FocusState;
      const live = filterOmniItemsByFoldAndFocus([item], doc, new Set(), focus, liveResolver(editor));
      expect(live).toHaveLength(1);
      expect(live[0].outsideFocus).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("an item INSIDE the focused band (live) is not stamped", () => {
    const { editor, cleanup } = mount();
    try {
      const doc = editor.state.doc;
      const item: OmniItem = { id: FN_KEY, pos: 0, anchorState: "anchored", content: null };
      // Locked band covers block 1 (the live fn anchor) → in-band, not stamped.
      const focus: FocusState = { active: true, locked: true, startBlockIndex: 0, endBlockIndex: 2 } as FocusState;
      const live = filterOmniItemsByFoldAndFocus([item], doc, new Set(), focus, liveResolver(editor));
      expect(live).toHaveLength(1);
      expect(live[0].outsideFocus).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

describe("filterOmniItemsByFoldAndFocus — fallback + edge cases", () => {
  it("falls back to the baked `item.pos` for a paragraph-anchored item (resolver returns undefined)", () => {
    const { editor, cleanup } = mount();
    try {
      const doc = editor.state.doc;
      // A note `@N` row the resolver doesn't cover; baked pos points at block 0.
      const item: OmniItem = {
        id: "float:card:note:n1@1",
        pos: doc.resolve(1).pos, // block 0
        anchorState: "anchored",
        content: null,
      };
      const hidden = new Set<number>([0]);
      const out = filterOmniItemsByFoldAndFocus([item], doc, hidden, NO_FOCUS, () => undefined);
      expect(out).toHaveLength(0); // dropped on the baked pos (block 0 collapsed)
    } finally {
      cleanup();
    }
  });

  it("a free item (pos null) is always kept (both passes)", () => {
    const { editor, cleanup } = mount();
    try {
      const doc = editor.state.doc;
      const item: OmniItem = { id: "float:card:note:free", pos: null, anchorState: "free", content: null };
      const focus: FocusState = { active: true, startBlockIndex: 5, endBlockIndex: 6 } as FocusState;
      const out = filterOmniItemsByFoldAndFocus([item], doc, new Set([0, 1, 2]), focus, () => undefined);
      expect(out).toHaveLength(1);
      expect(out[0].outsideFocus).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("no doc / no fold + no focus is the identity", () => {
    const item: OmniItem = { id: FN_KEY, pos: 3, anchorState: "anchored", content: null };
    expect(filterOmniItemsByFoldAndFocus([item], null, new Set([0]), NO_FOCUS, () => 99)).toEqual([item]);
  });
});
