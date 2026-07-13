// @vitest-environment jsdom
//
// T5 Pillar D — search results re-resolve a LIVE position at click time.
//
// The bug class (SR-F1-01 / SR-A2-01 / SR-F3-04): the search result baked a
// raw `{from,to}` at search time. Typing in an EARLIER paragraph shifted the
// whole doc, so clicking the result later highlighted STALE text (the old
// offset, now pointing at the wrong characters). The fix carries a
// keystroke-durable identity `{blockUuid, offset, length}` and re-resolves it
// to a live PM range via the DocStructure snapshot at click time.
//
// Also pins the multi-block off-by-one fix: `searchMainText` now derives the
// PM `from` from the same block-span index it matched against, so a match in
// the SECOND block lands on the second block's text — not one position off.
//
// Built on the real main-editor extension stack so the DocStructureObserver/bus
// actually re-maps positions (the borrowed-atoms smoke pattern).

import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted storage stub (figure/graphics/tex-block NodeViews pull @/lib/storage).
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
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
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { compileQuery } from "@/lib/search-sources";
import {
  searchMainText,
  resolveAnchoredHighlight,
} from "@/panels/Search/SearchPanel";
import { resolveLiveBlockRange } from "@/hooks/useLivePosResolver";

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

// Two paragraphs; the search target ("WIDGET") lives in the SECOND one, so a
// naive offset is exposed if the block mapping is off. Each block carries a
// stable uuid (the durable identity).
function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "uuid-para-1" },
        content: [{ type: "text", text: "Alpha beta gamma." }],
      },
      {
        type: "paragraph",
        attrs: { uuid: "uuid-para-2" },
        content: [{ type: "text", text: "Here is the WIDGET token." }],
      },
    ],
  };
}

// A paragraph with an inline footnote atom BEFORE the search target. The atom
// occupies a PM slot but contributes no chars, so a naive char-offset → PM
// conversion would land the highlight one position short. Exercises the
// per-run (atom-accurate) mapping.
function makeAtomContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "uuid-atom-para" },
        content: [
          { type: "text", text: "Lead in " },
          { type: "footnote", attrs: { footnoteId: "fn-x", number: 1 } },
          { type: "text", text: " then TARGET word." },
        ],
      },
    ],
  };
}

// A paragraph where the search target starts at the char DIRECTLY after an
// inline atom (a run boundary). Runs are char-contiguous but not PM-contiguous,
// so the boundary offset names two PM positions — the atom's own slot vs the
// following run's start. A start-endpoint conversion must pick the latter; the
// old inclusive-bound scan picked the former, anchoring the highlight on the
// atom pill one slot early. (`makeAtomContent` above starts its target MID-run,
// which can't see this — that's why the suite was green despite the bug.)
function makeBoundaryStartContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "uuid-boundary-para" },
        content: [
          { type: "text", text: "Lead " },
          { type: "footnote", attrs: { footnoteId: "fn-b", number: 1 } },
          { type: "text", text: "TARGET word." },
        ],
      },
    ],
  };
}

// A paragraph where the search target ENDS exactly at an atom boundary — the
// end-endpoint conversion must stop BEFORE the atom (the preceding run's end).
function makeBoundaryEndContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "uuid-boundary-end-para" },
        content: [
          { type: "text", text: "The END" },
          { type: "footnote", attrs: { footnoteId: "fn-e", number: 1 } },
          { type: "text", text: " tail." },
        ],
      },
    ],
  };
}

function mountWith(content: Content): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
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
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

let editor: Editor;
let cleanup: () => void;

beforeEach(() => {
  const m = mount();
  editor = m.editor;
  cleanup = m.cleanup;
  return () => cleanup();
});

/** What text the editor would highlight for a resolved range. */
function textAt(range: { from: number; to: number }): string {
  return editor.state.doc.textBetween(range.from, range.to);
}

/**
 * The editor-attached DocStructureBus seeds EMPTY and is first populated on the
 * initial structural emit (AGENTS "Initial population"). Live-range resolution
 * needs the bus snapshot populated, so warm it with one edit at the END of the
 * doc (doesn't shift the target/atom positions we then assert against). A
 * content edit in a uuid block IS a (content) emit, so the bus snapshot gets a
 * fresh block table — exactly the live-app warm path.
 */
function warmBus(ed: Editor): void {
  const end = ed.state.doc.content.size;
  ed.view.dispatch(ed.state.tr.insertText(" ", end - 1));
}

describe("searchMainText — block-anchored identity (multi-block off-by-one fix)", () => {
  it("anchors a second-block match to the correct block + offset, and from/to read the live text", () => {
    const re = compileQuery("WIDGET", { caseSensitive: true, wholeWord: false })!;
    const hits = searchMainText(editor, re);
    expect(hits).toHaveLength(1);
    const hit = hits[0];

    // Identity is the SECOND block + the intra-block char offset of "WIDGET"
    // ("Here is the " is 12 chars).
    expect(hit.blockId).toEqual({
      blockUuid: "uuid-para-2",
      offset: 12,
      length: 6,
    });
    // The baked from/to (resolved at search time) already read the right text.
    expect(textAt({ from: hit.from, to: hit.to })).toBe("WIDGET");
  });
});

describe("resolveLiveBlockRange — live re-resolution after an earlier edit", () => {
  it("tracks the match through a sentence inserted in an EARLIER paragraph (SR-F1-01)", () => {
    const re = compileQuery("WIDGET", { caseSensitive: true, wholeWord: false })!;
    const hit = searchMainText(editor, re)[0];
    expect(hit.blockId).toBeDefined();

    // Sanity: at search time the baked from points at the match.
    expect(textAt({ from: hit.from, to: hit.to })).toBe("WIDGET");
    const bakedFrom = hit.from;

    // Now type a whole sentence at the very START of the FIRST paragraph —
    // this shifts every later position, so the BAKED `from` is now stale.
    const insert = "A brand new opening sentence here. ";
    editor.view.dispatch(editor.state.tr.insertText(insert, 1));

    // The baked position now points at the WRONG text (the doc shifted under
    // it) — this is exactly the bug the live resolver fixes.
    expect(textAt({ from: bakedFrom, to: bakedFrom + 6 })).not.toBe("WIDGET");

    // Re-resolving the durable identity lands on the CURRENT "WIDGET".
    const live = resolveLiveBlockRange(editor, hit.blockId!);
    expect(live).not.toBeNull();
    expect(textAt(live!)).toBe("WIDGET");
    // And it has genuinely moved by the inserted length.
    expect(live!.from).toBe(bakedFrom + insert.length);
  });

  it("maps the highlight ACROSS an inline atom in the same block (atom-accurate from/to)", () => {
    const m = mountWith(makeAtomContent());
    const ed = m.editor;
    try {
      warmBus(ed);
      const re = compileQuery("TARGET", { caseSensitive: true, wholeWord: false })!;
      const hits = searchMainText(ed, re);
      expect(hits).toHaveLength(1);
      const hit = hits[0];
      // The baked from/to read the right text DESPITE the atom sitting before
      // the match (a naive char-offset would be one short).
      expect(ed.state.doc.textBetween(hit.from, hit.to)).toBe("TARGET");
      // Live re-resolution also lands on TARGET.
      const live = resolveLiveBlockRange(ed, hit.blockId!);
      expect(live).not.toBeNull();
      expect(ed.state.doc.textBetween(live!.from, live!.to)).toBe("TARGET");
    } finally {
      m.cleanup();
    }
  });

  it("returns null when the anchoring block was deleted (snapshot present, block absent — the click must no-op)", () => {
    warmBus(editor);
    const re = compileQuery("WIDGET", { caseSensitive: true, wholeWord: false })!;
    const hit = searchMainText(editor, re)[0];
    // Bus is warm and carries the block → live resolution succeeds pre-delete.
    expect(resolveLiveBlockRange(editor, hit.blockId!)).not.toBeNull();

    // Delete the entire second paragraph (the block the hit anchors to). This
    // is a structural edit → the bus re-emits and drops the block from the
    // snapshot.
    const firstPara = editor.state.doc.content.child(0);
    const firstParaEnd = firstPara.nodeSize; // boundary after para 1
    editor.view.dispatch(
      editor.state.tr.delete(firstParaEnd, editor.state.doc.content.size),
    );

    // The block is gone but the snapshot is present → null, NOT undefined.
    expect(resolveLiveBlockRange(editor, hit.blockId!)).toBeNull();
  });

  it("returns undefined (not null) when there is no snapshot at all — the only case the baked fallback serves", () => {
    const re = compileQuery("WIDGET", { caseSensitive: true, wholeWord: false })!;
    const hit = searchMainText(editor, re)[0];
    expect(resolveLiveBlockRange(null, hit.blockId!)).toBeUndefined();
  });
});

describe("charOffsetToPm endpoint semantics — matches at inline-atom boundaries", () => {
  it("a match STARTING directly after an atom anchors on the text, not the atom's PM slot", () => {
    const m = mountWith(makeBoundaryStartContent());
    const ed = m.editor;
    try {
      warmBus(ed);
      const re = compileQuery("TARGET", { caseSensitive: true, wholeWord: false })!;
      const hits = searchMainText(ed, re);
      expect(hits).toHaveLength(1);
      const hit = hits[0];

      // Assert the PM positions themselves (textBetween can't see this bug —
      // the atom contributes no chars). Doc: para open @0, "Lead " @1..6,
      // footnote atom @6..7, "TARGET word." @7..19. The match must start AT
      // the text (7), not on the atom slot (6) the old inclusive bound chose.
      expect(hit.from).toBe(7);
      expect(hit.to).toBe(13);
      expect(ed.state.doc.nodeAt(hit.from)?.isText).toBe(true);
      // The slot directly before the match start IS the atom — the match
      // begins immediately after it without swallowing it.
      expect(ed.state.doc.nodeAt(hit.from - 1)?.type.name).toBe("footnote");
      expect(ed.state.doc.textBetween(hit.from, hit.to)).toBe("TARGET");

      // The durable identity carries the corrected intra-block PM offset, so
      // live re-resolution reproduces the same correct range (not the
      // atom-swallowing one).
      expect(hit.blockId).toEqual({
        blockUuid: "uuid-boundary-para",
        offset: 6,
        length: 6,
      });
      const live = resolveLiveBlockRange(ed, hit.blockId!);
      expect(live).toEqual({ from: 7, to: 13 });
    } finally {
      m.cleanup();
    }
  });

  it("a match ENDING at an atom boundary still stops BEFORE the atom", () => {
    const m = mountWith(makeBoundaryEndContent());
    const ed = m.editor;
    try {
      warmBus(ed);
      const re = compileQuery("END", { caseSensitive: true, wholeWord: false })!;
      const hits = searchMainText(ed, re);
      expect(hits).toHaveLength(1);
      const hit = hits[0];

      // Doc: para open @0, "The END" @1..8, footnote atom @8..9. The match
      // ends at 8 — the slot AT `to` is the atom, i.e. the range stops just
      // before it and does not extend across it.
      expect(hit.from).toBe(5);
      expect(hit.to).toBe(8);
      expect(ed.state.doc.nodeAt(hit.to)?.type.name).toBe("footnote");
      expect(ed.state.doc.textBetween(hit.from, hit.to)).toBe("END");
    } finally {
      m.cleanup();
    }
  });
});

describe("resolveAnchoredHighlight — the click-time highlight policy", () => {
  it("no-ops (null) for a deleted block instead of falling back to the baked range", () => {
    warmBus(editor);
    const re = compileQuery("WIDGET", { caseSensitive: true, wholeWord: false })!;
    const hit = searchMainText(editor, re)[0];
    const baked = { from: hit.from, to: hit.to };

    // Pre-delete: resolves live.
    expect(resolveAnchoredHighlight(editor, hit.blockId!, baked)).not.toBeNull();

    // Delete the anchoring block. After a mid-doc deletion the baked range
    // can still be in bounds, so a `?? baked` fallback would amber-highlight
    // whatever unrelated text now occupies those coordinates. The policy must
    // return null → the caller clears the highlight instead.
    const firstPara = editor.state.doc.content.child(0);
    editor.view.dispatch(
      editor.state.tr.delete(firstPara.nodeSize, editor.state.doc.content.size),
    );
    expect(resolveAnchoredHighlight(editor, hit.blockId!, baked)).toBeNull();
  });

  it("falls back to the baked range ONLY when there is no snapshot at all", () => {
    const re = compileQuery("WIDGET", { caseSensitive: true, wholeWord: false })!;
    const hit = searchMainText(editor, re)[0];
    const baked = { from: hit.from, to: hit.to };
    // No editor → no bus/snapshot (the embedded-surface shape) → baked.
    expect(resolveAnchoredHighlight(null, hit.blockId!, baked)).toBe(baked);
  });
});
