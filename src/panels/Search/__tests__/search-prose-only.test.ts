// @vitest-environment jsdom
//
// Task 2026-08-31-517 (subsuming the retired 513) — main-text search reads the
// PROSE INDEX, so it stops matching inside raw LaTeX and inside `%` comments.
//
// The old `buildMainTextIndex` took every text node in every textblock with no
// carrier filtering, so searching `emph` found command names and a query
// matched inside a comment block. WHY NO PRE-517 LEG COULD SEE IT:
// `search-live-position.test.ts` — the one suite that drives `searchMainText`
// against a real document — builds paragraphs, headings and inline ATOMS, the
// single non-prose shape the old index already handled. A carrier run in a
// search fixture is unrepresentable in all of it.
//
// Every leg here drives the REAL main extension stack over the REAL parse, and
// each red leg carries its PROSE control through the identical harness — a
// suite that only proved "emph is not found" would pass on an index that finds
// nothing at all.
import { describe, expect, it, afterEach, vi } from "vitest";

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
    "mutateSidecar", "enqueueDocWrite",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { searchMainText } from "@/panels/Search/SearchPanel";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

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
  } as unknown as EditorExtensionsCtx;
}

function mount(body: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: parseLatex(
      `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
    ) as never,
  });
  return editor;
}

const hits = (body: string, term: string) =>
  searchMainText(mount(body), new RegExp(term, "gi"));

describe("main-text search sees prose only", () => {
  it("a term that appears ONLY as a command name returns zero hits", () => {
    expect(hits("Before \\foobar{inside} after.", "foobar")).toHaveLength(0);
  });

  it("…and the SAME term in prose still hits — the control", () => {
    const found = hits("The word foobar is prose here.", "foobar");
    expect(found).toHaveLength(1);
    expect(found[0].match).toBe("foobar");
  });

  it("a term inside a `%` comment BLOCK returns zero hits", () => {
    expect(hits("Prose line.\n\n% a foobar reminder\n\nMore prose.", "foobar")).toHaveLength(0);
  });

  it("a term inside a `%` comment TAIL returns zero hits", () => {
    expect(hits("Prose line. % a foobar reminder", "foobar")).toHaveLength(0);
  });

  it("a term inside a verbatim environment returns zero hits", () => {
    expect(
      hits("Prose.\n\n\\begin{verbatim}\nfoobar\n\\end{verbatim}\n\nMore.", "foobar"),
    ).toHaveLength(0);
  });

  it("a term inside an inline `\\verb` run returns zero hits", () => {
    expect(hits("Type \\verb|foobar| now.", "foobar")).toHaveLength(0);
  });

  it("a MODELED command's payload still hits — only the name is gone", () => {
    // `\emph{…}` is an italic MARK, not a carrier, so this is the pair that
    // keeps the legs above a prose test rather than a backslash test.
    const ed = mount("Some \\emph{emphasis} text.");
    expect(searchMainText(ed, /emphasis/gi)).toHaveLength(1);
    expect(searchMainText(ed, /emph\{/gi)).toHaveLength(0);
  });
});

describe("the surviving hit still lands where it says", () => {
  it("a prose hit AFTER a skipped carrier resolves to the right characters", () => {
    const ed = mount("Before \\foobar{inside} landing zone.");
    const found = searchMainText(ed, /landing/gi);
    expect(found).toHaveLength(1);
    const { from, to } = found[0];
    expect(ed.state.doc.textBetween(from, to)).toBe("landing");
  });

  it("the block-anchored identity is still recoverable", () => {
    // `blockId.offset` is a PM-position delta within the block, so a live
    // re-resolve (`block.pos + 1 + offset`) must land on the same characters.
    // The explicit `%!v:` anchor is load-bearing: `assignUuids` mints RANDOM
    // ids, so a fixture without one leaves `blockId` undefined and the leg
    // unfalsifiable in both directions.
    const ed = mount("Before \\foobar{inside} landing zone. %!v:ab12");
    const hit = searchMainText(ed, /landing/gi)[0];
    expect(hit.blockId?.blockUuid).toBe("ab12");
    const blockPos = hit.from - 1 - hit.blockId!.offset;
    const from = blockPos + 1 + hit.blockId!.offset;
    expect(ed.state.doc.textBetween(from, from + hit.blockId!.length)).toBe("landing");
  });

  it("a hit in the block AFTER a skipped comment block still lands", () => {
    // The comment block produces no span and no separator, so every offset
    // downstream of it shifts — the walk is what keeps the two coordinate
    // systems together.
    const ed = mount("First para.\n\n% a foobar reminder\n\nSecond landing para.");
    const found = searchMainText(ed, /landing/gi);
    expect(found).toHaveLength(1);
    expect(ed.state.doc.textBetween(found[0].from, found[0].to)).toBe("landing");
  });
});
